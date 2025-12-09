// ======================================================
// 🧠 VideoTopicService.js — Análisis de temas de VIDEO (IA externa)
// ------------------------------------------------------
// ✅ No rompe nada aunque el microservicio de IA NO esté configurado
// ✅ Firma compatible con el concepto original:
//      VideoTopicService.analyzePostVideo({ postId, videoUrlOrPath, text })
// ✅ Usa PostModel.topics + nuevos campos:
//      - videoTopics: [ "comedia", "deportes", ... ]
//      - videoAnalyzedAt: Date
// ✅ Pensado para llamarse desde VideoProcessingService / PostService
// ======================================================

import chalk from "chalk";
import { PostModel } from "../infrastructure/models/PostModel.js";

const DEFAULT_TIMEOUT_MS = 20_000;

// ------------------------------------------------------
// 🔌 Helper: cliente hacia microservicio de IA de video
// ------------------------------------------------------
// Espera que el microservicio exponga algo tipo:
//   POST VIDEO_TOPIC_AI_URL
//   Body JSON: { videoUrl, text, categoryHint? }
//   Respuesta: { tags: [...], raw?: any }  (tags = etiquetas de tema)
// ------------------------------------------------------

async function callExternalVideoAI({
  videoUrl,
  text,
  categoryHint,
}) {
  const endpoint = process.env.VIDEO_TOPIC_AI_URL;
  const apiKey = process.env.VIDEO_TOPIC_AI_API_KEY || null;
  const rawTimeout = process.env.VIDEO_TOPIC_AI_TIMEOUT_MS;
  const timeoutMs =
    rawTimeout && !Number.isNaN(Number(rawTimeout))
      ? Number(rawTimeout)
      : DEFAULT_TIMEOUT_MS;

  if (!endpoint) {
    console.warn(
      chalk.yellow(
        "[VideoTopicService] VIDEO_TOPIC_AI_URL no configurado. Se omite análisis de video."
      )
    );
    return null;
  }

  // Detectar fetch disponible (Node 18+) o usar node-fetch dinámico
  let fetchImpl = globalThis.fetch;
  if (!fetchImpl) {
    try {
      const mod = await import("node-fetch");
      fetchImpl = mod.default || mod;
    } catch (err) {
      console.warn(
        chalk.yellow(
          "[VideoTopicService] No hay fetch global ni node-fetch instalado. " +
            "No se puede llamar al microservicio de IA de video."
        )
      );
      return null;
    }
  }

  const payload = {
    videoUrl,
    text: text || "",
    categoryHint: categoryHint || undefined,
  };

  let controller = null;
  let timer = null;
  if (typeof AbortController !== "undefined") {
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!res.ok) {
      console.warn(
        chalk.yellow(
          `[VideoTopicService] Respuesta no OK del microservicio de IA: ${res.status} ${res.statusText}`
        )
      );
      return null;
    }

    const data = await res.json().catch(() => ({}));

    // Intentamos varias convenciones posibles: tags, topics, labels...
    const tagsRaw =
      (Array.isArray(data.tags) && data.tags) ||
      (Array.isArray(data.topics) && data.topics) ||
      (Array.isArray(data.labels) && data.labels) ||
      [];

    const tags = tagsRaw
      .map((t) => String(t || "").trim())
      .filter(Boolean);

    return {
      tags,
      raw: data,
    };
  } catch (err) {
    if (err?.name === "AbortError") {
      console.warn(
        chalk.yellow(
          `[VideoTopicService] Timeout al llamar al microservicio de IA (${timeoutMs}ms).`
        )
      );
    } else {
      console.error(
        chalk.red("[VideoTopicService] Error llamando al microservicio de IA:"),
        err?.message || err
      );
    }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ------------------------------------------------------
// 🧮 Normalización de tags
// ------------------------------------------------------
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const set = new Set();

  for (const raw of tags) {
    const t = String(raw || "").trim().toLowerCase();
    if (!t) continue;
    set.add(t);
  }

  return Array.from(set);
}

// ======================================================
// 📦 Servicio principal
// ======================================================
export class VideoTopicService {
  /**
   * Analiza el video de un POST concreto y guarda temas en la BD.
   *
   * @param {Object} params
   * @param {string} params.postId             - ID del post
   * @param {string} params.videoUrlOrPath     - URL absoluta o path /uploads/...
   * @param {string} [params.text]             - Texto asociado (título + descripción)
   * @param {string} [params.categoryHint]     - Hint opcional ("comedia", "deportes", ...)
   * @param {boolean} [params.force=false]     - Forzar re-análisis aunque ya exista videoAnalyzedAt
   */
  static async analyzePostVideo({
    postId,
    videoUrlOrPath,
    text,
    categoryHint,
    force = false,
  }) {
    try {
      if (!postId || !videoUrlOrPath) {
        console.warn(
          chalk.yellow(
            "[VideoTopicService] postId o videoUrlOrPath faltantes. Se omite análisis."
          )
        );
        return;
      }

      const post = await PostModel.findById(postId)
        .select("_id topics videoTopics videoAnalyzedAt")
        .lean();

      if (!post) {
        console.warn(
          chalk.yellow(
            `[VideoTopicService] Post ${postId} no encontrado. No se puede analizar video.`
          )
        );
        return;
      }

      if (post.videoAnalyzedAt && !force) {
        console.log(
          chalk.gray(
            `[VideoTopicService] Post ${postId} ya tenía videoAnalyzedAt. Se omite (force=false).`
          )
        );
        return;
      }

      const aiResult = await callExternalVideoAI({
        videoUrl: videoUrlOrPath,
        text: text || "",
        categoryHint,
      });

      let tags = normalizeTags(aiResult?.tags || []);

      // Si no vino nada de la IA pero tenemos un hint de categoría, lo usamos al menos.
      if (!tags.length && categoryHint) {
        tags = normalizeTags([categoryHint]);
      }

      if (!tags.length) {
        console.log(
          chalk.gray(
            `[VideoTopicService] IA no devolvió tags útiles para post ${postId}.`
          )
        );
        // Podemos elegir NO fijar videoAnalyzedAt para que en el futuro
        // se pueda reintentar cuando la IA mejore.
        return;
      }

      const now = new Date();

      await PostModel.updateOne(
        { _id: postId },
        {
          $addToSet: { topics: { $each: tags } },
          $set: {
            videoTopics: tags,
            videoAnalyzedAt: now,
          },
        }
      );

      console.log(
        chalk.green(
          `[VideoTopicService] Video de post ${postId} analizado con éxito. Tags: ${tags.join(
            ", "
          )}`
        )
      );
    } catch (err) {
      console.error(
        chalk.red("[VideoTopicService] Error en analyzePostVideo:"),
        err?.message || err
      );
      // NO re-lanzamos: nunca rompemos el flujo de publicación/procesado.
    }
  }

  /**
   * 🔁 Analiza en lote posts con video que aún no tengan videoAnalyzedAt.
   *    Pensado para cron / tarea manual de mantenimiento.
   *
   * @param {Object} params
   * @param {number} [params.limit=50]       - Máximo de posts a procesar
   */
  static async analyzePendingVideos({ limit = 50 } = {}) {
    try {
      const posts = await PostModel.find({
        "media.type": "video",
        $or: [{ videoAnalyzedAt: null }, { videoAnalyzedAt: { $exists: false } }],
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("_id media content videoTopics videoAnalyzedAt")
        .lean();

      if (!posts.length) {
        console.log(
          chalk.gray(
            "[VideoTopicService] No hay videos pendientes de análisis."
          )
        );
        return { processed: 0 };
      }

      let processed = 0;

      for (const post of posts) {
        const mediaArr = Array.isArray(post.media) ? post.media : [];
        const videoMedia = mediaArr.find((m) => m && m.type === "video");

        if (!videoMedia) continue;

        const videoPath =
          videoMedia.url ||
          videoMedia.path ||
          (typeof videoMedia.source === "string" ? videoMedia.source : null);

        if (!videoPath) continue;

        await VideoTopicService.analyzePostVideo({
          postId: post._id,
          videoUrlOrPath: videoPath,
          text: post.content || "",
          // No usamos force aquí: ya filtramos por videoAnalyzedAt inexistente
        });

        processed += 1;
      }

      console.log(
        chalk.green(
          `[VideoTopicService] analyzePendingVideos completado. Procesados: ${processed}`
        )
      );

      return { processed };
    } catch (err) {
      console.error(
        chalk.red("[VideoTopicService] Error en analyzePendingVideos:"),
        err?.message || err
      );
      return { processed: 0, error: err?.message || String(err) };
    }
  }
}

export default VideoTopicService;

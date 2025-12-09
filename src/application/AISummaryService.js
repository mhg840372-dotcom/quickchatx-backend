// ======================================================
// 🤖 QuickChatX v7.1 — AISummaryService
// GPT-4o-mini + Finanzas + MongoDB + Redis Cache (no-blocking) + config centralizada
// ======================================================

import chalk from "chalk";
import OpenAI from "openai";
import { initRedis } from "../infrastructure/RedisProvider.js";
import { MongoProvider } from "../infrastructure/MongoProvider.js";
import { config } from "../config/config.js";

const aiConfig = config.ai || {};

const OPENAI_API_KEY = aiConfig.apiKey || process.env.OPENAI_API_KEY;
const ENABLED =
  typeof aiConfig.enabled === "boolean"
    ? aiConfig.enabled
    : process.env.AI_SUMMARY_ENABLED === "true";

const LANG = aiConfig.lang || process.env.AI_SUMMARY_LANG || "es";
const MODEL = aiConfig.model || "gpt-4o-mini";

let openai = null;
let collection = null;

// ======================================================
// 🚀 Inicialización del servicio
// ======================================================
if (ENABLED && OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    console.log(
      chalk.greenBright(
        `🤖 AISummaryService habilitado (modelo ${MODEL} activo)`
      )
    );
  } catch (err) {
    console.error(
      chalk.red("❌ Error inicializando OpenAI SDK:"),
      err.message
    );
  }
} else {
  console.log(
    chalk.gray(
      "ℹ️ AISummaryService deshabilitado — falta API Key o AI_SUMMARY_ENABLED=false"
    )
  );
}

async function ensureCollection() {
  if (!MongoProvider.isConnected()) return null;
  if (!collection) {
    collection = MongoProvider.collection("ai_summaries");
    try {
      await collection.createIndex({ createdAt: -1 });
    } catch (err) {
      console.warn(
        chalk.yellow("⚠️ No se pudo crear índice en ai_summaries:"),
        err.message
      );
    }
  }
  return collection;
}

// ======================================================
// 🧠 Redis seguro (no rompe si está caído)
// ======================================================
async function safeRedis() {
  try {
    return await initRedis();
  } catch (err) {
    console.warn(
      chalk.yellow("⚠️ AISummaryService: Redis no disponible:"),
      err?.message || err
    );
    return null;
  }
}

// ======================================================
// 🧠 Servicio principal
// ======================================================
export class AISummaryService {
  /**
   * Genera un resumen IA diario basado en listas de noticias, videos y finanzas.
   * @param {Array} newsList - Noticias ({title, description})
   * @param {Array} videosList - Videos ({title, channelTitle})
   * @param {Array} financeList - Datos financieros ({symbol, price, change})
   * @returns {Promise<object|null>}
   */
  static async summarize(newsList = [], videosList = [], financeList = []) {
    if (!ENABLED || !openai) {
      console.log(
        chalk.gray(
          "⚙️ AISummaryService: IA deshabilitada, omitiendo ejecución."
        )
      );
      return null;
    }

    try {
      // ======================================================
      // 🧱 Construcción del prompt
      // ======================================================
      const newsText =
        newsList?.length > 0
          ? newsList
              .map(
                (n, i) =>
                  `${i + 1}. 📰 ${n.title}${
                    n.description ? ` — ${n.description}` : ""
                  }`
              )
              .join("\n")
          : "Sin noticias relevantes.";

      const videoText =
        videosList?.length > 0
          ? videosList
              .map(
                (v, i) =>
                  `${i + 1}. 🎬 ${v.title}${
                    v.channelTitle ? ` — Canal: ${v.channelTitle}` : ""
                  }`
              )
              .join("\n")
          : "Sin videos destacados.";

      const financeText =
        financeList?.length > 0
          ? financeList
              .map(
                (f) =>
                  `💹 ${f.symbol}: ${f.price} (${
                    f.change || "0%"
                  } variación)`
              )
              .join("\n")
          : "Sin datos financieros recientes.";

      const prompt = `
Eres un analista digital experto y periodista. Resume la información del día en idioma ${LANG}.
Incluye una narrativa fluida y coherente. Destaca los hechos más relevantes de noticias, videos y finanzas.

📋 Estructura el resumen con subtítulos:
- 🧠 Tecnología
- 🌦️ Clima
- 🏛️ Política
- 💰 Economía
- 🎥 Cine / Streaming
- 📈 Finanzas y Mercado

Evita repetir títulos. Usa un tono informativo, breve y moderno.

📰 Noticias:
${newsText}

🎬 Videos:
${videoText}

💹 Finanzas:
${financeText}
`;

      // ======================================================
      // 💬 Llamada al modelo GPT
      // ======================================================
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Eres un periodista digital experto en redacción moderna y análisis económico.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.65,
        max_tokens: 1000,
      });

      let summary =
        completion.choices?.[0]?.message?.content?.trim() || "";
      if (!summary) {
        console.warn(
          chalk.yellow(
            "⚠️ El resumen IA se generó vacío o incompleto."
          )
        );
        return null;
      }

      summary = summary.replace(/\n{3,}/g, "\n\n").trim();
      console.log(
        chalk.cyan("🧾 Resumen IA generado correctamente.")
      );

      // ======================================================
      // 💾 Guardar resumen en MongoDB + Redis Cache
      // ======================================================
      const coll = await ensureCollection();
      let savedDoc = null;
      const now = new Date();

      const doc = {
        createdAt: now,
        lang: LANG,
        totalNews: newsList.length,
        totalVideos: videosList.length,
        totalFinance: financeList.length,
        summary,
        sources: {
          news: newsList.map((n) => n.title),
          videos: videosList.map((v) => v.title),
          finance: financeList.map((f) => f.symbol),
        },
      };

      if (coll) {
        const { insertedId } = await coll.insertOne(doc);
        savedDoc = { _id: insertedId, ...doc };
        console.log(
          chalk.green(
            `💾 Resumen IA guardado en MongoDB (${insertedId})`
          )
        );
      }

      // Guardar en Redis (TTL 24h) — no bloqueante
      try {
        const redis = await safeRedis();
        if (redis) {
          const payload = JSON.stringify(doc);
          const ttlSeconds = 86400;

          redis
            .set("ai:summary:latest", payload, "EX", ttlSeconds)
            .then(() => {
              console.log(
                chalk.green(
                  "🧠 Resumen IA cacheado en Redis (24h TTL)"
                )
              );
            })
            .catch((err) => {
              console.warn(
                chalk.yellow(
                  "⚠️ No se pudo guardar resumen en Redis:"
                ),
                err?.message || err
              );
            });
        }
      } catch (err) {
        console.warn(
          chalk.yellow(
            "⚠️ No se pudo inicializar Redis para guardar resumen IA:"
          ),
          err?.message || err
        );
      }

      return savedDoc || doc;
    } catch (err) {
      console.error(
        chalk.red("❌ Error generando resumen IA:"),
        err.message
      );
      return null;
    }
  }

  // ======================================================
  // 📄 Obtener últimos resúmenes
  // ======================================================
  static async getLatest(limit = 5) {
    const coll = await ensureCollection();
    if (!coll) return [];
    return coll
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  // ======================================================
  // 🧹 Limpieza de registros antiguos
  // ======================================================
  static async cleanOld(days = 7) {
    const coll = await ensureCollection();
    if (!coll) return 0;
    const cutoff = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    );
    const result = await coll.deleteMany({
      createdAt: { $lt: cutoff },
    });
    console.log(
      chalk.gray(
        `🧹 ${result.deletedCount} resúmenes IA antiguos eliminados.`
      )
    );
    return result.deletedCount;
  }
}

export default AISummaryService;

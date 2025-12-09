// ======================================================
// 📰 src/interfaces/controllers/feedController.js
// ✅ QuickChatX v6.8 — Feed robusto (posts + news + commentsCount + avatars)
//    + normalización defensiva de URLs de imagen y media[]
//    + timings detallados por servicio y por endpoint
//    + aggregate para commentsCount (menos latencia)
//    + logFeedExposure en background (no bloquea)
//    + 🔥 Enriquecimiento con avatar/username del autor desde UserModel
//    + 🩹 buildBaseUrl sanea /api para que las imágenes no salgan negras en el feed
//    + 🧠 Usa toPublicJSON() de Post/Domain cuando está disponible
//    + 🧠 Feed personalizado con experimento de variantes topics_v1 / topics_explore_v1
// ======================================================

import { PostService } from "../../application/PostService.js";
import { NewsService } from "../../application/NewsService.js";
import { RecommendationService } from "../../application/RecommendationService.js";
import {
  getOrAssignExperimentVariant,
  logFeedExposure,
} from "../../application/UserActivityService.js";
import chalk from "chalk";
import { performance } from "node:perf_hooks";
import { initRedis } from "../../infrastructure/RedisProvider.js";

// 🧩 Import defensivo del CommentModel
import * as CommentModelModule from "../../infrastructure/models/CommentModel.js";
// 🧩 Import defensivo del UserModel (para avatars de autores)
import * as UserModelModule from "../../infrastructure/models/UserModel.js";

let postService = new PostService();
let newsService =
  typeof NewsService === "function" ? new NewsService() : NewsService;

// Detectamos el export correcto del modelo de comentarios
const CommentModel =
  CommentModelModule.default ||
  CommentModelModule.CommentModel ||
  CommentModelModule.Comment ||
  CommentModelModule.comment ||
  null;

// Detectamos el export correcto del modelo de usuarios
const UserModel =
  UserModelModule.default ||
  UserModelModule.UserModel ||
  UserModelModule.User ||
  null;

let redis = null;
async function getRedisSafe() {
  try {
    if (redis) return redis;
    redis = await initRedis();
    return redis;
  } catch {
    return null;
  }
}

// ======================================================
// 🔎 Helpers básicos
// ======================================================

function extractArray(result) {
  if (!result || result.status !== "fulfilled") return [];
  const value = result.value;

  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;

  return [];
}

// Fecha para ordenar
function getItemDate(item) {
  const d =
    item?.createdAt ||
    item?.publishedAt ||
    item?.date ||
    item?.timestamp ||
    null;
  return d ? new Date(d) : new Date(0);
}

// 🔁 Dedupe por id base (post o news)
function dedupeById(items = []) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = String(
      item.postId || item._id || item.id || item.newsId || item.slug || ""
    );
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

// ⏱️ Helper genérico para medir funciones async sin cambiar su contrato
async function timed(label, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = performance.now() - start;
    console.log(
      chalk.magenta(`⏱️ [Timing] ${label} — ${ms.toFixed(1)}ms`)
    );
    return result;
  } catch (err) {
    const ms = performance.now() - start;
    console.error(
      chalk.red(
        `❌ [Timing] ${label} falló tras ${ms.toFixed(1)}ms: ${
          err?.message || err
        }`
      )
    );
    throw err;
  }
}

// ======================================================
// 🌐 Normalización defensiva de URLs de imagen/media
// ======================================================

// Campos top-level que tratamos como URLs de media
const MEDIA_FIELDS = [
  "imageUrl",
  "thumbnailUrl",
  "mediaUrl",
  "avatarUrl",
  "image", // para news.image
];

function buildBaseUrl(req) {
  // 1) Prioridad a FILE_BASE_URL / PUBLIC_ASSETS_URL / API_BASE_URL si existen
  const envBase =
    process.env.FILE_BASE_URL ||
    process.env.PUBLIC_ASSETS_URL ||
    process.env.API_BASE_URL ||
    process.env.PUBLIC_API_URL ||
    null;

  if (envBase) {
    // 🔧 Saneamos: sin slash final y sin sufijo /api
    return envBase
      .replace(/\/+$/, "") // sin slash final
      .replace(/\/api$/i, ""); // quitamos /api si viene
  }

  // 2) Fallback al host de la request
  try {
    const proto = req?.protocol || "https";
    const host = req?.get?.("host");
    if (!host) return null;

    // También aquí limpiamos posibles /api añadidos por proxies
    return `${proto}://${host}`
      .replace(/\/+$/, "")
      .replace(/\/api$/i, "");
  } catch {
    return null;
  }
}

function normalizeMediaUrl(url, req) {
  if (!url || typeof url !== "string") return url;

  // Ya es absoluta → la dejamos tal cual
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  // Protocol-relative (//cdn...) → la respetamos
  if (url.startsWith("//")) return url;

  const base = buildBaseUrl(req);
  if (!base) return url;

  let pathPart = url;

  // Si hay "uploads/" en medio de un path absoluto de FS, lo recortamos
  const idx = pathPart.indexOf("uploads/");
  if (idx !== -1) {
    const before = idx > 0 ? pathPart[idx - 1] : "";
    const sliceFrom = before === "/" ? idx - 1 : idx;
    pathPart = pathPart.slice(sliceFrom); // "/uploads/..." o "uploads/..."
  }

  // Si empieza por "/uploads" u otra ruta absoluta
  if (pathPart.startsWith("/")) {
    return `${base}${pathPart}`;
  }

  // Si empieza por "uploads/..." → aseguramos "/uploads/..."
  if (pathPart.startsWith("uploads/")) {
    pathPart = `/${pathPart}`;
  } else {
    // Cualquier otra cosa relativa → le añadimos "/" delante
    pathPart = `/${pathPart}`;
  }

  return `${base}${pathPart}`;
}

function normalizeItemMedia(item, req) {
  if (!item || typeof item !== "object") return item;

  const cloned = { ...item };

  for (const field of MEDIA_FIELDS) {
    if (cloned[field]) {
      try {
        cloned[field] = normalizeMediaUrl(cloned[field], req);
      } catch {
        // si algo falla, dejamos el valor original
      }
    }
  }

  return cloned;
}

// Normaliza post.media[*] para que SIEMPRE haya media[i].url pública
function normalizePostMedia(post, req) {
  if (!post || typeof post !== "object") return post;
  if (!Array.isArray(post.media)) return post;

  const cloned = { ...post };
  cloned.media = post.media.map((m) => {
    if (!m || typeof m !== "object") return m;

    const mediaItem = { ...m };
    let url = mediaItem.url;
    const p = mediaItem.path || mediaItem.filePath || null;

    // 1) Si ya hay url, la normalizamos (si no es absoluta ya)
    if (url) {
      mediaItem.url = normalizeMediaUrl(url, req);
      mediaItem.path = mediaItem.url;
      return mediaItem;
    }

    // 2) Intentamos derivar url a partir de path local/relativa
    if (typeof p === "string") {
      let candidate = p;

      // Buscamos "uploads/" dentro del path y recortamos desde ahí
      const idx = candidate.indexOf("uploads/");
      if (idx !== -1) {
        const before = idx > 0 ? candidate[idx - 1] : "";
        const sliceFrom = before === "/" ? idx - 1 : idx;
        candidate = candidate.slice(sliceFrom); // "/uploads/..." o "uploads/..."
      }

      mediaItem.url = normalizeMediaUrl(candidate, req);
      mediaItem.path = mediaItem.url;
      return mediaItem;
    }

    return mediaItem;
  });

  return cloned;
}

// Helper solo para ver qué URLs se devuelven (debug)
function debugMediaUrls(label, items, limit = 5) {
  if (process.env.NODE_ENV === "production") return;
  const slice = Array.isArray(items) ? items.slice(0, limit) : [];
  console.log(`🖼️ [${label}] Primeros ${slice.length} items:`);
  slice.forEach((item, idx) => {
    const urls = {
      imageUrl: item.imageUrl,
      thumbnailUrl: item.thumbnailUrl,
      mediaUrl: item.mediaUrl,
      avatarUrl: item.avatarUrl,
      image: item.image,
      media0: Array.isArray(item.media) ? item.media[0] : null,
    };
    console.log(
      `  #${idx} id=${item._id || item.id || item.postId || item.newsId} type=${
        item.type
      }`,
      urls
    );
  });
}

// ======================================================
// 🧮 Adjuntar avatar/username del autor a POSTS
// ======================================================
async function attachAuthorsToPosts(posts = []) {
  if (!Array.isArray(posts) || posts.length === 0) return posts;
  if (!UserModel || (!UserModel.find && !UserModel.findOne)) {
    return posts;
  }

  try {
    const authorIdsSet = new Set(
      posts
        .map((p) => {
          return (
            p.authorId ||
            p.userId ||
            p.ownerId ||
            p.createdBy ||
            p.author?._id ||
            p.user?._id ||
            p.owner?._id ||
            null
          );
        })
        .filter(Boolean)
        .map((id) => String(id))
    );

    if (authorIdsSet.size === 0) return posts;

    const authorIds = Array.from(authorIdsSet);

    const users = await UserModel.find(
      { _id: { $in: authorIds } },
      "username avatarUrl profilePhoto"
    ).lean();

    const byId = new Map(
      users.map((u) => [String(u._id), u])
    );

    posts.forEach((p) => {
      const aid =
        p.authorId ||
        p.userId ||
        p.ownerId ||
        p.createdBy ||
        p.author?._id ||
        p.user?._id ||
        p.owner?._id ||
        null;

      if (!aid) return;
      const u = byId.get(String(aid));
      if (!u) return;

      const avatarUrl =
        p.avatarUrl ||
        u.avatarUrl ||
        u.profilePhoto ||
        "/uploads/default-avatar.png";

      // Rellenamos autor, respetando lo que ya hubiera
      p.author = {
        ...(p.author || {}),
        _id: p.author?._id || u._id,
        id: p.author?.id || u._id,
        username: p.author?.username || u.username,
        avatarUrl: p.author?.avatarUrl || avatarUrl,
        profilePhoto: p.author?.profilePhoto || u.profilePhoto,
      };

      // Campo plano para el frontend
      p.avatarUrl = avatarUrl;
      p.authorUsername = p.authorUsername || u.username;
    });

    return posts;
  } catch (err) {
    console.warn(
      "⚠️ No se pudo adjuntar avatar/autor a posts del feed:",
      err?.message || err
    );
    return posts;
  }
}

// ======================================================
// 🧮 Adjuntar commentsCount / likesCount / likedByUser a POSTS
//      + ahora también avatar/author (attachAuthorsToPosts)
// ======================================================
async function enrichPostsForFeed(req, posts = []) {
  if (!Array.isArray(posts) || posts.length === 0) return posts;

  const requesterId = req.user?._id || req.user?.id || null;

  // Pre-normalizamos likes + commentsCount base
  posts.forEach((p) => {
    const likesArray = Array.isArray(p.likes) ? p.likes : [];
    p.likes = likesArray;

    if (typeof p.likesCount !== "number") {
      p.likesCount = likesArray.length;
    }

    if (requesterId) {
      const likedByUser = likesArray.some(
        (id) => String(id) === String(requesterId)
      );
      p.likedByUser = likedByUser;
      if (typeof p.liked === "undefined") {
        p.liked = likedByUser;
      }
    }

    if (typeof p.commentsCount !== "number") {
      p.commentsCount = Array.isArray(p.comments) ? p.comments.length : 0;
    }
  });

  // Si no tenemos CommentModel funcional, salimos sin romper nada
  if (!CommentModel || !CommentModel.countDocuments) {
    posts.forEach((p) => {
      if (Array.isArray(p.comments)) delete p.comments;
    });
    // 🔥 Siempre adjuntamos autores aunque no haya CommentModel
    await attachAuthorsToPosts(posts);
    return posts;
  }

  const schemaHasTargetType = !!CommentModel.schema?.paths?.targetType;

  // IDs de posts a consultar
  const ids = posts
    .map((p) => String(p._id || p.id || p.postId || ""))
    .filter((id) => !!id);

  if (ids.length === 0) {
    posts.forEach((p) => {
      if (Array.isArray(p.comments)) delete p.comments;
    });
    await attachAuthorsToPosts(posts);
    return posts;
  }

  // Intentamos primero aggregate (1 sola query)
  if (typeof CommentModel.aggregate === "function") {
    try {
      const match = {
        targetId: { $in: ids },
      };
      if (schemaHasTargetType) {
        match.targetType = "post";
      }

      const agg = await CommentModel.aggregate([
        { $match: match },
        { $group: { _id: "$targetId", count: { $sum: 1 } } },
      ]);

      const map = new Map(
        agg.map((doc) => [String(doc._id), doc.count || 0])
      );

      if (map.size > 0) {
        posts.forEach((p) => {
          const pid = String(p._id || p.id || p.postId || "");
          if (!pid) return;

          const dbCount = map.get(pid) || 0;
          const baseCount =
            typeof p.commentsCount === "number" ? p.commentsCount : 0;

          p.commentsCount = Math.max(baseCount, dbCount);
          if (Array.isArray(p.comments)) delete p.comments;
        });

        await attachAuthorsToPosts(posts);
        return posts;
      }
    } catch (err) {
      console.warn(
        "⚠️ No se pudo usar aggregate para commentsCount (fallback a countDocuments por post):",
        err?.message || err
      );
    }
  }

  // Fallback: countDocuments por post (como antes)
  await Promise.all(
    posts.map(async (p) => {
      const pid = String(p._id || p.id || p.postId || "");
      if (!pid) return;

      try {
        const query = { targetId: pid };
        if (schemaHasTargetType) {
          query.targetType = "post";
        }

        const dbCount = await CommentModel.countDocuments(query);
        const baseCount =
          typeof p.commentsCount === "number" ? p.commentsCount : 0;

        p.commentsCount = Math.max(baseCount, dbCount);
      } catch (err) {
        console.warn(
          "⚠️ No se pudo calcular commentsCount para post en feed:",
          pid,
          err?.message || err
        );
      }

      if (Array.isArray(p.comments)) delete p.comments;
    })
  );

  await attachAuthorsToPosts(posts);
  return posts;
}

// ======================================================
// Normalizadores de resultados de servicios
// ======================================================

/**
 * Normaliza un array de posts (Domain Post, PostModel o plain objects)
 * para el feed:
 *  - Si el item tiene .toPublicJSON() → lo usamos (URLs absolutas correctas)
/*  - Luego normalizamos campos top-level + media[] como fallback defensivo
 */
async function mapPostsArrayForFeed(rawPosts, req) {
  const arr = Array.isArray(rawPosts) ? rawPosts : [];

  // 1) Convertimos a JSON plano, usando toPublicJSON si existe
  const baseJsonArray = await Promise.all(
    arr.map(async (item) => {
      if (item && typeof item.toPublicJSON === "function") {
        // Domain Post o PostModel
        const json = await item.toPublicJSON();
        return {
          ...json,
          type: json.type || "post",
        };
      }

      // Fallback legacy: asumimos que ya es un objeto plano de post
      return {
        ...(item || {}),
        type: item?.type || "post",
      };
    })
  );

  // 2) Aplicamos normalización defensiva de URLs
  const normalized = baseJsonArray.map((item) => {
    const base = normalizeItemMedia(item, req);
    return normalizePostMedia(base, req);
  });

  // 3) Enriquecer con likes/comments/autor
  await enrichPostsForFeed(req, normalized);
  return normalized;
}

// Para NEWS u otros tipos donde no queremos tocar nada especial salvo normalizar media
function safe(result, type, req) {
  try {
    const arr = extractArray(result);
    if (!Array.isArray(arr)) return [];
    return arr.map((item) =>
      normalizeItemMedia(
        {
          ...item,
          type: item.type || type,
        },
        req
      )
    );
  } catch {
    return [];
  }
}

// Normalizador específico para POSTS que vienen de servicios (Promise.allSettled)
async function safePosts(result, req) {
  const arr = extractArray(result);
  return mapPostsArrayForFeed(arr, req);
}

// ======================================================
// Helper para logFeedExposure en background (no bloqueante)
// ======================================================
function logFeedExposureAsync(payload) {
  // Fire-and-forget: no bloquea la respuesta HTTP
  Promise.resolve()
    .then(() => logFeedExposure(payload))
    .catch((err) => {
      console.warn(
        "⚠️ Error logFeedExposure (async):",
        err?.message || err
      );
    });
}

export const feedController = {
  // ======================================================
  // 📰 GET /api/feed
  // ======================================================
  async getFeed(req, res) {
    const controllerStart = performance.now();

    try {
      const limit = parseInt(req.query.limit, 10) || 20;
      const user = req.user || {};
      const userId = user.id || user._id || null;

      console.log(
        chalk.yellow(
          `📡 [Feed] Solicitando feed inicial (limit=${limit}) — userId=${
            userId || "anon"
          }`
        )
      );

      // newsService.getAll con timing
      const newsReq = timed("newsService.getAll (feed/getFeed)", () =>
        newsService.getAll({ limit })
      );

      let combinedPosts = [];
      let newsArr = [];

      if (userId) {
        // Timings separados por servicio
        const recPromise = timed(
          "RecommendationService.getPersonalizedFeedForUser (feed/getFeed)",
          () =>
            RecommendationService.getPersonalizedFeedForUser(userId, {
              limit,
              algoVariant: "topics_v1",
            })
        );

        const recentPromise = timed(
          "postService.getPaginated (feed/getFeed)",
          () => postService.getPaginated(0, limit)
        );

        const promises = [recPromise, recentPromise, newsReq];

        const [recResult, recentResult, newsResult] =
          await Promise.allSettled(promises);

        const recPosts = await safePosts(recResult, req);
        const recentPosts = await safePosts(recentResult, req);

        combinedPosts = dedupeById([...recentPosts, ...recPosts]);
        newsArr = safe(newsResult, "news", req);

        console.log(
          chalk.cyan(
            `📊 [Feed] Mezcla logueado → recPosts=${recPosts.length} recentPosts=${recentPosts.length} news=${newsArr.length}`
          )
        );
      } else {
        const postsPromise = timed(
          "postService.getPaginated (feed/getFeed-anon)",
          () => postService.getPaginated(0, limit)
        );

        const promises = [postsPromise, newsReq];
        const [postsResult, newsResult] = await Promise.allSettled(promises);

        combinedPosts = await safePosts(postsResult, req);
        newsArr = safe(newsResult, "news", req);

        console.log(
          chalk.cyan(
            `📊 [Feed] Mezcla anónimo → posts=${combinedPosts.length} news=${newsArr.length}`
          )
        );
      }

      const combined = [...combinedPosts, ...newsArr].sort(
        (a, b) => getItemDate(b) - getItemDate(a)
      );

      // Debug suave de URLs (solo en NO producción)
      debugMediaUrls("Feed/getFeed", combined, 10);

      // logFeedExposure en background (no bloquea)
      try {
        const userIdForLog = req.user?.id || req.user?._id;
        if (userIdForLog) {
          const itemsForLog = combined.slice(0, limit).map((item, index) => ({
            id: item.id || item._id || item.postId || item.newsId,
            type: item.type || "post",
            position: index,
          }));

          logFeedExposureAsync({
            userId: userIdForLog,
            experimentKey: null,
            variant: null,
            algoName: "feed_mixed_personalized_v1_fallback",
            items: itemsForLog,
          });
        }
      } catch (logErr) {
        console.warn(
          "⚠️ Error preparando logFeedExposure en getFeed:",
          logErr?.message || logErr
        );
      }

      const totalMs = performance.now() - controllerStart;
      const color =
        totalMs > 800
          ? chalk.red
          : totalMs > 400
          ? chalk.yellow
          : chalk.green;

      console.log(
        color(
          `⏱️ [Feed/getFeed] total=${totalMs.toFixed(
            1
          )}ms — items=${combined.length} limit=${limit}`
        )
      );

      return res.json({
        success: true,
        total: combined.length,
        data: combined,
      });
    } catch (err) {
      const totalMs = performance.now() - controllerStart;
      console.error(
        chalk.red(
          `❌ Error en getFeed tras ${totalMs.toFixed(1)}ms: ${
            err?.message || err
          }`
        ),
        err
      );
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  // ======================================================
  // 🧠 GET /api/feed/personalized
  // ======================================================
  async getPersonalizedFeed(req, res) {
    const controllerStart = performance.now();

    try {
      const user = req.user || {};
      const userId = user.id || user._id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "No autenticado",
        });
      }

      const limit = parseInt(req.query.limit, 10) || 20;

      console.log(
        chalk.yellow(
          `🎯 [Feed] Solicitando feed personalizado para usuario ${userId}...`
        )
      );

      const experimentKey = "feed_algo_v1";
      const variants = ["topics_v1", "topics_explore_v1"];

      let algoVariant = null;
      try {
        algoVariant = await getOrAssignExperimentVariant(
          userId,
          experimentKey,
          variants
        );
      } catch (expErr) {
        console.warn(
          "⚠️ Error en getOrAssignExperimentVariant:",
          expErr?.message || expErr
        );
      }

      // Fallback seguro: siempre usamos una variante conocida para el algoritmo
      const variantForAlgo =
        algoVariant && variants.includes(algoVariant)
          ? algoVariant
          : "topics_v1";

      // Cache Redis por usuario + variante (TTL corto)
      let cacheKey = null;
      try {
        const redisClient = await getRedisSafe();
        if (redisClient) {
          cacheKey = `feed:personalized:${userId}:limit:${limit}:variant:${variantForAlgo}`;
          const cached = await redisClient.get(cacheKey);
          if (cached) {
            const payload = JSON.parse(cached);
            const totalMs = performance.now() - controllerStart;
            console.log(
              chalk.green(
                `⚡ [Feed/getPersonalizedFeed] cache-hit (${cacheKey}) — ${totalMs.toFixed(
                  1
                )}ms`
              )
            );
            return res.json({
              success: true,
              total: payload?.length || 0,
              data: payload || [],
              source: "cache",
              algoVariant: variantForAlgo,
            });
          }
        }
      } catch (cacheErr) {
        console.warn(
          "⚠️ Cache feed personalizada falló:",
          cacheErr?.message || cacheErr
        );
      }

      const posts = await timed(
        "RecommendationService.getPersonalizedFeedForUser (feed/personalized)",
        () =>
          RecommendationService.getPersonalizedFeedForUser(userId, {
            limit,
            algoVariant: variantForAlgo,
          })
      );

      const data = await mapPostsArrayForFeed(posts, req);

      debugMediaUrls("Feed/getPersonalizedFeed", data, 10);

      // logFeedExposure en background
      try {
        const itemsForLog = data.map((item, index) => ({
          id: item.id || item._id || item.postId,
          type: item.type || "post",
          position: index,
          score: item.score || item.finalScore || null,
        }));

        logFeedExposureAsync({
          userId,
          experimentKey,
          variant: variantForAlgo,
          algoName: variantForAlgo,
          items: itemsForLog,
        });
      } catch (logErr) {
        console.warn(
          "⚠️ Error preparando logFeedExposure en getPersonalizedFeed:",
          logErr?.message || logErr
        );
      }

      const totalMs = performance.now() - controllerStart;
      const color =
        totalMs > 800
          ? chalk.red
          : totalMs > 400
          ? chalk.yellow
          : chalk.green;

      console.log(
        color(
          `⏱️ [Feed/getPersonalizedFeed] total=${totalMs.toFixed(
            1
          )}ms — items=${data.length} limit=${limit} variant=${variantForAlgo}`
        )
      );

      // Guardar cache si se construyó
      try {
        const redisClient = cacheKey ? await getRedisSafe() : null;
        const ttl = Number(process.env.FEED_PERSONALIZED_CACHE_TTL || 45);
        if (redisClient && cacheKey && ttl > 0) {
          await redisClient.set(
            cacheKey,
            JSON.stringify(data),
            "EX",
            ttl
          );
        }
      } catch (cacheErr) {
        console.warn(
          "⚠️ No se pudo cachear feed personalizado:",
          cacheErr?.message || cacheErr
        );
      }

      return res.json({
        success: true,
        total: data.length,
        data,
        algoVariant: variantForAlgo,
      });
    } catch (err) {
      const totalMs = performance.now() - controllerStart;
      console.error(
        chalk.red(
          `❌ Error en getPersonalizedFeed tras ${totalMs.toFixed(
            1
          )}ms: ${err?.message || err}`
        ),
        err
      );
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  // ======================================================
  // ♻️ GET /api/feed/refresh
  // ======================================================
  async refreshFeed(req, res) {
    const controllerStart = performance.now();

    try {
      const { since: sinceParam, limit: limitParam } = req.query;

      const since = sinceParam ? new Date(sinceParam) : null;
      if (!since || Number.isNaN(since.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Fecha inválida en parámetro 'since'",
        });
      }

      const limit = parseInt(limitParam, 10) || 20;

      const postsPromise = timed(
        "postService.getNewerThan (feed/refresh)",
        // PostService admite Date o ISO string → new Date() lo resuelve igual
        () => postService.getNewerThan(since, limit)
      );

      let newsPromise;
      if (
        newsService &&
        (typeof newsService.getNewsNewerThan === "function" ||
          typeof newsService.constructor?.getNewsNewerThan === "function")
      ) {
        const fn =
          newsService.getNewsNewerThan ||
          newsService.constructor.getNewsNewerThan;

        newsPromise = timed(
          "newsService.getNewsNewerThan (feed/refresh)",
          () => fn.call(newsService, since, { limit })
        );
      } else {
        newsPromise = timed(
          "newsService.getAll fallback (feed/refresh)",
          () => newsService.getAll({ limit })
        );
      }

      const [postsResult, newsResult] = await Promise.allSettled([
        postsPromise,
        newsPromise,
      ]);

      const postsArr = await safePosts(postsResult, req);
      const newsArr = safe(newsResult, "news", req);

      console.log(
        chalk.cyan(
          `📊 [Feed/refresh] posts=${postsArr.length} news=${newsArr.length} since=${since.toISOString()}`
        )
      );

      const combined = [...postsArr, ...newsArr].sort(
        (a, b) => getItemDate(b) - getItemDate(a)
      );

      debugMediaUrls("Feed/refresh", combined, 10);

      // logFeedExposure en background
      try {
        const user = req.user || {};
        const userId = user.id || user._id;
        if (userId) {
          const itemsForLog = combined.map((item, index) => ({
            id: item.id || item._id || item.postId || item.newsId,
            type: item.type || "post",
            position: index,
          }));

          logFeedExposureAsync({
            userId,
            experimentKey: null,
            variant: null,
            algoName: "feed_refresh_v1",
            items: itemsForLog,
          });
        }
      } catch (logErr) {
        console.warn(
          "⚠️ Error preparando logFeedExposure en refreshFeed:",
          logErr?.message || logErr
        );
      }

      const totalMs = performance.now() - controllerStart;
      const color =
        totalMs > 800
          ? chalk.red
          : totalMs > 400
          ? chalk.yellow
          : chalk.green;

      console.log(
        color(
          `⏱️ [Feed/refresh] total=${totalMs.toFixed(
            1
          )}ms — items=${combined.length} limit=${limit}`
        )
      );

      return res.json({
        success: true,
        total: combined.length,
        data: combined,
      });
    } catch (err) {
      const totalMs = performance.now() - controllerStart;
      console.error(
        chalk.red(
          `❌ Error en refreshFeed tras ${totalMs.toFixed(1)}ms: ${
            err?.message || err
          }`
        ),
        err
      );
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  // ======================================================
  // ⚙️ GET /api/feed/paginate
  // ======================================================
  async paginateFeed(req, res) {
    const controllerStart = performance.now();

    try {
      const skip = parseInt(req.query.skip, 10) || 0;
      const limit = parseInt(req.query.limit, 10) || 20;

      const page = skip / limit + 1;
      console.log(
        chalk.yellow(
          `📄 [Feed] Paginando feed (page=${page}, skip=${skip}, limit=${limit})`
        )
      );

      const postsReq = timed(
        "postService.getPaginated (feed/paginate)",
        () => postService.getPaginated(skip, limit)
      );

      const newsReq = timed(
        "newsService.getAll (feed/paginate)",
        () => newsService.getAll({ skip, limit })
      );

      const [postsResult, newsResult] = await Promise.allSettled([
        postsReq,
        newsReq,
      ]);

      const postsArr = await safePosts(postsResult, req);
      const newsArr = safe(newsResult, "news", req);

      console.log(
        chalk.cyan(
          `📊 [Feed/paginate] posts=${postsArr.length} news=${newsArr.length} page=${page}`
        )
      );

      const combined = [...postsArr, ...newsArr].sort(
        (a, b) => getItemDate(b) - getItemDate(a)
      );

      debugMediaUrls("Feed/paginate", combined, 10);

      // logFeedExposure en background
      try {
        const user = req.user || {};
        const userId = user.id || user._id;
        if (userId) {
          const itemsForLog = combined.map((item, index) => ({
            id: item.id || item._id || item.postId || item.newsId,
            type: item.type || "post",
            position: skip + index,
          }));

          logFeedExposureAsync({
            userId,
            experimentKey: null,
            variant: null,
            algoName: "feed_paginate_v1",
            items: itemsForLog,
          });
        }
      } catch (logErr) {
        console.warn(
          "⚠️ Error preparando logFeedExposure en paginateFeed:",
          logErr?.message || logErr
        );
      }

      const totalMs = performance.now() - controllerStart;
      const color =
        totalMs > 800
          ? chalk.red
          : totalMs > 400
          ? chalk.yellow
          : chalk.green;

      console.log(
        color(
          `⏱️ [Feed/paginate] total=${totalMs.toFixed(
            1
          )}ms — items=${combined.length} limit=${limit} page=${page}`
        )
      );

      return res.json({
        success: true,
        total: combined.length,
        data: combined,
      });
    } catch (err) {
      const totalMs = performance.now() - controllerStart;
      console.error(
        chalk.red(
          `❌ Error en paginateFeed tras ${totalMs.toFixed(1)}ms: ${
            err?.message || err
          }`
        ),
        err
      );
      return res.status(500).json({ success: false, error: err.message });
    }
  },

  // ======================================================
  // 🧠 Debug
  // ======================================================
  async debugStatus(req, res) {
    return res.json({
      success: true,
      status: "FeedController operativo",
      services: {
        posts: !!postService,
        news: !!newsService,
        comments: !!CommentModel,
        users: !!UserModel,
      },
      timestamp: new Date(),
    });
  },
};

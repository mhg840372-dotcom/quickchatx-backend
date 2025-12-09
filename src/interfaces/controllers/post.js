// ======================================================
// 📌 postController.js — v27.2 PRO + VIDEO JSON + TRANSCODE + REPOST (2025)
// ------------------------------------------------------
// ✔ Soft Delete + Eliminación REAL de archivos multimedia
// ✔ createPost seguro en /uploads/<username>/<file>
// ✔ Soporta posts con o sin texto (solo media OK)
// ✔ getPostsByUser /user/:id & /me
// ✔ getNewer + getOlder (scroll infinito + refresh)
// ✔ likesCount, likedByUser, commentsCount (CommentModel)
// ✔ Normaliza media + URLs absolutas (solo fallback)
// ✔ Compatible PostService v15.x , uploadMiddleware v16+
// ✔ 🆕 getPostVideoManifest: JSON ligero solo del video (enriquecido)
// ✔ 🆕 Feed usa PostModel.toPublicJSON (video JSON completo)
// ✔ 🆕 createPost soporta portada de video + watermark metadata
// ✔ 🆕 Integra VideoModel (ffmpeg) para variants/duration/thumb
// ✔ 🆕 registerView: contador de views de post/video + IA intereses
// ✔ 🆕 repostPost: crear repost + contador de reposts
// ======================================================

import { PostService } from "../../application/PostService.js";
import { MongoProvider } from "../../infrastructure/MongoProvider.js";
import { CommentService } from "../../application/CommentService.js";
import { PostModel } from "../../infrastructure/models/PostModel.js";
import * as CommentModelModule from "../../infrastructure/models/CommentModel.js";
import VideoModel from "../../infrastructure/models/VideoModel.js";
import { createVideoRecordForUpload } from "../../application/VideoProcessingService.js";
import { User } from "../../domain/User.js";
import { InteractionService } from "../../application/InteractionService.js";
import Upload from "../../domain/Upload.js";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";

const CommentModel =
  CommentModelModule.default ||
  CommentModelModule.CommentModel ||
  CommentModelModule.Comment ||
  CommentModelModule.comment ||
  null;

// ======================================================
// 🌍 HOST
// ======================================================
function getRealHost() {
  return (
    process.env.PUBLIC_ASSETS_URL ||
    process.env.API_BASE_URL ||
    "https://api.quickchatx.com"
  ).replace(/\/+$/, "");
}
function buildPublicURLFromPath(localPath) {
  if (!localPath) return null;
  return `${getRealHost()}${localPath}`;
}

// ======================================================
// ☁️ Config R2 (para eliminar objetos al borrar posts)
// ======================================================
const UPLOAD_DRIVER = process.env.UPLOAD_DRIVER || "local";
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

let r2DeleteClient = null;
if (
  UPLOAD_DRIVER === "r2" &&
  R2_BUCKET &&
  R2_ENDPOINT &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY
) {
  r2DeleteClient = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    // Evita headers de checksum que requieren Content-Length en streams.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

// ======================================================
// 🧩 Singleton
// ======================================================
let postService = null;
async function ensurePostService() {
  if (!MongoProvider.isConnected()) await MongoProvider.waitForConnection();
  if (!postService) postService = new PostService();
  return postService;
}

// ======================================================
// 🎨 Normalizar media storage → frontend-ready (FALLBACK)
// ======================================================
function normalizeMedia(username, mediaArr = []) {
  if (!Array.isArray(mediaArr)) return [];

  const safeUser = username?.toLowerCase() || "posts";

  return mediaArr
    .map((file) => {
      if (!file) return null;

      const rawPath = file.path || "";
      let filename =
        file.filename ||
        (rawPath ? rawPath.split("/").pop() : null) ||
        `media_${Date.now()}`;

      const mime = file.mime || file.mimetype || file.type || "";
      const type = mime?.startsWith("video") ? "video" : "image";

      let localPath = rawPath;
      if (!localPath.startsWith("/uploads/")) {
        localPath = `/uploads/${safeUser}/${filename}`;
      }

      return {
        type,
        filename,
        path: localPath,
        mime,
        size: file.size || null,
        url: buildPublicURLFromPath(localPath),
      };
    })
    .filter(Boolean);
}

// ======================================================
// 🧱 Normalizador general de Post
// ======================================================
async function safePostJSON(req, post) {
  if (!post) return null;

  const hasToPublic = typeof post.toPublicJSON === "function";

  const base = hasToPublic
    ? await post.toPublicJSON()
    : JSON.parse(JSON.stringify(post));

  const username =
    base.authorUsername ||
    (!hasToPublic && post.authorUsername) ||
    req.user?.username ||
    "unknown";

  // Si viene del modelo/domain con toPublicJSON → media ya viene lista
  if (!hasToPublic) {
    base.media = normalizeMedia(username, base.media || []);
  } else {
    base.media = Array.isArray(base.media) ? base.media : [];
  }

  const postId = String(base._id || base.id || "");

  let commentsCount =
    typeof base.commentsCount === "number" ? base.commentsCount : 0;

  if (postId && CommentModel?.countDocuments) {
    try {
      const dbCount = await CommentModel.countDocuments({
        targetId: postId,
        targetType: "post",
      });
      commentsCount = Math.max(commentsCount, dbCount);
    } catch {
      // silencioso
    }
  }
  base.commentsCount = commentsCount;

  base.likes = Array.isArray(base.likes) ? base.likes : [];
  base.likesCount =
    typeof base.likesCount === "number" ? base.likesCount : base.likes.length;

  if (base._id && !base.id) base.id = String(base._id);
  if (base.id && !base._id) base._id = base.id;

  const requesterId = req.user?._id || req.user?.id;
  if (requesterId) {
    const rid = String(requesterId);
    base.likedByUser = base.likes.some((id) => String(id) === rid);
    base.liked = base.likedByUser;
  }

  delete base.comments;
  return base;
}

// ======================================================
// 🔧 Helpers video manifest
// ======================================================
function extractUploadsPath(urlOrPath) {
  if (!urlOrPath) return null;
  const str = urlOrPath.toString();
  const marker = "/uploads/";
  const idx = str.indexOf(marker);
  if (idx === -1) return null;
  return str.slice(idx); // incluye "/uploads/..."
}

// 🔎 Obtiene ruta relativa limpia desde media (path/url/originalPath)
function resolveMediaRelPath(media) {
  if (!media) return null;

  const candidates = [
    media.originalPath,
    media.path,
    media.url,
    media.filename,
  ];

  for (const c of candidates) {
    const rel = extractUploadsPath(c);
    if (rel) return rel;
  }
  return null;
}

// 🧹 Elimina archivo local si existe
function tryDeleteLocal(relPath) {
  if (!relPath) return;
  const baseUploads =
    process.env.UPLOADS_DIR ||
    process.env.UPLOAD_DIR ||
    path.resolve("./uploads");

  const clean = relPath.replace(/^\/+uploads\//, "").replace(/^uploads\//, "");
  const absolutePath = path.join(baseUploads, clean);

  try {
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      console.log("🗑 Archivo eliminado:", absolutePath);
    }
  } catch (e) {
    console.warn(
      "⚠️ No se pudo eliminar archivo local:",
      absolutePath,
      e?.message || e
    );
  }
}

// ☁️ Elimina objeto en R2 si aplica
async function tryDeleteR2(relPath) {
  if (!r2DeleteClient || !relPath) return;
  try {
    const key = relPath
      .replace(/^\/+/, "")
      .replace(/^uploads\//, "uploads/");

    await r2DeleteClient.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    console.log("🗑 R2 objeto eliminado:", key);
  } catch (e) {
    console.warn("⚠️ No se pudo eliminar objeto R2:", e?.message || e);
  }
}

async function findVideoDocForMedia(ownerIdRaw, videoMedia) {
  try {
    const ownerId = ownerIdRaw ? String(ownerIdRaw) : null;

    const candidates = new Set();

    if (videoMedia.path) {
      const p = extractUploadsPath(videoMedia.path);
      if (p) candidates.add(p);
    }

    if (videoMedia.url) {
      const p = extractUploadsPath(videoMedia.url);
      if (p) candidates.add(p);
    }

    if (Array.isArray(videoMedia.variants)) {
      for (const v of videoMedia.variants) {
        const p = extractUploadsPath(v?.url);
        if (p) candidates.add(p);
      }
    }

    const arr = Array.from(candidates);
    if (!arr.length) return null;

    for (const localPath of arr) {
      const baseFilter = ownerId ? { ownerId } : {};

      let doc =
        (await VideoModel.findOne({
          ...baseFilter,
          originalUrl: localPath,
        })) ||
        (await VideoModel.findOne({
          ...baseFilter,
          sourcePath: localPath,
        }).catch(() => null)) || // sourcePath es opcional
        (await VideoModel.findOne({
          ...baseFilter,
          "variants.url": localPath,
        }));

      if (doc) return doc;
    }

    return null;
  } catch (e) {
    console.warn(
      "[postController] Error buscando VideoModel para media:",
      e?.message || e
    );
    return null;
  }
}

// ======================================================
// 📝 Crear publicación (con portada de video + watermark)
// ======================================================
export async function createPost(req, res) {
  try {
    const body = req.body || {};

    const rawContent =
      typeof body.content === "string"
        ? body.content
        : typeof body.text === "string"
        ? body.text
        : typeof body.message === "string"
        ? body.message
        : "";

    const content = rawContent.trim();

    // Archivos desde hybridUpload / multer
    const files = Array.isArray(req.files)
      ? req.files
      : req.files
      ? Object.values(req.files).flat()
      : [];

    // Dedup rápido: evita que el mismo archivo se procese dos veces
    const dedupedFiles = (() => {
      const seen = new Set();
      const out = [];
      for (const f of files) {
        if (!f) continue;
        const name = f.originalname || f.filename || f.path || "file";
        const size =
          typeof f.size === "number"
            ? f.size
            : f.buffer?.length || 0;
        const key = `${name}::${size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
      }
      return out;
    })();

    const user = req.user;
    const userId = user?.id || user?._id;

    if (!userId || !user?.username) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!content && dedupedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar texto o archivos",
      });
    }

    const username = user.username.toLowerCase();
    const uploadRoot = path.resolve("./uploads");
    const userDir = path.join(uploadRoot, username);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

    // Opcional: índice de portada (coverIndex) desde el body
    let coverIndexFromBody = null;
    if (typeof body.coverIndex !== "undefined") {
      const n = parseInt(body.coverIndex, 10);
      if (!Number.isNaN(n) && n >= 0) coverIndexFromBody = n;
    }

    const normalizedFiles = dedupedFiles.map((f, index) => {
      const ext = path.extname(f.originalname || f.filename || "");
      const filename =
        f.filename ||
        `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

      let finalPath = f.path || "";
      if (!finalPath.includes("/uploads/")) {
        const target = path.join(userDir, filename);
        if (f.path && fs.existsSync(f.path)) {
          fs.renameSync(f.path, target);
        } else if (f.buffer) {
          fs.writeFileSync(target, f.buffer);
        }
        finalPath = `/uploads/${username}/${filename}`;
      } else {
        const idx = finalPath.indexOf("/uploads/");
        finalPath = finalPath.slice(idx);
      }

      const mime = f.mimetype || f.mime || "";

      let type = "image";
      if (mime?.startsWith("video")) type = "video";
      else if (mime?.startsWith("image")) type = "image";

      const isCover =
        f.fieldname === "cover" ||
        f.fieldname === "thumbnail" ||
        f.fieldname === "poster" ||
        coverIndexFromBody === index;

      return {
        filename,
        path: finalPath,
        mimetype: mime || null,
        mime: mime || null,
        type,
        size: f.size || null,
        fieldname: f.fieldname,
        isCover: !!isCover,
        // Si algún middleware añade duración/width/height, las dejamos pasar
        durationSec:
          typeof f.durationSec === "number"
            ? f.durationSec
            : typeof f.duration === "number"
            ? f.duration
            : typeof f.videoDuration === "number"
            ? f.videoDuration
            : typeof f.length === "number"
            ? f.length
            : undefined,
        width: typeof f.width === "number" ? f.width : undefined,
        height: typeof f.height === "number" ? f.height : undefined,
      };
    });

    // 🎬 Transcodificar en caliente todos los videos adjuntos
    // (si falla ffmpeg o Mongo, se loguea y se ignora: la subida NO se rompe)
    for (const f of normalizedFiles) {
      if (f.type === "video") {
        try {
          await createVideoRecordForUpload({
            user,
            localPath: f.path,
            mime: f.mime || undefined,
            size: f.size || undefined,
          });
        } catch (e) {
          console.warn(
            "[postController] No se pudo procesar video para manifest:",
            e?.message || e
          );
        }
      }
    }

    // Flag opcional para marcar que el video tiene o tendrá watermark
    const applyWatermark =
      body.videoWatermark === "1" ||
      body.videoWatermark === "true" ||
      body.videoWatermark === true;

    const videoWatermark = applyWatermark
      ? {
          enabled: true,
          userId: String(userId),
          username: user.username,
        }
      : null;

    const service = await ensurePostService();
    let post = await service.createPost({
      authorId: userId,
      authorUsername: username,
      content,
      files: normalizedFiles,
      // nuevos campos opcionales (backwards compatible)
      videoWatermark,
      coverIndex: coverIndexFromBody,
    });

    post = await safePostJSON(req, post);
    return res.status(201).json({ success: true, data: post });
  } catch (err) {
    console.error("❌ ERROR createPost:", err);
    return res.status(500).json({
      success: false,
      error: "Error interno al crear publicación",
    });
  }
}

// ======================================================
// 📰 FEED
// ======================================================
export async function getFeed(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const postsRaw = await PostModel.find({
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const posts = await Promise.all(postsRaw.map((p) => safePostJSON(req, p)));

    return res.json({
      success: true,
      page,
      limit,
      count: posts.length,
      data: posts,
    });
  } catch (err) {
    console.error("❌ ERROR getFeed:", err);
    return res.status(500).json({
      success: false,
      error: "Error al obtener feed",
    });
  }
}

// ======================================================
// 🆕 NUEVOS POSTS (refresh)
// ======================================================
export async function getNewer(req, res) {
  try {
    const { since } = req.query;
    if (!since)
      return res.status(400).json({
        success: false,
        error: "Parámetro 'since' requerido",
      });

    const date = new Date(since);
    if (isNaN(date.getTime()))
      return res.status(400).json({
        success: false,
        error: "Fecha inválida",
      });

    const postsRaw = await PostModel.find({
      createdAt: { $gt: date },
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    })
      .sort({ createdAt: -1 })
      .limit(50);

    const posts = await Promise.all(postsRaw.map((p) => safePostJSON(req, p)));

    return res.json({
      success: true,
      count: posts.length,
      data: posts,
    });
  } catch (err) {
    console.error("❌ ERROR getNewer:", err);
    return res.status(500).json({
      success: false,
      error: "Error interno al obtener nuevos posts",
    });
  }
}

// ======================================================
// 🔽 POSTS ANTIGUOS (scroll infinito)
// ======================================================
export async function getOlder(req, res) {
  try {
    const { before } = req.query;
    if (!before)
      return res.status(400).json({
        success: false,
        error: "Parámetro 'before' requerido",
      });

    const date = new Date(before);
    if (isNaN(date.getTime()))
      return res.status(400).json({
        success: false,
        error: "Fecha inválida",
      });

    const postsRaw = await PostModel.find({
      createdAt: { $lt: date },
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    })
      .sort({ createdAt: -1 })
      .limit(50);

    const posts = await Promise.all(postsRaw.map((p) => safePostJSON(req, p)));

    return res.json({
      success: true,
      count: posts.length,
      data: posts,
    });
  } catch (err) {
    console.error("❌ ERROR getOlder:", err);
    return res.status(500).json({
      success: false,
      error: "Error interno al obtener posts antiguos",
    });
  }
}

// ======================================================
// ❤️ Like
// ======================================================
export async function likePost(req, res) {
  try {
    const uid = req.user?._id || req.user?.id;
    if (!uid) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    const service = await ensurePostService();
    let updated = await service.likePost(req.params.id, uid);

    updated = await safePostJSON(req, updated);
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("❌ ERROR likePost:", err);
    return res
      .status(500)
      .json({ success: false, error: "Error al dar like" });
  }
}

// ======================================================
// 🔁 REPOST PUBLICACIÓN
// ------------------------------------------------------
// POST /posts/repost
// Body esperado (frontend):
//   { postId, note?, url? / originalUrl? }
// Devuelve:
//   {
//     success: true,
//     repostsCount,
//     data: {
//       repostsCount,
//       originalId,
//       repostId,
//       repost?: <post normalizado opcional>
//     }
//   }
// ======================================================
export async function repostPost(req, res) {
  try {
    const userId = req.user?._id || req.user?.id;
    const username =
      req.user?.username ||
      req.user?.userName ||
      req.user?.name ||
      "unknown";

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    const body = req.body || {};

    // Soporta varias formas: postId en body o param id
    const postId =
      body.postId ||
      body.id ||
      body.post ||
      req.params?.id ||
      null;

    if (!postId || !mongoose.isValidObjectId(postId)) {
      return res.status(400).json({
        success: false,
        error: "ID de publicación inválido",
      });
    }

    const original = await PostModel.findById(postId);
    if (!original || original.deletedAt) {
      return res.status(404).json({
        success: false,
        error: "Post original no encontrado",
      });
    }

    // Texto opcional del usuario
    const rawNote =
      typeof body.note === "string"
        ? body.note
        : typeof body.comment === "string"
        ? body.comment
        : typeof body.text === "string"
        ? body.text
        : "";
    const note = rawNote.trim();

    const originalContent =
      (original.content && String(original.content)) || "";

    // Combinar nota del usuario + contenido original
    const combinedContent = [note, originalContent]
      .map((t) => t && t.trim())
      .filter(Boolean)
      .join("\n\n");

    // Clonar media del post original (sin tocar documento original)
    const clonedMedia = Array.isArray(original.media)
      ? JSON.parse(JSON.stringify(original.media))
      : [];

    // Metadata opcional de la URL compartida
    const sharedUrl = body.originalUrl || body.url || null;

    // Crear nuevo post tipo "repost"
    const repostDoc = new PostModel({
      authorId: userId,
      authorUsername: username.toLowerCase(),
      content: combinedContent,
      media: clonedMedia,
      type: "repost",
      repostOf: original._id,
      originalAuthorId: original.authorId || null,
      originalAuthorUsername: original.authorUsername || null,
      sharedUrl: sharedUrl,
    });

    await repostDoc.save();

    // Actualizar contador de reposts en el post original (si la colección lo soporta)
    if (Array.isArray(original.reposts)) {
      const already = original.reposts.some(
        (id) => String(id) === String(userId)
      );
      if (!already) {
        original.reposts.push(userId);
      }
    } else {
      original.reposts = [userId];
    }

    const computedRepostsCount = Array.isArray(original.reposts)
      ? original.reposts.length
      : 1;

    if (typeof original.repostsCount === "number") {
      original.repostsCount = Math.max(
        original.repostsCount,
        computedRepostsCount
      );
    } else {
      original.repostsCount = computedRepostsCount;
    }

    await original.save();

    const repostsCount = original.repostsCount || computedRepostsCount;

    // Opcionalmente devolvemos el repost ya normalizado
    let normalizedRepost = null;
    try {
      normalizedRepost = await safePostJSON(req, repostDoc);
    } catch {
      normalizedRepost = null;
    }

    return res.status(201).json({
      success: true,
      repostsCount, // para helpers que lean directamente resp.repostsCount
      data: {
        repostsCount, // para helpers que lean resp.data.repostsCount
        originalId: String(original._id),
        repostId: String(repostDoc._id),
        repost: normalizedRepost,
      },
    });
  } catch (err) {
    console.error("❌ ERROR repostPost:", err);
    return res.status(500).json({
      success: false,
      error: "Error al crear repost",
    });
  }
}

// ======================================================
// 👁 REGISTER VIEW (viewsCount++ + IA intereses por video)
// POST /posts/:id/view
// ======================================================
export async function registerView(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: "ID inválido",
      });
    }

    const service = await ensurePostService();
    const userId = req.user?._id || req.user?.id || null;

    // 1) Incrementar contador persistente en el Post
    const updated = await service.registerView(id, userId);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Post no encontrado",
      });
    }

    const viewsCount =
      typeof updated.viewsCount === "number"
        ? updated.viewsCount
        : 0;

    // 2) Detectar si el post tiene video
    const hasVideo =
      Array.isArray(updated.media) &&
      updated.media.some((m) => {
        const rawType = (m?.type || "").toString().toLowerCase();
        const mime = (m?.mime || m?.mimetype || "")
          .toString()
          .toLowerCase();
        return rawType === "video" || mime.startsWith("video/");
      });

    // 3) Registrar vista detallada en InteractionService (IA + ActivityLog)
    //    Solo si hay usuario y el post contiene video.
    if (userId && hasVideo) {
      try {
        const body = req.body || {};

        const durationMsRaw = body.durationMs;
        const durationMs =
          typeof durationMsRaw === "number"
            ? durationMsRaw
            : Number.isFinite(Number(durationMsRaw))
            ? Number(durationMsRaw)
            : 0;

        const fullyViewed = Boolean(body.fullyViewed);
        const algoVariant = body.algoVariant ?? null;
        const algoName = body.algoName ?? null;

        const positionRaw = body.position;
        const position =
          typeof positionRaw === "number"
            ? positionRaw
            : Number.isFinite(Number(positionRaw))
            ? Number(positionRaw)
            : null;

        const rankRaw = body.rank;
        const rank =
          typeof rankRaw === "number"
            ? rankRaw
            : Number.isFinite(Number(rankRaw))
            ? Number(rankRaw)
            : null;

        const scoreRaw = body.score;
        const score =
          typeof scoreRaw === "number"
            ? scoreRaw
            : Number.isFinite(Number(scoreRaw))
            ? Number(scoreRaw)
            : null;

        const reason = body.reason ?? null;

        await InteractionService.registerView({
          itemId: id,
          type: "post",
          userId: String(userId),
          durationMs,
          fullyViewed,
          algoVariant,
          algoName,
          position,
          rank,
          score,
          reason,
        });
      } catch (err) {
        console.error(
          "⚠️ Error en InteractionService.registerView desde postController:",
          err?.message || err
        );
      }
    }

    return res.json({
      success: true,
      data: {
        id: String(updated._id || updated.id || id),
        viewsCount,
      },
    });
  } catch (err) {
    console.error("❌ ERROR registerView:", err);
    return res.status(500).json({
      success: false,
      error: "Error al registrar view",
    });
  }
}

// ======================================================
// 💬 Comentario
// ======================================================
export async function addComment(req, res) {
  try {
    const userId = req.user?._id || req.user?.id;
    const postId = req.params.id;
    const { text } = req.body;

    if (!userId)
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });

    if (!text?.trim())
      return res.status(400).json({
        success: false,
        error: "Comentario vacío",
      });

    const exists = await PostModel.findById(postId);
    if (!exists || exists.deletedAt)
      return res.status(404).json({
        success: false,
        error: "Post no encontrado",
      });

    await CommentService.addComment({
      userId,
      targetId: postId,
      content: text.trim(),
      parentId: null,
    });

    return res.json({
      success: true,
      message: "Comentario agregado",
      targetId: postId,
    });
  } catch (err) {
    console.error("❌ ERROR addComment:", err);
    return res.status(500).json({
      success: false,
      error: "Error al agregar comentario",
    });
  }
}

// ======================================================
// 📌 Obtener post
// ======================================================
export async function getPostById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({
        success: false,
        error: "ID inválido",
      });

    const doc = await PostModel.findById(id);
    if (!doc || doc.deletedAt)
      return res.status(404).json({
        success: false,
        error: "Post no encontrado",
      });

    const post = await safePostJSON(req, doc);
    return res.json({ success: true, data: post });
  } catch (err) {
    console.error("❌ ERROR getPostById:", err);
    return res.status(500).json({ success: false, error: "Error interno" });
  }
}

// ======================================================
// 🎬 VIDEO MANIFEST (JSON ligero para reproductor)
// GET /posts/:id/video-manifest
// ======================================================
export async function getPostVideoManifest(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: "ID inválido",
      });
    }

    const doc = await PostModel.findById(id);
    if (!doc || doc.deletedAt) {
      return res.status(404).json({
        success: false,
        error: "Post no encontrado",
      });
    }

    // Base segura (PostModel.toPublicJSON si existe)
    const base =
      typeof doc.toPublicJSON === "function"
        ? await doc.toPublicJSON()
        : JSON.parse(JSON.stringify(doc));

    const mediaArr = Array.isArray(base.media) ? base.media : [];
    const videoMedia = mediaArr.find((m) => m.type === "video");

    if (!videoMedia) {
      return res.status(404).json({
        success: false,
        error: "Este post no contiene video",
      });
    }

    let durationSec =
      typeof videoMedia.durationSec === "number"
        ? videoMedia.durationSec
        : typeof videoMedia.duration === "number"
        ? videoMedia.duration
        : typeof videoMedia.videoDuration === "number"
        ? videoMedia.videoDuration
        : typeof videoMedia.length === "number"
        ? videoMedia.length
        : null;

    let quality =
      videoMedia.quality || videoMedia.resolution || null;

    let variants = Array.isArray(videoMedia.variants)
      ? videoMedia.variants
      : [];

    let thumbUrl =
      videoMedia.thumbUrl || videoMedia.thumbnailUrl || null;

    const ownerForVideo =
      base.authorId ||
      doc.authorId ||
      doc.userId ||
      doc.ownerId ||
      null;

    // 🧠 Intentar enriquecer con VideoModel (ffmpeg) si falta info
    if (!variants.length || !thumbUrl || !durationSec || !quality) {
      const videoDoc = await findVideoDocForMedia(ownerForVideo, videoMedia);
      if (videoDoc) {
        if (!variants.length && Array.isArray(videoDoc.variants)) {
          variants = videoDoc.variants.map((v) => ({
            quality: v.quality,
            url: v.url,
            mime: v.mime || "video/mp4",
            width: typeof v.width === "number" ? v.width : null,
            height: typeof v.height === "number" ? v.height : null,
            sizeBytes:
              typeof v.sizeBytes === "number" ? v.sizeBytes : null,
          }));
        }

        if (!thumbUrl && videoDoc.thumbUrl) {
          thumbUrl = videoDoc.thumbUrl;
        }

        if (
          !durationSec &&
          typeof videoDoc.duration === "number" &&
          videoDoc.duration > 0
        ) {
          durationSec = videoDoc.duration;
        }

        if (!quality && videoDoc.defaultQuality) {
          quality = videoDoc.defaultQuality;
        }
      }
    }

    const hasVariants = Array.isArray(variants) && variants.length > 0;

    const vp =
      videoMedia.videoProcessing &&
      typeof videoMedia.videoProcessing === "object"
        ? videoMedia.videoProcessing
        : null;

    const processingStatus =
      vp?.status || (hasVariants ? "ready" : null);
    const processingEngine =
      vp?.engine || (hasVariants ? "ffmpeg" : null);

    const processed =
      processingStatus === "ready" || processingStatus === "processing";

    const manifest = {
      postId: String(base.id || base._id || id),
      authorId: base.authorId || null,
      content: base.content || "",
      video: {
        url: videoMedia.url || null,
        thumbnailUrl: thumbUrl,
        durationSec,
        quality,
        // alias semántico
        qualityDetected: quality,
        width:
          typeof videoMedia.width === "number"
            ? videoMedia.width
            : null,
        height:
          typeof videoMedia.height === "number"
            ? videoMedia.height
            : null,
        size:
          typeof videoMedia.size === "number"
            ? videoMedia.size
            : null,
        variants,
        processed,
        processingStatus,
        processingEngine,
        hasVariants,
        // compat
        videoProcessing: vp,
        videoInfo: videoMedia.videoInfo || null,
      },
    };

    return res.json({ success: true, data: manifest });
  } catch (err) {
    console.error("❌ ERROR getPostVideoManifest:", err);
    return res.status(500).json({
      success: false,
      error: "Error interno al obtener manifest de video",
    });
  }
}

// ======================================================
// 👤 Posts de usuario
// ======================================================
export async function getPostsByUser(req, res) {
  try {
    let { id } = req.params;
    if (id === "me") id = req.user?._id || req.user?.id;

    const user = await User.findById(id).lean();
    if (!user)
      return res.status(404).json({
        success: false,
        error: "Usuario no encontrado",
      });

    const postsRaw = await PostModel.find({
      authorId: id,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    }).sort({ createdAt: -1 });

    const posts = await Promise.all(postsRaw.map((p) => safePostJSON(req, p)));

    return res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        bio: user.bio || "",
        avatarUrl: user.avatarUrl || "",
        backgroundUrl: user.backgroundUrl || "",
      },
      data: { posts },
    });
  } catch (err) {
    console.error("❌ ERROR getPostsByUser:", err);
    return res.status(500).json({ success: false, error: "Error interno" });
  }
}

// ======================================================
// 🗑 DELETE POST
// ======================================================
export async function deletePost(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    if (!userId)
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });

    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({
        success: false,
        error: "ID inválido",
      });

    const post = await PostModel.findById(id);
    if (!post)
      return res.status(404).json({
        success: false,
        error: "Post no encontrado",
      });

    if (String(post.authorId) !== String(userId))
      return res.status(403).json({
        success: false,
        error: "Sin permiso",
      });

    post.deletedAt = new Date();
    await post.save();

    // 🧹 Limpieza de archivos (local y/o R2) + metadata Upload
    const seenPaths = new Set();
    if (Array.isArray(post.media)) {
      for (const m of post.media) {
        const rels = [];
        const mainRel = resolveMediaRelPath(m);
        if (mainRel) rels.push(mainRel);
        if (Array.isArray(m.variants)) {
          for (const v of m.variants) {
            const r = resolveMediaRelPath(v);
            if (r) rels.push(r);
          }
        }

        for (const rel of rels) {
          if (!rel) continue;

          // normaliza a "/uploads/..."
          const normalizedRel = rel.startsWith("/uploads/")
            ? rel
            : `/uploads/${rel.replace(/^\/+/, "")}`;

          if (seenPaths.has(normalizedRel)) continue;
          seenPaths.add(normalizedRel);

          // borra en R2 si aplica
          await tryDeleteR2(normalizedRel);
          // borra en disco local (thumbs locales, modo local)
          tryDeleteLocal(normalizedRel);

          // borra metadata en colección Upload
          try {
            await Upload.deleteMany({
              user: userId,
              path: normalizedRel,
            });
          } catch (e) {
            console.warn(
              "⚠️ No se pudo limpiar metadata Upload:",
              e?.message || e
            );
          }
        }
      }
    }

    return res.json({
      success: true,
      message: "Publicación eliminada",
      deletedId: id,
    });
  } catch (err) {
    console.error("❌ ERROR deletePost:", err);
    return res.status(500).json({
      success: false,
      error: "Error al eliminar",
    });
  }
}

// ======================================================
// ♻ RESTAURAR POST
// ======================================================
export async function restorePost(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({
        success: false,
        error: "ID inválido",
      });

    const post = await PostModel.findById(id);
    if (!post || !post.deletedAt)
      return res.status(404).json({
        success: false,
        error: "Post no eliminada",
      });

    if (String(post.authorId) !== String(userId))
      return res.status(403).json({
        success: false,
        error: "Sin permiso",
      });

    const diffHours =
      (Date.now() - new Date(post.deletedAt).getTime()) / 3600000;

    if (diffHours > 24)
      return res.status(410).json({
        success: false,
        error: "Ventana de restauración expirada",
      });

    const missing = [];
    for (const m of post.media) {
      const rel = m.path?.replace("/uploads/", "");
      const abs = path.join("./uploads", rel);
      if (!fs.existsSync(abs)) missing.push(rel);
    }

    if (missing.length > 0)
      return res.status(410).json({
        success: false,
        error: "No se puede restaurar, archivos eliminados:",
        missing,
      });

    post.deletedAt = undefined;
    await post.save();

    return res.json({
      success: true,
      message: "Publicación restaurada",
      restoredId: id,
    });
  } catch (err) {
    console.error("❌ ERROR restorePost:", err);
    return res.status(500).json({
      success: false,
      error: "Error al restaurar",
    });
  }
}
// ======================================================
// FIN postController.js
// ======================================================

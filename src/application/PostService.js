// ======================================================
// 📄 PostService.js — v15.1 PRO ULTRA-STABLE (2025)
// ------------------------------------------------------
// 🛡 Rutas multimedia 100% correctas
// 🛡 FIX Anti-404 definitivo
// 🧠 Compatible con PostModel v14.3 y UploadService v16
// 🎯 No rompe feed, explore, likes ni topics
// 🆕 Soporta portada personalizada de video + watermark metadata
// 🆕 registerView(postId) para viewsCount (persistente)
// ======================================================

import chalk from "chalk";
import { Post } from "../domain/Post.js";
import { PostModel } from "../infrastructure/models/PostModel.js";
import Upload from "../domain/Upload.js";
import TopicClassifierService from "./TopicClassifierService.js";

/* ======================================================
   🔧 path público correcto
   ====================================================== */
function getPublicPath(username, filename) {
  return `/uploads/${String(username).toLowerCase()}/${filename}`;
}

/* ======================================================
   Detectar tipo multimedia
   ====================================================== */
function detectMediaType(mime = "", filename = "") {
  mime = (mime || "").toLowerCase();
  filename = (filename || "").toLowerCase();

  if (mime === "image/gif") return "gif";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";

  if (/\.(gif)$/i.test(filename)) return "gif";
  if (/\.(jpg|jpeg|png|webp)$/i.test(filename)) return "image";
  if (/\.(mp4|mov|avi|mkv|webm)$/i.test(filename)) return "video";

  return "image";
}

/* ======================================================
   Normalización ruta anti-404
   ====================================================== */
function normalizeUploadPath(username, storedPath, filename) {
  const safeUser = String(username).toLowerCase();
  const base = `/uploads/${safeUser}/`;

  if (!storedPath) return getPublicPath(safeUser, filename);

  if (storedPath.startsWith(base)) return storedPath;

  if (storedPath.startsWith("/uploads/")) {
    return getPublicPath(safeUser, filename);
  }

  if (storedPath.includes("/uploads/")) {
    return getPublicPath(safeUser, filename);
  }

  return getPublicPath(safeUser, filename);
}

/* ======================================================
   Clase principal
   ====================================================== */
export class PostService {
  constructor() {
    console.log(chalk.green("🧩 PostService v15.1 cargado."));
  }

  async registerUploadsMetadata({ authorId, username, media }) {
    try {
      if (!authorId || !Array.isArray(media) || media.length === 0) return;

      const safeUser = String(username || "").toLowerCase();

      const ops = media
        .filter((m) => m?.path)
        .map((m) => {
          const safePath = m.path.startsWith("/uploads/")
            ? m.path
            : `/uploads/${safeUser}/${String(m.path).replace(/^\/+/, "")}`;

          const filename =
            m.filename ||
            (safePath.includes("/") ? safePath.split("/").pop() : safePath) ||
            "file";

          const filetype = m.type || detectMediaType(m.mime, filename);

          return {
            updateOne: {
              filter: { user: authorId, path: safePath },
              update: {
                $set: {
                  user: authorId,
                  filename,
                  path: safePath,
                  mimetype: m.mime || null,
                  filetype,
                  size: m.size || null,
                  uploadedAt: new Date(),
                },
              },
              upsert: true,
            },
          };
        });

      if (ops.length > 0) {
        await Upload.bulkWrite(ops, { ordered: false });
      }
    } catch (err) {
      console.error(
        "⚠️ No se pudo registrar metadata de uploads:",
        err.message
      );
    }
  }

  toDomain(doc) {
    if (!doc) return null;
    const base = doc.toObject ? doc.toObject() : doc;

    return new Post({
      ...base,
      _id: base._id?.toString?.() || base._id,
      authorId:
        base.authorId ||
        base.userId ||
        base.createdBy ||
        null,
    });
  }

  /* ======================================================
     📌 Crear publicación
     ====================================================== */
  async createPost({
    authorId,
    authorUsername,
    content,
    files,
    topics,
    // nuevos parámetros opcionales, backwards compatible
    videoWatermark = null,
    coverIndex = null,
  }) {
    try {
      if (!authorId) throw new Error("authorId requerido");

      const username = String(authorUsername || "").toLowerCase();
      const safeContent =
        typeof content === "string"
          ? content.trim().slice(0, 10000)
          : "";

      const safeFiles = Array.isArray(files) ? files.slice(0, 10) : [];

      // =============================
      // 🖼 Normalizar media base
      // =============================
      const baseMedia = safeFiles.map((f, index) => {
        const filename =
          f.filename ||
          (f.path ? f.path.split("/").pop() : null);

        if (!filename) throw new Error("Archivo inválido.");

        const stored = normalizeUploadPath(
          username,
          f.path,
          filename
        );

        const mime = f.mimetype || f.mime || "";
        const type = f.type || detectMediaType(mime, filename);

        const size =
          typeof f.size === "number"
            ? f.size
            : typeof f.sizeBytes === "number"
            ? f.sizeBytes
            : null;

        const durationSec =
          typeof f.durationSec === "number"
            ? f.durationSec
            : typeof f.duration === "number"
            ? f.duration
            : typeof f.videoDuration === "number"
            ? f.videoDuration
            : typeof f.length === "number"
            ? f.length
            : null;

        const width =
          typeof f.width === "number" ? f.width : null;
        const height =
          typeof f.height === "number" ? f.height : null;

        const isCoverFlag =
          !!f.isCover ||
          (typeof coverIndex === "number" && coverIndex === index);

        return {
          path: stored,
          filename,
          type,
          mime: mime || null,
          size,
          durationSec,
          width,
          height,
          isCover: isCoverFlag,
          // videoInfo / videoProcessing se pueden rellenar luego por workers
        };
      });

      // =============================
      // 🎨 Detectar portada (cover)
      // =============================
      const explicitCover = baseMedia.find(
        (m) => m.type === "image" && m.isCover
      );
      const coverPath = explicitCover ? explicitCover.path : null;

      // =============================
      // 🎬 Aplicar portada + watermark a videos
      // =============================
      const media = baseMedia.map((m) => {
        const extra = {};

        if (m.type === "video") {
          if (coverPath) {
            extra.thumbnailUrl = coverPath;
            extra.thumbUrl = coverPath;
          }

          if (videoWatermark && videoWatermark.enabled) {
            extra.watermark = {
              enabled: true,
              userId: String(videoWatermark.userId),
              username: videoWatermark.username || null,
            };
          }
        }

        return {
          ...m,
          ...extra,
        };
      });

      // =============================
      // 🎯 Topics
      // =============================
      let normalizedTopics = [];
      if (Array.isArray(topics)) {
        normalizedTopics = topics
          .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
          .filter(Boolean);
      }

      if (!normalizedTopics.length) {
        try {
          normalizedTopics = await TopicClassifierService.classifyPost({
            content: safeContent,
          });
        } catch (err) {
          console.error("⚠️ Error topics:", err);
        }
      }

      // =============================
      // 💾 Guardar
      // =============================
      await this.registerUploadsMetadata({
        authorId,
        username,
        media,
      });

      const created = await PostModel.create({
        authorId: String(authorId),
        authorUsername: username,
        content: safeContent,
        media,
        likes: [],
        commentsCount: 0,
        topics: normalizedTopics,
        // viewsCount queda con default: 0
      });

      return this.toDomain(created);
    } catch (err) {
      console.error("❌ Error createPost:", err);
      throw err;
    }
  }

  /* ======================================================
     📌 getPostById
     ====================================================== */
  async getPostById(id) {
    const doc = await PostModel.findById(id).lean();
    return doc ? this.toDomain(doc) : null;
  }

  /* ======================================================
     ❤️ Like / Unlike
     ====================================================== */
  async likePost(postId, userId) {
    const doc = await PostModel.findById(postId);
    if (!doc) throw new Error("Post no encontrado.");

    const post = this.toDomain(doc);
    post.toggleLike(userId);

    await PostModel.findByIdAndUpdate(postId, {
      $set: { likes: post.likes, updatedAt: new Date() },
    });

    return post;
  }

  /* ======================================================
     👁 Registrar view (viewsCount++)
     ====================================================== */
  async registerView(postId, userId = null) {
    try {
      if (!postId) throw new Error("postId requerido");

      const updated = await PostModel.findByIdAndUpdate(
        postId,
        {
          $inc: { viewsCount: 1 },
          $set: { updatedAt: new Date() },
        },
        { new: true, lean: true }
      );

      if (!updated) return null;

      // Aquí podrías enganchar InteractionService / Analytics si quieres:
      // (la lógica actual está en postController.registerView)
      // if (userId) { ... }

      return this.toDomain(updated);
    } catch (err) {
      console.error("❌ Error registerView:", err);
      throw err;
    }
  }

  /* ======================================================
     📜 Paginación simple (no usada por el feed principal)
     ====================================================== */
  async getPaginated(skip = 0, limit = 20) {
    const docs = await PostModel.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return docs.map((d) => this.toDomain(d));
  }

  async getNewerThan(dateISO, limit = 20) {
    const date = new Date(dateISO);

    const docs = await PostModel.find({
      createdAt: { $gt: date },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return docs.map((d) => this.toDomain(d));
  }

  async getOlderThan(dateISO, limit = 20) {
    const date = new Date(dateISO);

    const docs = await PostModel.find({
      createdAt: { $lt: date },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return docs.map((d) => this.toDomain(d));
  }
}
/* ======================================================
   🔧 Singleton (se hace en postController.ensurePostService)
   ====================================================== */

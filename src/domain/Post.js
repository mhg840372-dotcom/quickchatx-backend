// ======================================================
// 📁 src/domain/Post.js — QuickChatX v15.0 Ultra Stable
// ------------------------------------------------------
// ✔ Compatible con UploadService 2025
// ✔ Incluye URL absoluta segura
// ✔ Soporta cualquier estructura del folder /uploads
// ✔ detectMediaType optimizado
// ✔ Autor usa safeAvatar si existe
// ✔ Conserva metadata de video (duration, width, height, quality)
// ✔ Conserva thumb personalizado, isCover y watermark
// ✔ 🆕 Soporta videoTopics, videoAnalyzedAt y viewsCount
// ✔ 🆕 Alias videoViews para compat con PostModel.toPublicJSON
// ======================================================

import UserModel from "../infrastructure/models/UserModel.js";

const BASE_ASSETS_URL = (
  process.env.PUBLIC_ASSETS_URL ||
  process.env.API_BASE_URL ||
  "https://api.quickchatx.com"
).replace(/\/+$/, "");

/* ===============================
   📌 Detectar MIME o extensión
   =============================== */
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

/* ===============================
   📌 Extraer path relativo a uploads
   =============================== */
function extractRelativeUploadsPath(rawPath = "") {
  let p = rawPath.toString().trim().replace(/\\/g, "/");
  if (!p) return "";

  const idx = p.indexOf("/uploads/");
  if (idx !== -1) return p.slice(idx + "/uploads/".length);

  const parts = p.split("/").filter(Boolean);
  const index = parts.lastIndexOf("uploads");
  if (index >= 0 && index < parts.length - 1) {
    return parts.slice(index + 1).join("/");
  }

  return p; // fallback seguro
}

/* ===============================
   📌 Crear URL absoluta
   =============================== */
function buildMediaUrl(rawPath) {
  const rel = extractRelativeUploadsPath(rawPath);
  if (!rel) return null;
  return `${BASE_ASSETS_URL}/uploads/${rel.replace(/^\/+/, "")}`;
}

function deriveThumbUrl(media) {
  if (!media) return null;

  const existing =
    media.thumbnailUrl ||
    media.thumbUrl ||
    media.thumb ||
    media.thumbnail ||
    null;

  if (existing) {
    const relExisting = extractRelativeUploadsPath(existing);
    const absolute = buildMediaUrl(relExisting);
    if (absolute) return absolute;
  }

  if (media.type !== "video") return null;

  const rel = extractRelativeUploadsPath(media.path);
  if (!rel) return null;

  const baseName = rel.replace(/\.[^/.]+$/, "");
  return buildMediaUrl(`thumbs/${baseName}.jpg`);
}

/* ===============================
   📌 Clase dominio Post
   =============================== */
export class Post {
  constructor({
    _id = null,
    authorId = null,
    authorUsername = null,
    content = "",
    media = [],
    likes = [],
    topics = [],
    videoTopics = [],
    commentsCount = 0,
    createdAt = new Date(),
    updatedAt = new Date(),
    videoAnalyzedAt = null,
    viewsCount = 0,
    deletedAt = null,
    comments = [], // legacy
  } = {}) {
    this._id = _id ? String(_id) : null;
    this.authorId = authorId ? String(authorId) : null;
    this.authorUsername = authorUsername || null;

    this.content =
      typeof content === "string" ? content.trim().slice(0, 10000) : "";

    // MEDIA NORMALIZADO + DEDUP (conservando metadata, cover y watermark)
    const normalized = Array.isArray(media)
      ? media.map((m) => {
          if (!m) return null;

          const raw =
            m.path ||
            m.filename ||
            m.url ||
            m.originalPath ||
            "";

          const rel = extractRelativeUploadsPath(raw);
          const mime = m.mime || m.mimetype || null;

          const type =
            m.type || detectMediaType(mime, rel);

          const size =
            typeof m.size === "number"
              ? m.size
              : typeof m.sizeBytes === "number"
              ? m.sizeBytes
              : null;

          const durationSec =
            typeof m.durationSec === "number"
              ? m.durationSec
              : typeof m.duration === "number"
              ? m.duration
              : typeof m.videoDuration === "number"
              ? m.videoDuration
              : typeof m.length === "number"
              ? m.length
              : null;

          const width =
            typeof m.width === "number" ? m.width : null;
          const height =
            typeof m.height === "number" ? m.height : null;

          const quality =
            m.quality || m.resolution || m.label || null;

          const videoInfo =
            m.videoInfo && typeof m.videoInfo === "object"
              ? m.videoInfo
              : null;

          const videoProcessing = m.videoProcessing || undefined;

          const thumbRaw =
            m.thumbnailUrl ||
            m.thumbUrl ||
            m.thumb ||
            m.thumbnail ||
            null;
          const thumbRel = thumbRaw
            ? extractRelativeUploadsPath(thumbRaw)
            : null;

          const isCover = !!m.isCover;

          const watermark =
            m.watermark && typeof m.watermark === "object"
              ? m.watermark
              : null;

          return {
            path: rel,
            mime,
            size,
            type,
            durationSec,
            width,
            height,
            quality,
            videoInfo,
            videoProcessing,
            thumbUrl: thumbRel,
            thumbnailUrl: thumbRel,
            isCover,
            watermark,
          };
        })
      : [];

    const seen = new Set();
    const deduped = [];

    for (const m of normalized) {
      if (!m || !m.path) continue;
      const key = m.path.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(m);
      if (deduped.length >= 10) break;
    }

    this.media = deduped;

    this.topics = Array.isArray(topics)
      ? topics
          .map((t) => (typeof t === "string" ? t.trim() : ""))
          .filter(Boolean)
      : [];

    this.videoTopics = Array.isArray(videoTopics)
      ? videoTopics
          .map((t) => (typeof t === "string" ? t.trim() : ""))
          .filter(Boolean)
      : [];

    const likeSet = new Set();
    if (Array.isArray(likes)) {
      likes.forEach((id) => {
        if (!id) return;
        likeSet.add(String(id));
      });
    }
    this.likes = [...likeSet];

    this.commentsCount =
      typeof commentsCount === "number"
        ? commentsCount
        : Array.isArray(comments)
        ? comments.length
        : 0;

    this.createdAt = createdAt ? new Date(createdAt) : new Date();
    this.updatedAt = updatedAt ? new Date(updatedAt) : new Date();

    this.videoAnalyzedAt = videoAnalyzedAt
      ? new Date(videoAnalyzedAt)
      : null;

    this.viewsCount =
      typeof viewsCount === "number" ? viewsCount : 0;

    this.deletedAt = deletedAt ? new Date(deletedAt) : null;

    this._authorCache = null;
  }

  /* ===============================
      🔄 Construcción desde documento
     =============================== */
  static fromDocument(doc = {}) {
    if (!doc) return new Post({});
    const plain =
      typeof doc.toObject === "function" ? doc.toObject() : { ...doc };

    return new Post({
      _id: plain._id || plain.id,
      authorId:
        plain.authorId ||
        plain.userId ||
        (plain.author?._id) ||
        null,
      authorUsername:
        plain.authorUsername ||
        (plain.author?.username) ||
        null,
      content: plain.content || plain.text || "",
      media: plain.media || [],
      likes: plain.likes || [],
      topics: plain.topics || [],
      videoTopics: plain.videoTopics || [],
      commentsCount:
        typeof plain.commentsCount === "number"
          ? plain.commentsCount
          : Array.isArray(plain.comments)
          ? plain.comments.length
          : 0,
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
      videoAnalyzedAt: plain.videoAnalyzedAt,
      viewsCount:
        typeof plain.viewsCount === "number"
          ? plain.viewsCount
          : 0,
      deletedAt: plain.deletedAt,
      comments: plain.comments || [],
    });
  }

  /* ===============================
     ❤️ LIKE / UNLIKE
     =============================== */
  toggleLike(userId) {
    const uid = String(userId);
    const index = this.likes.indexOf(uid);
    if (index >= 0) this.likes.splice(index, 1);
    else this.likes.push(uid);
    this.updatedAt = new Date();
  }

  /* ===============================
     👤 CARGAR AUTOR — Mejorado
     =============================== */
  async loadAuthor() {
    if (this._authorCache) return this._authorCache;

    if (!this.authorId) {
      this._authorCache = {
        id: null,
        username: "Unknown",
        avatar: null,
      };
      return this._authorCache;
    }

    try {
      const user = await UserModel.findById(this.authorId).lean();

      if (!user) {
        this._authorCache = {
          id: this.authorId,
          username: "Unknown",
          avatar: null,
        };
      } else {
        this._authorCache = {
          id: user._id.toString(),
          username: user.username || "User",
          avatar:
            user.avatarUrl ||
            user.safeAvatar ||
            user.profilePhoto ||
            null,
        };
      }
    } catch {
      this._authorCache = {
        id: this.authorId,
        username: "Unknown",
        avatar: null,
      };
    }

    return this._authorCache;
  }

  /* ===============================
     🌍 Salida pública (FRONT-READY)
     =============================== */
  async toPublicJSON({ includeAuthor = false } = {}) {
    let author;
    if (includeAuthor) {
      author = await this.loadAuthor();
    }

    const mediaPublic = this.media.map((m) => {
      const url = buildMediaUrl(m.path);
      const thumbUrl = deriveThumbUrl(m);

      const durationSec =
        typeof m.durationSec === "number"
          ? m.durationSec
          : null;

      const quality = m.quality || null;

      return {
        path: url,
        url,
        originalPath: m.path,
        type: m.type,
        size: m.size,
        mime: m.mime,
        thumbUrl,
        thumbnailUrl: thumbUrl,

        // aliases de duración para el frontend
        durationSec,
        duration: durationSec,
        videoDuration: durationSec,
        length: durationSec,

        quality,
        resolution: quality,

        width:
          typeof m.width === "number" ? m.width : null,
        height:
          typeof m.height === "number" ? m.height : null,

        videoInfo: m.videoInfo || null,
        videoProcessing: m.videoProcessing || undefined,

        // 🆕 cover + watermark
        isCover: !!m.isCover,
        watermark: m.watermark || null,
      };
    });

    const viewsCount =
      typeof this.viewsCount === "number" ? this.viewsCount : 0;

    const base = {
      id: this._id,
      authorId: this.authorId,
      authorUsername: this.authorUsername,
      content: this.content,
      media: mediaPublic,
      topics: this.topics,
      videoTopics: this.videoTopics || [],
      videoAnalyzedAt: this.videoAnalyzedAt || null,
      likes: this.likes,
      likesCount: this.likes.length,
      commentsCount: this.commentsCount,
      viewsCount,
      videoViews: viewsCount, // alias compatible con PostModel
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };

    return includeAuthor ? { ...base, author } : base;
  }

  /* ===============================
     🛠 Debug
     =============================== */
  toFullJSON() {
    return {
      id: this._id,
      authorId: this.authorId,
      authorUsername: this.authorUsername,
      content: this.content,
      media: this.media,
      topics: this.topics,
      videoTopics: this.videoTopics || [],
      likes: this.likes,
      commentsCount: this.commentsCount,
      viewsCount: this.viewsCount,
      videoAnalyzedAt: this.videoAnalyzedAt,
      deletedAt: this.deletedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export default Post;

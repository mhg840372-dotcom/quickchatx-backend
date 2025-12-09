// ======================================================
// 🗄️ PostModel.js — QuickChatX v14.6 VIDEO-READY+META+ORIENTATION (2025)
// ------------------------------------------------------
// 🛡 FIX ANTI-404 TOTAL
// 🧠 Compatible con PostService v15.1 y UploadService v16
// 🎞 Media limpio, deduplicado, máximo 10
// 🌍 URLs absolutas automáticas
// 🎬 Video JSON-ready (duration, quality, variants...)
// 🧭 Orientación de imagen (horizontal / vertical / square)
// 🆕 Portada personalizada de video + watermark metadata
// 🆕 viewsCount (contador de visualizaciones)
// 🆕 videoTopics + videoAnalyzedAt (análisis IA de video)
// 🆕 dislikes (simétrico a likes)
// ======================================================

import mongoose from "mongoose";

const BASE_ASSETS_URL = (
  process.env.PUBLIC_ASSETS_URL ||
  process.env.API_BASE_URL ||
  "https://api.quickchatx.com"
).replace(/\/+$/, "");

/* ======================================================
   🧹 NORMALIZADOR UNIVERSAL DE RUTAS
   ====================================================== */
function extractRelativeUploadsPath(rawPath) {
  if (!rawPath) return "";

  let p = rawPath.toString().trim().replace(/\\/g, "/");

  const marker = "/uploads/";
  const idx = p.indexOf(marker);
  if (idx >= 0) return p.slice(idx + marker.length);

  if (p.includes("/uploads/")) {
    const parts = p.split("/").filter(Boolean);
    const i = parts.lastIndexOf("uploads");
    return parts.slice(i + 1).join("/");
  }

  // "user/file.jpg"
  if (/^[a-z0-9_\-]+\/[^/]+$/i.test(p)) return p;

  // "file.jpg"
  return p.replace(/^\/+/, "");
}

/* ======================================================
   🌍 URL absoluta pública
   ====================================================== */
function buildMediaUrl(rel) {
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

/* ======================================================
   🧭 Orientación de imagen (igual lógica que en el frontend)
   ====================================================== */
function computeImageOrientation(width, height) {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const diff = Math.abs(width - height);
  const threshold = Math.min(width, height) * 0.05; // 5% tolerancia

  if (diff <= threshold) return "square";
  if (width > height) return "horizontal";
  return "vertical";
}

/* ======================================================
   🔤 Normalizador de arrays de topics
   ====================================================== */
function normalizeTopicsArray(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();

  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }

  return out;
}

const TopicArrayField = {
  type: [String],
  default: [],
  index: true,
  set: normalizeTopicsArray,
};

/* ======================================================
   🎞 VIDEO VARIANT SCHEMA (multi bitrate / resoluciones)
   ====================================================== */
const VideoVariantSchema = new mongoose.Schema(
  {
    // Ruta relativa dentro de /uploads (ej: "videos/720p/abc.mp4")
    path: { type: String, required: true },

    // Etiqueta de calidad: "1080p", "720p", "480p", "HD", etc.
    quality: { type: String, default: null },

    // Info opcional para UI / debug
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bitrate: { type: Number, default: null }, // en bits/s
    mime: { type: String, default: null },
    size: { type: Number, default: null }, // bytes
  },
  { _id: false }
);

/* ======================================================
   🎞 MEDIA SCHEMA
   ====================================================== */
const MediaSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    type: {
      type: String,
      enum: ["image", "video", "gif"],
      default: "image",
    },
    mime: { type: String, default: null },
    size: { type: Number, default: null }, // bytes

    // ====== METADATA DE VIDEO / IMAGEN ======
    durationSec: { type: Number, default: null }, // duración real en segundos
    width: { type: Number, default: null },
    height: { type: Number, default: null },

    // Etiqueta de calidad principal: "720p", "HD", etc.
    quality: { type: String, default: null },

    // Variantes generadas por ffmpeg (HLS o progresivo multi-res)
    variants: {
      type: [VideoVariantSchema],
      default: [],
    },

    // Info rica de video (para debug / UI avanzada)
    videoInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Estado del procesamiento de video (para workers/background jobs)
    videoProcessing: {
      type: new mongoose.Schema(
        {
          status: {
            type: String,
            enum: ["pending", "processing", "ready", "error"],
            default: "ready",
          },
          engine: { type: String, default: null }, // "ffmpeg", "cloudflare-stream", etc.
          errorCode: { type: String, default: null },
          errorMessage: { type: String, default: null },
          updatedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: undefined,
    },

    // 🆕 Portada personalizada / thumbnail relativo
    thumbUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },

    // 🆕 Flag para marcar el media como portada explícita
    isCover: { type: Boolean, default: false },

    // 🆕 Metadata de watermark de video (usuario, etc.)
    watermark: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false }
);

/* ======================================================
   🧹 Normalizador de media (dedup + límite 10)
   ====================================================== */
function normalizeMediaArray(arr) {
  if (!Array.isArray(arr)) return [];

  const seen = new Set();
  const out = [];

  for (const raw of arr) {
    if (!raw) continue;

    const rawPath =
      raw.path ||
      raw.filename ||
      raw.url ||
      raw.originalPath ||
      "";

    const rel = extractRelativeUploadsPath(rawPath);
    if (!rel) continue;

    if (seen.has(rel)) continue;
    seen.add(rel);

    const mime = raw.mime || raw.mimetype || raw.type || null;
    const isVideo =
      raw.type === "video" ||
      (typeof mime === "string" && mime.startsWith("video"));

    const type = isVideo ? "video" : raw.type || "image";

    const size =
      typeof raw.size === "number"
        ? raw.size
        : typeof raw.sizeBytes === "number"
        ? raw.sizeBytes
        : null;

    const durationSec =
      typeof raw.durationSec === "number"
        ? raw.durationSec
        : typeof raw.duration === "number"
        ? raw.duration
        : typeof raw.videoDuration === "number"
        ? raw.videoDuration
        : typeof raw.length === "number"
        ? raw.length
        : null;

    const width =
      typeof raw.width === "number" ? raw.width : null;
    const height =
      typeof raw.height === "number" ? raw.height : null;

    const quality =
      raw.quality ||
      raw.resolution ||
      raw.label ||
      null;

    const videoInfo =
      raw.videoInfo && typeof raw.videoInfo === "object"
        ? raw.videoInfo
        : null;

    const variants = Array.isArray(raw.variants)
      ? raw.variants
          .map((v) => {
            if (!v) return null;
            const vPath = extractRelativeUploadsPath(
              v.path || v.url || ""
            );
            if (!vPath) return null;
            return {
              path: vPath,
              quality: v.quality || v.resolution || v.label || null,
              width:
                typeof v.width === "number" ? v.width : null,
              height:
                typeof v.height === "number" ? v.height : null,
              bitrate:
                typeof v.bitrate === "number" ? v.bitrate : null,
              mime: v.mime || v.mimetype || null,
              size:
                typeof v.size === "number"
                  ? v.size
                  : typeof v.sizeBytes === "number"
                  ? v.sizeBytes
                  : null,
            };
          })
          .filter(Boolean)
      : [];

    const isCover = !!raw.isCover;

    const rawThumb =
      raw.thumbnailUrl ||
      raw.thumbUrl ||
      raw.coverImage ||
      raw.cover ||
      null;
    const thumbRel = rawThumb
      ? extractRelativeUploadsPath(rawThumb)
      : null;

    const watermark =
      raw.watermark && typeof raw.watermark === "object"
        ? raw.watermark
        : null;

    out.push({
      path: rel,
      type,
      mime,
      size,
      durationSec,
      width,
      height,
      quality,
      variants,
      videoInfo,
      // ⚠️ videoProcessing se deja como venga del servicio / worker
      videoProcessing: raw.videoProcessing || undefined,
      isCover,
      thumbUrl: thumbRel,
      thumbnailUrl: thumbRel,
      watermark,
    });

    if (out.length >= 10) break;
  }

  return out;
}

/* ======================================================
   ❤️ Normalizar Likes / Dislikes
   ====================================================== */
function normalizeLikes(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();

  for (const v of arr) {
    if (!v) continue;
    seen.add(String(v));
  }

  return [...seen];
}

/* ======================================================
   📝 POST SCHEMA
   ====================================================== */
const PostSchema = new mongoose.Schema(
  {
    authorId: { type: String, required: true, index: true },
    authorUsername: { type: String },

    content: {
      type: String,
      trim: true,
      maxlength: 10000,
      default: "",
    },

    media: {
      type: [MediaSchema],
      default: [],
      set: normalizeMediaArray,
      validate: [
        {
          validator(a) {
            return Array.isArray(a) && a.length <= 10;
          },
          message: "Máximo 10 archivos multimedia",
        },
      ],
    },

    // 🧠 Tópicos generales del post (texto + video IA)
    topics: TopicArrayField,

    // 🧠 Tópicos específicos del video (VideoTopicService)
    videoTopics: { ...TopicArrayField },

    // 🕒 Cuándo se analizó por última vez el video
    videoAnalyzedAt: { type: Date, default: null },

    likes: {
      type: [String],
      default: [],
      set: normalizeLikes,
      index: true,
    },

    // 🆕 Dislikes opcionales (para InteractionService)
    dislikes: {
      type: [String],
      default: [],
      set: normalizeLikes,
      index: true,
    },

    commentsCount: { type: Number, default: 0, index: true },

    // 🆕 Contador de visualizaciones
    viewsCount: { type: Number, default: 0, index: true },

    // Soft delete
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "posts" }
);

PostSchema.index({ createdAt: -1 });
PostSchema.index({ authorId: 1, createdAt: -1 });
PostSchema.index({ videoTopics: 1, createdAt: -1 });

/* ======================================================
   🌍 JSON para frontend — VIDEO JSON FRIENDLY + ORIENTATION
   ====================================================== */
PostSchema.methods.toPublicJSON = function () {
  const mediaArray = Array.isArray(this.media) ? this.media : [];
  const likesArray = Array.isArray(this.likes) ? this.likes : [];
  const dislikesArray = Array.isArray(this.dislikes)
    ? this.dislikes
    : [];
  const viewsCount =
    typeof this.viewsCount === "number" ? this.viewsCount : 0;

  const topics = Array.isArray(this.topics) ? this.topics : [];
  const videoTopics = Array.isArray(this.videoTopics)
    ? this.videoTopics
    : [];

  return {
    id: this._id.toString(),
    authorId: this.authorId,
    authorUsername: this.authorUsername || null,
    content: this.content,

    media: mediaArray.map((m) => {
      const plain =
        typeof m.toObject === "function" ? m.toObject() : m;

      const rel = extractRelativeUploadsPath(plain.path);
      const url = buildMediaUrl(rel);
      const thumbUrl = deriveThumbUrl({ ...plain, path: rel });

      const isVideo = plain.type === "video";

      // duración unificada en varios alias para el frontend
      const durationSec =
        typeof plain.durationSec === "number"
          ? plain.durationSec
          : null;

      // Calidad principal: campo propio o el de la primera variante
      let quality = plain.quality || null;
      if (
        !quality &&
        Array.isArray(plain.variants) &&
        plain.variants.length > 0
      ) {
        quality =
          plain.variants[0].quality ||
          plain.variants[0].label ||
          null;
      }

      // Variantes absolutas (si hay)
      const variants =
        isVideo && Array.isArray(plain.variants)
          ? plain.variants
              .filter((v) => v && v.path)
              .map((v) => {
                const relVar = extractRelativeUploadsPath(
                  v.path || v.url || ""
                );
                const variantUrl = buildMediaUrl(relVar);
                return {
                  path: variantUrl,
                  url: variantUrl,
                  originalPath: relVar,
                  quality: v.quality || v.label || null,
                  width:
                    typeof v.width === "number" ? v.width : null,
                  height:
                    typeof v.height === "number" ? v.height : null,
                  bitrate:
                    typeof v.bitrate === "number"
                      ? v.bitrate
                      : null,
                  mime: v.mime || null,
                  size:
                    typeof v.size === "number" ? v.size : null,
                };
              })
          : [];

      const width = plain.width || null;
      const height = plain.height || null;
      const orientation =
        !isVideo && width && height
          ? computeImageOrientation(width, height)
          : null;

      const isCover = !!plain.isCover;
      const watermark = plain.watermark || null;

      return {
        // ==== forma antigua (ya usada por tu frontend) ====
        path: url,
        url,
        originalPath: rel,
        type: plain.type,
        mime: plain.mime,
        size: plain.size,
        thumbUrl,
        thumbnailUrl: thumbUrl,

        // ==== NUEVO: metadata de video e info rica ====
        durationSec,
        duration: durationSec,
        videoDuration: durationSec,
        length: durationSec,

        quality,
        resolution: quality, // alias

        variants,

        width,
        height,

        // 🧭 Orientación calculada para imágenes
        orientation, // "horizontal" | "vertical" | "square" | null

        videoInfo: plain.videoInfo || null,
        videoProcessing: plain.videoProcessing || undefined,

        // 🆕 Portada + watermark
        isCover,
        watermark,
      };
    }),

    topics,
    videoTopics,
    videoAnalyzedAt: this.videoAnalyzedAt || null,

    likes: likesArray,
    likesCount: likesArray.length,

    dislikes: dislikesArray,
    dislikesCount: dislikesArray.length,

    commentsCount: this.commentsCount || 0,

    // 🆕 Exponer views al frontend
    viewsCount,
    videoViews: viewsCount, // alias compatible

    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

/* ======================================================
   📦 Export
   ====================================================== */
const PostModel =
  mongoose.models.Post || mongoose.model("Post", PostSchema);

export { PostModel };
export default PostModel;

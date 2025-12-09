// ======================================================
// 🎬 VideoModel.js — Modelo de videos procesados (ffmpeg)
// ======================================================

import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Variante de video (360p, 720p, etc.)
 */
const VideoVariantSchema = new Schema(
  {
    quality: { type: String, required: true }, // "360p", "720p", etc.
    url: { type: String, required: true },     // siempre relativo: "/uploads/videos/..."
    mime: { type: String, default: "video/mp4" },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    sizeBytes: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * Documento principal de Video
 */
const VideoSchema = new Schema(
  {
    // 🔧 user._id como string
    ownerId: {
      type: String,
      required: true,
      index: true,
      default: "anonymous",
    },

    // 🔗 Ruta original desde la que se subió el video
    //    ej: "/uploads/mikehg/1764902395539_4a1f...mp4"
    sourcePath: {
      type: String,
      index: true,
      default: null,
    },

    // Ruta relativa al original convertido a mp4
    originalUrl: { type: String, required: true }, // ej: "/uploads/videos/vid_xxx_orig.mp4"

    // Thumbnail relativo
    thumbUrl: { type: String, required: true }, // ej: "/uploads/thumbs/vid_xxx.jpg"

    duration: { type: Number, required: true }, // segundos (float)

    mime: { type: String, default: "video/mp4" },

    // Calidad por defecto que debería usar el frontend
    defaultQuality: { type: String, default: "720p" },

    // Variantes tipo 360p, 720p...
    variants: {
      type: [VideoVariantSchema],
      default: [],
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: "videos",
  }
);

// Índices útiles
VideoSchema.index({ ownerId: 1, createdAt: -1 });
VideoSchema.index({ ownerId: 1, sourcePath: 1 }); // para enlazar con Post.media

// Reutiliza el modelo si ya existe (hot reload / tests)
const VideoModel =
  mongoose.models.Video || mongoose.model("Video", VideoSchema);

export { VideoModel };
export default VideoModel;

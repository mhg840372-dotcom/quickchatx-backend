import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    /* ======================================================
       📌 Identificadores principales
    ====================================================== */
    room: { type: String, required: true, index: true },

    from: { type: String, required: true, index: true },
    to: { type: String, required: true, index: true },

    /* ======================================================
       💬 Contenido
    ====================================================== */
    text: { type: String, default: "" },

    type: {
      type: String,
      enum: ["text", "image", "video", "audio", "file"],
      default: "text",
    },

    /* ======================================================
       📁 Multimedia (opcional)
    ====================================================== */
    mediaUrl: { type: String, default: null },

    // tamaño real (útil con 200MB)
    mediaSize: { type: Number, default: 0 },

    // mime real capturado por uploadMiddleware
    mediaMime: { type: String, default: null },

    // thumbnail para videos/imágenes (FUTURE READY)
    thumbnailUrl: { type: String, default: null },

    /* ======================================================
       🧪 Seguridad (AES opcional)
    ====================================================== */
    chatKey: { type: String, default: null },

    /* ======================================================
       📖 Estado
    ====================================================== */
    read: { type: Boolean, default: false, index: true },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },

    updatedAt: {
      type: Date,
      default: null,
      index: true,
    },

    /* ======================================================
       🗑 Soft delete
    ====================================================== */
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },
  },
  { versionKey: false, timestamps: false }
);

/* ======================================================
   📚 Índices críticos (rendimiento + consultas)
====================================================== */

// Mensajes por room ordenados por fecha
MessageSchema.index({ room: 1, timestamp: -1 });

// Historial entre 2 usuarios
MessageSchema.index({ from: 1, to: 1, timestamp: -1 });

// Consultas por usuario (ChatsList)
MessageSchema.index({ to: 1, read: 1 });
MessageSchema.index({ from: 1, deleted: 1 });

// Soft-delete & restore más rápido
MessageSchema.index({ deleted: 1, deletedAt: -1 });

/* ======================================================
   🧹 Limpieza automática
====================================================== */
MessageSchema.pre("save", function (next) {
  if (!this.text && !this.mediaUrl) {
    this.text = "[mensaje vacío]";
  }

  // si se borra/restaura, marcamos updatedAt
  if (this.isModified("deleted") || this.isModified("read")) {
    this.updatedAt = new Date();
  }

  next();
});

/* ======================================================
   🛡 Validación adicional (segura)
====================================================== */
MessageSchema.pre("validate", function (next) {
  // evitar mensajes corruptos de media
  if (this.type !== "text" && !this.mediaUrl) {
    return next(new Error("mediaUrl requerido para mensajes multimedia"));
  }
  next();
});

export default mongoose.model("Message", MessageSchema);

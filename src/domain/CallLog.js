import mongoose from "mongoose";

/**
 * 🧾 CallLog.js
 * Registro histórico y analítico de llamadas
 * (se genera al finalizar una llamada en CallService)
 */
const CallLogSchema = new mongoose.Schema(
  {
    // 🔐 ID de la llamada original
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Call",
      required: true,
      index: true,
    },

    // 👤 Emisor de la llamada
    caller: {
      type: String,
      required: true,
      index: true,
    },

    // 👥 Receptor o receptores
    receivers: {
      type: [String],
      default: [],
      index: true,
    },

    // 🎥 Tipo de llamada
    type: {
      type: String,
      enum: ["audio", "video"],
      default: "audio",
    },

    // ⏱️ Duración total (en segundos)
    duration: {
      type: Number,
      default: 0,
    },

    // 📊 Estado final
    status: {
      type: String,
      enum: ["completed", "missed", "cancelled", "rejected"],
      default: "completed",
      index: true,
    },

    // 📅 Fechas
    startedAt: {
      type: Date,
      required: true,
    },
    endedAt: {
      type: Date,
      required: true,
    },

    // 💬 Quién finalizó o canceló
    endedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // agrega createdAt y updatedAt
  }
);

/**
 * 🧮 Virtual para obtener duración formateada (mm:ss)
 */
CallLogSchema.virtual("durationFormatted").get(function () {
  const minutes = Math.floor(this.duration / 60);
  const seconds = this.duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
});

/**
 * ⚡ Índices compuestos para mejorar consultas por usuario y fecha
 */
CallLogSchema.index({ caller: 1, startedAt: -1 });
CallLogSchema.index({ receivers: 1, startedAt: -1 });

const CallLog = mongoose.model("CallLog", CallLogSchema);
export default CallLog;

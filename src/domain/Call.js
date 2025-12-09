import mongoose from "mongoose";

/**
 * 📞 Esquema de llamadas (1 a 1 o grupales)
 * Soporta audio / video, con seguimiento de estado, participantes y duración.
 */
const CallSchema = new mongoose.Schema(
  {
    // Usuario que inicia la llamada
    caller: {
      type: String,
      required: true,
      index: true,
    },

    // Usuario(s) receptores (puede ser nulo si es grupal)
    receiver: {
      type: String,
      index: true,
    },

    // Todos los participantes de la llamada
    participants: {
      type: [String],
      default: [],
      index: true,
    },

    // Tipo de llamada: audio o video
    type: {
      type: String,
      enum: ["audio", "video"],
      default: "audio",
    },

    // Estado de la llamada
    status: {
      type: String,
      enum: ["ringing", "active", "rejected", "cancelled", "ended", "missed"],
      default: "ringing",
      index: true,
    },

    // Tiempos clave
    startedAt: {
      type: Date,
      default: Date.now,
    },
    acceptedAt: {
      type: Date,
    },
    endedAt: {
      type: Date,
    },

    // Usuario que finaliza la llamada
    endedBy: {
      type: String,
    },

    // Duración en segundos
    duration: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt automáticos
  }
);

/**
 * ⏱️ Middleware para calcular duración automáticamente
 * antes de guardar una llamada con estado "ended"
 */
CallSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status === "ended") {
    if (this.startedAt && this.endedAt) {
      this.duration = Math.round((this.endedAt - this.startedAt) / 1000);
    }
  }
  next();
});

/**
 * 🧩 Virtual para saber si la llamada es grupal
 */
CallSchema.virtual("isGroupCall").get(function () {
  return this.participants.length > 2;
});

/**
 * 🔍 Índices compuestos para rendimiento en historial de llamadas
 */
CallSchema.index({ participants: 1, startedAt: -1 });
CallSchema.index({ caller: 1, status: 1 });

const Call = mongoose.model("Call", CallSchema);
export default Call;

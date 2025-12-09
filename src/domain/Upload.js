import mongoose from "mongoose";
import crypto from "crypto";

const uploadSchema = new mongoose.Schema(
  {
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true,
    },

    filename: { type: String, required: true, trim: true },

    // Nombre correcto del campo que usará el servicio
    path: { type: String, required: true, trim: true },

    mimetype: { type: String, required: true },

    filetype: { 
      type: String, 
      enum: ["image", "video", "audio", "document", "file"], 
      default: "file" 
    },

    size: { type: Number, required: true, min: 0 },

    hash: { type: String, index: true },

    thumbnailUrl: { type: String, default: null },

    virusScan: {
      status: { 
        type: String, 
        enum: ["pending", "clean", "infected", "error"], 
        default: "pending" 
      },
      scannedAt: { type: Date },
      engine: { type: String, default: "unknown" },
      details: { type: String },
    },

    uploadedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Generar hash si no existe
uploadSchema.pre("save", function (next) {
  if (!this.path || this.hash) return next();

  try {
    const hash = crypto
      .createHash("sha256")
      .update(this.filename + this.user.toString())
      .digest("hex");

    this.hash = hash;
  } catch (err) {
    console.error("❌ Error generando hash:", err);
  }

  next();
});

// índices
uploadSchema.index({ user: 1, uploadedAt: -1 });
uploadSchema.index({ filetype: 1 });

const Upload = mongoose.model("Upload", uploadSchema);
export default Upload;

// ======================================================
// ⚖️ models/LegalModel.js — Términos y Condiciones
// ======================================================

import mongoose from "mongoose";

const LegalSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "Términos y Condiciones de QuickChatX",
    },
    content: {
      type: String,
      required: true,
    },
    version: {
      type: String,
      default: "1.0.0",
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: "legal_terms" }
);

export default mongoose.model("Legal", LegalSchema);

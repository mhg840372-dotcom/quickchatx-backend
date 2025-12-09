// ======================================================
// 🧠 UserInterestModel.js — preferencias por tema
// ======================================================

import mongoose from "mongoose";

const UserInterestSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    topic: {
      type: String,
      required: true,
      index: true,
      trim: true,
      // Normalizamos siempre a minúsculas para evitar duplicados raros
      set: (v) =>
        typeof v === "string" ? v.trim().toLowerCase() : v,
    },
    score: {
      type: Number,
      default: 0,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "user_interests",
  }
);

UserInterestSchema.index({ userId: 1, topic: 1 }, { unique: true });

export const UserInterestModel =
  mongoose.models.UserInterest ||
  mongoose.model("UserInterest", UserInterestSchema);

export default UserInterestModel;

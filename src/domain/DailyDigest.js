// src/domain/DailyDigest.js
import mongoose from "mongoose";

const DailyDigestSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  topic: String,
  articles: [Object],
  videos: [Object],
});

export const DailyDigest =
  mongoose.models.DailyDigest || mongoose.model("DailyDigest", DailyDigestSchema);

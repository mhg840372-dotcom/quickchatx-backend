// ======================================================
// 🎯 classifyFile.js — Detector de tipo MIME
// ------------------------------------------------------
// • Detecta image / video / gif
// • Analiza extensión y MIME real del archivo
// • Compatible con multer y PostService
// ======================================================

import path from "path";

export const classifyFile = (file) => {
  if (!file) return null;

  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype || "";

  // =============================
  // 🖼️ IMAGENES
  // =============================
  if (
    mime.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(ext)
  ) {
    return "image";
  }

  // =============================
  // 🎞️ GIF
  // =============================
  if (mime === "image/gif" || ext === ".gif") {
    return "gif";
  }

  // =============================
  // 🎥 VIDEOS
  // =============================
  if (
    mime.startsWith("video/") ||
    [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext)
  ) {
    return "video";
  }

  // =============================
  // ❓ Tipo desconocido
  // =============================
  return "image"; // fallback seguro
};

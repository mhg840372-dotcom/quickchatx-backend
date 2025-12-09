// ======================================================
// 📦 fileClassifier.js — Clasifica archivos por MIME
// ======================================================

export const classifyFile = (mime) => {
  if (!mime) return "other";

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("pdf")) return "document";
  if (mime.includes("word") || mime.includes("msword")) return "document";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "document";
  if (mime.includes("zip") || mime.includes("compressed")) return "compressed";
  if (mime.startsWith("audio/")) return "audio";

  return "other";
};

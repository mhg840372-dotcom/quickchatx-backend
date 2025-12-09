// ======================================================
// 🧬 hybridUpload.js — v8.1 LTS HYBRID + BIG-FILES
// ------------------------------------------------------
// ✔ Usa la misma instancia de multer (uploadMiddleware.js v18+)
// ✔ EVITA LIMIT_UNEXPECTED_FILE (usa upload.any())
// ✔ Soporta: media, file, files, image, video, audio,
//   avatar, background, thumbnail, y cualquier otro campo
// ✔ Normaliza req.file cuando solo llega un archivo
// ✔ Normaliza req.files a objeto { fieldName: File[] }
// ✔ Limpia estructuras inválidas de req.files
// ✔ 🆕 Manejo elegante de archivos demasiado grandes (413 JSON)
// ======================================================

import multer from "multer";
import upload, {
  UPLOAD_MAX_FILE_SIZE_MB,
} from "./uploadMiddleware.js";

// Campos “oficiales” del backend (solo para referencia/documentación)
export const HYBRID_FIELDS = [
  "media",
  "file",
  "files",
  "image",
  "video",
  "audio",
  "avatar",
  "background",
  "thumbnail",
];

// ======================================================
// 🧩 Middleware híbrido oficial (a prueba de bombas)
// ======================================================
export const hybridUpload = (req, res, next) => {
  // 🔥 Acepta CUALQUIER campo de archivo → no hay Unexpected field
  const handler = upload.any();

  handler(req, res, (err) => {
    if (err) {
      console.error("❌ hybridUpload Multer Error:", err);

      // 🆕 Error típico cuando el archivo supera el límite de tamaño
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          error: `El archivo es demasiado grande. Límite aproximado: ${UPLOAD_MAX_FILE_SIZE_MB.toFixed(
            1
          )}MB.`,
          code: "UPLOAD_LIMIT_EXCEEDED",
        });
      }

      // Errores de filtro (MIME no permitido, etc.)
      if (err?.message?.toLowerCase().includes("tipo de archivo no permitido")) {
        return res.status(400).json({
          success: false,
          error: err.message,
          code: "UPLOAD_MIME_NOT_ALLOWED",
        });
      }

      // Cualquier otro error sigue el flujo normal
      return next(err);
    }

    // En upload.any(), req.files es SIEMPRE un array
    const arrayFiles = Array.isArray(req.files) ? req.files : [];

    // Agrupamos por fieldname en un objeto: { media: [..], file: [..], ... }
    const filesByField = {};

    for (const f of arrayFiles) {
      if (!f) continue;
      const field =
        (f.fieldname && String(f.fieldname).trim()) || "file";

      if (!filesByField[field]) {
        filesByField[field] = [];
      }
      filesByField[field].push(f);
    }

    // Limpiar: eliminar campos vacíos
    for (const key of Object.keys(filesByField)) {
      if (
        !Array.isArray(filesByField[key]) ||
        filesByField[key].length === 0
      ) {
        delete filesByField[key];
      }
    }

    // 🔁 Compatibilidad:
    // - req.files: objeto { fieldName: File[] }
    // - req.file: si solo hay un archivo total
    req.files = filesByField;

    const allFiles = Object.values(filesByField).flat();

    if (!req.file && allFiles.length === 1) {
      req.file = allFiles[0];
    }

    // Si no hay archivos, aseguramos estructura consistente
    if (!req.files || Object.keys(req.files).length === 0) {
      req.files = {};
    }

    return next();
  });
};

export default hybridUpload;

// ======================================================
// 📦 uploadMiddleware.js — v18.2 (2025) Anti-Corruption + R2
// ------------------------------------------------------
// ✔ Slug seguro por usuario (sin confiar en body)
// ✔ Extensiones mapeadas por MIME (anti-binario fantasma)
// ✔ Carpetas autocreadas + export UPLOADS_BASE_DIR
// ✔ Límite por defecto 500MB (configurable por env)
// ✔ Soporte dual: disco local / Cloudflare R2 (UPLOAD_DRIVER)
// ✔ 100% compatible con hybridUpload / PostController
// ======================================================

import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// ======================================================
// 🔧 Configuración básica
// ======================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DRIVER = process.env.UPLOAD_DRIVER || "local"; // 'local' | 'r2'

const DEFAULT_BASE_DIR = path.resolve(__dirname, "../../uploads");

// En local: path real en disco
// En R2: prefijo lógico dentro del bucket (ej: "uploads")
export const UPLOADS_BASE_DIR =
  UPLOAD_DRIVER === "local"
    ? process.env.UPLOADS_DIR || process.env.UPLOAD_DIR || DEFAULT_BASE_DIR
    : process.env.R2_PREFIX || "uploads";

// Crear carpeta solo en modo local
if (UPLOAD_DRIVER === "local") {
  if (!fs.existsSync(UPLOADS_BASE_DIR)) {
    fs.mkdirSync(UPLOADS_BASE_DIR, { recursive: true });
    console.log("📁 Carpeta uploads creada:", UPLOADS_BASE_DIR);
  }
} else {
  console.log(
    `🪣 UPLOAD_DRIVER=r2 → usando Cloudflare R2. Prefijo base en bucket: ${UPLOADS_BASE_DIR}`
  );
}

// ======================================================
// 🛡️ Utilidades anti-corruption
// ======================================================
const toAscii = (value = "") =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const slugifyUser = (raw) => {
  const normalized = toAscii(String(raw || ""))
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 50);
  return normalized || null;
};

const resolveUploadUsername = (req) => {
  const candidates = [
    req?.user?.username,
    req?.user?.user?.username,
    req?.auth?.username,
    req?.auth?.user?.username,
    req?.body?.username,
  ];

  for (const candidate of candidates) {
    const slug = slugifyUser(candidate);
    if (slug) return slug;
  }

  const id = req?.user?._id || req?.user?.id;
  if (id) return `user_${String(id).slice(-8).toLowerCase()}`;

  return `anon_${crypto.randomBytes(4).toString("hex")}`;
};

const ensureDir = (dir) => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error("❌ Error creando carpeta:", dir, err);
  }
};

// ======================================================
// 🎨 Tipos soportados + extensiones forzadas
// ======================================================
const MIME_EXTENSION = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
};

const allowedMime = new Set(Object.keys(MIME_EXTENSION));

const pickExtension = (file) => {
  const fromName = path.extname(file?.originalname || "").toLowerCase();
  if (fromName && fromName.length <= 8 && /^[.\w-]+$/.test(fromName)) {
    return fromName;
  }

  if (file?.mimetype && MIME_EXTENSION[file.mimetype]) {
    return MIME_EXTENSION[file.mimetype];
  }

  return ".bin";
};

// ======================================================
// ☁️ Cloudflare R2 (S3 compatible)
// ======================================================
let r2Client = null;
const R2_BUCKET = process.env.R2_BUCKET;

if (UPLOAD_DRIVER === "r2") {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!R2_BUCKET || !endpoint || !accessKeyId || !secretAccessKey) {
    console.warn(
      "⚠️ UPLOAD_DRIVER=r2 pero faltan variables: R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
    );
  } else {
    r2Client = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      // Evita que el SDK añada headers de checksum (requieren Content-Length)
      // que rompen los streams con x-amz-decoded-content-length=undefined.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    console.log("🪣 Cloudflare R2 client inicializado para bucket:", R2_BUCKET);
  }
}

// ======================================================
// 🧱 Storage R2 (custom Multer storage)
// ======================================================
const r2Storage = {
  _handleFile(req, file, cb) {
    if (!r2Client || !R2_BUCKET) {
      return cb(
        new Error(
          "R2 no está configurado correctamente. Revisa variables de entorno."
        )
      );
    }

    const username = resolveUploadUsername(req);
    req.uploadUser = username;

    const ext = pickExtension(file);
    const randomName = crypto.randomBytes(16).toString("hex");
    const finalName = `${Date.now()}_${randomName}${ext}`;

    // Prefijo lógico dentro del bucket: uploads/username/archivo.ext
    const userFolder = `${UPLOADS_BASE_DIR}/${username}`;
    const key = `${userFolder}/${finalName}`.replace(/\/\/+/g, "/");

    const putCommand = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: file.stream, // streaming directo a R2
      ContentType: file.mimetype,
    });

    r2Client
      .send(putCommand)
      .then(() => {
        cb(null, {
          destination: userFolder, // lógico
          filename: finalName,
          path: key, // usamos la key de R2 como "path"
          mimetype: file.mimetype,
          bucket: R2_BUCKET,
          key,
          storage: "r2",
        });
      })
      .catch((err) => cb(err));
  },

  _removeFile(req, file, cb) {
    if (!r2Client || !R2_BUCKET || !file?.path) return cb(null);

    r2Client
      .send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: file.path,
        })
      )
      .then(() => cb(null))
      .catch((err) => cb(err));
  },
};

// ======================================================
// 🧱 Storage en disco (original)
// ======================================================
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const username = resolveUploadUsername(req);
      const userFolder = path.join(UPLOADS_BASE_DIR, username);
      ensureDir(userFolder);
      req.uploadUser = username;
      cb(null, userFolder);
    } catch (err) {
      cb(new Error("Error creando carpeta de usuario"), null);
    }
  },

  filename: (req, file, cb) => {
    const ext = pickExtension(file);
    const randomName = crypto.randomBytes(16).toString("hex");
    const finalName = `${Date.now()}_${randomName}${ext}`;
    cb(null, finalName);
  },
});

// Elegimos storage según el driver
const storage = UPLOAD_DRIVER === "r2" ? r2Storage : diskStorage;

// ======================================================
// ✅ File filter (MIME estricto)
// ======================================================
const fileFilter = (req, file, cb) => {
  const mime = file?.mimetype;
  if (!mime || !allowedMime.has(mime)) {
    return cb(
      new Error(`Tipo de archivo no permitido (${mime || "desconocido"})`),
      false
    );
  }
  cb(null, true);
};

// ======================================================
// 🚀 Multer — configurable por env (compatible v17 + mejoras)
// ------------------------------------------------------
// Prioridad de límites:
//  1) UPLOAD_MAX_BYTES
//  2) UPLOAD_MAX_MB
//  3) UPLOAD_LIMIT_MB
//  4) BODY_LIMIT_MB
//  5) DEFAULT_MAX_FILE_SIZE_MB (500MB)
// ======================================================
const DEFAULT_MAX_FILE_SIZE_MB = 500; // ⬅️ antes 1024 (1GB)

const envMaxBytes = Number(process.env.UPLOAD_MAX_BYTES);
const envMaxMbLegacy = Number(process.env.UPLOAD_MAX_MB);
const envUploadLimitMb = Number(process.env.UPLOAD_LIMIT_MB);
const envBodyLimitMb = Number(process.env.BODY_LIMIT_MB);

let maxFileSizeBytes;

if (Number.isFinite(envMaxBytes) && envMaxBytes > 0) {
  maxFileSizeBytes = envMaxBytes;
} else if (Number.isFinite(envMaxMbLegacy) && envMaxMbLegacy > 0) {
  maxFileSizeBytes = envMaxMbLegacy * 1024 * 1024;
} else if (Number.isFinite(envUploadLimitMb) && envUploadLimitMb > 0) {
  maxFileSizeBytes = envUploadLimitMb * 1024 * 1024;
} else if (Number.isFinite(envBodyLimitMb) && envBodyLimitMb > 0) {
  maxFileSizeBytes = envBodyLimitMb * 1024 * 1024;
} else {
  maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024;
}

const effectiveLimitMb = maxFileSizeBytes / 1024 / 1024;

// exportamos los límites para reutilizarlos (ej: media.js)
export const UPLOAD_MAX_FILE_SIZE_BYTES = maxFileSizeBytes;
export const UPLOAD_MAX_FILE_SIZE_MB = effectiveLimitMb;

const envMaxFiles = Number(process.env.UPLOAD_MAX_FILES);
const MAX_FILES_PER_REQUEST =
  Number.isFinite(envMaxFiles) && envMaxFiles > 0 ? envMaxFiles : 500;

console.log(
  `📦 Multer limits → fileSize ≈ ${effectiveLimitMb.toFixed(
    1
  )}MB (${maxFileSizeBytes} bytes), maxFiles=${MAX_FILES_PER_REQUEST}, driver=${UPLOAD_DRIVER}`
);

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: maxFileSizeBytes,
    files: MAX_FILES_PER_REQUEST,
  },
});

export default upload;
// ======================================================

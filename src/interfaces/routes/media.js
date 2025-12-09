// ======================================================
// 📁 media.js — Upload + Procesado de Video (ffmpeg) + R2 + Compresión agresiva
// ------------------------------------------------------
// ✔ Sube video a tmp_uploads/
// ✔ "Tronco": genera máx. 720p fuertemente comprimido (H.264) → original + variante 720p
// ✔ "Batón": genera variante 360p aún más comprimida
// ✔ Genera thumb en /uploads/thumbs
// ✔ Guarda en VideoModel
// ✔ Devuelve JSON listo para el frontend
// ✔ Usa el mismo límite de tamaño que uploadMiddleware (≈500MB por defecto)
// ✔ Manejo elegante de LIMIT_FILE_SIZE (413 JSON)
// ✔ ffmpeg: CRF + maxrate / bufsize para bajar mucho el peso
// ✔ Soporte dual: LOCAL / Cloudflare R2 (UPLOAD_DRIVER)
// ======================================================

import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Usa el modelo real desde infraestructura
import { VideoModel } from "../../infrastructure/models/VideoModel.js";

// Reutilizamos el límite global de uploads (500MB por defecto)
import {
  UPLOAD_MAX_FILE_SIZE_BYTES,
} from "../../infrastructure/uploadMiddleware.js";

const router = express.Router();

// ======================================================
// 🔧 Config almacenamiento (LOCAL / R2)
// ======================================================
const UPLOAD_DRIVER = process.env.UPLOAD_DRIVER || "local";

const R2_BUCKET = process.env.R2_BUCKET;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

let r2Client = null;

if (
  UPLOAD_DRIVER === "r2" &&
  R2_BUCKET &&
  R2_ENDPOINT &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY
) {
  r2Client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    // Desactiva checksums automáticos que requieren Content-Length (streaming).
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  console.log(
    "🪣 media.js → Cloudflare R2 client inicializado. Bucket:",
    R2_BUCKET
  );
} else if (UPLOAD_DRIVER === "r2") {
  console.warn(
    "⚠️ UPLOAD_DRIVER=r2 pero faltan variables R2_ (R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)"
  );
}

// Helper: sube un archivo local a R2 si está habilitado
async function uploadFileToR2(localPath, key, contentType) {
  if (!r2Client) {
    console.warn(
      `⚠️ uploadFileToR2: R2 no configurado, se omite subida de ${key}`
    );
    return;
  }

  const cleanKey = key.replace(/^\/+/, ""); // sin slash inicial
  const data = await fs.readFile(localPath);

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: cleanKey,
      Body: data,
      ContentType: contentType,
    })
  );

  console.log(`⬆️ Subido a R2: ${cleanKey} (${contentType})`);
}

// ======================================================
// 🔧 Parámetros de compresión ffmpeg
// ======================================================
// "Tronco" (máx. altura) → 720p
const FFMPEG_MAX_HEIGHT = Number(process.env.FFMPEG_MAX_HEIGHT) || 720;

// CRF más alto = más compresión, menos calidad.
// 30 es bastante agresivo pero usable para móvil / social.
const FFMPEG_VIDEO_PRESET =
  process.env.FFMPEG_VIDEO_PRESET || "veryfast";
const FFMPEG_VIDEO_CRF = process.env.FFMPEG_VIDEO_CRF || "30";

// Bitrates máximos por variante (kbps)
const VIDEO_720_MAX_KBPS =
  Number(process.env.FFMPEG_720P_MAX_KBPS) || 2500; // máx. ~2.5Mbps
const VIDEO_360_MAX_KBPS =
  Number(process.env.FFMPEG_360P_MAX_KBPS) || 800; // máx. ~0.8Mbps

// Usamos ruta relativa al proyecto; Node resuelve con cwd del proceso
const TMP_DIR = "tmp_uploads";

// Multer específico para este endpoint, pero usando el MISMO límite global
const upload = multer({
  dest: TMP_DIR + "/",
  limits: {
    fileSize: UPLOAD_MAX_FILE_SIZE_BYTES,
  },
});

// Asegura que exista el directorio temporario (top-level await en ESM)
await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

// Opcional: si defines estos paths en el .env, se configuran aquí
if (process.env.FFMPEG_PATH) {
  try {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
  } catch (e) {
    console.warn("⚠ No se pudo setear FFMPEG_PATH:", e?.message || e);
  }
}
if (process.env.FFPROBE_PATH) {
  try {
    ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
  } catch (e) {
    console.warn("⚠ No se pudo setear FFPROBE_PATH:", e?.message || e);
  }
}

// ======================================================
// 🔧 helper para procesar video con compresión "tronco + batón"
//  - Tronco = 720p máx (fuertemente comprimido)
//  - Batón  = 360p aún más comprimido
// ======================================================
async function processVideo(filePath, ownerId) {
  const t0 = Date.now();
  const useR2 = UPLOAD_DRIVER === "r2" && !!r2Client;

  const id = `vid_${Date.now()}`;
  const outDir = "uploads/videos";
  const thumbDir = "uploads/thumbs";

  // Rutas lógicas (para URL y para key en R2)
  const originalRel = `${outDir}/${id}_720p.mp4`; // "tronco" → máx 720p
  const thumbRel = `${thumbDir}/${id}.jpg`;

  // Paths absolutos locales donde ffmpeg escribirá
  const originalAbs = path.resolve(originalRel);
  const thumbAbs = path.resolve(thumbRel);

  // Aseguramos carpetas locales para ffmpeg, siempre, aunque luego subamos a R2
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(thumbDir, { recursive: true });

  // 0) ffprobe original de entrada para saber altura y duración
  const probeData = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) =>
      err ? reject(err) : resolve(data)
    );
  });

  const videoStream =
    probeData?.streams?.find((s) => s.codec_type === "video") ||
    probeData?.streams?.[0];

  const srcHeight = Number(videoStream?.height) || 0;
  let rawDuration = probeData?.format?.duration;

  if (typeof rawDuration === "string") {
    const parsed = Number(rawDuration);
    if (Number.isFinite(parsed)) rawDuration = parsed;
  }

  const duration =
    typeof rawDuration === "number" && Number.isFinite(rawDuration)
      ? rawDuration
      : 0;

  // 1) "Tronco": convertir a H.264 máx. 720p fuertemente comprimido
  const t1 = Date.now();
  await new Promise((resolve, reject) => {
    const cmd = ffmpeg(filePath)
      .outputOptions([
        "-c:v libx264",
        `-preset ${FFMPEG_VIDEO_PRESET}`,
        `-crf ${FFMPEG_VIDEO_CRF}`,
        `-maxrate ${VIDEO_720_MAX_KBPS}k`,
        `-bufsize ${VIDEO_720_MAX_KBPS * 2}k`,
        "-profile:v high",
        "-level 4.0",
        "-c:a aac",
        "-b:a 96k",
        "-movflags +faststart",
      ]);

    // Solo reducimos a 720p si el original es más alto, nunca escalamos hacia arriba
    if (srcHeight && srcHeight > FFMPEG_MAX_HEIGHT) {
      cmd.size(`?x${FFMPEG_MAX_HEIGHT}`);
    }

    cmd
      .output(originalAbs)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
  const t2 = Date.now();
  console.log(
    "⏱ ffmpeg tronco 720p:",
    ((t2 - t1) / 1000).toFixed(2),
    "s",
    `(preset=${FFMPEG_VIDEO_PRESET}, crf=${FFMPEG_VIDEO_CRF}, maxrate=${VIDEO_720_MAX_KBPS}k)`
  );

  const origStat = await fs.stat(originalAbs);

  // 2) Generar thumb (frame en el segundo 1) desde el tronco 720p
  const t3 = Date.now();
  await new Promise((resolve, reject) => {
    ffmpeg(originalAbs)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .screenshots({
        count: 1,
        filename: path.basename(thumbAbs),
        folder: path.dirname(thumbAbs),
        timemarks: ["1"],
      });
  });
  const t4 = Date.now();
  console.log("⏱ ffmpeg thumb:", ((t4 - t3) / 1000).toFixed(2), "s");

  // 3) Variantes:
  //    - 720p: usamos el tronco como variante principal (no re-encode)
  //    - 360p: "batón", aún más comprimida
  const variants = [];

  // Variante 720p (tronco)
  const variant720Url = "/" + originalRel;
  variants.push({
    quality: "720p",
    url: variant720Url,
    mime: "video/mp4",
    sizeBytes: origStat.size,
  });

  // Batón: 360p
  const tVarStart = Date.now();
  const q = { label: "360p", h: 360 };

  const variantRel = `${outDir}/${id}_${q.label}.mp4`;
  const variantAbs = path.resolve(variantRel);
  const tv1 = Date.now();

  await new Promise((resolve, reject) => {
    const cmd = ffmpeg(originalAbs)
      .size(`?x${q.h}`) // siempre reducimos, el 720p es más alto
      .outputOptions([
        "-c:v libx264",
        `-preset ${FFMPEG_VIDEO_PRESET}`,
        `-crf ${FFMPEG_VIDEO_CRF}`,
        `-maxrate ${VIDEO_360_MAX_KBPS}k`,
        `-bufsize ${VIDEO_360_MAX_KBPS * 2}k`,
        "-profile:v main",
        "-level 3.1",
        "-c:a aac",
        "-b:a 64k",
        "-movflags +faststart",
      ]);

    cmd
      .output(variantAbs)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });

  const tv2 = Date.now();
  console.log(
    `⏱ ffmpeg batón 360p:`,
    ((tv2 - tv1) / 1000).toFixed(2),
    "s",
    `(maxrate=${VIDEO_360_MAX_KBPS}k)`
  );

  const stat360 = await fs.stat(variantAbs);

  variants.push({
    quality: q.label,
    url: "/" + variantRel,
    mime: "video/mp4",
    sizeBytes: stat360.size,
  });

  console.log(
    "⏱ ffmpeg variants total:",
    ((Date.now() - tVarStart) / 1000).toFixed(2),
    "s"
  );

  // 4) Subir tronco + batón + thumb a R2 si corresponde
  if (useR2) {
    try {
      await uploadFileToR2(originalAbs, originalRel, "video/mp4");
    } catch (err) {
      console.error("❌ Error subiendo tronco 720p a R2:", originalRel, err);
    }

    try {
      await uploadFileToR2(variantAbs, variantRel, "video/mp4");
    } catch (err) {
      console.error("❌ Error subiendo batón 360p a R2:", variantRel, err);
    }

    try {
      await uploadFileToR2(thumbAbs, thumbRel, "image/jpeg");
    } catch (err) {
      console.error("❌ Error subiendo thumb a R2:", thumbRel, err);
    }

    // Opcional: borrar los archivos locales finales para ahorrar espacio
    await fs.unlink(originalAbs).catch(() => {});
    await fs.unlink(variantAbs).catch(() => {});
    await fs.unlink(thumbAbs).catch(() => {});
  }

  // 5) Guardar en BD
  const originalUrl = "/" + originalRel; // tronco 720p
  const thumbUrl = "/" + thumbRel;

  const doc = await VideoModel.create({
    ownerId,
    originalUrl,
    thumbUrl,
    duration,
    mime: "video/mp4",
    defaultQuality: "720p",
    variants,
  });

  // 6) Devolver JSON listo para el frontend
  const defaultVariant =
    variants.find((v) => v.quality === "720p") || variants[0];

  console.log(
    "⏱ processVideo total:",
    ((Date.now() - t0) / 1000).toFixed(2),
    "s"
  );

  return {
    id: doc._id.toString(),
    type: "video",
    duration,
    thumbUrl: doc.thumbUrl,
    quality: defaultVariant?.quality || "720p",
    mime: "video/mp4",
    url: defaultVariant?.url || doc.originalUrl,
    variants,
  };
}

// ======================================================
// POST /api/media/upload-video
// field name: "video"
// ======================================================
router.post("/upload-video", upload.single("video"), async (req, res) => {
  let tmpPath = null;

  try {
    const file = req.file;

    // 🔐 Sacar el usuario REAL si viene por JWT
    const ownerIdFromUser = req.user?._id || req.user?.id || null;

    // 📝 Fallback opcional: permitir ownerId explícito en el body (campo normal del form-data)
    const ownerIdFromBody =
      typeof req.body?.ownerId === "string" && req.body.ownerId.trim().length > 0
        ? req.body.ownerId.trim()
        : null;

    const ownerId = ownerIdFromUser || ownerIdFromBody;

    if (!ownerId) {
      console.warn(
        "⚠ [/api/media/upload-video] intento de subida SIN usuario (ownerId vacío)"
      );
      return res.status(401).json({
        success: false,
        error:
          "No se pudo identificar al usuario que sube el video (ownerId ausente).",
        code: "NO_OWNER_ID",
      });
    }

    if (!file) {
      return res
        .status(400)
        .json({ success: false, error: "No se recibió archivo." });
    }

    tmpPath = file.path;

    const fileSizeMb = file.size / 1024 / 1024;
    const limitMb = UPLOAD_MAX_FILE_SIZE_BYTES / 1024 / 1024;

    console.log(
      `📹 [/api/media/upload-video] recibido ${fileSizeMb.toFixed(
        2
      )}MB (límite≈${limitMb.toFixed(1)}MB) ownerId=${ownerId}`
    );

    const json = await processVideo(tmpPath, ownerId);

    return res.json({ success: true, data: json });
  } catch (e) {
    console.error("upload-video error:", e);
    return res.status(500).json({
      success: false,
      error: "No se pudo procesar el video.",
    });
  } finally {
    if (tmpPath) {
      fs.unlink(tmpPath).catch(() => {});
    }
  }
});

// 🆕 Manejador de errores específico para este router (tamaño excedido)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    const limitMb = UPLOAD_MAX_FILE_SIZE_BYTES / 1024 / 1024;
    console.error("❌ upload-video LIMIT_FILE_SIZE:", err);
    return res.status(413).json({
      success: false,
      error: `El video es demasiado grande. Límite aproximado: ${limitMb.toFixed(
        1
      )}MB.`,
      code: "UPLOAD_LIMIT_EXCEEDED",
    });
  }

  // Dejar pasar otros errores al manejador global
  return next(err);
});

export default router;
// ======================================================

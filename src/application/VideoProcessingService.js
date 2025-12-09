// src/application/VideoProcessingService.js
// =======================================================
// 🎬 VideoProcessingService — v2.0 (metadata + transcode)
// -------------------------------------------------------
// - ffprobe: durationSec, width, height, bitrate
// - enrichVideoFileMetadata: JSON listo para guardarse en Upload
// - createVideoRecordForUpload:
//    • Copia original a /uploads/videos/vid_<ts>_orig.mp4
//    • Genera 360p + 720p
//    • Genera thumbnail en /uploads/thumbs
//    • Crea documento en colección "videos" con ownerId real
// - Si algo falla, loguea y NO rompe el flujo de subida
// =======================================================

import fs from "fs";
import path from "path";
import ffmpeg from "../video/ffmpegClient.js";
import VideoModel from "../infrastructure/models/VideoModel.js";

/* ======================================================
   Helpers internos
   ====================================================== */

function normalizeUploadsRelativePath(localPath) {
  let rel = localPath.toString().trim().replace(/\\/g, "/");

  const marker = "/uploads/";
  const idx = rel.indexOf(marker);
  if (idx >= 0) rel = rel.slice(idx + marker.length);

  rel = rel.replace(/^\/+/, "");
  return rel;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/* ======================================================
   ffprobe metadata
   ====================================================== */

/**
 * Ejecuta ffprobe sobre un archivo local y saca metadata básica.
 * Nunca lanza excepción: siempre resuelve con un objeto seguro.
 *
 * @param {string} absolutePath
 * @returns {Promise<{durationSec: number|null, width: number|null, height: number|null, bitrate: number|null}>}
 */
export async function probeVideoMetadata(absolutePath) {
  return new Promise((resolve) => {
    const EMPTY = {
      durationSec: null,
      width: null,
      height: null,
      bitrate: null,
    };

    if (!absolutePath) return resolve(EMPTY);

    if (!fs.existsSync(absolutePath)) {
      console.warn("[VideoProcessingService] Archivo no existe:", absolutePath);
      return resolve(EMPTY);
    }

    try {
      ffmpeg.ffprobe(absolutePath, (err, metadata) => {
        if (err) {
          console.warn(
            "[VideoProcessingService] ffprobe error:",
            err.message || err
          );
          return resolve(EMPTY);
        }

        const format = metadata?.format || {};
        const streams = Array.isArray(metadata?.streams)
          ? metadata.streams
          : [];

        const videoStream =
          streams.find((s) => s.codec_type === "video") || {};

        let durationSec = null;
        if (typeof format.duration === "number") {
          durationSec = format.duration;
        } else if (typeof format.duration === "string") {
          const n = Number(format.duration);
          durationSec = Number.isFinite(n) ? n : null;
        }

        const width =
          typeof videoStream.width === "number" ? videoStream.width : null;
        const height =
          typeof videoStream.height === "number" ? videoStream.height : null;

        let bitrate = null;
        if (typeof format.bit_rate === "number") {
          bitrate = format.bit_rate;
        } else if (typeof format.bit_rate === "string") {
          const n = Number(format.bit_rate);
          bitrate = Number.isFinite(n) ? n : null;
        }

        resolve({
          durationSec: durationSec && durationSec > 0 ? durationSec : null,
          width,
          height,
          bitrate,
        });
      });
    } catch (e) {
      console.warn(
        "[VideoProcessingService] ffprobe threw error:",
        e?.message || e
      );
      resolve(EMPTY);
    }
  });
}

/**
 * Calidad aproximada a partir de resolución.
 *
 * @param {number|null} width
 * @param {number|null} height
 * @returns {string|null}
 */
function guessQualityFromResolution(width, height) {
  if (!width || !height) return null;
  const h = Math.max(width, height); // por si viene rotado

  if (h >= 2160) return "4K";
  if (h >= 1440) return "1440p";
  if (h >= 1080) return "1080p";
  if (h >= 720) return "720p";
  if (h >= 480) return "480p";
  if (h >= 360) return "360p";
  return null;
}

/* ======================================================
   enrichVideoFileMetadata (usado por UploadService)
   ====================================================== */

/**
 * Enriquecer un archivo de video con metadata lista para MediaSchema.
 *
 * @param {Object} opts
 * @param {string} opts.localPath - ruta relativa dentro de /uploads
 *        (ej: "user/file.mp4" o "/uploads/user/file.mp4")
 * @param {string} [opts.mime] - mimeType, ej "video/mp4"
 * @param {number} [opts.size] - tamaño en bytes
 */
export async function enrichVideoFileMetadata({ localPath, mime, size }) {
  if (!localPath) {
    return {
      durationSec: null,
      width: null,
      height: null,
      quality: null,
      variants: [],
      videoProcessing: {
        status: "ready",
        engine: "ffmpeg",
        errorCode: "NO_PATH",
        errorMessage: "Sin ruta de archivo",
        updatedAt: new Date(),
      },
    };
  }

  // Normalizar ruta relativa dentro de ./uploads
  const rel = normalizeUploadsRelativePath(localPath);
  const absolutePath = path.resolve("./uploads", rel);

  const meta = await probeVideoMetadata(absolutePath);

  const quality =
    guessQualityFromResolution(meta.width, meta.height) || null;

  // Por ahora sin variantes: estructura lista para el futuro
  const variants = [];

  return {
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    quality,
    variants,
    videoProcessing: {
      status: "ready",
      engine: "ffmpeg",
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    },
  };
}

/* ======================================================
   createVideoRecordForUpload — transcoder + Mongo
   ====================================================== */

/**
 * Crea registro en colección "videos" y genera transcodificaciones.
 *
 * @param {Object} opts
 * @param {Object} opts.user      - objeto user (req.user)
 * @param {string} opts.localPath - ruta tipo "/uploads/<user>/<file>.mp4"
 * @param {string} [opts.mime]    - ej "video/mp4"
 * @param {number} [opts.size]    - tamaño original en bytes
 *
 * @returns {Promise<VideoModel|null>}
 */
export async function createVideoRecordForUpload({
  user,
  localPath,
  mime,
  size,
}) {
  try {
    if (!localPath) return null;

    const uploadsRoot = path.resolve("./uploads");
    const rel = normalizeUploadsRelativePath(localPath);
    const sourceAbsolutePath = path.join(uploadsRoot, rel);

    if (!fs.existsSync(sourceAbsolutePath)) {
      console.warn(
        "[VideoProcessingService] Archivo origen no existe para video:",
        sourceAbsolutePath
      );
      return null;
    }

    const videosDir = path.join(uploadsRoot, "videos");
    const thumbsDir = path.join(uploadsRoot, "thumbs");
    ensureDir(videosDir);
    ensureDir(thumbsDir);

    const ts = Date.now();
    const baseId = `vid_${ts}`;

    // Original en carpeta /uploads/videos
    const origFilename = `${baseId}_orig.mp4`;
    const origAbsolutePath = path.join(videosDir, origFilename);

    if (!fs.existsSync(origAbsolutePath)) {
      await fs.promises.copyFile(sourceAbsolutePath, origAbsolutePath);
    }

    // Variantes 360p + 720p
    const variantConfigs = [
      { quality: "360p", size: "640x360" },
      { quality: "720p", size: "1280x720" },
    ];

    const variants = [];

    for (const cfg of variantConfigs) {
      const outFilename = `${baseId}_${cfg.quality}.mp4`;
      const outAbsolutePath = path.join(videosDir, outFilename);

      if (!fs.existsSync(outAbsolutePath)) {
        await new Promise((resolve, reject) => {
          ffmpeg(origAbsolutePath)
            .videoCodec("libx264")
            .audioCodec("aac")
            .size(cfg.size)
            .outputOptions(["-preset veryfast", "-movflags +faststart"])
            .on("end", resolve)
            .on("error", reject)
            .save(outAbsolutePath);
        });
      }

      const stat = await fs.promises.stat(outAbsolutePath);

      variants.push({
        quality: cfg.quality,
        url: `/uploads/videos/${outFilename}`,
        mime: mime || "video/mp4",
        width: null,
        height: null,
        sizeBytes: stat.size,
      });
    }

    // Thumbnail en /uploads/thumbs
    const thumbFilename = `${baseId}.jpg`;
    const thumbAbsolutePath = path.join(thumbsDir, thumbFilename);

    if (!fs.existsSync(thumbAbsolutePath)) {
      await new Promise((resolve, reject) => {
        ffmpeg(origAbsolutePath)
          .screenshots({
            timestamps: ["00:00:00.5"],
            filename: thumbFilename,
            folder: thumbsDir,
          })
          .on("end", resolve)
          .on("error", reject);
      });
    }

    const meta = await probeVideoMetadata(origAbsolutePath);

    const ownerRaw =
      user?._id ||
      user?.id ||
      user?.ownerId ||
      user?.userId ||
      null;
    const ownerId = ownerRaw ? String(ownerRaw) : "anonymous";

    const defaultQuality =
      variants.find((v) => v.quality === "720p")?.quality ||
      variants[0]?.quality ||
      "720p";

    const doc = await VideoModel.create({
      ownerId,
      originalUrl: `/uploads/videos/${origFilename}`,
      thumbUrl: `/uploads/thumbs/${thumbFilename}`,
      duration: meta.durationSec ?? 0,
      mime: mime || "video/mp4",
      defaultQuality,
      variants,
    });

    return doc;
  } catch (err) {
    console.warn(
      "[VideoProcessingService] Error en createVideoRecordForUpload:",
      err?.message || err
    );
    // Dejamos que el caller decida si quiere capturar; normalmente se usa en fire-and-forget.
    throw err;
  }
}

/* ======================================================
   EOF
   ====================================================== */

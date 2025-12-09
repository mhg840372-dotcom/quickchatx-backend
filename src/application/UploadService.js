// src/application/UploadService.js
// =======================================================
// 📤 UploadService — v16.2 (video-aware + ffmpeg hook)
// -------------------------------------------------------
// - Guarda archivo en /uploads/<username>/
// - Calcula hash, tamaño, tipo lógico (image/video/audio/document/file)
// - En videos:
//    • enrichVideoFileMetadata → durationSec, width, height, quality, videoProcessing
//    • createVideoRecordForUpload (fire & forget) → crea doc en "videos" + transcodifica
// =======================================================

import Upload from "../domain/Upload.js";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import chalk from "chalk";
import { User } from "../domain/User.js";
// 🆕 Enriquecedor de metadata de video + transcoder
import {
  enrichVideoFileMetadata,
  createVideoRecordForUpload,
} from "./VideoProcessingService.js";

export class UploadService {
  /* ===============================
      📤 Guardar archivo
     =============================== */
  static async saveFile(file, user, uploadDir) {
    try {
      if (!file || (!file.originalname && !file.filename)) {
        throw new Error("Archivo inválido o vacío");
      }

      // 🔐 Resolver id de usuario de forma robusta
      const userId = user?._id || user?.id;
      if (!userId) {
        throw new Error("Usuario inválido.");
      }

      // Validar usuario en DB
      const userExists = await User.exists({ _id: userId });
      if (!userExists) {
        throw new Error("Usuario inválido.");
      }

      const username =
        String(user.username || "").toLowerCase().trim() || "uploads";

      // Directorio del usuario
      const userDir = path.join(uploadDir, username);
      await fs.mkdir(userDir, { recursive: true });

      // Nombre único
      const originalName = file.originalname || file.filename || "file";
      const ext = path.extname(originalName).toLowerCase();
      const unique = crypto.randomBytes(16).toString("hex");
      const uniqueName = `${Date.now()}_${unique}${ext}`;

      const absolutePath = path.join(userDir, uniqueName);

      // Guardar archivo
      if (file.buffer) {
        await fs.writeFile(absolutePath, file.buffer);
      } else if (file.path) {
        await fs.rename(file.path, absolutePath);
      } else {
        throw new Error("Archivo inválido: sin buffer ni path.");
      }

      // Tamaño (una sola vez)
      const stat = await fs.stat(absolutePath);
      const size = file.size || stat.size;

      // Hash
      const fileBuffer = await fs.readFile(absolutePath);
      const hash = crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");

      // Tipo lógico
      const mime = (file.mimetype || file.mime || "").toLowerCase();
      let filetype = "file";

      if (mime.startsWith("image")) filetype = "image";
      else if (mime.startsWith("video")) filetype = "video";
      else if (mime.startsWith("audio")) filetype = "audio";
      else if (mime.includes("pdf") || mime.includes("word"))
        filetype = "document";

      // Path público relativo (SIEMPRE así)
      const publicPath = `/uploads/${username}/${uniqueName}`;

      // 🧠 Campos extra de video (metadata básica + hook de transcode)
      let videoMeta = null;

      if (filetype === "video") {
        // 1) Enriquecer metadata JSON-friendly
        try {
          videoMeta = await enrichVideoFileMetadata({
            localPath: publicPath, // el helper sabe resolver /uploads/...
            mime,
            size,
          });
        } catch (e) {
          console.warn(
            chalk.yellow(
              "[UploadService] No se pudo enriquecer metadata de video:",
              e?.message || e
            )
          );
        }

        // 2) Lanzar transcodificación + registro en colección "videos"
        //    No bloquea la respuesta al cliente (fire & forget).
        try {
          Promise.resolve(
            createVideoRecordForUpload({
              user,
              localPath: publicPath,
              mime,
              size,
            })
          ).catch((err) => {
            console.warn(
              chalk.yellow(
                "[UploadService] Error en createVideoRecordForUpload:",
                err?.message || err
              )
            );
          });
        } catch (e) {
          console.warn(
            chalk.yellow(
              "[UploadService] No se pudo iniciar transcodificación de video:",
              e?.message || e
            )
          );
        }
      }

      // Guardar en DB
      const newUpload = await Upload.create({
        user: userId,
        filename: uniqueName,
        path: publicPath,
        mimetype: mime,
        filetype,
        size,
        hash,
        virusScan: { status: "pending" },
        uploadedAt: new Date(),
        // 🧠 Campos extra de video (durationSec, width, height, quality, variants, videoProcessing)
        ...(videoMeta || {}),
      });

      console.log(chalk.green(`📁 Upload guardado: ${publicPath}`));
      return newUpload;
    } catch (error) {
      console.error(chalk.red("❌ Error al guardar upload:"), error.message);
      throw new Error("No se pudo guardar el archivo.");
    }
  }

  /* ===============================
      🗑 Eliminar archivo
     =============================== */
  static async deleteFile(uploadId, uploadDir) {
    try {
      const upload = await Upload.findById(uploadId);
      if (!upload) throw new Error("Archivo no encontrado");

      const relativePath = upload.path.replace("/uploads/", "");
      const absolutePath = path.join(uploadDir, relativePath);

      await fs.unlink(absolutePath).catch(() => {});

      await upload.deleteOne();

      console.log(chalk.yellow(`🗑 Archivo eliminado: ${upload.filename}`));
      return true;
    } catch (error) {
      console.error(chalk.red("❌ Error al eliminar archivo:"), error.message);
      throw new Error("No se pudo eliminar el archivo.");
    }
  }

  /* ===============================
      🔍 Obtener uploads del usuario
     =============================== */
  static async getUserUploads(userId) {
    return Upload.find({ user: userId }).sort({ uploadedAt: -1 });
  }
}

// (opcional) si quieres soportar import default:
export default UploadService;

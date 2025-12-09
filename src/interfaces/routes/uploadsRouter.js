// src/interfaces/routes/uploadsRouter.js
// ======================================================
// 📂 uploadsRouter.js — API + Serving (LOCAL / R2)
// ------------------------------------------------------
// POST   /uploads/upload   → subir archivo (hybridUpload + UploadController)
// GET    /uploads/my       → mis archivos (meta en DB)
// DELETE /uploads/:id      → borrar (meta + objeto)
// GET    /uploads/*        → servir archivo físico desde LOCAL o R2
// ======================================================

import { Router } from "express";
import { UploadController } from "../controllers/uploadsController.js";
import { authMiddleware } from "../middlewares/AuthMiddleware.js";
import { hybridUpload } from "../../infrastructure/hybridUpload.js";

import fs from "fs";
import path from "path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { UPLOADS_BASE_DIR as BASE_FROM_MW } from "../../infrastructure/uploadMiddleware.js";

const router = Router();

// ======================================================
// 🔧 Config almacenamiento
// ======================================================
const UPLOAD_DRIVER = process.env.UPLOAD_DRIVER || "local";

// LOCAL: path absoluto que ya calcula uploadMiddleware
const LOCAL_UPLOADS_BASE =
  UPLOAD_DRIVER === "local" ? BASE_FROM_MW : null;

// R2
let r2Client = null;
let R2_BUCKET = null;
const R2_PREFIX = process.env.R2_PREFIX || "uploads";

if (UPLOAD_DRIVER === "r2") {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  R2_BUCKET = process.env.R2_BUCKET;

  if (!endpoint || !accessKeyId || !secretAccessKey || !R2_BUCKET) {
    console.warn(
      "⚠️ UPLOAD_DRIVER=r2 pero faltan variables: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET"
    );
  } else {
    r2Client = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      // Evitar checksums auto (requieren Content-Length) que rompen streams.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    console.log(
      "🪣 uploadsRouter → R2 client listo. Bucket:",
      R2_BUCKET,
      "Prefix:",
      R2_PREFIX
    );
  }
} else {
  console.log("📁 uploadsRouter → usando almacenamiento LOCAL:", LOCAL_UPLOADS_BASE);
}

// ======================================================
// 🧾 Rutas API existentes (sin cambios de contrato)
// ======================================================
router.post(
  "/upload",
  authMiddleware,
  hybridUpload, // ⬅️ Multer / hybridUpload
  UploadController.uploadFile
);

router.get("/my", authMiddleware, UploadController.getMyFiles);
router.delete("/:id", authMiddleware, UploadController.deleteFile);

// ======================================================
// 🖼 Servir archivos: GET /uploads/*
//  - En LOCAL: lee de disco (LOCAL_UPLOADS_BASE)
//  - En R2: key = R2_PREFIX + "/" + path_relativo
//    Ej: /uploads/videos/vid.mp4 → key "uploads/videos/vid.mp4"
// ======================================================
router.get("/*file", async (req, res) => {
  const rawParam = req.params.file ?? req.params[0] ?? "";
  const raw = Array.isArray(rawParam) ? rawParam.join("/") : rawParam;
  const relPath = String(raw).replace(/^\/+/, ""); // sin slash inicial

  if (!relPath) {
    return res.status(400).json({ error: "Ruta de archivo vacía" });
  }

  // ============================
  // ☁️ MODO R2
  // ============================
  if (UPLOAD_DRIVER === "r2" && r2Client && R2_BUCKET) {
    const key = `${R2_PREFIX}/${relPath}`.replace(/\/\/+/g, "/");

    try {
      const obj = await r2Client.send(
        new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        })
      );

      if (obj.ContentType) {
        res.setHeader("Content-Type", obj.ContentType);
      }
      if (obj.ContentLength != null) {
        res.setHeader("Content-Length", String(obj.ContentLength));
      }

      const stream = obj.Body;

      stream.on("error", (err) => {
        console.error("❌ Error en stream desde R2:", err);
        if (!res.headersSent) {
          res.sendStatus(500);
        } else {
          res.destroy(err);
        }
      });

      stream.pipe(res);
      return;
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404) {
        return res.sendStatus(404);
      }
      console.error("❌ Error GetObject R2:", err);
      return res.sendStatus(500);
    }
  }

  // ============================
  // 💾 MODO LOCAL (fallback / dev)
  // ============================
  if (!LOCAL_UPLOADS_BASE) {
    return res
      .status(500)
      .json({ error: "Almacenamiento local no configurado" });
  }

  const absolutePath = path.join(LOCAL_UPLOADS_BASE, relPath);
  const normalized = path.normalize(absolutePath);

  // anti path traversal
  if (!normalized.startsWith(LOCAL_UPLOADS_BASE)) {
    return res.status(400).json({ error: "Ruta inválida" });
  }

  fs.access(normalized, fs.constants.F_OK, (err) => {
    if (err) {
      return res.sendStatus(404);
    }

    res.sendFile(normalized, (sendErr) => {
      if (sendErr) {
        console.error("❌ Error enviando archivo local:", sendErr);
        if (!res.headersSent) {
          res.sendStatus(500);
        }
      }
    });
  });
});

export default router;

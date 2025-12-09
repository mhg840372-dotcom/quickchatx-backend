// ======================================================
// 🚀 chatRoutes.js — QuickChatX 2025 (FINAL)
// ------------------------------------------------------
// Rutas oficiales del módulo de chat:
// ✔ Historial paginado
// ✔ Envío de texto + multimedia
// ✔ Soft delete / restore
// ✔ Compatible con uploadMiddleware v17 (200MB)
// ======================================================

import express from "express";
import upload from "../../infrastructure/uploadMiddleware.js";
import { ChatController } from "../controllers/chat.js";

const router = express.Router();

/* ======================================================
   📜 Obtener historial
   GET /api/chat/:receiverId?page=1&chatKey=...
   - page: opcional (paginación futuro)
   - chatKey: opcional (AES por usuario)
====================================================== */
router.get("/:receiverId", ChatController.getMessages);

/* ======================================================
   📨 Enviar mensaje (texto o multimedia)
   POST /api/chat/send/:receiverId
   Body:
     - text (opcional si hay archivo)
     - chatKey (AES)
   File:
     - file (image/video/audio/document)
====================================================== */
router.post(
  "/send/:receiverId",
  upload.single("file"),        // admite imagen / video / audio / file
  ChatController.sendMessage
);

/* ======================================================
   🗑 Soft delete
   DELETE /api/chat/message/:messageId
====================================================== */
router.delete(
  "/message/:messageId",
  ChatController.deleteMessage
);

/* ======================================================
   ♻ Restore message
   PATCH /api/chat/message/:messageId/restore
====================================================== */
router.patch(
  "/message/:messageId/restore",
  ChatController.restoreMessage
);

export default router;

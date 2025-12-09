// ======================================================
// 📡 MessageRoutes.js — QuickChatX v4.8 PRO (2025)
// ------------------------------------------------------
// ✔ Compatible con ChatService v3.9
// ✔ WS emit automático: NEW_MESSAGE, message_deleted, message_restored
// ✔ Multimedia soportada (imagen, video, audio)
// ✔ Lee historial desde Redis o Mongo
// ✔ Soft delete + restore
// ✔ Marcar como leído
// ======================================================

import express from "express";
import multer from "multer";
import { ChatService } from "../../application/ChatService.js";
import { verifyAccessToken } from "../middlewares/AuthMiddleware.js";
import { getSocketService } from "../websockets/SocketService.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
const socket = getSocketService();

/* ======================================================
   🧩 Utilidad para emitir eventos WS
====================================================== */
const wsEmit = (event, payload, room) => {
  try {
    if (room) socket.emitToRoom(room, event, payload);
    else socket.broadcast(event, payload);
  } catch (err) {
    console.log("⚠️ WS emit error:", err.message);
  }
};

/* ======================================================
   📬 POST /messages/send — enviar mensaje
====================================================== */
router.post(
  "/send",
  verifyAccessToken,
  upload.single("media"),
  async (req, res) => {
    try {
      const { to, text, mediaType, chatKey } = req.body;
      const from = req.user.id;

      if (!to)
        return res.status(400).json({ success: false, error: "El campo 'to' es requerido." });

      const mediaFile = req.file || null;

      const result = await ChatService.sendMessage({
        from,
        to,
        text,
        mediaFile,
        mediaType,
        chatKey,
        wsEmit: (event, payload) => wsEmit(event, payload, [from, to].sort().join("_")),
      });

      res.json({ success: true, message: result });
    } catch (err) {
      console.error("❌ Error en /messages/send:", err);
      res.status(500).json({ success: false, error: "Error enviando mensaje." });
    }
  }
);

/* ======================================================
   📜 GET /messages/history/:otherUserId — historial chat
====================================================== */
router.get(
  "/history/:otherUserId",
  verifyAccessToken,
  async (req, res) => {
    try {
      const userA = req.user.id;
      const userB = req.params.otherUserId;
      const { limit = 200, chatKey = null, includeDeleted = false } = req.query;

      const history = await ChatService.getHistory(
        userA,
        userB,
        Number(limit),
        chatKey,
        includeDeleted === "true"
      );

      res.json({ success: true, messages: history });
    } catch (err) {
      console.error("❌ Error obteniendo historial:", err);
      res.status(500).json({ success: false, error: "Error obteniendo historial" });
    }
  }
);

/* ======================================================
   🟢 PUT /messages/mark-read/:otherUserId
====================================================== */
router.put(
  "/mark-read/:otherUserId",
  verifyAccessToken,
  async (req, res) => {
    try {
      const userA = req.user.id;
      const userB = req.params.otherUserId;

      const room = [userA, userB].sort().join("_");

      await ChatService.markAsRead(room, userA);

      wsEmit("messages_read", { room, by: userA }, room);

      res.json({ success: true });
    } catch (err) {
      console.error("❌ Error marcando como leídos:", err);
      res.status(500).json({ success: false, error: "Error al marcar como leídos" });
    }
  }
);

/* ======================================================
   🗑️ DELETE /messages/soft-delete/:id
====================================================== */
router.delete(
  "/soft-delete/:id",
  verifyAccessToken,
  async (req, res) => {
    try {
      const actorUserId = req.user.id;
      const messageId = req.params.id;

      const result = await ChatService.softDeleteMessage(
        messageId,
        actorUserId,
        (event, payload) => wsEmit(event, payload, payload.room)
      );

      res.json({ success: true, deleted: result });
    } catch (err) {
      console.error("❌ Error en soft-delete:", err);
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

/* ======================================================
   ♻️ PATCH /messages/restore/:id
====================================================== */
router.patch(
  "/restore/:id",
  verifyAccessToken,
  async (req, res) => {
    try {
      const actorUserId = req.user.id;
      const messageId = req.params.id;

      const result = await ChatService.restoreMessage(
        messageId,
        actorUserId,
        (event, payload) => wsEmit(event, payload, payload.room)
      );

      res.json({ success: true, restored: result });
    } catch (err) {
      console.error("❌ Error en restore:", err);
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

export default router;

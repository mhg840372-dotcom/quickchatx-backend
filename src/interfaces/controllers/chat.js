// ======================================================
// 💬 Chat Controller — QuickChatX 2025 (FINAL)
// ======================================================

import { ChatService } from "../../application/ChatService.js";

export const ChatController = {

  /* =====================================================
     📜 Obtener historial (paginado + AES opcional)
     GET /api/chat/:receiverId?page=1&chatKey=...
  ====================================================== */
  async getMessages(req, res) {
    try {
      const { receiverId } = req.params;

      const page = Number(req.query.page || 1);
      const chatKey = req.query.chatKey || null;

      // userId seguro
      const userId =
        req.user?.id ||
        req.user?.userId ||
        req.user?.username ||
        req.auth?.id ||
        req.auth?.username;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado",
        });
      }

      // ChatService v4.1 no usa page todavía, pero NO rompe NADA
      const messages = await ChatService.getHistory(
        userId,
        receiverId,
        200,
        chatKey
      );

      return res.json({ success: true, data: messages });
    } catch (err) {
      console.error("❌ Error al obtener mensajes:", err);
      return res.status(500).json({
        success: false,
        error: "Error al obtener mensajes",
        details: err.message,
      });
    }
  },

  /* =====================================================
     📨 Enviar mensaje (texto o multimedia)
     POST /api/chat/send/:receiverId
  ====================================================== */
  async sendMessage(req, res) {
    try {
      const { receiverId } = req.params;
      const { text, mediaType, chatKey } = req.body;

      const file = req.file || null;

      const userId =
        req.user?.id ||
        req.user?.userId ||
        req.user?.username ||
        req.auth?.id ||
        req.auth?.username;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado",
        });
      }

      const socketService = req.app.locals.socketService || null;

      // normalizamos tipo multimedia
      const finalMediaType =
        mediaType || (file ? "file" : "text");

      const saved = await ChatService.sendMessage({
        from: userId,
        to: receiverId,
        text: text || "",
        mediaType: finalMediaType,
        mediaFile: file,
        chatKey,
        wsEmit: (event, payload) => {
          if (!socketService) return;

          // enviar evento a ambos lados
          socketService.emitToUser(receiverId, event, payload);
          socketService.emitToUser(userId, event, payload);
        },
      });

      return res.json({ success: true, data: saved });
    } catch (err) {
      console.error("❌ Error al enviar mensaje:", err);
      return res.status(500).json({
        success: false,
        error: "Error al enviar mensaje",
        details: err.message,
      });
    }
  },

  /* =====================================================
     🗑 Soft delete
     DELETE /api/chat/message/:messageId
  ====================================================== */
  async deleteMessage(req, res) {
    try {
      const { messageId } = req.params;

      const actorId =
        req.user?.id ||
        req.user?.userId ||
        req.user?.username ||
        req.auth?.id ||
        req.auth?.username;

      if (!actorId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado",
        });
      }

      const socketService = req.app.locals.socketService;

      const payload = await ChatService.softDeleteMessage(
        messageId,
        actorId,
        (event, data) => {
          if (!socketService) return;
          socketService.emitToUser(actorId, event, data);
          socketService.emitToUser(data?.deletedBy, event, data);
        }
      );

      return res.json({ success: true, data: payload });
    } catch (err) {
      console.error("❌ Error al eliminar mensaje:", err);
      return res.status(500).json({
        success: false,
        error: "Error al eliminar mensaje",
        details: err.message,
      });
    }
  },

  /* =====================================================
     ♻ Restaurar mensaje
     PATCH /api/chat/message/:messageId/restore
  ====================================================== */
  async restoreMessage(req, res) {
    try {
      const { messageId } = req.params;

      const actorId =
        req.user?.id ||
        req.user?.userId ||
        req.user?.username ||
        req.auth?.id ||
        req.auth?.username;

      if (!actorId) {
        return res.status(401).json({
          success: false,
          error: "Usuario no autenticado",
        });
      }

      const socketService = req.app.locals.socketService;

      const payload = await ChatService.restoreMessage(
        messageId,
        actorId,
        (event, data) => {
          if (!socketService) return;
          socketService.emitToUser(actorId, event, data);
          socketService.emitToUser(data?.restoredBy, event, data);
        }
      );

      return res.json({ success: true, data: payload });
    } catch (err) {
      console.error("❌ Error al restaurar mensaje:", err);
      return res.status(500).json({
        success: false,
        error: "Error al restaurar mensaje",
        details: err.message,
      });
    }
  },
};

export default ChatController;

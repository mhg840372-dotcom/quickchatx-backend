/**
 * 📞 CallController
 * Controlador encargado de manejar las llamadas (audio / video)
 * Integrado con CallService, CallLog y WebSocket
 */

import CallService from "../../application/CallService.js";
import { addNotification } from "../../application/UserActivityService.js";

export const CallController = {
  /**
   * 🚀 Iniciar llamada
   * type: "audio" | "video"
   */
  async startCall(req, res) {
    try {
      const { receiverId, type } = req.body;
      const callerId = req.user._id;

      const socketService = req.app.locals.socketService;

      const callData = await CallService.startCall({
        callerId,
        receiverId,
        type,
        socketService,
      });

      res.json({
        success: true,
        message: "📞 Llamada iniciada correctamente",
        data: callData,
      });
    } catch (err) {
      console.error("❌ Error al iniciar llamada:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Error al iniciar llamada",
      });
    }
  },

  /**
   * ✅ Aceptar llamada
   */
  async acceptCall(req, res) {
    try {
      const { callId } = req.params;
      const userId = req.user._id;

      const socketService = req.app.locals.socketService;
      const result = await CallService.acceptCall(callId, userId, socketService);

      res.json({
        success: true,
        message: "✅ Llamada aceptada correctamente",
        data: result,
      });
    } catch (err) {
      console.error("❌ Error al aceptar llamada:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Error al aceptar llamada",
      });
    }
  },

  /**
   * ❌ Rechazar llamada
   */
  async rejectCall(req, res) {
    try {
      const { callId } = req.params;
      const userId = req.user._id;

      const socketService = req.app.locals.socketService;
      const result = await CallService.rejectCall(callId, userId, socketService);

      res.json({
        success: true,
        message: "📵 Llamada rechazada correctamente",
        data: result,
      });
    } catch (err) {
      console.error("❌ Error al rechazar llamada:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Error al rechazar llamada",
      });
    }
  },

  /**
   * 📴 Finalizar llamada
   */
  async endCall(req, res) {
    try {
      const { callId } = req.params;
      const userId = req.user._id;

      const socketService = req.app.locals.socketService;
      const result = await CallService.endCall(callId, userId, socketService);

      // 🧠 Registrar actividad del usuario
      await addNotification(
        result?.caller || userId,
        "call",
        `📴 Llamada finalizada por ${req.user.username || userId}`
      );

      res.json({
        success: true,
        message: "📴 Llamada finalizada correctamente",
        data: result,
      });
    } catch (err) {
      console.error("❌ Error al finalizar llamada:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Error al finalizar llamada",
      });
    }
  },

  /**
   * 📊 Obtener historial de llamadas del usuario autenticado
   */
  async getHistory(req, res) {
    try {
      const userId = req.user._id;
      const history = await CallService.getHistory(userId);

      res.json({
        success: true,
        data: history,
        message: `📜 Historial de llamadas para ${userId}`,
      });
    } catch (err) {
      console.error("❌ Error al obtener historial de llamadas:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Error al obtener historial de llamadas",
      });
    }
  },
};

export default CallController;

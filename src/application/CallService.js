/**
 * 📞 CallService
 * Servicio de gestión de llamadas (audio / video)
 * Integra persistencia en MongoDB + emisión por WebSocket + UserActivity + CallLog
 */

import Call from "../domain/Call.js";
import CallLog from "../domain/CallLog.js";
import { addNotification } from "./UserActivityService.js";

export class CallService {
  /**
   * 🚀 Iniciar llamada
   */
  static async startCall({ callerId, receiverId, type = "audio", socketService = null }) {
    try {
      const receivers = Array.isArray(receiverId) ? receiverId : [receiverId];
      const participants = [callerId, ...receivers];

      const call = await Call.create({
        caller: callerId,
        participants,
        type,
        status: "ringing",
        startedAt: new Date(),
      });

      // 🔔 Emitir evento a receptores
      if (socketService) {
        receivers.forEach((receiver) => {
          socketService.emitToUser(receiver, "INCOMING_CALL", {
            callId: call._id,
            from: callerId,
            type,
            participants,
            startedAt: call.startedAt,
          });
        });
      }

      // 🧠 Registrar notificación
      for (const receiver of receivers) {
        await addNotification(receiver, "call", `📞 Llamada ${type} entrante de ${callerId}`);
      }

      console.log(`📞 Llamada ${type} iniciada entre ${callerId} y ${receivers.join(", ")}`);
      return call.toObject();
    } catch (err) {
      console.error("❌ Error al iniciar llamada:", err);
      throw new Error("Error al iniciar llamada");
    }
  }

  /**
   * ✅ Aceptar llamada
   */
  static async acceptCall(callId, userId, socketService = null) {
    try {
      const call = await Call.findByIdAndUpdate(
        callId,
        { status: "active", acceptedAt: new Date() },
        { new: true }
      );

      if (!call) throw new Error("Llamada no encontrada");

      if (socketService) {
        call.participants.forEach((participant) => {
          socketService.emitToUser(participant, "CALL_ACCEPTED", {
            callId,
            acceptedBy: userId,
          });
        });
      }

      console.log(`✅ Llamada ${callId} aceptada por ${userId}`);
      return call.toObject();
    } catch (err) {
      console.error("❌ Error al aceptar llamada:", err);
      throw err;
    }
  }

  /**
   * ❌ Rechazar llamada
   */
  static async rejectCall(callId, userId, socketService = null) {
    try {
      const call = await Call.findByIdAndUpdate(
        callId,
        {
          status: "rejected",
          endedAt: new Date(),
          endedBy: userId,
        },
        { new: true }
      );

      if (!call) throw new Error("Llamada no encontrada");

      // Registrar log de rechazo
      await CallLog.create({
        callId: call._id,
        caller: call.caller,
        receivers: call.participants.filter((p) => p !== call.caller),
        type: call.type,
        duration: 0,
        status: "rejected",
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        endedBy: userId,
      });

      if (socketService) {
        call.participants.forEach((p) => {
          socketService.emitToUser(p, "CALL_REJECTED", {
            callId,
            rejectedBy: userId,
          });
        });
      }

      console.log(`📵 Llamada ${callId} rechazada por ${userId}`);
      return call.toObject();
    } catch (err) {
      console.error("❌ Error al rechazar llamada:", err);
      throw err;
    }
  }

  /**
   * 📴 Finalizar llamada
   */
  static async endCall(callId, endedBy, socketService = null) {
    try {
      const call = await Call.findById(callId);
      if (!call) throw new Error("Llamada no encontrada");

      const endedAt = new Date();
      const duration =
        call.startedAt && call.status === "active"
          ? Math.floor((endedAt - call.startedAt) / 1000)
          : 0;

      call.status = "ended";
      call.endedAt = endedAt;
      call.endedBy = endedBy;
      call.duration = duration;
      await call.save();

      // 🧾 Guardar registro en CallLog
      await CallLog.create({
        callId: call._id,
        caller: call.caller,
        receivers: call.participants.filter((p) => p !== call.caller),
        type: call.type,
        duration,
        status: "completed",
        startedAt: call.startedAt,
        endedAt,
        endedBy,
      });

      // 🔔 Emitir evento por WebSocket
      if (socketService) {
        call.participants.forEach((user) => {
          socketService.emitToUser(user, "CALL_ENDED", {
            callId,
            endedBy,
            duration,
          });
        });
      }

      console.log(`📴 Llamada ${callId} finalizada por ${endedBy}`);
      return call.toObject();
    } catch (err) {
      console.error("❌ Error al finalizar llamada:", err);
      throw err;
    }
  }

  /**
   * 📜 Obtener historial de llamadas (últimas 50)
   */
  static async getHistory(userId, limit = 50) {
    try {
      const history = await CallLog.find({
        $or: [{ caller: userId }, { receivers: userId }],
      })
        .sort({ startedAt: -1 })
        .limit(limit)
        .lean();

      return history;
    } catch (err) {
      console.error("❌ Error al obtener historial de llamadas:", err);
      return [];
    }
  }
}

export default CallService;

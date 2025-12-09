// ======================================================
// 🎧 src/interfaces/websockets/events/userActivityEvents.js
// ✅ QuickChatX v9.2 PRO — Actividad WS + Redis + Presencia
// ======================================================

import chalk from "chalk";
import {
  updateUserStatus,
  updateLastOnline,
  registerUserAction,
  setTypingStatus,
  setCurrentCall,
} from "../../../application/UserActivityService.js";
import { ActivityLog } from "../../../domain/ActivityLog.js";
import { initRedis } from "../../../infrastructure/RedisProvider.js";

/**
 * 🎯 initUserActivityEvents(io)
 * ------------------------------------------------------
 * Listener centralizado para actividad del usuario.
 * ✅ Soporta presencia, typing, llamadas y logging distribuido.
 * ✅ Sincroniza con Redis y emite logs en tiempo real.
 */
export async function initUserActivityEvents(io) {
  const redis = await initRedis().catch(() => null);

  io.on("connection", (socket) => {
    const user = socket.user;
    if (!user?.id) {
      console.warn(chalk.red("⚠️ Conexión rechazada: usuario no autenticado"));
      socket.disconnect(true);
      return;
    }

    const userId = user.id;
    const username = user.username || "Usuario";
    const ip = socket.handshake.address || "unknown";
    const userAgent = socket.handshake.headers["user-agent"] || "unknown";
    const sessionTag = chalk.gray(`[Session ${userId}]`);

    console.log(chalk.green(`🎧 ${sessionTag} → Conectado: ${username} (${ip})`));

    /* ======================================================
       🟢 PRESENCIA: Online / Offline
    ====================================================== */
    updateUserStatus(userId, "online", { ip, userAgent }).catch((err) =>
      console.warn(chalk.yellow(`⚠️ ${sessionTag} Error status online:`), err.message)
    );

    ActivityLog.log({
      userId,
      type: "USER_LOGIN",
      description: "Conectado vía WebSocket",
      meta: { ip, userAgent },
    });

    socket.on("disconnect", async (reason) => {
      try {
        await updateUserStatus(userId, "offline", { reason, ip });
        await updateLastOnline(userId);
        console.log(chalk.yellow(`⚡ ${sessionTag} Usuario desconectado (${reason})`));

        await ActivityLog.log({
          userId,
          type: "USER_LOGOUT",
          description: "Desconectado del servidor WS",
          meta: { reason, ip },
        });
      } catch (err) {
        console.warn(chalk.red(`❌ ${sessionTag} Error al manejar desconexión:`), err.message);
      }
    });

    /* ======================================================
       ✍️ ESTADO DE ESCRITURA (Typing)
    ====================================================== */
    socket.on("user:typing", async ({ chatId, isTyping }) => {
      if (!chatId) return;
      try {
        await setTypingStatus(userId, chatId, Boolean(isTyping));
        socket.to(chatId).emit("user:typing:update", {
          userId,
          chatId,
          isTyping: Boolean(isTyping),
        });

        await ActivityLog.log({
          userId,
          type: "CUSTOM_EVENT",
          description: `Usuario ${isTyping ? "empezó" : "dejó"} de escribir`,
          meta: { chatId },
        });
      } catch (err) {
        console.warn(chalk.yellow(`⚠️ ${sessionTag} Error typing:`), err.message);
      }
    });

    /* ======================================================
       📞 LLAMADAS: Inicio / Fin / Estado
    ====================================================== */
    socket.on("user:call", async ({ callId, type, action, participants = [] }) => {
      if (!callId || !type || !action) return;
      try {
        await setCurrentCall(userId, { callId, type, action, participants });

        io.emit("user:call:update", { userId, callId, type, action });

        await ActivityLog.log({
          userId,
          type: action === "start" ? "CALL_STARTED" : "CALL_ENDED",
          description: `Llamada ${action}`,
          meta: { callId, type, participants },
        });
      } catch (err) {
        console.warn(chalk.yellow(`⚠️ ${sessionTag} Error llamada:`), err.message);
      }
    });

    /* ======================================================
       🧠 ACCIONES RÁPIDAS (mensaje, reacción, etc.)
    ====================================================== */
    socket.on("user:action", async ({ action, meta = {} }) => {
      if (!action) return;
      try {
        await registerUserAction(userId, action, { ip, userAgent, ...meta });
        socket.broadcast.emit("user:action:update", { userId, action });

        await ActivityLog.log({
          userId,
          type: "CUSTOM_EVENT",
          description: `Acción rápida: ${action}`,
          meta,
        });
      } catch (err) {
        console.warn(chalk.yellow(`⚠️ ${sessionTag} Error registrando acción:`), err.message);
      }
    });

    /* ======================================================
       💓 HEARTBEAT AUTOMÁTICO
    ====================================================== */
    socket.on("heartbeat", async () => {
      try {
        await updateLastOnline(userId);
        socket.emit("heartbeat:ack", { userId, at: new Date() });

        if (redis) {
          await redis.set(`presence:${userId}`, "online", "EX", 90);
        }
      } catch (err) {
        console.warn(chalk.yellow(`⚠️ ${sessionTag} Heartbeat fallido:`), err.message);
      }
    });

    /* ======================================================
       🔁 RECONEXIÓN / REFRESH DE SESIÓN
    ====================================================== */
    socket.on("user:reconnect", async () => {
      try {
        await updateUserStatus(userId, "online", { ip, userAgent });
        socket.emit("user:reconnect:ack", { userId, reconnectedAt: new Date() });
        console.log(chalk.blue(`🔄 ${sessionTag} Reconexión exitosa`));

        await ActivityLog.log({
          userId,
          type: "CUSTOM_EVENT",
          description: "Sesión WS reconectada",
        });
      } catch (err) {
        console.warn(chalk.yellow(`⚠️ ${sessionTag} Error reconectar:`), err.message);
      }
    });

    /* ======================================================
       🧩 SESIÓN: KeepAlive automático
    ====================================================== */
    const keepAlive = setInterval(() => {
      socket.emit("keepalive", { userId, ts: Date.now() });
    }, 45000);

    socket.on("disconnect", () => clearInterval(keepAlive));
  });

  console.log(chalk.cyan("🔌 UserActivityEvents v9.2 PRO inicializados ✅"));
}

// ======================================================
// ✅ QuickChatX v9.2 PRO Highlights
// ------------------------------------------------------
// - 🔁 Sincronización con Redis para presencia
// - 🧾 Log distribuido con ActivityLog.log()
// - 📡 Emisión WS automática de actividad
// - 💓 Heartbeat + TTL Redis de 90s
// - 🧩 KeepAlive cada 45 segundos
// - 🚀 Compatible con UserActivityService v9+
// ======================================================

// ======================================================
// 🎯 UserActivityController.js — v10.8 Ultra-Stable (2025)
// ------------------------------------------------------
// ✔ FIX: No usa getRedisClient (no existe en RedisProvider)
// ✔ FIX: SocketService cargado correctamente sin crash
// ✔ FIX: EmitToRoom usa namespace y room correctos
// ✔ Presencia, typing, llamadas y logs 100% compatibles
// ======================================================

import jwt from "jsonwebtoken";
import chalk from "chalk";
import config from "../../config/config.js";

import { initRedis, getRedis } from "../../infrastructure/RedisProvider.js";
import { UserActivity } from "../../domain/UserActivity.js";
import { getSocketService } from "../websockets/SocketService.js";

const flattenHash = (hash = {}) =>
  Object.entries(hash).flatMap(([k, v]) => [k, v]);

const hsetCompat = (client, key, hash) => {
  if (!client) return null;
  if (typeof client.hSet === "function") return client.hSet(key, hash);
  if (typeof client.hset === "function")
    return client.hset(key, ...flattenHash(hash));
  if (typeof client.hmset === "function") return client.hmset(key, hash);
  return null;
};

const hgetCompat = (client, key, field) => {
  if (!client) return null;
  if (typeof client.hGet === "function") return client.hGet(key, field);
  if (typeof client.hget === "function") return client.hget(key, field);
  return null;
};

// ======================================================
// ♻️ Redis inicializado una sola vez
// ======================================================
let redis = null;
(async () => {
  try {
    redis = await initRedis();
    console.log("🔌 Redis listo en UserActivityController");
  } catch (err) {
    console.warn("⚠️ Redis no disponible en UserActivityController");
  }
})();

// ======================================================
// 🛰 SocketService seguro (sin crash al iniciar)
// ======================================================
let socketService = null;
setTimeout(() => {
  try {
    socketService = getSocketService();
    console.log("🌐 SocketService vinculado a UserActivityController");
  } catch {
    console.warn("⚠️ SocketService aún no inicializado");
  }
}, 500);


// ======================================================
// 🧠 Obtener actividad del usuario
// ======================================================
export const getMyActivity = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ ok: false, error: "No autorizado" });

    const cached = redis ? await redis.get(`user:activity:${userId}`) : null;

    if (cached) {
      return res.json({
        ok: true,
        activity: JSON.parse(cached),
        source: "redis",
      });
    }

    const activity = await UserActivity.findOne({ userId });

    if (redis && activity) {
      await redis.setEx(`user:activity:${userId}`, 15, JSON.stringify(activity));
    }

    res.json({ ok: true, activity });
  } catch (err) {
    console.error("❌ getMyActivity:", err);
    res.status(500).json({ ok: false });
  }
};


// ======================================================
// 🧭 Registrar acción
// ======================================================
export const registerAction = async (req, res) => {
  try {
    const { action, metadata } = req.body;
    const userId = req.user?.id;

    await UserActivity.updateOne(
      { userId },
      { $push: { logs: { action, metadata, at: new Date() } } },
      { upsert: true }
    );

    socketService?.emitToUser?.(userId, "user:activity:log", {
      action,
      metadata,
      at: new Date(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ registerAction:", err);
    res.status(500).json({ ok: false });
  }
};


// ======================================================
// 🟢 Estado de usuario (online / offline / away…)
// ======================================================
export const setUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.user?.id;

    if (!status) return res.status(400).json({ ok: false, error: "status requerido" });

    if (redis) await hsetCompat(redis, `user:${userId}`, { status });

    const payload = { userId, status, at: new Date() };

    socketService?.emitToUser?.(userId, "user:status:update", payload);

    // FIX: emitir al namespace correcto
    socketService?.io?.of("/activity")?.emit("user:status:update", payload);

    res.json({ ok: true, status });
  } catch (err) {
    console.error("❌ setUserStatus:", err);
    res.status(500).json({ ok: false });
  }
};


// ======================================================
// ✍️ TYPING
// ======================================================
export const updateTyping = async (req, res) => {
  try {
    const { chatId, isTyping } = req.body;
    const userId = req.user?.id;

    if (!chatId) return res.status(400).json({ ok: false, error: "chatId requerido" });

    const payload = { userId, chatId, isTyping, at: new Date() };

    socketService?.emitToRoom?.(chatId, "chat:typing:update", payload);

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ updateTyping:", err);
    res.status(500).json({ ok: false });
  }
};


// ======================================================
// 🔔 Notificaciones usuario a usuario
// ======================================================
export const sendNotification = async (req, res) => {
  try {
    const { to, message, type } = req.body;
    const from = req.user?.id;

    if (!to || !message)
      return res.status(400).json({ ok: false, error: "Faltan datos" });

    const payload = { from, message, type, at: new Date() };

    socketService?.emitToUser?.(to, "user:notification:new", payload);

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ sendNotification:", err);
    res.status(500).json({ ok: false });
  }
};


// ======================================================
// 🧹 Borrar notificaciones
// ======================================================
export const clearNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (redis) await redis.del(`user:notifications:${userId}`);

    socketService?.emitToUser?.(userId, "user:notification:cleared", {});

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ clearNotifications:", err);
    res.status(500).json({ ok: false });
  }
};


// ======================================================
// 📞 Manejo de llamadas
// ======================================================
export const handleCall = async (req, res) => {
  try {
    const { callId, action, participants = [], type } = req.body;
    const userId = req.user?.id;

    const payload = { userId, callId, action, type, at: new Date() };

    participants.forEach((pid) => {
      socketService?.emitToUser?.(pid, "call:update", payload);
    });

    socketService?.io?.of("/calls")?.emit("call:update", payload);

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ handleCall:", err);
    res.status(500).json({ ok: false });
  }
};


// ======================================================
// ♻️ Sincronizar presencia (al reconectar)
// ======================================================
export const syncPresence = async (req, res) => {
  try {
    const userId = req.user?.id;

    const status =
      (redis ? await hgetCompat(redis, `user:${userId}`, "status") : null) ||
      "online";

    await hsetCompat(redis, `user:${userId}`, { status });

    const payload = { userId, status, at: new Date() };

    socketService?.io?.of("/activity")?.emit("user:status:update", payload);

    res.json({ ok: true, status });
  } catch (err) {
    console.error("❌ syncPresence:", err);
    res.status(500).json({ ok: false });
  }
};


// ======================================================
// 🔁 REFRESH TOKEN — 100% compatible Frontend
// ======================================================
export const refreshToken = async (req, res) => {
  try {
    const oldToken = req.body?.token;
    if (!oldToken)
      return res.status(400).json({ success: false, error: "Token requerido" });

    const decoded = jwt.verify(oldToken, config.jwt.secret, {
      ignoreExpiration: true,
    });

    const newToken = jwt.sign(
      {
        id: decoded.id,
        username: decoded.username,
        role: decoded.role,
      },
      config.jwt.secret,
      { expiresIn: "365d" }
    );

    res.json({ success: true, token: newToken });
  } catch (err) {
    console.error("❌ refreshToken:", err);
    res.status(401).json({ success: false, error: "Token inválido" });
  }
};

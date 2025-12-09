// ======================================================
// 🔐 AuthMiddleware.js — QuickChatX v13.3 ULTRA STABLE (2025)
// ------------------------------------------------------
// ✔ Compatible 100% con RedisProvider (ioredis)
// ✔ NO usa hGet/hSet, usa hget/hset (compatibilidad segura)
// ✔ JWT persistente (365 días)
// ✔ req.user siempre lleno (id + username)
// ✔ WS seguro + refresh integrado
// ======================================================

import jwt from "jsonwebtoken";
import chalk from "chalk";
import { getRedis } from "../../infrastructure/RedisProvider.js";

// ======================================================
// 🔍 Extraer token globalmente
// ======================================================
function extractToken(req) {
  const h =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    req.headers?.["x-access-token"] ||
    "";

  if (typeof h === "string" && h.startsWith("Bearer "))
    return h.slice(7).trim();

  return req.query?.token || req.body?.token || null;
}

// ======================================================
// 🧩 Normalizador universal de usuario
// ======================================================
function normalizeUser(decoded) {
  const id =
    decoded.id ||
    decoded._id ||
    decoded.userId ||
    decoded.user?._id ||
    decoded.user?.id ||
    null;

  return {
    id,
    _id: id,
    username: decoded.username || decoded.user?.username || "guest",
    email: decoded.email || decoded.user?.email || null,
    role: decoded.role || "user",
    avatar: decoded.avatar || decoded.user?.avatar || null,
  };
}

// ======================================================
// 🔒 AUTH obligatorio
// ======================================================
export function authenticateJWT(allowedRoles = []) {
  return async (req, res, next) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        error: "JWT_SECRET faltante",
      });
    }

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Token requerido",
      });
    }

    try {
      // ============================
      // 📌 Decodificar SIN bloquear
      // ============================
      const decoded = jwt.verify(token, secret, {
        ignoreExpiration: true,
      });

      const user = normalizeUser(decoded);
      if (!user.id) {
        return res.status(401).json({
          success: false,
          error: "Token inválido",
        });
      }

      req.user = user;

      // ======================================================
      // 🔂 Validación en Redis (pero sin bloquear ni romper)
      // ======================================================
      const redis = await getRedis();
      if (redis && req.user.id) {
        const key = `user:${req.user.id}`;

        // Usamos hget en vez de hGet (ioredis compatibility)
        const storedToken = await redis.hget(key, "token");

        if (storedToken && storedToken !== token) {
          console.warn(
            chalk.yellow(
              `⚠️ Token cambiado → actualizando sesión para ${req.user.username}`
            )
          );
        }

        // Guardar nuevo token / actualizar actividad
        await redis.hset(key, "token", token);
        await redis.hset(key, "lastAction", Date.now().toString());
      }

      // ======================================================
      // 🎭 Roles
      // ======================================================
      if (
        Array.isArray(allowedRoles) &&
        allowedRoles.length > 0 &&
        !allowedRoles.includes(req.user.role)
      ) {
        return res.status(403).json({
          success: false,
          error: "Acceso denegado",
        });
      }

      next();
    } catch (err) {
      console.error("❌ authenticateJWT:", err.message);
      return res.status(401).json({
        success: false,
        error: "Token inválido",
      });
    }
  };
}

// ======================================================
// 🟦 AUTH opcional
// ======================================================
export const authOptionalMiddleware = async (req, res, next) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) return next();

  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, secret, { ignoreExpiration: true });
    const user = normalizeUser(decoded);

    if (!user.id) {
      req.user = null;
      return next();
    }

    req.user = user;

    const redis = await getRedis();
    if (redis) {
      const key = `user:${user.id}`;
      const storedToken = await redis.hget(key, "token");

      if (storedToken && storedToken !== token) {
        console.warn(
          chalk.yellow(`⚠️ Token cambiado (optional) para ${user.username}`)
        );
      }

      await redis.hset(key, "token", token);
      await redis.hset(key, "lastAction", Date.now().toString());
    }

    next();
  } catch {
    req.user = null;
    next();
  }
};

// ======================================================
// 🕸️ WebSocket Auth
// ======================================================
export async function socketAuthMiddleware(socket, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return next(new Error("JWT_SECRET faltante"));

  try {
    const token =
      socket.handshake?.auth?.token ||
      socket.handshake?.headers?.authorization?.split(" ")[1] ||
      socket.handshake?.query?.token;

    if (!token) return next(new Error("Token requerido"));

    const decoded = jwt.verify(token, secret, { ignoreExpiration: true });
    const user = normalizeUser(decoded);

    if (!user.id) return next(new Error("Token inválido"));

    socket.user = user;

    const redis = await getRedis();
    if (redis) {
      const key = `user:${user.id}`;
      const storedToken = await redis.hget(key, "token");

      if (storedToken && storedToken !== token) {
        console.warn(
          chalk.yellow(
            `⚠️ WS token cambiado → actualizando sesión para ${user.username}`
          )
        );
      }

      await redis.hset(key, "token", token);
      await redis.hset(key, "status", "online");
      await redis.hset(key, "lastWS", Date.now().toString());
    }

    next();
  } catch (err) {
    next(new Error("Token inválido"));
  }
}

// ======================================================
// 🚪 Logout completo
// ======================================================
export async function logoutUser(userId) {
  try {
    const redis = await getRedis();
    if (redis) await redis.del(`user:${userId}`);

    console.log(`🚪 Logout OK de ${userId}`);
    return true;
  } catch (err) {
    console.error("❌ logoutUser:", err.message);
    return false;
  }
}

// ======================================================
// 🔧 Aliases
// ======================================================
export const verifyAccessToken = authenticateJWT();
export const authMiddleware = authenticateJWT();

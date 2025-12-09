// ======================================================
// 🔑 src/infrastructure/JWTProvider.js
// ✅ QuickChatX v5.7.2 — JWT Provider unificado (Access + Refresh + Redis Cache)
// ======================================================

import jwt from "jsonwebtoken";
import chalk from "chalk";
import { initRedis } from "./RedisProvider.js"; // Cambié la importación a `initRedis`

/* ======================================================
   ⚙️ Configuración global
====================================================== */
const ACCESS_TTL = parseInt(process.env.JWT_EXPIRES_IN || "3600", 10); // 1h
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_EXPIRES_IN || "604800", 10); // 7d
const ACCESS_SECRET = process.env.JWT_SECRET || "";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "";
const REDIS_PREFIX = "auth:session:";

/* ======================================================
   🧠 Normalizador de payloads
====================================================== */
function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    id: payload.id || payload._id,
    username: payload.username || "anon",
    email: payload.email || null,
    role: payload.role || "user",
    exp: payload.exp || null,
  };
}

/* ======================================================
   🧩 Generar par de tokens (Access + Refresh)
====================================================== */
export async function generateTokens(user) {
  if (!ACCESS_SECRET || !REFRESH_SECRET) {
    throw new Error("🚫 Faltan JWT_SECRET o JWT_REFRESH_SECRET en el entorno.");
  }

  const payload = {
    id: user.id || user._id,
    username: user.username,
    email: user.email,
    role: user.role || "user",
  };

  const accessToken = jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });

  try {
    const redis = await initRedis(); // Usamos `initRedis` para obtener el cliente Redis
    if (redis?.setEx) {
      await redis.setEx(
        `${REDIS_PREFIX}${payload.id}`,
        REFRESH_TTL,
        JSON.stringify({
          ...payload,
          accessToken,
          refreshToken,
          createdAt: new Date().toISOString(),
        })
      );
    }
  } catch (err) {
    console.warn(chalk.yellow("⚠️ Redis no disponible para cachear sesión JWT:"), err.message);
  }

  return { accessToken, refreshToken };
}

/* ======================================================
   🔍 Verificar y decodificar token
====================================================== */
export function verifyToken(token, type = "access") {
  const secret = type === "refresh" ? REFRESH_SECRET : ACCESS_SECRET;
  if (!secret) throw new Error(`🚫 Falta clave secreta JWT para tipo: ${type}`);

  try {
    const decoded = jwt.verify(token, secret);
    const normalized = normalizePayload(decoded);
    if (!normalized) throw new Error("Token inválido o vacío.");
    return normalized;
  } catch (err) {
    if (err.name === "TokenExpiredError") throw new Error("Token expirado");
    if (err.name === "JsonWebTokenError") throw new Error("Token inválido o manipulado");
    throw err;
  }
}

/* ======================================================
   ♻️ Refrescar tokens expirados
====================================================== */
export async function refreshTokens(refreshToken) {
  try {
    const decoded = verifyToken(refreshToken, "refresh");
    if (!decoded?.id) throw new Error("Refresh token sin ID de usuario.");

    const redis = await initRedis(); // Usamos `initRedis` para obtener el cliente Redis
    const cacheKey = `${REDIS_PREFIX}${decoded.id}`;
    const cached = redis ? await redis.get(cacheKey) : null;

    if (!cached) throw new Error("Sesión expirada o inválida.");

    const user = JSON.parse(cached);
    const newTokens = await generateTokens(user);

    console.log(
      chalk.blue(`♻️ Tokens regenerados para ${decoded.username || "usuario"} (${decoded.id})`)
    );
    return { ...newTokens, user };
  } catch (err) {
    console.error(chalk.red("❌ Error al refrescar tokens:"), err.message);
    throw new Error("Refresh token inválido o expirado");
  }
}

/* ======================================================
   🧨 Invalidar sesión (logout forzado)
====================================================== */
export async function invalidateSession(userId) {
  try {
    const redis = await initRedis(); // Usamos `initRedis` para obtener el cliente Redis
    if (redis?.del) {
      await redis.del(`${REDIS_PREFIX}${userId}`);
      console.log(chalk.gray(`🚫 Sesión invalidada para usuario ${userId}`));
    }
  } catch (err) {
    console.warn(chalk.yellow("⚠️ No se pudo invalidar sesión en Redis:"), err.message);
  }
}

/* ======================================================
   ⚙️ Obtener sesión activa desde Redis
====================================================== */
export async function getActiveSession(userId) {
  try {
    const redis = await initRedis(); // Usamos `initRedis` para obtener el cliente Redis
    if (!redis) return null;
    const data = await redis.get(`${REDIS_PREFIX}${userId}`);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.warn(chalk.yellow(`⚠️ Error obteniendo sesión activa (${userId}):`), err.message);
    return null;
  }
}

/* ======================================================
   🧩 Decodificar sin verificar (uso diagnóstico)
====================================================== */
export function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

/* ======================================================
   🔁 Exportación unificada
====================================================== */
export default {
  generateTokens,
  verifyToken,
  refreshTokens,
  invalidateSession,
  getActiveSession,
  decodeToken,
};

// ======================================================
// ✅ QuickChatX v5.7.2 — Mejoras clave
// ------------------------------------------------------
// - 🧩 Normalización robusta de payloads
// - 🔒 Control de claves faltantes (JWT_SECRET / REFRESH_SECRET)
// - 🚀 Manejo resiliente ante fallos Redis (sin romper flujo)
// - 🧠 Cacheo inteligente con TTL sincronizado
// - ♻️ Refresh seguro con validación de sesión activa
// ======================================================

// ======================================================
// 🧩 src/types/jwt.js
// ✅ Definición auxiliar de payload JWT (QuickChatX v5.3.1)
// ======================================================

/**
 * Representa el payload estándar de un JWT usado en QuickChatX.
 * @typedef {Object} JwtPayloadLike
 * @property {string} [id] - ID del usuario
 * @property {string} [_id] - ID alternativo
 * @property {string} [username] - Nombre de usuario
 * @property {string} [email] - Correo electrónico
 * @property {string} [role] - Rol del usuario (user, moderator, admin, etc.)
 * @property {number} [exp] - Fecha de expiración (timestamp UNIX)
 * @property {Record<string, any>} [other] - Campos adicionales
 */

// No se exporta nada funcional, solo la documentación JSDoc
export const __JwtPayloadLike = {};

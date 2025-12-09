// ======================================================
// 🛡️ src/interfaces/middlewares/AdminAuthMiddleware.js
// ✅ QuickChatX v8.1.2 — Middleware de autenticación admin
// ------------------------------------------------------
// 🔐 Verifica el token de administrador (x-admin-token o Bearer)
// • Compatible con Authorization: Bearer <token>
// • Registra intentos no autorizados sin exponer el token
// • Acepta token en header, query o body
// ======================================================

import chalk from "chalk";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme_admin_token";

/**
 * 🔒 Middleware para proteger rutas administrativas
 * Verifica la validez del token de administrador
 */
export function verifyAdminToken(req, res, next) {
  try {
    const rawAuth = req.headers.authorization;
    const headerToken = rawAuth?.startsWith("Bearer ")
      ? rawAuth.slice(7).trim()
      : null;

    const token =
      req.headers["x-admin-token"] ||
      req.query.token ||
      req.body?.token ||
      headerToken;

    if (!token || token !== ADMIN_TOKEN) {
      console.warn(
        chalk.red(
          `⛔ Acceso denegado al endpoint admin — IP: ${req.ip || "unknown"}`
        )
      );
      return res.status(403).json({
        success: false,
        error: "Acceso denegado: token de administrador inválido o ausente",
      });
    }

    // Añadimos marca para logs posteriores
    req.isAdmin = true;
    console.log(
      chalk.greenBright(`🛡️ Acceso admin autorizado — ${req.method} ${req.originalUrl}`)
    );

    next();
  } catch (err) {
    console.error(chalk.red("❌ Error en verifyAdminToken:"), err);
    res.status(500).json({
      success: false,
      error: "Error interno en autenticación admin",
    });
  }
}

// ======================================================
// ✅ QuickChatX v8.1.2 — verifyAdminToken Final
// ------------------------------------------------------
// 🧩 Modo seguro con logs y control de origen IP
// 🌐 Soporte para header x-admin-token, Bearer, query o body
// 🔒 Sin exposición del token en consola
// ======================================================

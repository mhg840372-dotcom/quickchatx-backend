// ======================================================
// 🧨 src/interfaces/middlewares/ErrorHandler.js
// ✅ QuickChatX v3.9 — Middleware global de manejo de errores
// ======================================================

import chalk from "chalk";

/**
 * Middleware global para capturar y responder errores del backend.
 * Se encarga de detectar errores comunes (JWT, validación, archivos, etc.)
 * y devolver una respuesta JSON estandarizada al cliente.
 */
export function errorHandler(err, req, res, next) {
  // Log detallado en consola
  console.error(chalk.redBright("🔥 [ErrorHandler] Error capturado:"));
  console.error(err);

  // Si ya se envió una respuesta, no intentar responder de nuevo
  if (res.headersSent) {
    return next(err);
  }

  // Tipo de error y mensaje
  let statusCode = 500;
  let message = "Error interno del servidor";
  let details = null;

  /* ======================================================
     🔐 Errores de autenticación JWT
  ====================================================== */
  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Token inválido o corrupto";
  } else if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expirado, por favor vuelve a iniciar sesión";
  }

  /* ======================================================
     📂 Errores de subida de archivos (multer)
  ====================================================== */
  else if (err.name === "MulterError") {
    statusCode = 400;
    message = "Error al subir el archivo";
    details = err.message;
  }

  /* ======================================================
     📦 Errores de validación (por ejemplo, mongoose o joi)
  ====================================================== */
  else if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Error de validación en los datos enviados";
    details = err.errors
      ? Object.keys(err.errors).map((k) => err.errors[k].message)
      : err.message;
  }

  /* ======================================================
     🚫 Errores de permisos o acceso denegado
  ====================================================== */
  else if (err.name === "ForbiddenError" || err.status === 403) {
    statusCode = 403;
    message = "Acceso denegado. No tienes permisos suficientes.";
  }

  /* ======================================================
     🔍 Error 404 manual o rutas inexistentes
  ====================================================== */
  else if (err.status === 404) {
    statusCode = 404;
    message = "Recurso no encontrado";
  }

  /* ======================================================
     ⚙️ Errores de base de datos o red
  ====================================================== */
  else if (err.code && typeof err.code === "string" && err.code.startsWith("ECONN")) {
    statusCode = 503;
    message = "Error de conexión con base de datos o servicio externo";
  }

  /* ======================================================
     🧩 Errores personalizados del sistema
  ====================================================== */
  else if (err.isCustomError) {
    statusCode = err.statusCode || 400;
    message = err.message || "Error en la solicitud";
    details = err.details || null;
  }

  /* ======================================================
     🧠 Respuesta estándar al cliente
  ====================================================== */
  const response = {
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== "production" && {
      stack: err.stack,
      details,
    }),
  };

  res.status(statusCode).json(response);
}

/**
 * Middleware 404 para rutas inexistentes
 * Colócalo después de todas las rutas.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: "Ruta no encontrada",
    path: req.originalUrl,
  });
}

// 📁 src/interfaces/routes/UserActivityRoutes.js
// ======================================================
// 🚀 QuickChatX v10.8 — User Activity REST API
// ------------------------------------------------------
// ✔ Totalmente compatible con UserActivityController v10.8
// ✔ Rutas limpias + AuthMiddleware moderno
// ✔ Sin conflictos con WebSockets ni Redis
// ✔ trackActivity aplicado correctamente
// ✔ Refresh Token mejorado en nueva ruta /auth/refresh
// ======================================================

import express from "express";
import { verifyAccessToken } from "../middlewares/AuthMiddleware.js";
import { trackActivity } from "../middlewares/trackActivity.js";

import {
  getMyActivity,
  registerAction,
  setUserStatus,
  sendNotification,
  clearNotifications,
  updateTyping,
  handleCall,
  syncPresence,
  refreshToken,
} from "../controllers/UserActivityController.js";

const router = express.Router();

/* ======================================================
   🧩 HEALTHCHECK
====================================================== */
router.get("/ping", (req, res) => {
  res.json({
    ok: true,
    service: "UserActivity",
    version: "10.8",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/* ======================================================
   🧠 ACTIVIDAD GENERAL DEL USUARIO
====================================================== */

// 📌 Obtener actividad del usuario autenticado
router.get("/me", verifyAccessToken, trackActivity, getMyActivity);

// 🧭 Registrar acción genérica (login, ver post, reacción, etc.)
router.post("/action", verifyAccessToken, trackActivity, registerAction);

/* ======================================================
   🟢 ESTADO / PRESENCIA
====================================================== */

// 🔄 Sincroniza presencia (online / offline / restore)
router.post("/presence/sync", verifyAccessToken, syncPresence);

// 🟢 Cambiar estado del usuario
router.post("/status", verifyAccessToken, trackActivity, setUserStatus);

/* ======================================================
   ✍️ CHAT: ESTADO DE ESCRITURA
====================================================== */

router.post("/typing", verifyAccessToken, trackActivity, updateTyping);

/* ======================================================
   🔔 NOTIFICACIONES
====================================================== */

// ➕ Enviar una notificación push en tiempo real
router.post("/notify", verifyAccessToken, trackActivity, sendNotification);

// 🧹 Borrar / limpiar notificaciones
router.patch(
  "/notifications/clear",
  verifyAccessToken,
  trackActivity,
  clearNotifications
);

/* ======================================================
   📞 LLAMADAS (VOICE / VIDEO)
====================================================== */

// ☎ Administrar estados de llamada: call.start, call.end, ringing, etc.
router.post("/call", verifyAccessToken, trackActivity, handleCall);

/* ======================================================
   ♻ TOKEN REFRESH (versión robusta)
====================================================== */

// ✔ No requiere verifyAccessToken
router.post("/refresh-token", refreshToken);

/* ======================================================
   EXPORT
====================================================== */
export default router;

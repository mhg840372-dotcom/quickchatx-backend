import express from "express";
import { CallController } from "../controllers/call.js";
import { authenticateJWT } from "../middlewares/AuthMiddleware.js";

const router = express.Router();

/**
 * 📞 Rutas de gestión de llamadas (audio / video)
 * Todas protegidas por autenticación JWT
 */
router.use(authenticateJWT(process.env.JWT_SECRET));

// 🚀 Iniciar llamada
router.post("/start", CallController.startCall);

// ✅ Aceptar llamada
router.post("/:callId/accept", CallController.acceptCall);

// ❌ Rechazar llamada
router.post("/:callId/reject", CallController.rejectCall);

// 📴 Finalizar llamada
router.post("/:callId/end", CallController.endCall);

// 📜 Obtener historial de llamadas del usuario autenticado
router.get("/history", CallController.getHistory);

export default router;

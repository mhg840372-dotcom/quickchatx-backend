import { Router } from "express";
import { getRtcConfig, createRtcSession } from "../controllers/webrtcController.js";

const router = Router();

// Devuelve configuración básica (appId, iceServers, TTL, flags)
router.get("/config", getRtcConfig);

// Crea/recicla una sesión RTC para el usuario autenticado
router.post("/session", createRtcSession);

export default router;

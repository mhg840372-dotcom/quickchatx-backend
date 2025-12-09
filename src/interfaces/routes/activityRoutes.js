// ======================================================
// 📁 activityRoutes.js — v9.2 PRO
// ✅ Endpoints de historial de actividad
// ======================================================

import express from "express";
import { authMiddleware } from "../middlewares/AuthMiddleware.js";
import { ActivityController } from "../controllers/ActivityController.js";

const router = express.Router();

// 🔒 Actividad propia (usuario autenticado)
router.get("/me", authMiddleware, ActivityController.getMyActivity);

// 🔒 Actividad de otro usuario (solo admin)
router.get("/:id", authMiddleware, ActivityController.getActivityByUser);

export default router;

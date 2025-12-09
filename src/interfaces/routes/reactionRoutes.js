// ======================================================
// 💓 reactionRoutes.js
// ✅ Rutas de reacciones (likes) en publicaciones
// 🚀 QuickChatX v3.9.2 — Estructura REST + Seguridad JWT
// ======================================================

import express from "express";
import { authenticateJWT } from "../middlewares/AuthMiddleware.js";
import { reactionController } from "../controllers/reactionController.js";

const router = express.Router();

/**
 * ❤️ Alternar "like" en una publicación
 * POST /api/reactions/:id/like
 * Protegido: ✅ Requiere autenticación JWT
 */
router.post("/:id/like", authenticateJWT(), reactionController.toggleLike);

/**
 * 🔢 Obtener número total de likes en una publicación
 * GET /api/reactions/:id/likes/count
 */
router.get("/:id/likes/count", reactionController.getLikeCount);

/**
 * 🧍‍♂️ Verificar si el usuario autenticado dio like
 * GET /api/reactions/:id/likes/me
 * Protegido: ✅ Requiere autenticación JWT
 */
router.get("/:id/likes/me", authenticateJWT(), reactionController.hasUserLiked);

export default router;

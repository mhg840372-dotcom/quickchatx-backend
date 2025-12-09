// ======================================================
// 📁 src/interfaces/routes/interactionRoutes.js
// ✅ Solo interacciones con POSTS (NO news, NO YouTube)
// ======================================================

import express from "express";
import { likePostComment } from "../controllers/interaction.js";
import { authenticateJWT } from "../middlewares/AuthMiddleware.js";

const router = express.Router();

// ❤️ Like a comentario de un POST
router.post("/comment/like", authenticateJWT(), likePostComment);

export default router;

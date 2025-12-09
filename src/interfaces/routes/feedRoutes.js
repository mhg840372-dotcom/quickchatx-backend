// ======================================================
// 📁 src/interfaces/routes/feedRoutes.js
// ✅ QuickChatX v5.0 — Feed SOLO Posts y News (sin YouTube)
// ======================================================

import express from "express";
import { feedController } from "../controllers/feedController.js";
import { authenticateJWT } from "../middlewares/AuthMiddleware.js";
import chalk from "chalk";
import { performance } from "node:perf_hooks";

const router = express.Router();

// ======================================================
// 🧭 Middleware de log para depuración
// ======================================================
router.use((req, res, next) => {
  const start = performance.now();

  // Log de entrada a la ruta
  console.log(
    chalk.cyan(`🌍 [FeedRoute] → ${req.method} ${req.originalUrl}`)
  );

  // Log de tiempo total de respuesta
  res.on("finish", () => {
    const durationMs = performance.now() - start;

    const color =
      durationMs > 800
        ? chalk.red
        : durationMs > 400
        ? chalk.yellow
        : chalk.green;

    console.log(
      color(
        `⏱️ [FeedRoute] ${req.method} ${req.originalUrl} — ${durationMs.toFixed(
          1
        )}ms`
      )
    );
  });

  next();
});

// ======================================================
// 📰 GET /api/feed
// ======================================================
router.get("/", authenticateJWT(), feedController.getFeed);

// ======================================================
// 🎯 GET /api/feed/personalized
// ======================================================
router.get(
  "/personalized",
  authenticateJWT(),
  feedController.getPersonalizedFeed
);

// ======================================================
// ♻️ GET /api/feed/refresh
// ======================================================
router.get("/refresh", authenticateJWT(), feedController.refreshFeed);

// ======================================================
// ⚙️ GET /api/feed/paginate
// ======================================================
router.get("/paginate", authenticateJWT(), feedController.paginateFeed);

// ======================================================
// 🧠 GET /api/feed/debug
// ======================================================
router.get("/debug", authenticateJWT(), feedController.debugStatus);

// ======================================================
// Fallback
// ======================================================
router.use((req, res) => {
  console.warn(chalk.yellow(`⚠️ Ruta desconocida: ${req.originalUrl}`));
  res.status(404).json({
    success: false,
    error: "Ruta de Feed no encontrada.",
  });
});

export default router;

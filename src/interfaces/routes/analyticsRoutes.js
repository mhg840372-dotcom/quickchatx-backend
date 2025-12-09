// ======================================================
// 📊 src/interfaces/routes/analyticsRoutes.js
// ✅ QuickChatX v1.1 — Rutas de métricas de feed / usuario
// ======================================================

import express from "express";
import { analyticsController } from "../controllers/analyticsController.js";
import { authenticateJWT } from "../middlewares/AuthMiddleware.js";
import chalk from "chalk";

const router = express.Router();

// Log básico
router.use((req, _res, next) => {
  console.log(
    chalk.cyan(
      `📊 [AnalyticsRoute] → ${req.method} ${req.originalUrl}`
    )
  );
  next();
});

// 🧪 Métricas de experimentos de feed (modo completo / admin)
router.get(
  "/feed/experiments",
  authenticateJWT(),
  analyticsController.getFeedExperimentMetrics
);

// 👤 Métricas de consumo de contenido por usuario
router.get(
  "/user/content",
  authenticateJWT(),
  analyticsController.getUserContentStats
);

// 📱 Resumen de experimento de feed para App / Producción
router.get(
  "/feed/app-summary",
  authenticateJWT(),
  analyticsController.getFeedExperimentSummaryForApp
);

// Fallback
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Ruta de Analytics no encontrada.",
  });
});

export default router;

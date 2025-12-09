// ======================================================
// 🧩 src/interfaces/routes/RedisMetricsRoutes.js
// ======================================================

import express from "express";
import { getRedisMetrics } from "../controllers/RedisMetricsController.js";

const router = express.Router();

// 📊 Endpoint: /metrics/redis
router.get("/metrics/redis", getRedisMetrics);

export default router;

// ======================================================
// 🧩 src/interfaces/routes/RedisHealthRoutes.js
// ======================================================

import express from "express";
import { getRedisHealth } from "../controllers/RedisHealthController.js";

const router = express.Router();

// 🩺 Endpoint: /api/health/redis
router.get("/health/redis", getRedisHealth);

export default router;

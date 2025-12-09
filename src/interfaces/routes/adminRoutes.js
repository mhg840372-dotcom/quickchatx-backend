import express from "express";
import { broadcastNewsController } from "../controllers/adminNews.js";

const router = express.Router();

// Endpoint para broadcast de noticias
router.post("/broadcast-news", broadcastNewsController);

export default router;

import express from "express";
import dotenv from "dotenv";
import { postDeviceInfo } from "../controllers/device.js";
import { authenticateJWT } from "../middlewares/AuthMiddleware.js";

dotenv.config(); // 🔹 Cargar variables de entorno desde .env

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret"; // 🔹 Valor de respaldo

const router = express.Router();

// 🔹 Pasar JWT_SECRET a tu middleware de autenticación
router.post("/", authenticateJWT(JWT_SECRET), postDeviceInfo);

export default router;

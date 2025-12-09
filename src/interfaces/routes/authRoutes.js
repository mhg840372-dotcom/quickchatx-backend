// ======================================================
// 📁 src/interfaces/routes/authRoutes.js
// ✅ QuickChatX v9.2 — Autenticación Segura + Total Sync
// ------------------------------------------------------
// • Totalmente compatible con authController v9.0 PRO FIX
// • Acepta identifier + password
// • Registro, login, check username/email, update-profile
// • Refresh token simple (basado en JWT actual)
// ======================================================

import express from "express";
import upload from "../../infrastructure/uploadMiddleware.js";
import { hybridUpload } from "../../infrastructure/hybridUpload.js";
import jwt from "jsonwebtoken";
import chalk from "chalk";

import { authController } from "../controllers/auth.js";
import { authenticateJWT } from "../middlewares/AuthMiddleware.js";
import config from "../../config/config.js";

const router = express.Router();

// Usamos misma prioridad de secreto que userController
const JWT_SECRET =
  config.jwt?.secret || process.env.JWT_SECRET || "secret-key";

const controller = authController(JWT_SECRET);

// ======================================================
// 🧾 REGISTRO — Público
// ======================================================
router.post("/register", upload.single("avatar"), async (req, res) => {
  try {
    const { acceptedTerms } = req.body || {};

    const accepted =
      acceptedTerms === true ||
      acceptedTerms === "true" ||
      acceptedTerms === "1" ||
      acceptedTerms === 1;

    if (!accepted) {
      return res.status(400).json({
        success: false,
        error: "Debes aceptar los términos y condiciones para continuar.",
      });
    }

    console.log(chalk.cyan("📩 POST /api/auth/register recibido"));
    await controller.register(req, res);
  } catch (err) {
    console.error(chalk.red("❌ Error en /register:"), err);
    res.status(500).json({
      success: false,
      error: "Error interno durante el registro.",
    });
  }
});

// ======================================================
// 🔑 LOGIN — Público (identifier + password)
// ======================================================
router.post("/login", async (req, res) => {
  try {
    console.log(chalk.cyan("📩 POST /api/auth/login recibido"));
    await controller.login(req, res);
  } catch (err) {
    console.error(chalk.red("❌ Error en /login:"), err);
    res
      .status(500)
      .json({ success: false, error: "Error interno durante el login." });
  }
});

// ======================================================
// 🔍 CHECK USERNAME — Público
//   (se apoya en authController.checkUsername tal cual)
//   Espera username en query (?username=) o body/params
// ======================================================
router.get("/check-username", async (req, res) => {
  try {
    console.log(chalk.cyan("🔎 GET /api/auth/check-username recibido"));
    await controller.checkUsername(req, res);
  } catch (err) {
    console.error(chalk.red("❌ Error en /check-username:"), err);
    res.status(500).json({ success: false, error: "Error interno." });
  }
});

// ======================================================
// 📧 CHECK EMAIL — Público
//   Espera email en query (?email=) o body/params
// ======================================================
router.get("/check-email", async (req, res) => {
  try {
    console.log(chalk.cyan("🔎 GET /api/auth/check-email recibido"));
    await controller.checkEmail(req, res);
  } catch (err) {
    console.error(chalk.red("❌ Error en /check-email:"), err);
    res.status(500).json({ success: false, error: "Error interno." });
  }
});

// ======================================================
// 👤 UPDATE PROFILE — Protegido
//   (esto es el flujo legacy; el nuevo flujo usa /api/profile/update)
// ======================================================
router.put(
  "/update-profile",
  authenticateJWT(["user", "admin"]),
  // hybridUpload para aceptar avatar/avatarFile/avatarData y background*
  hybridUpload,
  async (req, res) => {
    try {
      console.log(chalk.cyan("✏️ PUT /api/auth/update-profile recibido"));
      await controller.updateProfile(req, res);
    } catch (err) {
      console.error(chalk.red("❌ Error en /update-profile:"), err);
      res
        .status(500)
        .json({ success: false, error: "Error al actualizar perfil." });
    }
  }
);

// ======================================================
// ♻️ REFRESH TOKEN — Protegido (basado en JWT actual)
//   Nota: el refresh real por refreshToken está en /api/auth/refresh
//   definido en createExpressApp; esto mantiene compatibilidad legacy.
// ======================================================
router.post(
  "/refresh",
  authenticateJWT(["user", "admin"]),
  async (req, res) => {
    try {
      console.log(chalk.cyan("♻️ POST /api/auth/refresh (legacy) recibido"));

      const user = req.user;
      if (!user) {
        return res.status(401).json({
          success: false,
          error: "Usuario no encontrado en el token.",
        });
      }

      const newToken = jwt.sign(
        {
          _id: user._id,
          id: user.id || user._id,
          username: user.username,
          email: user.email,
          role: user.role || "user",
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.json({
        success: true,
        message: "Token renovado correctamente.",
        token: newToken,
        user,
      });
    } catch (err) {
      console.error(chalk.red("❌ Error en /refresh:"), err);
      res
        .status(500)
        .json({ success: false, error: "Error al refrescar token." });
    }
  }
);

export default router;
// ======================================================

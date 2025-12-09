// ======================================================
// 📁 profileRouter.js — v6.1 AUTH FIX (2025)
// ------------------------------------------------------
// ✅ Protege /api/profile/update con authMiddleware
// ✅ Mantiene upload.fields avatar/background
// ======================================================

import express from "express";
import upload from "../../infrastructure/uploadMiddleware.js";
import { hybridUpload } from "../../infrastructure/hybridUpload.js";
import { profileController } from "../controllers/profile.js";
import { authMiddleware } from "../middlewares/AuthMiddleware.js";

const router = express.Router();

const controller = profileController();

router.put(
  "/update",
  authMiddleware,
  // hybridUpload permite avatar/background + variantes (avatarFile/backgroundFile)
  hybridUpload,
  controller.updateProfile
);

export default router;

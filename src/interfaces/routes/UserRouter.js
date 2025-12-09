// ======================================================
// 📁 src/interfaces/routes/UserRouter.js — FIX v12.2
// ======================================================

import express from "express";
import { verifyAccessToken } from "../middlewares/AuthMiddleware.js";

import {
  register,
  login,
  logout,
  getTerms,
  acceptTerms,
  checkUsername,
  checkEmail,
  followUser,
  unfollowUser,
  getFollowState,
  getMeProfile,
  getUserProfileById,
  searchUsers,
} from "../controllers/userController.js";

import {
  getMyActivity,
  registerAction,
  setUserStatus,
  sendNotification,
  clearNotifications,
  updateTyping,
  handleCall,
  syncPresence,
  refreshToken,
} from "../controllers/UserActivityController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refreshToken);

router.get("/terms", getTerms);
router.post("/accept-terms", verifyAccessToken, acceptTerms);

router.get("/check-username/:username", checkUsername);
router.get("/check-email/:email", checkEmail);

// PERFIL + BÚSQUEDA
router.get("/me", verifyAccessToken, getMeProfile);
router.get("/search", verifyAccessToken, searchUsers);
router.get("/:id", verifyAccessToken, getUserProfileById);

// FOLLOW SYSTEM
router.post("/:id/follow", verifyAccessToken, followUser);
router.delete("/:id/follow", verifyAccessToken, unfollowUser);
router.get("/:id/follow-state", verifyAccessToken, getFollowState);

// USER ACTIVITY SYSTEM
router.get("/activity/me", verifyAccessToken, getMyActivity);
router.post("/activity/action", verifyAccessToken, registerAction);
router.post("/activity/status", verifyAccessToken, setUserStatus);
router.post("/activity/notify", verifyAccessToken, sendNotification);
router.patch(
  "/activity/notifications/read",
  verifyAccessToken,
  clearNotifications
);
router.post("/activity/typing", verifyAccessToken, updateTyping);
router.post("/activity/call", verifyAccessToken, handleCall);
router.post("/activity/sync", verifyAccessToken, syncPresence);

router.post("/logout", verifyAccessToken, logout);

export default router;

// ======================================================
// 🧠 src/application/AuthService.js
// ✅ QuickChatX v4.0 — Autenticación con JWT + Refresh Tokens
// ======================================================

import jwt from "jsonwebtoken";
import { User } from "../domain/User.js";

export class AuthService {
  constructor(jwtSecret) {
    if (!jwtSecret) throw new Error("JWT_SECRET no definido");
    this.jwtSecret = jwtSecret;
  }

  /**
   * 🧩 Registrar un usuario con deviceInfo y avatar opcional
   */
  async register(data) {
    const {
      firstName,
      lastName,
      username,
      email,
      password,
      gender,
      termsAccepted,
      profilePhoto,
      deviceInfo,
    } = data;

    // 🔍 Verificar si el usuario ya existe
    const existing = await User.findOne({
      $or: [
        { username: username.toLowerCase() },
        { email: email.toLowerCase() },
      ],
    });
    if (existing) throw new Error("Usuario ya existe");

    // 👤 Crear usuario nuevo
    const user = new User({
      firstName,
      lastName,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      gender: gender || null,
      profilePhoto: profilePhoto || null,
      termsAccepted: termsAccepted === true,
      devices: deviceInfo ? [deviceInfo] : [],
    });

    await user.save();

    // 🔐 Generar access token (7 días)
    const token = jwt.sign(
      { id: user._id, username: user.username },
      this.jwtSecret,
      { expiresIn: "7d" }
    );

    // 🔁 Generar refresh token (30 días)
    const refreshToken = jwt.sign(
      { id: user._id },
      this.jwtSecret,
      { expiresIn: "30d" }
    );

    return { user, token, refreshToken };
  }

  /**
   * 🔑 Login con email o username
   */
  async login(emailOrUsername, password) {
    const user = await User.findOne({
      $or: [
        { email: emailOrUsername.toLowerCase() },
        { username: emailOrUsername.toLowerCase() },
      ],
    });
    if (!user) throw new Error("Usuario no encontrado");

    const match = await user.comparePassword(password);
    if (!match) throw new Error("Contraseña incorrecta");

    // Access y refresh tokens
    const token = jwt.sign(
      { id: user._id, username: user.username },
      this.jwtSecret,
      { expiresIn: "7d" }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      this.jwtSecret,
      { expiresIn: "30d" }
    );

    return { user, token, refreshToken };
  }

  /**
   * ♻️ Refrescar access token usando un refresh token válido
   */
  async refreshAccessToken(refreshToken) {
    try {
      if (!refreshToken) throw new Error("Falta el refresh token");

      const decoded = jwt.verify(refreshToken, this.jwtSecret);
      const user = await User.findById(decoded.id);
      if (!user) throw new Error("Usuario no encontrado");

      const newAccessToken = jwt.sign(
        { id: user._id, username: user.username },
        this.jwtSecret,
        { expiresIn: "7d" }
      );

      return { accessToken: newAccessToken, user };
    } catch (err) {
      console.error("❌ Error al refrescar token:", err.message);
      throw new Error("Refresh token inválido o expirado");
    }
  }
}

// ======================================================
// 🧩 Exportación auxiliar para compatibilidad
// (permite usar: import { refreshAccessToken } from 'AuthService.js')
// ======================================================
const defaultAuthService = new AuthService(process.env.JWT_SECRET || "default_secret");
export const refreshAccessToken = (token) =>
  defaultAuthService.refreshAccessToken(token);

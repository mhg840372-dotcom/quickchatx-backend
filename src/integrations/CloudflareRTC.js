// ======================================================
// 🌐 Cloudflare WebRTC / SFU helper (placeholder, sin secretos)
// ------------------------------------------------------
// • Usa envs: CLOUDFLARE_RTC_APP_ID, CLOUDFLARE_RTC_API_TOKEN
// • No expone tokens al cliente; solo indica si existe
// • Devuelve lista de ICE servers (STUN/TURN) configurable
// ======================================================

import crypto from "crypto";
import config from "../config/config.js";

const defaultIce = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

export function buildIceServers() {
  const urls = Array.isArray(config.webrtc?.iceServers)
    ? config.webrtc.iceServers.filter(Boolean)
    : defaultIce;

  return urls.map((u) => ({ urls: u }));
}

export function hasCloudflareConfig() {
  return Boolean(config.webrtc?.appId);
}

export function hasApiToken() {
  return Boolean(config.webrtc?.apiToken);
}

export function createRtcPayload({ roomId, userId, username }) {
  const now = Date.now();
  const ttlSeconds = Number(config.webrtc?.ttlSeconds || 3600);

  return {
    provider: config.webrtc?.provider || "cloudflare",
    appId: config.webrtc?.appId || null,
    roomId: roomId || crypto.randomUUID(),
    clientId: userId || null,
    username: username || null,
    iceServers: buildIceServers(),
    hasServerToken: hasApiToken(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
  };
}

export function ensureRtcEnabled() {
  if (!hasCloudflareConfig()) {
    throw new Error("Cloudflare RTC no está configurado (CLOUDFLARE_RTC_APP_ID requerido)");
  }
}

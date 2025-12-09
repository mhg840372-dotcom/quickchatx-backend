// ======================================================
// 🎥 WebRTC Controller — Cloudflare SFU (placeholder seguro)
// ------------------------------------------------------
// • No expone token de API
// • Devuelve ICE servers y appId para que el cliente conecte al SFU
// • Usa la misma identidad (userId/username) del JWT
// ======================================================

import {
  buildIceServers,
  createRtcPayload,
  ensureRtcEnabled,
  hasApiToken,
} from "../../integrations/CloudflareRTC.js";
import config from "../../config/config.js";

export async function getRtcConfig(req, res) {
  try {
    ensureRtcEnabled();

    return res.json({
      success: true,
      data: {
        provider: config.webrtc?.provider || "cloudflare",
        appId: config.webrtc?.appId || null,
        iceServers: buildIceServers(),
        ttlSeconds: config.webrtc?.ttlSeconds || 3600,
        hasApiToken: hasApiToken(),
      },
    });
  } catch (err) {
    return res.status(503).json({
      success: false,
      error: err.message || "RTC no disponible",
    });
  }
}

export async function createRtcSession(req, res) {
  try {
    ensureRtcEnabled();

    const roomId = req.body?.roomId || req.query?.roomId || null;
    const payload = createRtcPayload({
      roomId,
      userId: req.user?.id || req.user?._id,
      username: req.user?.username || null,
    });

    return res.json({ success: true, data: payload });
  } catch (err) {
    return res.status(503).json({
      success: false,
      error: err.message || "No se pudo crear sesión RTC",
    });
  }
}

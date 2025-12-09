// ======================================================
// 📰 src/interfaces/controllers/adminNews.js
// ✅ QuickChatX v5.2.1 — Controlador de noticias en tiempo real (broadcast global)
// ======================================================

import jwt from "jsonwebtoken";

/**
 * Broadcast global de noticias a todos los clientes conectados (Socket.IO + WS)
 */
export async function broadcastNewsController(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ error: "Authorization header missing" });

    const token = authHeader.replace("Bearer ", "");

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }

    // Solo admin autorizado
    if (!payload.username || payload.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado: se requiere rol admin" });
    }

    const { title, content } = req.body;
    if (!title || !content)
      return res.status(400).json({ error: "Faltan campos title o content" });

    // Obtener servicio WebSocket desde el contexto global
    const socketService = req.app.locals.socketService;
    if (!socketService)
      return res.status(500).json({ error: "SocketService no disponible" });

    // Emitir broadcast global (Socket.IO + WS nativo)
    socketService.broadcast({
      type: "news",
      title,
      content,
      author: payload.username,
      time: new Date().toISOString(),
    });

    return res.json({
      success: true,
      message: "📢 Noticia enviada a todos los clientes conectados.",
    });
  } catch (err) {
    console.error("❌ Error en broadcastNewsController:", err);
    return res.status(500).json({ error: "Error interno en broadcastNewsController" });
  }
}

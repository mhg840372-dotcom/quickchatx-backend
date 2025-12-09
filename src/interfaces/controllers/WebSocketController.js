/**
 * 📡 WebSocketController — Broadcast de noticias
 */
import chalk from "chalk";

/**
 * Envía noticias a todos los clientes WebSocket conectados.
 * @param {WebSocketServer|SocketService} wss - Instancia de WebSocket o SocketService
 * @param {Array} articles - Lista de artículos nuevos
 */
export function broadcastNews(wss, articles) {
  if (!articles?.length) return;

  try {
    if (wss.broadcast) {
      // Si se pasa una instancia de SocketService
      wss.broadcast("news_update", articles);
    } else if (wss.clients) {
      // Si se pasa un WebSocketServer crudo
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: "news_update", data: articles }));
        }
      }
    }
    console.log(chalk.cyan(`📢 Noticias emitidas a ${articles.length} clientes.`));
  } catch (err) {
    console.error(chalk.red("❌ Error al hacer broadcast de noticias:"), err.message);
  }
}

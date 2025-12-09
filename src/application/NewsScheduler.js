// ======================================================
// 🕒 QuickChatX v5.8.0 — NewsScheduler (wrapper de NewsService)
// ------------------------------------------------------
// - Llama a NewsService.periodicUpdate() de forma segura
// - Control por ENV:
//     ENABLE_NEWS_SERVICE = "false" → desactiva scheduler
//     NEWS_POLL_INTERVAL_MS         → override de intervalo
// - Compat total con NewsService v8.6 (clase + singleton)
// ======================================================

import chalk from "chalk";
// Import defensivo: clase o singleton
import * as NewsServiceModule from "./NewsService.js";

// Detectamos el export correcto:
// - named: { NewsService }  → clase
// - default: export default newsServiceSingleton
const NewsService =
  NewsServiceModule.NewsService ||
  NewsServiceModule.default ||
  NewsServiceModule.newsService ||
  null;

let isRunning = false;
/** @type {NodeJS.Timeout | null} */
let schedulerInterval = null;

// ⏱️ Intervalo por defecto: 20 minutos (sobrescribible por ENV)
const DEFAULT_INTERVAL_MS =
  Number(process.env.NEWS_POLL_INTERVAL_MS) > 0
    ? Number(process.env.NEWS_POLL_INTERVAL_MS)
    : 20 * 60 * 1000;

/**
 * 🔁 Ejecuta la sincronización de noticias y notifica a los clientes WebSocket.
 * Reutiliza NewsService.periodicUpdate(), no inventa otra lógica.
 * @param {import("ws").WebSocketServer | null} wss - Servidor WebSocket (opcional)
 */
export async function pollNewsAndBroadcast(wss = null) {
  if (isRunning) {
    console.log(
      chalk.gray(
        "⏳ NewsScheduler: ciclo anterior aún en curso, omitiendo ejecución."
      )
    );
    return;
  }

  // Defensa por si NewsService aún no está bien inicializado
  if (!NewsService || typeof NewsService.periodicUpdate !== "function") {
    console.warn(
      chalk.yellow(
        "⚠️ NewsScheduler: NewsService.periodicUpdate no está disponible. Revisa NewsService.js."
      )
    );
    return;
  }

  isRunning = true;
  console.log(
    chalk.blueBright(
      "🔄 NewsScheduler: iniciando ciclo de sincronización de noticias..."
    )
  );

  const startedAt = Date.now();

  try {
    await NewsService.periodicUpdate();

    const elapsed = Date.now() - startedAt;
    console.log(
      chalk.greenBright(
        `✅ NewsScheduler: ciclo completado en ${Math.round(
          elapsed / 100
        ) / 10}s`
      )
    );

    // OJO: NewsService ya hace broadcast por WebSocket dentro de fetchAndSave().
    // Aquí solo emitimos un log opcional.
    if (wss && typeof wss.clients === "object") {
      console.log(
        chalk.cyan(
          `📡 NewsScheduler: notificación completa. Clientes WS conectados: ${wss.clients.size}`
        )
      );
    }
  } catch (error) {
    console.error(
      chalk.red("❌ Error en NewsScheduler.pollNewsAndBroadcast:"),
      error?.message || error
    );
  } finally {
    isRunning = false;
  }
}

/**
 * 🕒 Inicia el proceso programado de sincronización.
 * @param {import("ws").WebSocketServer | null} [wss] - Servidor WebSocket (opcional)
 * @param {number} [intervalMs=DEFAULT_INTERVAL_MS] - Intervalo en milisegundos
 */
export function startNewsPolling(wss = null, intervalMs = DEFAULT_INTERVAL_MS) {
  if (schedulerInterval) {
    console.log(
      chalk.gray(
        "⚙️ NewsScheduler: ya estaba en ejecución, reiniciando intervalo..."
      )
    );
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  if (process.env.ENABLE_NEWS_SERVICE === "false") {
    console.log(
      chalk.gray(
        "🕒 NewsScheduler NO iniciado (ENABLE_NEWS_SERVICE=false). " +
          "Si quieres noticias automáticas, elimina esa variable o ponla a 'true'."
      )
    );
    return null;
  }

  console.log(
    chalk.magentaBright(
      `🕒 NewsScheduler activo — ejecutando cada ${Math.round(
        intervalMs / 60000
      )} min.`
    )
  );

  // Ejecutar inmediatamente al iniciar el servidor
  pollNewsAndBroadcast(wss).catch((err) => {
    console.error(
      chalk.red(
        "❌ Error en primera ejecución de NewsScheduler.pollNewsAndBroadcast:"
      ),
      err?.message || err
    );
  });

  // Programar ejecución periódica
  schedulerInterval = setInterval(() => {
    pollNewsAndBroadcast(wss).catch((err) => {
      console.error(
        chalk.red("❌ Error en ciclo programado de NewsScheduler:"),
        err?.message || err
      );
    });
  }, intervalMs);

  // Permitir que el proceso se pueda cerrar aunque el intervalo exista
  schedulerInterval.unref?.();

  return schedulerInterval;
}

/**
 * 🧹 Detiene el proceso de sincronización de noticias.
 */
export function stopNewsPolling() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log(chalk.yellow("🛑 NewsScheduler detenido manualmente."));
  } else {
    console.log(
      chalk.gray(
        "ℹ️ NewsScheduler.stopNewsPolling: no había intervalo activo."
      )
    );
  }
}

// ======================================================
// 🩺 HealthMonitor.js — Monitoreo de estado de servicios
// ======================================================
import chalk from "chalk";

const failureCounts = new Map(); // { serviceName: { count, lastError, lastOk } }
const MAX_FAILURES = 3;

let telegramAlertFn = null;

/**
 * Inicializa el monitor con una función de alerta (Telegram)
 */
export function initHealthMonitor(alertFunction) {
  telegramAlertFn = alertFunction;
  console.log(chalk.blue("🩺 HealthMonitor inicializado."));
}

/**
 * Registra un fallo en un servicio
 * @param {string} serviceName - Nombre del servicio (ej: "YouTubeService")
 * @param {string} error - Mensaje de error
 */
export async function registerFailure(serviceName, error) {
  const entry = failureCounts.get(serviceName) || { count: 0, lastError: null, lastOk: null };
  entry.count++;
  entry.lastError = error;
  failureCounts.set(serviceName, entry);

  console.warn(chalk.red(`⚠️ ${serviceName} fallo #${entry.count}: ${error}`));

  if (entry.count >= MAX_FAILURES) {
    console.log(chalk.bgRed.white(`🚨 ${serviceName} falló ${entry.count} veces seguidas.`));
    if (telegramAlertFn) {
      await telegramAlertFn(`🚨 *${serviceName}* ha fallado ${entry.count} veces seguidas.\nÚltimo error: ${error}`, true);
    }
    // Reiniciar contador después de alerta
    entry.count = 0;
    failureCounts.set(serviceName, entry);
  }
}

/**
 * Registra un éxito (resetea contador de fallos)
 * @param {string} serviceName
 */
export function registerSuccess(serviceName) {
  const entry = failureCounts.get(serviceName) || { count: 0, lastError: null, lastOk: null };
  if (entry.count > 0) {
    console.log(chalk.green(`✅ ${serviceName} volvió a funcionar correctamente.`));
  }
  entry.count = 0;
  entry.lastOk = new Date();
  failureCounts.set(serviceName, entry);
}

/**
 * Obtiene el estado de los servicios monitoreados
 */
export function getHealthStatus() {
  return Array.from(failureCounts.entries()).map(([name, data]) => ({
    service: name,
    failures: data.count,
    lastError: data.lastError,
    lastOk: data.lastOk,
  }));
}
// ======================================================
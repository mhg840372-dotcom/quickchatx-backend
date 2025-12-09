// ======================================================
// 🔑 src/infrastructure/ApiKeyManager.js
// ✅ QuickChatX v8.3 — Gestor seguro de claves API (sin Redis duro)
// ------------------------------------------------------
// • Rotación circular en memoria (round-robin)
// • Backoff progresivo por clave (suspensión temporal)
// • Compatible con NewsAPI / GNews / TheNewsAPI
// • Sin dependencias de YouTube ni SerpAPI
// ======================================================

import chalk from "chalk";

export class ApiKeyManager {
  /**
   * @param {Object} options
   * @param {string} options.name   Nombre del proveedor (NewsAPI, GNews, TheNewsAPI)
   * @param {string[]} options.keys Lista de claves API
   */
  constructor({ name = "API", keys = [] } = {}) {
    this.name = name;
    this.keys = (keys || [])
      .map((k) => (k || "").trim())
      .filter(Boolean);

    this.initialized = false;

    // key → { disabledUntil, fails, createdAt }
    this.state = new Map();

    // índice para round-robin
    this._rrIndex = 0;

    this.stats = {
      rotations: 0,
      suspensions: 0,
      recoveries: 0,
      lastRotation: null,
      lastCleanup: null,
    };

    if (!this.keys.length) {
      console.warn(
        chalk.yellow(
          `⚠️ ApiKeyManager (${this.name}): sin claves configuradas en .env`
        )
      );
    }
  }

  // ======================================================
  // ⚙️ Inicialización (solo memoria, sin Redis)
// ======================================================
  async initialize() {
    if (this.initialized) return;

    const now = Date.now();
    for (const key of this.keys) {
      if (!this.state.has(key)) {
        this.state.set(key, {
          disabledUntil: 0,
          fails: 0,
          createdAt: now,
        });
      }
    }

    this.initialized = true;
    console.log(
      chalk.gray(
        `🔑 ApiKeyManager (${this.name}) activo en modo memoria (${this.keys.length} claves).`
      )
    );
  }

  // ======================================================
  // 🧹 Limpieza de suspensiones expiradas
  // ======================================================
  async cleanupExpired() {
    await this.initialize();
    const now = Date.now();
    let recovered = 0;

    for (const [key, info] of this.state.entries()) {
      if (info.disabledUntil && info.disabledUntil < now) {
        info.disabledUntil = 0;
        recovered++;
      }
    }

    if (recovered > 0) {
      this.stats.recoveries += recovered;
      this.stats.lastCleanup = new Date().toISOString();
      console.log(
        chalk.cyan(
          `🔁 ${recovered} claves reactivadas (${this.name})`
        )
      );
    }
  }

  // ======================================================
  // 🔄 Obtener siguiente clave activa (rotación circular)
// ======================================================
  async getActiveKey() {
    await this.initialize();
    await this.cleanupExpired();

    if (!this.keys.length) {
      console.warn(chalk.red(`❌ No hay claves configuradas (${this.name})`));
      return null;
    }

    const now = Date.now();

    // filtrar claves NO suspendidas
    const usable = this.keys.filter((key) => {
      const info = this.state.get(key) || {};
      return !info.disabledUntil || info.disabledUntil <= now;
    });

    // si todas están penalizadas, las re-habilitamos todas
    const pool = usable.length ? usable : this.keys;

    if (!usable.length) {
      for (const info of this.state.values()) {
        info.disabledUntil = 0;
      }
    }

    if (!pool.length) {
      console.warn(chalk.red(`🚫 No hay claves utilizables (${this.name})`));
      return null;
    }

    if (this._rrIndex >= pool.length) this._rrIndex = 0;
    const key = pool[this._rrIndex];
    this._rrIndex = (this._rrIndex + 1) % pool.length;

    this.stats.rotations++;
    this.stats.lastRotation = new Date().toISOString();

    return key || null;
  }

  // ======================================================
  // 🚫 Suspender clave temporalmente (backoff progresivo)
// ======================================================
  async suspendKey(key, reason = "cuota agotada o clave inválida") {
    if (!key) return;
    await this.initialize();

    const info =
      this.state.get(key) || {
        disabledUntil: 0,
        fails: 0,
        createdAt: Date.now(),
      };

    info.fails = (info.fails || 0) + 1;

    // backoff progresivo: 5m, 15m, 60m, 180m...
    const stepsMinutes = [5, 15, 60, 180];
    const idx = Math.min(stepsMinutes.length - 1, info.fails - 1);
    const minutes = stepsMinutes[idx];

    const durationMs = minutes * 60 * 1000;
    info.disabledUntil = Date.now() + durationMs;

    this.state.set(key, info);
    this.stats.suspensions++;

    console.warn(
      chalk.yellow(
        `⚠️ Clave suspendida (${this.name}): ${key.slice(
          0,
          12
        )}… → ${reason} (reactivación en ${minutes} min, fails=${info.fails})`
      )
    );
  }

  // ======================================================
  // ⚠️ Analizador de errores de API — suspensión automática
  // ======================================================
  async handleApiError(key, error) {
    if (!key || !error) return false;
    await this.initialize();

    const errStr =
      typeof error === "string"
        ? error.toLowerCase()
        : JSON.stringify(error).toLowerCase();

    const patterns = [
      "quota",
      "exceeded",
      "rate limit",
      "daily limit",
      "invalid key",
      "forbidden",
      "unauthorized",
      "key disabled",
      "account has run out",
      "quotaexceeded",
    ];

    if (patterns.some((p) => errStr.includes(p))) {
      await this.suspendKey(key, "límite alcanzado o clave inválida");
      return true;
    }

    return false;
  }

  // ======================================================
  // 📊 Estado del gestor (para debugging)
// ======================================================
  getStatus() {
    const suspended = [];
    for (const [key, info] of this.state.entries()) {
      if (info.disabledUntil && info.disabledUntil > Date.now()) {
        suspended.push({
          key: key.slice(0, 8) + "…",
          until: new Date(info.disabledUntil).toISOString(),
          fails: info.fails,
        });
      }
    }

    return {
      name: this.name,
      totalKeys: this.keys.length,
      suspended,
      mode: "memory",
      stats: this.stats,
      uptimeSec: Math.floor(process.uptime()),
    };
  }
}

export default ApiKeyManager;

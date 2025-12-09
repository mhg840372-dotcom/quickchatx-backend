// ======================================================
// 🧰 checkApiKeys.js — Verificador de estado de claves API
// ✅ QuickChatX v7.9 — CLI de monitoreo y diagnóstico
// ======================================================

import chalk from "chalk";
import { ApiKeyManager } from "../infrastructure/ApiKeyManager.js";

const services = [
  {
    name: "YouTube",
    keys: (process.env.YOUTUBE_API_KEYS || "").split(","),
  },
  {
    name: "News",
    keys: (process.env.NEWS_API_KEYS || "").split(","),
  },
  {
    name: "GNews",
    keys: (process.env.GNEWS_API_KEYS || "").split(","),
  },
];

(async () => {
  console.log(chalk.cyanBright("\n🔍 Verificando estado de claves API...\n"));

  for (const svc of services) {
    const manager = new ApiKeyManager({ name: svc.name, keys: svc.keys });
    await manager.initialize();

    const total = svc.keys.length;
    const suspended = Array.from(manager.suspendedKeys);
    const active = svc.keys.filter((k) => !suspended.includes(k));

    console.log(chalk.bold(`🧩 ${svc.name} — Total: ${total}`));

    if (active.length > 0) {
      console.log(chalk.green(`   ✅ Activas (${active.length}):`));
      active.forEach((k) => console.log(`     • ${k.slice(0, 20)}…`));
    }

    if (suspended.length > 0) {
      console.log(chalk.yellow(`   🚫 Suspendidas (${suspended.length}):`));
      suspended.forEach((k) => console.log(`     • ${k.slice(0, 20)}…`));
    }

    console.log();
  }

  console.log(chalk.cyanBright("✅ Revisión completa.\n"));
  process.exit(0);
})();

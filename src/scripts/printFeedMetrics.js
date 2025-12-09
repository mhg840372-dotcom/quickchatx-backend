// node src/scripts/printFeedMetrics.js topics_v1

import "dotenv/config.js";
import mongoose from "mongoose";
import { MongoProvider } from "../infrastructure/MongoProvider.js";
import AnalyticsService from "../application/AnalyticsService.js";

async function main() {
  await MongoProvider.connect();

  const algoName = process.argv[2] || "topics_v1";

  const metrics = await AnalyticsService.getGlobalFeedMetrics({
    algoName,
    // from / to opcional, default 24h
  });

  console.log("=== Métricas globales de feed ===");
  console.log(JSON.stringify(metrics, null, 2));

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error("❌ Error en printFeedMetrics:", err);
  process.exit(1);
});

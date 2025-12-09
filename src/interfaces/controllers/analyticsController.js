// ======================================================
// 📊 src/interfaces/controllers/analyticsController.js
// ✅ QuickChatX v1.1 — Controlador de métricas de feed
// ======================================================

import AnalyticsService from "../../application/AnalyticsService.js";
import chalk from "chalk";

export const analyticsController = {
  // ======================================================
  // 🧪 GET /api/analytics/feed/experiments
  // Query:
  //   experimentKey?=feed_algo_v1
  //   variants?=topics_v1,topics_explore_v1
  //   from?=2025-01-01
  //   to?=2025-01-31
  // ======================================================
  async getFeedExperimentMetrics(req, res) {
    try {
      const experimentKey =
        req.query.experimentKey || "feed_algo_v1";

      const variants =
        typeof req.query.variants === "string"
          ? req.query.variants
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
          : ["topics_v1", "topics_explore_v1"];

      const from = req.query.from ? new Date(req.query.from) : undefined;
      const to = req.query.to ? new Date(req.query.to) : undefined;

      const data = await AnalyticsService.getFeedExperimentMetrics({
        experimentKey,
        variants,
        from,
        to,
      });

      return res.json({
        success: true,
        data,
      });
    } catch (err) {
      console.error(
        chalk.red("❌ Error en getFeedExperimentMetrics:"),
        err
      );
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  },

  // ======================================================
  // 👤 GET /api/analytics/user/content
  // Query:
  //   userId (obligatorio si no viene en req.user)
  //   from?=2025-01-01
  //   to?=2025-01-31
  // ======================================================
  async getUserContentStats(req, res) {
    try {
      const authUser = req.user || {};
      const userIdParam = req.query.userId;
      const userId = userIdParam || authUser.id || authUser._id;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: "userId requerido",
        });
      }

      const from = req.query.from ? new Date(req.query.from) : undefined;
      const to = req.query.to ? new Date(req.query.to) : undefined;

      const data = await AnalyticsService.getUserContentStats({
        userId,
        from,
        to,
      });

      return res.json({
        success: true,
        data,
      });
    } catch (err) {
      console.error(
        chalk.red("❌ Error en getUserContentStats:"),
        err
      );
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  },

  // ======================================================
  // 📱 GET /api/analytics/feed/app-summary
  // Endpoint ligero pensado para App / Panel en producción
  // - Usa experimentKey = feed_algo_v1
  // - Variants por defecto: topics_v1, topics_explore_v1
  // - Ventana: últimas 24h (salvo que pases from/to)
  // ======================================================
  async getFeedExperimentSummaryForApp(req, res) {
    try {
      const experimentKey = "feed_algo_v1";

      const variants =
        typeof req.query.variants === "string"
          ? req.query.variants
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
          : ["topics_v1", "topics_explore_v1"];

      const from = req.query.from ? new Date(req.query.from) : undefined;
      const to = req.query.to ? new Date(req.query.to) : undefined;

      const raw = await AnalyticsService.getFeedExperimentMetrics({
        experimentKey,
        variants,
        from,
        to,
      });

      // 🔍 Hacemos la respuesta más compacta, ideal para UI
      const summary = (raw.variants || []).map((v) => ({
        variant: v.variant,
        exposures: v.exposures,
        impressions: v.impressions,
        uniqueUsers: v.uniqueUsers,
        ctr: Number(v.ctr.toFixed(4)),
        likeRate: Number(v.likeRate.toFixed(4)),
        commentRate: Number(v.commentRate.toFixed(4)),
      }));

      return res.json({
        success: true,
        experimentKey,
        window: {
          from: raw.from,
          to: raw.to,
        },
        variants: summary,
      });
    } catch (err) {
      console.error(
        chalk.red("❌ Error en getFeedExperimentSummaryForApp:"),
        err
      );
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  },
};

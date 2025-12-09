// src/interfaces/controllers/adminMetricsController.js (ejemplo)

import AnalyticsService from "../../application/AnalyticsService.js";

export const adminMetricsController = {
  async getFeedMetrics(req, res) {
    try {
      const { from, to, algoName, experimentKey, variant } = req.query;
      const metrics = await AnalyticsService.getGlobalFeedMetrics({
        from,
        to,
        algoName,
        experimentKey,
        variant,
      });
      return res.json({ success: true, data: metrics });
    } catch (err) {
      console.error("❌ Error en getFeedMetrics:", err);
      return res
        .status(500)
        .json({ success: false, error: err.message });
    }
  },
};

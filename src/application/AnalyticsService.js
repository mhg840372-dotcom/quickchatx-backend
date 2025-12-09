// ======================================================
// 📊 src/application/AnalyticsService.js
// ✅ Analytics de Feed / Recomendador (CTR, viewTime, score, etc.)
// ------------------------------------------------------
// Usa ActivityLog con los tipos:
//  - FEED_EXPOSURE (meta: { algoName, experimentKey, variant, items[] })
//      items[] puede contener: { id, type, position, score? }
//  - CONTENT_VIEW   (meta: { durationMs, fullyViewed, algoName, variant, ... })
//  - CONTENT_INTERACTION (meta: { action, algoName, variant, ... })
// ======================================================

import chalk from "chalk";
import { ActivityLog } from "../domain/ActivityLog.js";

function normalizeDateRange({ from, to }) {
  const now = new Date();
  let start = from
    ? new Date(from)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000); // default 24h
  let end = to ? new Date(to) : now;

  if (isNaN(start)) start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isNaN(end)) end = now;

  return { start, end };
}

export class AnalyticsService {
  // ======================================================
  // 🔧 Helper interno: FEED_EXPOSURE + score de items
  // ------------------------------------------------------
  // Devuelve:
  //   - exposures
  //   - exposureItems
  //   - avgScoreExposed
  //   - minScoreExposed
  //   - maxScoreExposed
  // ======================================================
  static async _aggregateExposureAndScore(exposureMatch) {
    // 1) Exposiciones + nº de items
    const [exposureAgg] = await ActivityLog.aggregate([
      { $match: exposureMatch },
      {
        $project: {
          itemsCount: {
            $size: { $ifNull: ["$meta.items", []] },
          },
        },
      },
      {
        $group: {
          _id: null,
          exposures: { $sum: 1 },
          exposureItems: { $sum: "$itemsCount" },
        },
      },
    ]);

    const exposures = exposureAgg?.exposures || 0;
    const exposureItems = exposureAgg?.exposureItems || 0;

    // 2) Stats de score (si meta.items[].score existe)
    let avgScoreExposed = 0;
    let minScoreExposed = null;
    let maxScoreExposed = null;

    try {
      const [scoreAgg] = await ActivityLog.aggregate([
        { $match: exposureMatch },
        {
          $unwind: {
            path: "$meta.items",
            preserveNullAndEmptyArrays: false,
          },
        },
        {
          $match: {
            "meta.items.score": { $type: "number" },
          },
        },
        {
          $group: {
            _id: null,
            avgScore: { $avg: "$meta.items.score" },
            minScore: { $min: "$meta.items.score" },
            maxScore: { $max: "$meta.items.score" },
            scoredItems: { $sum: 1 },
          },
        },
      ]);

      if (scoreAgg && scoreAgg.scoredItems > 0) {
        avgScoreExposed = scoreAgg.avgScore || 0;
        minScoreExposed =
          typeof scoreAgg.minScore === "number"
            ? scoreAgg.minScore
            : null;
        maxScoreExposed =
          typeof scoreAgg.maxScore === "number"
            ? scoreAgg.maxScore
            : null;
      }
    } catch (err) {
      console.warn(
        chalk.yellow(
          "⚠️ Error calculando stats de score en _aggregateExposureAndScore:"
        ),
        err?.message || err
      );
    }

    return {
      exposures,
      exposureItems,
      avgScoreExposed,
      minScoreExposed,
      maxScoreExposed,
    };
  }

  /**
   * 📈 Métricas globales de feed por algoritmo / variante
   * - Exposiciones de feed
   * - Items expuestos (suma de items en meta.items[])
   * - Interacciones (like/comment/share/click...)
   * - CTR calculado (interacciones / items expuestos)
   * - Vistas y tiempo medio
   * - 🆕 Stats de score (avg/min/max) de los items expuestos
   */
  static async getGlobalFeedMetrics({
    from,
    to,
    algoName = null,
    experimentKey = null,
    variant = null,
  } = {}) {
    const { start, end } = normalizeDateRange({ from, to });

    const dateFilter = {
      $or: [
        { timestamp: { $gte: start, $lte: end } },
        { createdAt: { $gte: start, $lte: end } }, // fallback
      ],
    };

    const algoFilter = {};
    if (algoName) algoFilter["meta.algoName"] = algoName;
    if (experimentKey) algoFilter["meta.experimentKey"] = experimentKey;
    if (variant) algoFilter["meta.variant"] = variant;

    // ======================================================
    // 1) FEED_EXPOSURE → exposición y número de items + scores
    // ======================================================
    const exposureMatch = {
      type: "FEED_EXPOSURE",
      ...dateFilter,
      ...algoFilter,
    };

    const {
      exposures,
      exposureItems,
      avgScoreExposed,
      minScoreExposed,
      maxScoreExposed,
    } = await this._aggregateExposureAndScore(exposureMatch);

    // ======================================================
    // 2) CONTENT_INTERACTION → likes, comments, share, etc.
    // ======================================================
    const interactionMatch = {
      type: "CONTENT_INTERACTION",
      ...dateFilter,
      ...algoFilter,
    };

    const interactionsAgg = await ActivityLog.aggregate([
      { $match: interactionMatch },
      {
        $group: {
          _id: "$meta.action",
          count: { $sum: 1 },
        },
      },
    ]);

    const interactionsByAction = {};
    for (const row of interactionsAgg) {
      const action = row._id || "unknown";
      interactionsByAction[action] = row.count || 0;
    }

    const totalInteractions = Object.values(interactionsByAction).reduce(
      (sum, v) => sum + v,
      0
    );

    // CTR simple: todas las interacciones / items expuestos
    const ctrGlobal =
      exposureItems > 0 ? totalInteractions / exposureItems : 0;

    // CTR específico para likes+comments (engagement "positivo")
    const positiveActions = ["like", "comment", "share", "click"];
    const positiveInteractions = positiveActions.reduce(
      (sum, act) => sum + (interactionsByAction[act] || 0),
      0
    );
    const ctrPositive =
      exposureItems > 0 ? positiveInteractions / exposureItems : 0;

    // ======================================================
    // 3) CONTENT_VIEW → vistas + tiempo medio
    // ======================================================
    const viewMatch = {
      type: "CONTENT_VIEW",
      ...dateFilter,
      ...algoFilter,
    };

    const [viewsAgg] = await ActivityLog.aggregate([
      { $match: viewMatch },
      {
        $group: {
          _id: null,
          totalViews: { $sum: 1 },
          totalDurationMs: { $sum: "$meta.durationMs" },
          fullyViewedCount: {
            $sum: {
              $cond: [{ $eq: ["$meta.fullyViewed", true] }, 1, 0],
            },
          },
        },
      },
    ]);

    const totalViews = viewsAgg?.totalViews || 0;
    const totalDurationMs = viewsAgg?.totalDurationMs || 0;
    const fullyViewedCount = viewsAgg?.fullyViewedCount || 0;

    const avgViewDurationMs =
      totalViews > 0 ? totalDurationMs / totalViews : 0;
    const fullViewRate =
      totalViews > 0 ? fullyViewedCount / totalViews : 0;

    return {
      window: { from: start, to: end },
      algoName: algoName || null,
      experimentKey: experimentKey || null,
      variant: variant || null,

      exposures,
      exposureItems,

      interactionsByAction,
      totalInteractions,
      ctrGlobal,
      ctrPositive,

      totalViews,
      avgViewDurationMs,
      fullViewRate,

      // 🆕 stats de score de los items expuestos
      avgScoreExposed,
      minScoreExposed,
      maxScoreExposed,
    };
  }

  /**
   * 👤 Métricas de un usuario concreto
   */
  static async getUserFeedMetrics({
    userId,
    from,
    to,
    algoName = null,
    experimentKey = null,
    variant = null,
  } = {}) {
    if (!userId) throw new Error("userId requerido");

    const { start, end } = normalizeDateRange({ from, to });

    const base = {
      $or: [
        { timestamp: { $gte: start, $lte: end } },
        { createdAt: { $gte: start, $lte: end } },
      ],
      userId,
    };

    const algoFilter = {};
    if (algoName) algoFilter["meta.algoName"] = algoName;
    if (experimentKey) algoFilter["meta.experimentKey"] = experimentKey;
    if (variant) algoFilter["meta.variant"] = variant;

    // Reutilizamos la misma lógica que la global pero filtrando por usuario:
    const exposureMatch = {
      type: "FEED_EXPOSURE",
      ...base,
      ...algoFilter,
    };

    const {
      exposures,
      exposureItems,
      avgScoreExposed,
      minScoreExposed,
      maxScoreExposed,
    } = await this._aggregateExposureAndScore(exposureMatch);

    const interactionMatch = {
      type: "CONTENT_INTERACTION",
      ...base,
      ...algoFilter,
    };

    const interactionsAgg = await ActivityLog.aggregate([
      { $match: interactionMatch },
      {
        $group: {
          _id: "$meta.action",
          count: { $sum: 1 },
        },
      },
    ]);

    const interactionsByAction = {};
    for (const row of interactionsAgg) {
      const action = row._id || "unknown";
      interactionsByAction[action] = row.count || 0;
    }

    const totalInteractions = Object.values(interactionsByAction).reduce(
      (sum, v) => sum + v,
      0
    );

    const positiveActions = ["like", "comment", "share", "click"];
    const positiveInteractions = positiveActions.reduce(
      (sum, act) => sum + (interactionsByAction[act] || 0),
      0
    );

    const ctrGlobal =
      exposureItems > 0 ? totalInteractions / exposureItems : 0;
    const ctrPositive =
      exposureItems > 0 ? positiveInteractions / exposureItems : 0;

    const viewMatch = {
      type: "CONTENT_VIEW",
      ...base,
      ...algoFilter,
    };

    const [viewsAgg] = await ActivityLog.aggregate([
      { $match: viewMatch },
      {
        $group: {
          _id: null,
          totalViews: { $sum: 1 },
          totalDurationMs: { $sum: "$meta.durationMs" },
          fullyViewedCount: {
            $sum: {
              $cond: [{ $eq: ["$meta.fullyViewed", true] }, 1, 0],
            },
          },
        },
      },
    ]);

    const totalViews = viewsAgg?.totalViews || 0;
    const totalDurationMs = viewsAgg?.totalDurationMs || 0;
    const fullyViewedCount = viewsAgg?.fullyViewedCount || 0;

    const avgViewDurationMs =
      totalViews > 0 ? totalDurationMs / totalViews : 0;
    const fullViewRate =
      totalViews > 0 ? fullyViewedCount / totalViews : 0;

    return {
      window: { from: start, to: end },
      userId,
      algoName: algoName || null,
      experimentKey: experimentKey || null,
      variant: variant || null,

      exposures,
      exposureItems,

      interactionsByAction,
      totalInteractions,
      ctrGlobal,
      ctrPositive,

      totalViews,
      avgViewDurationMs,
      fullViewRate,

      // 🆕 stats de score de los items expuestos a ESTE usuario
      avgScoreExposed,
      minScoreExposed,
      maxScoreExposed,
    };
  }

  // ======================================================
  // 🧪 NUEVO: Métricas por experimento de feed (para controller)
  // ------------------------------------------------------
  // Devuelve:
  // {
  //   from, to, experimentKey, algoName,
  //   variants: [
  //     {
  //       variant,
  //       exposures,
  //       impressions,
  //       uniqueUsers,
  //       ctr,
  //       likeRate,
  //       commentRate,
  //       avgScoreExposed,
  //       minScoreExposed,
  //       maxScoreExposed,
  //       ...
  //     }
  //   ]
  // }
  // ======================================================
  static async getFeedExperimentMetrics({
    experimentKey = "feed_algo_v1",
    variants = ["topics_v1", "topics_explore_v1"],
    from,
    to,
    algoName = null,
  } = {}) {
    const { start, end } = normalizeDateRange({ from, to });

    const results = [];

    for (const variant of variants) {
      const metrics = await this.getGlobalFeedMetrics({
        from: start,
        to: end,
        algoName,
        experimentKey,
        variant,
      });

      // Distinct users expuestos a este experimento/variante
      const userFilter = {
        type: "FEED_EXPOSURE",
        $or: [
          { timestamp: { $gte: start, $lte: end } },
          { createdAt: { $gte: start, $lte: end } },
        ],
        "meta.experimentKey": experimentKey,
        "meta.variant": variant,
      };
      if (algoName) userFilter["meta.algoName"] = algoName;

      let uniqueUsersCount = 0;
      try {
        const distinctUsers = await ActivityLog.distinct(
          "userId",
          userFilter
        );
        uniqueUsersCount = Array.isArray(distinctUsers)
          ? distinctUsers.length
          : 0;
      } catch (err) {
        console.error(
          chalk.red(
            "⚠️ Error calculando uniqueUsers en getFeedExperimentMetrics:"
          ),
          err?.message || err
        );
      }

      const impressions = metrics.exposureItems || 0;
      const interactionsByAction = metrics.interactionsByAction || {};
      const likeCount = interactionsByAction.like || 0;
      const commentCount = interactionsByAction.comment || 0;

      const likeRate = impressions > 0 ? likeCount / impressions : 0;
      const commentRate = impressions > 0 ? commentCount / impressions : 0;

      results.push({
        variant,
        exposures: metrics.exposures || 0,
        impressions,
        uniqueUsers: uniqueUsersCount,
        ctr: metrics.ctrGlobal || 0,
        likeRate,
        commentRate,
        interactionsByAction,
        totalInteractions: metrics.totalInteractions || 0,
        totalViews: metrics.totalViews || 0,
        avgViewDurationMs: metrics.avgViewDurationMs || 0,
        fullViewRate: metrics.fullViewRate || 0,

        // 🆕 stats de score por variante en este experimento
        avgScoreExposed: metrics.avgScoreExposed || 0,
        minScoreExposed:
          typeof metrics.minScoreExposed === "number"
            ? metrics.minScoreExposed
            : null,
        maxScoreExposed:
          typeof metrics.maxScoreExposed === "number"
            ? metrics.maxScoreExposed
            : null,
      });
    }

    return {
      from: start,
      to: end,
      experimentKey,
      algoName: algoName || null,
      variants: results,
    };
  }

  // ======================================================
  // 👤 NUEVO: Métricas de consumo de contenido por usuario
  // ------------------------------------------------------
  // Alias ligero sobre getUserFeedMetrics, para no romper nada.
  // ======================================================
  static async getUserContentStats({
    userId,
    from,
    to,
    algoName = null,
    experimentKey = null,
    variant = null,
  } = {}) {
    return this.getUserFeedMetrics({
      userId,
      from,
      to,
      algoName,
      experimentKey,
      variant,
    });
  }
}

export default AnalyticsService;
// ======================================================
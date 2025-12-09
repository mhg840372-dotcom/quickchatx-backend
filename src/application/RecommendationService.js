// ======================================================
// 🎯 RecommendationService.js — feed personalizado por usuario
// v3 — Topics + VideoTopics + Following + Recencia + Engagement + Views
// ------------------------------------------------------
// ✅ Usa intereses por tópico (UserInterest)
// ✅ Usa following (autores que el usuario sigue)
// ✅ Usa recencia y engagement (likes + comments + views)
// ✅ Aprovecha videoTopics (IA de video) con un pequeño extra de peso
// ✅ Devuelve score final + breakdown (_algo) sin romper el frontend
// ======================================================

import { PostModel } from "../infrastructure/models/PostModel.js";
import UserModel from "../infrastructure/models/UserModel.js";
import { UserInterestService } from "./UserInterestService.js";

class RecommendationServiceClass {
  /**
   * Feed personalizado SOLO de posts del backend
   * - Usa intereses por tópico (UserInterest)
   * - Usa following (autores que el usuario sigue)
   * - Usa recencia y engagement
   * - Desde InteractionService.registerView, también aprende de views de VIDEO
   * - Usa videoTopics (IA de video) con más peso en topicScore
   *
   * Devuelve objetos JSON "public" de post con:
   *   - score / finalScore
   *   - _algo: { variant, topicScore, recencyScore, engagementScore, followScore, finalScore }
   */
  async getPersonalizedFeedForUser(
    userId,
    { limit = 20, algoVariant = "topics_v1" } = {}
  ) {
    if (!userId) return [];

    const userIdStr = userId.toString();

    // 0) Cargar usuario + following (si falla, seguimos sin following)
    let followingSet = new Set();
    try {
      const userDoc = await UserModel.findById(userIdStr)
        .select("_id following")
        .lean();
      if (userDoc && Array.isArray(userDoc.following)) {
        followingSet = new Set(
          userDoc.following.map((id) => id.toString())
        );
      }
    } catch (err) {
      console.warn(
        "⚠️ RecommendationService: no se pudo cargar following del usuario:",
        err?.message || err
      );
    }

    // 1) Cargar mapa de intereses del usuario
    const interestMap = await UserInterestService.getUserInterestsMap(
      userIdStr
    );

    // 2) Cargar posts candidatos (últimos 300 por fecha, sin soft-delete)
    const candidates = await PostModel.find({
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    })
      .sort({ createdAt: -1 })
      .limit(300)
      .exec();

    const now = Date.now();

    const scored = candidates.map((post) => {
      const topicScore = this.computeTopicScore(
        interestMap,
        post,
        algoVariant
      );
      const recencyScore = this.computeRecencyScore(
        now,
        post.createdAt
      );
      const engagementScore = this.computeEngagementScore(post);
      const followScore = this.computeFollowScore(post, followingSet);

      const finalScore = this.computeFinalScore(
        topicScore,
        recencyScore,
        engagementScore,
        followScore,
        algoVariant
      );

      return {
        post,
        finalScore,
        topicScore,
        recencyScore,
        engagementScore,
        followScore,
      };
    });

    // 3) Ordenar por score DESC (mejor primero)
    scored.sort((a, b) => b.finalScore - a.finalScore);

    // 4) Devolver posts ya serializados a JSON público + score
    return scored.slice(0, limit).map(
      ({
        post,
        finalScore,
        topicScore,
        recencyScore,
        engagementScore,
        followScore,
      }) => {
        const base =
          typeof post.toPublicJSON === "function"
            ? post.toPublicJSON()
            : post.toObject({ virtuals: true });

        // score / finalScore son usados por feedController para log/analytics
        return {
          ...base,
          score: finalScore,
          finalScore,
          _algo: {
            variant: algoVariant,
            topicScore,
            recencyScore,
            engagementScore,
            followScore,
            finalScore,
          },
        };
      }
    );
  }

  /* =====================================================
     📊 Topic score (afinidad por temas + videoTopics)
     - Usa topics (texto / tags generales)
     - Usa videoTopics (IA de video) con un pequeño extra de peso
     ===================================================== */
  computeTopicScore(interestMap, post, algoVariant = "topics_v1") {
    const topics = Array.isArray(post.topics) ? post.topics : [];
    const videoTopics = Array.isArray(post.videoTopics)
      ? post.videoTopics
      : [];

    if (!topics.length && !videoTopics.length) return 0;

    // Construimos un mapa topic -> { score, hasVideo }
    const topicMap = new Map();

    const pushTopics = (arr, isVideo) => {
      for (const raw of arr) {
        if (typeof raw !== "string") continue;
        const t = raw.trim().toLowerCase();
        if (!t) continue;

        const existing = topicMap.get(t) || {
          score: interestMap.get(t) ?? 0,
          hasVideo: false,
        };

        if (isVideo) existing.hasVideo = true;
        topicMap.set(t, existing);
      }
    };

    pushTopics(topics, false);
    pushTopics(videoTopics, true);

    if (topicMap.size === 0) return 0;

    let weightedSum = 0;
    let weightTotal = 0;

    for (const [, info] of topicMap.entries()) {
      const baseScore = info.score || 0;

      // Peso base por tema
      let weight = 1;

      // Si es tema detectado en video → pequeño boost
      if (info.hasVideo) {
        weight += 0.5; // temas de video pesan más
      }

      // En variante "explore" damos un pelín menos peso al tema
      if (algoVariant === "topics_explore_v1") {
        weight *= 0.9;
      }

      weightedSum += baseScore * weight;
      weightTotal += weight;
    }

    if (!weightTotal) return 0;

    const avg = weightedSum / weightTotal;

    // Normalizamos a [0,1] asumiendo SCORE_MAX ≈ 50 (ver UserInterestService)
    const normalized = Math.max(0, Math.min(1, avg / 50));
    return normalized;
  }

  /* =====================================================
     ⏱️ Recency score (más nuevo → más alto)
     ===================================================== */
  computeRecencyScore(now, createdAt) {
    if (!createdAt) return 0;
    const created = new Date(createdAt).getTime();
    if (!Number.isFinite(created)) return 0;

    const ageMs = now - created;
    const oneDay = 24 * 60 * 60 * 1000;

    const days = ageMs / oneDay;
    // 1.0 si es de hoy, decae linealmente hasta 0 a los 7 días
    const score = Math.max(0, 1 - days / 7);
    return score;
  }

  /* =====================================================
     🔥 Engagement score (likes + comentarios + views)
     - viewsCount viene de InteractionService.registerView (especialmente video)
     ===================================================== */
  computeEngagementScore(post) {
    const likesCount = Array.isArray(post.likes) ? post.likes.length : 0;
    const commentsCount =
      typeof post.commentsCount === "number"
        ? post.commentsCount
        : Array.isArray(post.comments)
        ? post.comments.length
        : 0;

    const viewsCount =
      typeof post.viewsCount === "number" ? post.viewsCount : 0;

    // Cap suave de views para que no se vaya a infinito
    const cappedViews = Math.min(viewsCount, 1000);

    // Fórmula simple:
    //  - like = 1 punto
    //  - comment = 2 puntos
    //  - cada 25 views ≈ 1 punto (hasta 40 puntos por views)
    const raw =
      likesCount + commentsCount * 2 + cappedViews / 25;

    // Ajustable según tu tráfico: posts muy fuertes se saturan en 1.0
    const maxExpected = 100;

    return Math.min(1, raw / maxExpected);
  }

  /* =====================================================
     🤝 Follow score (1 si sigues al autor, 0 si no)
     ===================================================== */
  computeFollowScore(post, followingSet) {
    if (!followingSet || followingSet.size === 0) return 0;

    const authorId =
      post.authorId ||
      post.userId ||
      post.author?._id ||
      post.createdBy?._id ||
      post.createdBy ||
      null;

    if (!authorId) return 0;

    const key = authorId.toString();
    return followingSet.has(key) ? 1 : 0;
  }

  /* =====================================================
     🧮 Score final — combina temas + recencia + engagement + following
     ===================================================== */
  computeFinalScore(
    topicScore,
    recencyScore,
    engagementScore,
    followScore = 0,
    algoVariant = "topics_v1"
  ) {
    // Pesos por defecto: centrado en temas + follow
    let alpha = 0.45; // afinidad temas
    let beta = 0.25; // recencia
    let gamma = 0.15; // engagement
    let delta = 0.15; // follow (autor que sigues)

    // Variante "explore": menos peso a tema, más a recencia/engagement
    if (algoVariant === "topics_explore_v1") {
      alpha = 0.35;
      beta = 0.35;
      gamma = 0.2;
      delta = 0.1;
    }

    return (
      alpha * topicScore +
      beta * recencyScore +
      gamma * engagementScore +
      delta * followScore
    );
  }
}

export const RecommendationService = new RecommendationServiceClass();
export default RecommendationService;
/* ======================================================
   🔧 Singleton
   ====================================================== */

// ======================================================
// 🧠 UserInterestService.js — motor de gustos por tema v2
// ------------------------------------------------------
// ✅ Registra intereses por interacción con posts
// ✅ Soporta "seguir autor" con dos modos:
//    - registerAuthorFollow({ userId, authorTopics })
//    - registerAuthorFollow({ userId, authorId, maxPosts? })
// ✅ Si falla la inferencia de topics NO rompe el flujo
// ======================================================

import { UserInterestModel } from "../infrastructure/models/UserInterestModel.js";
import { PostModel } from "../infrastructure/models/PostModel.js";

const SCORE_MIN = -10;
const SCORE_MAX = 50;

const INTEREST_WEIGHTS = {
  like: 2,
  dislike: -2,
  comment: 3,
  // reservado para futuro:
  view: 0.5,
  long_view: 1,
  share: 4,
  hide: -3,
  report: -5,
  // seguir a un autor cuyos posts tienen ciertos temas
  follow_author: 3,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class UserInterestServiceClass {
  /**
   * Registra una interacción con un POST concreto (like, view, comment, etc.).
   * - Usa post.topics (array de strings)
   * - Suma un delta definido en INTEREST_WEIGHTS[type]
   */
  async registerPostInteraction({ userId, post, type }) {
    if (!userId || !post) return;

    const topics = Array.isArray(post.topics) ? post.topics : [];
    if (!topics.length) return;

    const weight = INTEREST_WEIGHTS[type];
    if (!weight) return;

    await Promise.all(
      topics.map((rawTopic) => {
        const topic =
          typeof rawTopic === "string" ? rawTopic.trim().toLowerCase() : "";
        if (!topic) return null;

        return this.incrementTopicScore(userId.toString(), topic, weight);
      })
    );
  }

  /**
   * Registrar que un usuario sigue a un autor.
   *
   * MODO 1 (recomendado):
   *   registerAuthorFollow({ userId, authorTopics: ["futbol", "nba", ...] })
   *
   * MODO 2 (auto-inferencia):
   *   registerAuthorFollow({ userId, authorId })
   *   → busca posts recientes de ese autor y saca los topics más frecuentes.
   */
  async registerAuthorFollow({ userId, authorTopics, authorId, maxPosts = 50 }) {
    if (!userId) return;

    let topics = Array.isArray(authorTopics) ? authorTopics : [];

    // Si no nos pasan topics pero sí authorId, intentamos inferirlos desde PostModel
    if ((!topics || !topics.length) && authorId) {
      try {
        if (!PostModel || typeof PostModel.find !== "function") {
          console.warn(
            "⚠️ PostModel.find no disponible en registerAuthorFollow; saltando inferencia."
          );
        } else {
          const posts = await PostModel.find({
            $or: [
              { authorId: authorId.toString() },
              { userId: authorId.toString() },
              { createdBy: authorId.toString() },
            ],
          })
            .sort({ createdAt: -1 })
            .limit(maxPosts)
            .select("topics")
            .lean();

          const topicSet = new Set();

          for (const p of posts || []) {
            if (Array.isArray(p.topics)) {
              for (const raw of p.topics) {
                if (typeof raw === "string") {
                  const t = raw.trim().toLowerCase();
                  if (t) topicSet.add(t);
                }
              }
            }
          }

          topics = Array.from(topicSet);
        }
      } catch (err) {
        console.warn(
          "⚠️ Error inferiendo topics en registerAuthorFollow:",
          err?.message || err
        );
        topics = [];
      }
    }

    // Si después de todo no hay topics, no hacemos nada (pero no rompemos)
    if (!topics || !topics.length) return;

    const weight = INTEREST_WEIGHTS["follow_author"];
    if (!weight) return;

    await Promise.all(
      topics.map((rawTopic) => {
        const topic =
          typeof rawTopic === "string" ? rawTopic.trim().toLowerCase() : "";
        if (!topic) return null;

        return this.incrementTopicScore(userId.toString(), topic, weight);
      })
    );
  }

  async incrementTopicScore(userId, topic, delta) {
    const now = new Date();

    const doc = await UserInterestModel.findOneAndUpdate(
      { userId, topic },
      {
        $inc: { score: delta },
        $set: { updatedAt: now },
      },
      { new: true, upsert: true }
    );

    // clamp en segundo paso para no pelearse con $inc
    if (doc.score < SCORE_MIN || doc.score > SCORE_MAX) {
      doc.score = clamp(doc.score, SCORE_MIN, SCORE_MAX);
      await doc.save();
    }

    return doc;
  }

  /**
   * Devuelve un Map(topic => score) para un usuario.
   */
  async getUserInterestsMap(userId) {
    if (!userId) return new Map();

    const docs = await UserInterestModel.find({ userId }).lean();
    const map = new Map();
    for (const d of docs) {
      map.set(d.topic, d.score);
    }
    return map;
  }
}

export const UserInterestService = new UserInterestServiceClass();
export default UserInterestService;

// src/infrastructure/repositories/UserInterestRepository.js
const UserInterestModel = require("../models/UserInterestModel");

const SCORE_MIN = -10;
const SCORE_MAX = 20;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class UserInterestRepository {
  async getByUser(userId) {
    return UserInterestModel.find({ userId }).lean();
  }

  async getMapByUser(userId) {
    const docs = await this.getByUser(userId);
    const map = new Map();
    docs.forEach((doc) => {
      map.set(doc.topic, doc);
    });
    return map;
  }

  async incrementScore(userId, topic, delta) {
    const now = new Date();

    const doc =
      (await UserInterestModel.findOneAndUpdate(
        { userId, topic },
        {
          $inc: { score: delta },
          $set: { updatedAt: now },
        },
        { new: true, upsert: true }
      )) || (await UserInterestModel.findOne({ userId, topic }));

    if (!doc) return null;

    if (doc.score < SCORE_MIN || doc.score > SCORE_MAX) {
      doc.score = clamp(doc.score, SCORE_MIN, SCORE_MAX);
      await doc.save();
    }

    return doc;
  }
}

module.exports = new UserInterestRepository();

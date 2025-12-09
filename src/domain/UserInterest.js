// src/domain/UserInterest.js
class UserInterest {
  constructor({ id, userId, topic, score, updatedAt }) {
    this.id = id;
    this.userId = userId;
    this.topic = topic;  // 'deportes', 'musica', ...
    this.score = score;  // número (puede ser negativo)
    this.updatedAt = updatedAt;
  }
}

module.exports = UserInterest;

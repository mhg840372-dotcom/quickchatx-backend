// ======================================================
// 📊 src/application/InteractionWeights.js
// ------------------------------------------------------
// Pesos de interés para interacciones de contenido.
// Compartido por varios servicios (IA, analytics, etc.).
// ======================================================

const INTEREST_WEIGHTS = {
  // 👁️ Visualizaciones (video)
  view: 0.5,
  long_view: 1.0,

  // ❤️ Reacciones
  like: 2.0,
  dislike: -2.0,

  // 💬 Participación
  comment: 3.0,
  share: 4.0,

  // 🚫 Señales negativas
  hide: -3.0,
  report: -5.0,

  // 🤝 Seguir a un autor (se extrapola a sus tópicos)
  follow_author: 3.0,
};

module.exports = {
  INTEREST_WEIGHTS,
};

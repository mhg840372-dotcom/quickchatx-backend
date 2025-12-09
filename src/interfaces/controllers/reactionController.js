// ======================================================
// 💓 reactionController.js
// ✅ Controlador de reacciones en publicaciones
// 🚀 QuickChatX v3.9.4 — REST + Seguridad JWT + Logging
// ======================================================

import chalk from "chalk";
import ReactionService from "../../application/ReactionService.js"; // ⬅️ Importación corregida

/**
 * 🎯 Controlador de Reacciones
 * - Interactúa con ReactionService
 * - Protegido por middleware JWT
 * - Incluye logs detallados con chalk
 */
export const reactionController = {
  /**
   * ❤️ Alternar "like" en una publicación
   * - Requiere autenticación JWT
   * - Usa ReactionService.toggleLike()
   */
  async toggleLike(req, res) {
    try {
      const { id: postId } = req.params;
      const userId = req.user?.id;

      if (!postId || !userId) {
        console.warn(chalk.yellow("⚠️ Falta postId o userId en toggleLike"));
        return res.status(400).json({
          success: false,
          message: "Faltan parámetros obligatorios (postId o userId)",
        });
      }

      const result = await ReactionService.toggleLike(postId, userId);

      console.log(
        chalk.greenBright(
          `💓 [ReactionController] Usuario ${userId} ${
            result.liked ? "dio like" : "quitó like"
          } en publicación ${postId}`
        )
      );

      return res.status(200).json({
        success: true,
        message: result.liked ? "Like agregado" : "Like eliminado",
        data: result,
      });
    } catch (err) {
      console.error(chalk.red("❌ Error en ReactionController.toggleLike:"), err);
      return res.status(500).json({
        success: false,
        message: "Error al procesar la reacción",
        error: err.message,
      });
    }
  },

  /**
   * 🔢 Obtener número total de likes en un post
   */
  async getLikeCount(req, res) {
    try {
      const { id: postId } = req.params;
      if (!postId) {
        console.warn(chalk.yellow("⚠️ Falta parámetro postId en getLikeCount"));
        return res.status(400).json({
          success: false,
          message: "Falta el parámetro postId",
        });
      }

      const totalLikes = await ReactionService.getLikeCount(postId);

      console.log(
        chalk.blueBright(
          `📊 [ReactionController] Likes en post ${postId}: ${totalLikes}`
        )
      );

      return res.status(200).json({
        success: true,
        data: { totalLikes },
      });
    } catch (err) {
      console.error(chalk.red("⚠️ Error en ReactionController.getLikeCount:"), err);
      return res.status(500).json({
        success: false,
        message: "Error al obtener el contador de likes",
        error: err.message,
      });
    }
  },

  /**
   * 🧍‍♂️ Verificar si el usuario autenticado ya dio like
   */
  async hasUserLiked(req, res) {
    try {
      const { id: postId } = req.params;
      const userId = req.user?.id;

      if (!postId || !userId) {
        console.warn(chalk.yellow("⚠️ Falta postId o userId en hasUserLiked"));
        return res.status(400).json({
          success: false,
          message: "Faltan parámetros obligatorios (postId o userId)",
        });
      }

      const liked = await ReactionService.hasUserLiked(postId, userId);

      console.log(
        chalk.magentaBright(
          `👤 [ReactionController] Usuario ${userId} ${
            liked ? "ya dio like" : "no ha dado like"
          } en post ${postId}`
        )
      );

      return res.status(200).json({
        success: true,
        data: { liked },
      });
    } catch (err) {
      console.error(chalk.red("⚠️ Error en ReactionController.hasUserLiked:"), err);
      return res.status(500).json({
        success: false,
        message: "Error al verificar el like del usuario",
        error: err.message,
      });
    }
  },
};

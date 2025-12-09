// ======================================================
// 📁 src/interfaces/controllers/interaction.js
// ✅ Interacciones SOLO en POSTS
// ======================================================

import { PostService } from "../../application/PostService.js";

const postService = new PostService();

// ❤️ Like a comentario de un post
export const likePostComment = async (req, res) => {
  try {
    const { postId, commentIndex } = req.body;
    const userId = req.user?.id;

    if (!postId || commentIndex === undefined) {
      return res.status(400).json({ success: false, error: "Faltan parámetros" });
    }

    const updated = await postService.likeComment(postId, userId, commentIndex);

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("❌ Error en likePostComment:", err);
    return res
      .status(500)
      .json({ success: false, error: err?.message || "Error interno" });
  }
};

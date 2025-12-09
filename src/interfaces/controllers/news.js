// ======================================================
// 🧭 src/interfaces/controllers/NewsController.js
// ======================================================

import { NewsService } from "../../application/NewsService.js";
import chalk from "chalk";

// ... getNews, addNews, updateNews, getNewsById, deleteNews ...

/* ======================================================
   ❤️ Like / Unlike noticia
====================================================== */
export const toggleNewsLike = async (req, res) => {
  try {
    const user = req.user || {};
    const userId = user.id || user._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "No autenticado",
      });
    }

    const { id } = req.params;

    const data = await NewsService.toggleLike({
      newsId: id,
      userId,
      value: 1,
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error(
      chalk.red("❌ Error al hacer like en noticia:"),
      err
    );
    res.status(500).json({
      success: false,
      error: "Error al procesar el like de la noticia",
    });
  }
};

// ======================================================
// 🧩 QuickChatX v6.9.1 — NewsController listo
// ======================================================

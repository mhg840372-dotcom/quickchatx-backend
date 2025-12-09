// ======================================================
// 🧭 src/interfaces/routes/newsRoutes.js
// ✅ QuickChatX v8.4 — Noticias desde MongoDB + Redis Cache + Admin Secure Refresh
// ======================================================

import express from "express";
import chalk from "chalk";
import NewsService from "../../application/NewsService.js";
import { initRedis } from "../../infrastructure/RedisProvider.js";
import { verifyAdminToken } from "../middlewares/AdminAuthMiddleware.js";

const CACHE_TTL = 120; // 🕒 2 min de cache

export default function newsRoutes() {
  const router = express.Router();

  // ======================================================
  // 🧠 Helpers de cache Redis
  // ======================================================
  async function getCache(key) {
    try {
      const redis = await initRedis();
      const cached = await redis.get(key);
      if (cached) {
        console.log(chalk.gray(`💾 Cache HIT → ${key}`));
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn(chalk.yellow("⚠️ Redis GET falló"), err.message);
    }
    return null;
  }

  async function setCache(key, data, ttl = CACHE_TTL) {
    try {
      const redis = await initRedis();
      await redis.set(key, JSON.stringify(data), "EX", ttl);
      console.log(chalk.cyan(`📦 Cache SET → ${key}`));
    } catch (err) {
      console.warn(chalk.yellow("⚠️ Redis SET falló"), err.message);
    }
  }

  async function clearNewsCache() {
    try {
      const redis = await initRedis();
      let cursor = "0";
      let deleted = 0;
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", "news:*");
        if (keys.length) {
          await redis.del(keys);
          deleted += keys.length;
        }
        cursor = next;
      } while (cursor !== "0");
      if (deleted > 0)
        console.log(
          chalk.magenta(`🧹 Cache de noticias limpiado (${deleted} claves)`)
        );
    } catch (err) {
      console.warn(chalk.yellow("⚠️ Limpieza de cache falló"), err.message);
    }
  }

  // ======================================================
  // 🔹 Endpoint de control: forzar actualización inmediata (solo admin)
  // ======================================================
  router.post("/admin/refresh", verifyAdminToken, async (req, res) => {
    try {
      console.log(
        chalk.blue("🔄 Forzando actualización manual de noticias (admin)...")
      );
      const updated = await NewsService.fetchAndSave();
      await clearNewsCache();

      res.json({
        success: true,
        message: `Noticias actualizadas manualmente (${updated.length} nuevas)`,
      });
    } catch (err) {
      console.error(
        chalk.red("❌ Error actualizando noticias manualmente:"),
        err
      );
      res
        .status(500)
        .json({ success: false, error: "Error actualizando noticias" });
    }
  });

  // ======================================================
  // 🔹 Obtener noticias (paginadas desde Mongo + cache)
  // ======================================================
  router.get("/", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);
      const skip = parseInt(req.query.skip) || 0;
      const key = `news:list:${limit}:${skip}`;

      const cached = await getCache(key);
      if (cached)
        return res.json({ success: true, cached: true, data: cached });

      const news = await NewsService.getLatest({ limit, skip });
      console.log(
        chalk.cyan(`📰 /news → ${news.length} items (limit=${limit}, skip=${skip})`)
      );
      await setCache(key, news);

      res.json({ success: true, cached: false, data: news });
    } catch (err) {
      console.error(chalk.red("❌ Error obteniendo noticias:"), err);
      res
        .status(500)
        .json({ success: false, error: "Error al obtener noticias" });
    }
  });

  // ======================================================
  // 🔹 Endpoint rápido para obtener las últimas N noticias
  // ======================================================
  const handleLatest = async (req, res) => {
    try {
      const rawCount = req.params.count ?? req.query.count;
      const count = Math.min(parseInt(rawCount) || 10, 50);
      const key = `news:latest:${count}`;

      const cached = await getCache(key);
      if (cached)
        return res.json({ success: true, cached: true, data: cached });

      const latest = await NewsService.getLatest({ limit: count, skip: 0 });
      console.log(chalk.cyan(`📰 /news/latest → ${latest.length} items`));
      await setCache(key, latest, 60);

      res.json({ success: true, cached: false, data: latest });
    } catch (err) {
      console.error(chalk.red("❌ Error obteniendo últimas noticias:"), err);
      res.status(500).json({
        success: false,
        error: "Error obteniendo últimas noticias",
      });
    }
  };

  router.get("/latest", handleLatest);
  router.get("/latest/:count", handleLatest);

  // ======================================================
  // 🔹 Obtener noticia por ID (cacheado)
  // ======================================================
  router.get("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const key = `news:id:${id}`;

      const cached = await getCache(key);
      if (cached)
        return res.json({ success: true, cached: true, data: cached });

      const newsItem = await NewsService.getById(id);
      if (!newsItem)
        return res
          .status(404)
          .json({ success: false, error: "Noticia no encontrada" });

      await setCache(key, newsItem);
      res.json({ success: true, cached: false, data: newsItem });
    } catch (err) {
      console.error(chalk.red("❌ Error obteniendo noticia por ID:"), err);
      res
        .status(500)
        .json({ success: false, error: "Error obteniendo noticia" });
    }
  });

  // ======================================================
  // ❤️ Like noticia (nota: la app usa /api/news/like/:id definido en ExpressApp)
// ======================================================
  router.post("/like/:id", async (req, res) => {
    try {
      const { id: newsId } = req.params;
      const user = req.user || {};
      const userId = user.id || user._id;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, error: "No autenticado" });
      }

      const value =
        typeof req.body?.value === "number" ? req.body.value : 1;

      const result = await NewsService.toggleLike({
        newsId,
        userId,
        value,
      });

      try {
        const redis = await initRedis();
        await redis.del(`news:id:${newsId}`);
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ No se pudo limpiar cache de noticia tras like:"),
          err.message
        );
      }

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error(chalk.red("❌ Error registrando like de noticia:"), err);
      return res.status(500).json({
        success: false,
        error: "Error al registrar el like de la noticia",
      });
    }
  });

  // ======================================================
  // 🔹 Crear o actualizar noticia manual (modo admin)
  // ======================================================
  router.post("/", verifyAdminToken, async (req, res) => {
    try {
      const { title, url } = req.body;
      if (!title || !url)
        return res.status(400).json({
          success: false,
          error: "Faltan campos obligatorios: título o URL",
        });

      const newsItem = await NewsService.createOrUpdate(req.body);
      await setCache(`news:id:${newsItem._id}`, newsItem);
      await clearNewsCache();

      res.json({ success: true, data: newsItem });
    } catch (err) {
      console.error(chalk.red("❌ Error creando noticia:"), err);
      res
        .status(500)
        .json({ success: false, error: "Error creando noticia" });
    }
  });

  // ======================================================
  // 🔹 Eliminar noticia (modo admin)
  // ======================================================
  router.delete("/:id", verifyAdminToken, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await NewsService.deleteById(id);

      if (!deleted)
        return res.status(404).json({
          success: false,
          error: "Noticia no encontrada o ya eliminada",
        });

      const redis = await initRedis();
      await redis.del(`news:id:${id}`);
      await clearNewsCache();

      res.json({
        success: true,
        message: "Noticia eliminada correctamente",
      });
    } catch (err) {
      console.error(chalk.red("❌ Error eliminando noticia:"), err);
      res
        .status(500)
        .json({ success: false, error: "Error eliminando noticia" });
    }
  });

  return router;
}

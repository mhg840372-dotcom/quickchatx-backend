import express from "express";
import { getConnectedUsers } from "../infrastructure/services/socketMetrics.js";
import chalk from "chalk";

const router = express.Router();

/* ======================================================
   📊 GET /admin/socket-metrics
   - Retorna lista de usuarios conectados vía WebSocket
====================================================== */
router.get("/socket-metrics", async (req, res) => {
  try {
    // ⚠️ Aquí puedes agregar verificación de admin con JWT si la tienes
    const users = await getConnectedUsers();

    console.log(chalk.magenta(`📡 Consultadas ${users.length} conexiones activas`));

    res.status(200).json({
      status: "ok",
      count: users.length,
      users,
    });
  } catch (err) {
    console.error(chalk.red("❌ Error en /admin/socket-metrics:"), err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

export default router;

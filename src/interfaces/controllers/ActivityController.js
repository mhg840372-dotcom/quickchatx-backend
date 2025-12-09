// ======================================================
// 📄 ActivityController.js — v9.2 PRO (2025)
// ✅ Devuelve actividad reciente del usuario autenticado
// ✅ Integra Mongo + Redis + WS + fallback
// ======================================================

import { ActivityLog } from "../../domain/ActivityLog.js";
import chalk from "chalk";

export const ActivityController = {
  /* ======================================================
     📜 GET /api/activity/me — Actividad del usuario actual
  ====================================================== */
  async getMyActivity(req, res) {
    try {
      const user = req.user;
      if (!user)
        return res.status(401).json({
          success: false,
          error: "No autenticado",
        });

      const identifier = user.id || user.email;
      const logs = await ActivityLog.findRecent(identifier, 30);

      return res.json({
        success: true,
        count: logs.length,
        data: logs,
      });
    } catch (err) {
      console.error(chalk.red("❌ [ActivityController.getMyActivity]"), err);
      return res.status(500).json({
        success: false,
        error: "Error al obtener actividad del usuario",
      });
    }
  },

  /* ======================================================
     📜 GET /api/activity/:id — Actividad de otro usuario
     (Solo para administradores)
  ====================================================== */
  async getActivityByUser(req, res) {
    try {
      if (req.user?.role !== "admin")
        return res.status(403).json({
          success: false,
          error: "Acceso denegado",
        });

      const { id } = req.params;
      const logs = await ActivityLog.findRecent(id, 50);

      return res.json({
        success: true,
        count: logs.length,
        data: logs,
      });
    } catch (err) {
      console.error(chalk.red("❌ [ActivityController.getActivityByUser]"), err);
      return res.status(500).json({
        success: false,
        error: "Error al obtener actividad del usuario",
      });
    }
  },
};

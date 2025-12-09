// src/interfaces/controllers/device.js
import { saveDeviceInfo } from "../../application/DeviceService.js";

/**
 * Controlador para guardar información del dispositivo.
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 */
export async function postDeviceInfo(req, res) {
  try {
    const userId = req.user?.id || null; // req.user viene del middleware de autenticación
    const payload = req.body;

    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ ok: false, error: "Payload inválido" });
    }

    const device = await saveDeviceInfo(payload, userId);

    return res.status(201).json({
      ok: true,
      message: "Información del dispositivo guardada correctamente",
      id: device._id,
    });
  } catch (err) {
    console.error("❌ Error guardando device info:", err);
    return res.status(500).json({
      ok: false,
      error: "Ocurrió un error al guardar la información del dispositivo",
    });
  }
}
// -------------------------------
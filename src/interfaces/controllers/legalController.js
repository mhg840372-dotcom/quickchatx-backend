// ======================================================
// ⚖️ legalController.js — Controlador de Términos
// ======================================================

import Legal from "../models/LegalModel.js";

// ✅ Obtener los términos activos
export const getTerms = async (req, res) => {
  try {
    const latest = await Legal.findOne().sort({ lastUpdated: -1 });
    if (!latest)
      return res.status(404).json({
        success: false,
        error: "No hay términos registrados en la base de datos.",
      });

    res.status(200).json({
      success: true,
      content: latest.content,
      version: latest.version,
      updatedAt: latest.lastUpdated,
    });
  } catch (err) {
    console.error("❌ Error al obtener términos:", err);
    res
      .status(500)
      .json({ success: false, error: "Error interno al obtener los términos." });
  }
};

// ✅ Crear o actualizar los términos
export const upsertTerms = async (req, res) => {
  try {
    const { content, version } = req.body;

    if (!content)
      return res
        .status(400)
        .json({ success: false, error: "El campo 'content' es obligatorio." });

    const legalDoc = new Legal({
      content,
      version: version || "1.0.0",
      lastUpdated: new Date(),
    });

    await legalDoc.save();
    res.status(201).json({ success: true, message: "Términos actualizados." });
  } catch (err) {
    console.error("❌ Error al guardar términos:", err);
    res.status(500).json({ success: false, error: "No se pudo guardar." });
  }
};

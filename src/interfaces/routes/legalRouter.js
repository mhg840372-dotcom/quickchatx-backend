// ======================================================
// ⚖️ legalRouter.js — Términos y Condiciones (dinámico)
// ======================================================

import express from "express";
const router = express.Router();

// Ejemplo: esto podría venir de MongoDB, un archivo, o CMS
const termsContent = `
# Términos y Condiciones de QuickChatX

## 1. Aceptación del servicio
Al crear una cuenta en QuickChatX, aceptas cumplir nuestras normas...

## 2. Conductas prohibidas
- Acoso o amenazas
- Suplantación de identidad
- Publicar contenido ilegal o violento
- Spam o enlaces maliciosos

## 3. Privacidad
Tu información se utiliza exclusivamente para ofrecerte el servicio...

## 4. Sanciones
QuickChatX puede suspender cuentas que incumplan las normas.
`;

router.get("/terms", async (req, res) => {
  try {
    res.status(200).json({ success: true, content: termsContent });
  } catch (err) {
    console.error("Error al cargar términos:", err);
    res.status(500).json({ success: false, error: "No se pudieron obtener los términos." });
  }
});

export default router;

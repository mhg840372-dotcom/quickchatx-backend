import mongoose from "mongoose";

// ======================================================
// 🧾 Esquema FinanceRecord — Histórico financiero
// ======================================================
const FinanceSchema = new mongoose.Schema(
  {
    ticker: { type: String, index: true }, // El símbolo del ticker (ej. "AAPL:NASDAQ")
    title: { type: String },               // Título de la acción o moneda
    price: { type: Number },               // Precio actual
    change: { type: Number },              // Cambio absoluto en el precio
    changePercent: { type: String },       // Porcentaje de cambio (ej. "1.23%")
    currency: { type: String },            // Moneda (ej. "USD")
    marketCap: { type: String },           // Capitalización de mercado (ej. "2.5B")
    timestamp: { type: Date, default: Date.now }, // Fecha del registro
    source: { type: String, default: "SerpApi" },  // Fuente de los datos (ej. "SerpApi")
    raw: { type: Object },                 // Datos crudos provenientes de SerpApi
  },
  { timestamps: true, collection: "finance_records" } // Habilita timestamps (createdAt, updatedAt)
);

// ======================================================
// ✅ Modelo de FinanceRecord
// ======================================================
export const FinanceRecord = mongoose.models.FinanceRecord ||
  mongoose.model("FinanceRecord", FinanceSchema);

// ======================================================
// 💡 Notas de versión — QuickChatX v8.8.0
// ------------------------------------------------------
// - Modelo para almacenar los registros financieros
// - Optimizado para la consulta y almacenamiento eficiente
// - Conexión a MongoDB para persistencia de datos históricos
// ======================================================

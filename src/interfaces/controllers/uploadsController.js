import { UploadService } from "../../application/UploadService.js";
import { UPLOADS_BASE_DIR } from "../../infrastructure/uploadMiddleware.js";

// EL MISMO DIRECTORIO QUE USA ExpressApp
const UPLOAD_DIR = UPLOADS_BASE_DIR;

export class UploadController {
  static async uploadFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No se envió ningún archivo" });
      }

      const user = req.user;
      const saved = await UploadService.saveFile(req.file, user, UPLOAD_DIR);

      return res.status(201).json({
        success: true,
        file: saved,
      });
    } catch (err) {
      console.error("❌ UploadController.uploadFile:", err);
      return res.status(500).json({ error: "Error al subir archivo" });
    }
  }

  static async getMyFiles(req, res) {
    try {
      const userId = req.user._id;
      const uploads = await UploadService.getUserUploads(userId);

      return res.json({ success: true, files: uploads });
    } catch (err) {
      console.error("❌ getMyFiles:", err);
      return res.status(500).json({ error: "Error al obtener archivos" });
    }
  }

  static async deleteFile(req, res) {
    try {
      const uploadId = req.params.id;
      const deleted = await UploadService.deleteFile(uploadId, UPLOAD_DIR);

      if (!deleted) {
        return res.status(404).json({ error: "Archivo no encontrado" });
      }

      return res.json({
        success: true,
        message: "Archivo eliminado correctamente",
      });
    } catch (err) {
      console.error("❌ deleteFile:", err);
      return res.status(500).json({ error: "Error al eliminar archivo" });
    }
  }
}

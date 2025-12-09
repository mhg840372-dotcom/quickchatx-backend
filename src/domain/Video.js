// ======================================================
// 📌 domain/Video.js — Entidad de Video (dominio)
// ------------------------------------------------------
// ✔ Envuelve el modelo Mongoose de infraestructura
// ✔ API mínima y segura (create/find/findById/updateOne)
// ✔ No rompe nada existente: nadie lo importa aún
// ✔ Listo para usar en VideoProcessingService / servicios futuros
// ======================================================

import { VideoModel } from "../infrastructure/models/Video.js";

class Video {
  /**
   * Crea un nuevo video en la BD.
   * @param {Object} data
   * @returns {Promise<any>}
   */
  static async create(data) {
    return VideoModel.create(data);
  }

  /**
   * Busca un video por ID.
   * @param {string} id
   * @returns {Promise<any|null>}
   */
  static async findById(id) {
    return VideoModel.findById(id);
  }

  /**
   * Busca una lista de videos con un filtro.
   * @param {Object} filter
   * @returns {Promise<any[]>}
   */
  static async find(filter = {}) {
    return VideoModel.find(filter);
  }

  /**
   * Actualiza un video.
   * @param {Object} filter
   * @param {Object} update
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  static async updateOne(filter, update, options = {}) {
    return VideoModel.updateOne(filter, update, options);
  }

  /**
   * Elimina (hard delete) un video si algún día lo necesitas.
   * No se usa por defecto.
   */
  static async deleteOne(filter) {
    return VideoModel.deleteOne(filter);
  }
}

export { Video, VideoModel };
export default Video;

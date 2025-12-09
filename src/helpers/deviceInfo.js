// src/helpers/deviceInfo.js
import DeviceInfo from "../../domain/DeviceInfo.js";
import fetch from "node-fetch";
import { UAParser } from "ua-parser-js";

export async function captureDeviceInfoPro(userId, req) {
  try {
    // Obtener IP
    const ip =
      (req.headers["x-forwarded-for"]?.split(",")[0].trim()) ||
      req.connection?.remoteAddress ||
      req.ip ||
      "unknown";

    // Geolocalización
    let geo = null;
    try {
      const response = await fetch(
        `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,query`
      );
      const data = await response.json();
      if (data.status === "success") {
        geo = {
          ip: data.query,
          country: data.country,
          region: data.regionName,
          city: data.city,
          lat: data.lat,
          lon: data.lon,
        };
      }
    } catch (err) {
      console.warn("❌ Geo lookup failed", err);
    }

    // Analizar user-agent
    const ua = new UAParser(req.headers["user-agent"] || "");
    const deviceType = ua.device.type || "desktop";
    const os = ua.os.name ? `${ua.os.name} ${ua.os.version || ""}`.trim() : "unknown";
    const browser = ua.browser.name ? `${ua.browser.name} ${ua.browser.version || ""}`.trim() : "unknown";

    const deviceData = {
      userId,
      deviceName: req.headers["user-agent"] || "unknown",
      ipLocal: ip,
      geolocation: geo,
      deviceType,
      os,
      browser,
      timestamp: new Date(),
    };

    // Revisar si ya existe dispositivo con misma IP o user-agent
    const existingDevice = await DeviceInfo.findOne({
      userId,
      $or: [{ deviceName: deviceData.deviceName }, { ipLocal: deviceData.ipLocal }],
    });

    if (existingDevice) {
      await DeviceInfo.updateOne(
        { _id: existingDevice._id },
        { $set: deviceData }
      );
    } else {
      await DeviceInfo.create(deviceData);
    }
  } catch (err) {
    console.error("❌ Error capturando device info", err);
  }
}
// -------------------------------
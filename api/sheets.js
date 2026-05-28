import {
  fetchSheetValues,
  getGoogleConfig,
  isValidVendorId,
  sendJson,
} from "./lib/google-sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Método no permitido" });
  }

  if (!getGoogleConfig()) {
    return sendJson(res, 503, { error: "Sistema no configurado" });
  }

  const vendorId = req.headers["x-ag-vendor"];
  if (!isValidVendorId(vendorId)) {
    return sendJson(res, 401, { error: "Sesión inválida" });
  }

  const range = req.query.range;
  if (!range) {
    return sendJson(res, 400, { error: "Falta parámetro range" });
  }

  try {
    const data = await fetchSheetValues(range);
    return sendJson(res, 200, { values: data.values || [] });
  } catch (e) {
    return sendJson(res, e.status || 500, { error: e.message || "Error al leer Sheet" });
  }
}

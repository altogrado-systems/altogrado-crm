import {
  fetchSheetValues,
  getGoogleConfig,
  isValidVendorId,
  sendJson,
} from "../lib/google-sheets.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Método no permitido" });
  }

  if (!getGoogleConfig()) {
    return sendJson(res, 503, { error: "Sistema no configurado" });
  }

  const { id_vendedor, pin } = req.body || {};
  if (!isValidVendorId(id_vendedor) || !pin) {
    return sendJson(res, 400, { error: "Credenciales inválidas" });
  }

  try {
    const data = await fetchSheetValues("Vendedores!A2:K20");
    const vendedor = (data.values || []).find((row) => row[0] === id_vendedor);
    if (!vendedor) {
      return sendJson(res, 401, { error: "ID no encontrado" });
    }

    const pinEsperado = String(vendedor[10] || "").replace(".0", "").trim();
    if (String(pin).trim() !== pinEsperado) {
      return sendJson(res, 401, { error: "PIN incorrecto" });
    }

    return sendJson(res, 200, {
      id_vendedor: vendedor[0],
      nombre: vendedor[1] || "",
      email: vendedor[3] || "",
    });
  } catch (e) {
    return sendJson(res, e.status || 500, { error: e.message || "Error de conexión" });
  }
}

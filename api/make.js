import {
  isValidVendorId,
  normalizeVendorId,
  sendJson,
} from "./lib/google-sheets.js";

const TARGETS = {
  e5: "MAKE_WEBHOOK_E5",
  e7: "MAKE_WEBHOOK_E7",
  result: "MAKE_WEBHOOK_RESULT",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Método no permitido" });
  }

  const vendorId = normalizeVendorId(req.headers["x-ag-vendor"]);
  if (!vendorId) {
    return sendJson(res, 401, { error: "Sesión inválida" });
  }

  const target = String(req.query.target || "").toLowerCase();
  const envName = TARGETS[target];
  if (!envName) {
    return sendJson(res, 400, { error: "Webhook no válido" });
  }

  const webhookUrl = process.env[envName];
  if (!webhookUrl || webhookUrl.includes("YOUR_")) {
    return sendJson(res, 503, { error: "Webhook no configurado" });
  }

  const payload = req.body && typeof req.body === "object" ? { ...req.body } : {};
  if (payload.id_vendedor && normalizeVendorId(payload.id_vendedor) !== vendorId) {
    return sendJson(res, 403, { error: "Vendedor no autorizado" });
  }
  payload.id_vendedor = payload.id_vendedor || vendorId;

  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return sendJson(res, upstream.ok ? 200 : 502, { ok: upstream.ok });
  } catch {
    return sendJson(res, 502, { error: "No se pudo contactar Make" });
  }
}

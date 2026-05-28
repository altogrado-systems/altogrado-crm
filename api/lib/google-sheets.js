const ALLOWED_RANGE_PREFIXES = ["Prospectos!", "Vendedores!", "Plan Semanal!"];

export function isValidVendorId(id) {
  return /^VEND-\d{3}$/i.test(String(id || "").trim());
}

export function normalizeVendorId(id) {
  const s = String(id || "").trim();
  return /^VEND-\d{3}$/i.test(s) ? s.toUpperCase() : "";
}

export function isAllowedSheetRange(range) {
  const r = String(range || "").trim();
  if (!r || r.length > 120) return false;
  return ALLOWED_RANGE_PREFIXES.some((p) => r.startsWith(p));
}

export function getGoogleConfig() {
  const sheetId = process.env.GOOGLE_SHEET_ID || "";
  const apiKey = process.env.GOOGLE_API_KEY || "";
  if (!sheetId || !apiKey || sheetId === "YOUR_GOOGLE_SHEET_ID") {
    return null;
  }
  return { sheetId, apiKey };
}

export async function fetchSheetValues(range) {
  const cfg = getGoogleConfig();
  if (!cfg) {
    const err = new Error("Google Sheets no configurado en el servidor");
    err.status = 503;
    throw err;
  }
  if (!isAllowedSheetRange(range)) {
    const err = new Error("Rango no permitido");
    err.status = 400;
    throw err;
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(range)}?key=${cfg.apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || "Error al leer Sheet");
    err.status = res.status;
    throw err;
  }
  return data;
}

export function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

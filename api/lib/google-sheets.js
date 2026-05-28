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
  // GOOGLE_* en Vercel; VITE_* solo como respaldo en .env local antiguo
  const sheetId =
    process.env.GOOGLE_SHEET_ID || process.env.VITE_SHEET_ID || "";
  const apiKey =
    process.env.GOOGLE_API_KEY || process.env.VITE_API_KEY || "";
  if (!sheetId || !apiKey || sheetId === "YOUR_GOOGLE_SHEET_ID") {
    return null;
  }
  return { sheetId, apiKey };
}

function explainGoogleError(message = "", status = 0) {
  const m = String(message);
  if (
    m.includes("referer") ||
    m.includes("PERMISSION_DENIED") ||
    status === 403
  ) {
    return (
      "GOOGLE_API_KEY bloqueada para servidor: crea una key solo para backend " +
      "(Application restriction = None, API restriction = Google Sheets API). " +
      "La key con restricción de sitios web solo sirve para VITE_MAPS_KEY en el navegador."
    );
  }
  return m || "Error al leer Google Sheet";
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
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    const err = new Error(`Sin conexión a Google Sheets: ${e.message}`);
    err.status = 502;
    throw err;
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* respuesta no JSON */
  }

  if (!res.ok) {
    const raw = data?.error?.message || res.statusText;
    const err = new Error(explainGoogleError(raw, res.status));
    err.status = res.status === 403 ? 403 : res.status >= 400 ? res.status : 502;
    throw err;
  }
  return data;
}

export function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Lectura de Google Sheets desde el navegador (misma API key con restricción HTTP referrer).
 * Así funciona con UNA sola key como antes del refactor de seguridad.
 */

function sheetConfig() {
  const apiKey =
    import.meta.env.VITE_API_KEY || import.meta.env.VITE_GOOGLE_API_KEY || "";
  const sheetId =
    import.meta.env.VITE_SHEET_ID || import.meta.env.VITE_GOOGLE_SHEET_ID || "";
  return { apiKey, sheetId };
}

export function hasSheetConfig() {
  const { apiKey, sheetId } = sheetConfig();
  return Boolean(apiKey && sheetId && sheetId !== "YOUR_GOOGLE_SHEET_ID");
}

export async function fetchSheetRange(range) {
  const { apiKey, sheetId } = sheetConfig();
  if (!hasSheetConfig()) {
    throw new Error("Falta VITE_API_KEY y VITE_SHEET_ID en Vercel");
  }
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || "Error al leer Sheet");
  }
  return { values: data.values || [] };
}

export async function loginWithPin(id_vendedor, pin) {
  const data = await fetchSheetRange("Vendedores!A2:K20");
  const vendedor = (data.values || []).find((row) => row[0] === id_vendedor);
  if (!vendedor) throw new Error("ID no encontrado");
  const pinEsperado = String(vendedor[10] || "").replace(".0", "").trim();
  if (String(pin).trim() !== pinEsperado) throw new Error("PIN incorrecto");
  return {
    id_vendedor: vendedor[0],
    nombre: vendedor[1] || "",
    email: vendedor[3] || "",
  };
}

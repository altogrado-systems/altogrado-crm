/** ID de vendedor tipo VEND-001 */
export function isVendorIdValue(s) {
  return /^VEND-\d{3}$/i.test(String(s || "").trim());
}

export function normalizeVendorId(id) {
  const s = String(id || "").trim();
  return isVendorIdValue(s) ? s.toUpperCase() : s;
}

/** Resuelve id desde columnas del Sheet (col 21 nombre/id, col 22 id/nombre). */
export function resolveVendorFieldsFromSheet(col21, col22) {
  const a = String(col21 || "").trim();
  const b = String(col22 || "").trim();
  const id = [b, a].find(isVendorIdValue) || b || a;
  return {
    vendedor: a || b,
    vendedor_id: id,
    id_vendedor: id,
  };
}

export function prospectBelongsToVendor(p, vendorId) {
  const vid = normalizeVendorId(vendorId);
  if (!vid) return false;
  const fields = [p.vendedor_id, p.id_vendedor, p.vendedor].map(normalizeVendorId);
  return fields.some((f) => f && f === vid);
}

export function normalizeSheetDate(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  return s;
}

function looksLikeTime(s) {
  return /^\d{1,2}:\d{2}/.test(String(s || "").trim());
}

export function parseHoraFromSheetRow(row) {
  for (const idx of [34, 35, 43, 44]) {
    const v = (row[idx] || "").trim();
    if (looksLikeTime(v)) return v.slice(0, 5);
  }
  return "";
}

/** Fecha de cita: campo dedicado o próxima acción si es cita agendada. */
export function getFechaCita(p) {
  const raw =
    p.fechaCita ||
    (p.estado === "CITA_AGENDADA" ? p.proximaAccion : "") ||
    "";
  return normalizeSheetDate(raw);
}

export function getHoraCita(p) {
  const h = String(p.horaCita || "").trim();
  return looksLikeTime(h) ? h.slice(0, 5) : "";
}

/** Teléfono MX: 52XXXXXXXXXX (sin +) */
export function normalizeTel(tel) {
  if (!tel) return "";
  let s = String(tel).replace(".0", "").replace(/\s/g, "").replace("+", "");
  if (s.startsWith("5252")) s = s.slice(2);
  if (s.length === 10) s = "52" + s;
  if (s.length === 11 && s.startsWith("1")) s = "52" + s.slice(1);
  return s;
}

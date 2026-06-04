/**
 * Log de interacciones (Fase A).
 *
 * Hoja Log_Seguimiento (append vía Make accion=log_interaccion):
 * A timestamp | B id_prospecto | C nombre_clinica | D id_vendedor
 * E vendedor | F tipo | G origen | H notas
 */

import { payloadLogInteraccion } from "./makePayloads.js";
import { postMake } from "./apiClient.js";
import { normalizeSheetDate, normalizeVendorId } from "./vendor.js";

const LOCAL_KEY = "ag_interaction_log";
const MAX_LOCAL = 500;

export const CONTACT_TYPES = new Set(["LLAMADA", "WHATSAPP", "EMAIL", "VISITA"]);

/** Fecha local YYYY-MM-DD (evita desfase UTC con toISOString). */
export function getLocalDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Lunes de la semana actual en fecha local. */
export function getWeekStartMondayLocal(d = new Date()) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(d.getDate() + diff);
  return getLocalDateString(mon);
}

function sheetSerialToIso(serial) {
  const ms = (serial - 25569) * 86400 * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
}

export function normalizeLogTimestamp(val) {
  if (val == null || val === "") return "";
  if (typeof val === "number" && val > 30000) return sheetSerialToIso(val);
  const s = String(val).trim();
  if (!s) return "";
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 30000) return sheetSerialToIso(n);
  }
  return s;
}

export function fechaFromLogEntry({ timestamp, fecha } = {}) {
  const fromFecha = normalizeSheetDate(fecha);
  if (fromFecha) return fromFecha;
  const ts = normalizeLogTimestamp(timestamp);
  if (!ts) return "";
  const fromTs = normalizeSheetDate(ts);
  if (fromTs) return fromTs;
  if (/^\d{4}-\d{2}-\d{2}/.test(ts)) return ts.slice(0, 10);
  return "";
}

export function parseSheetLogRows(values = []) {
  return (values || [])
    .map((row, rowIndex) => {
      const timestamp = normalizeLogTimestamp(row[0]);
      const tipo = String(row[5] || "").trim().toUpperCase();
      const id_prospecto = String(row[1] || "").trim();
      return {
        id: `sheet-${rowIndex}-${timestamp}-${id_prospecto}-${tipo}`,
        timestamp,
        fecha: fechaFromLogEntry({ timestamp }),
        id_prospecto,
        nombre: String(row[2] || "").trim(),
        id_vendedor: normalizeVendorId(row[3]),
        vendedor: String(row[4] || "").trim(),
        tipo,
        origen: String(row[6] || "").trim(),
        notas: String(row[7] || "").trim(),
        source: "sheet",
      };
    })
    .filter((l) => l.id_prospecto && CONTACT_TYPES.has(l.tipo));
}

export function loadLocalInteractionLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalInteractionLogs(logs) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(logs.slice(-MAX_LOCAL)));
  } catch {
    /* quota */
  }
}

/** Clave para no duplicar el mismo evento local ya reflejado en Sheet. */
function logKey(l) {
  const ts = String(l.timestamp || l.fecha || "");
  return `${l.id_prospecto}|${l.tipo}|${ts}|${l.origen || ""}`;
}

export function mergeInteractionLogs(sheetLogs = [], localLogs = []) {
  const sheetKeys = new Set(sheetLogs.map(logKey));
  const merged = [...sheetLogs];
  for (const l of localLogs) {
    if (!sheetKeys.has(logKey(l))) merged.push(l);
  }
  return merged;
}

export function countContactInteractions(
  logs,
  { vendorId, fechaMin, fechaMax, tipos = CONTACT_TYPES } = {}
) {
  const vid = vendorId ? normalizeVendorId(vendorId) : "";
  return (logs || []).filter((l) => {
    if (vid && normalizeVendorId(l.id_vendedor) !== vid) return false;
    if (!tipos.has(l.tipo)) return false;
    const f = fechaFromLogEntry(l);
    if (!f) return false;
    if (fechaMin && f < fechaMin) return false;
    if (fechaMax && f > fechaMax) return false;
    return true;
  }).length;
}

export async function registerInteraction({
  prospecto,
  tipo,
  origen = "app",
  notas = "",
  vendedor = {},
}) {
  const t = String(tipo || "").toUpperCase();
  if (!prospecto?.id || !CONTACT_TYPES.has(t)) {
    throw new Error("Interacción inválida");
  }

  const now = new Date();
  const entry = {
    id: `local-${now.getTime()}`,
    timestamp: now.toISOString(),
    fecha: getLocalDateString(now),
    id_prospecto: prospecto.id,
    nombre: prospecto.nombre || "",
    id_vendedor: normalizeVendorId(vendedor.id),
    vendedor: vendedor.name || "",
    tipo: t,
    origen,
    notas: notas || "",
    source: "local",
  };

  const logs = loadLocalInteractionLogs();
  logs.push(entry);
  saveLocalInteractionLogs(logs);

  try {
    await postMake("e7", payloadLogInteraccion(entry));
  } catch {
    /* el log local ya quedó guardado */
  }

  return entry;
}

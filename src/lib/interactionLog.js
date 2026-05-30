/**
 * Log de interacciones (Fase A).
 *
 * Hoja Log_Seguimiento (append vía Make accion=log_interaccion):
 * A timestamp | B id_prospecto | C nombre_clinica | D id_vendedor
 * E vendedor | F tipo | G origen | H notas
 */

import { postMake } from "./apiClient.js";

const LOCAL_KEY = "ag_interaction_log";
const MAX_LOCAL = 500;

export const CONTACT_TYPES = new Set(["LLAMADA", "WHATSAPP", "EMAIL", "VISITA"]);

export function parseSheetLogRows(values = []) {
  return (values || [])
    .map((row) => {
      const timestamp = row[0] || "";
      return {
        id: `sheet-${timestamp}-${row[1]}-${row[5]}`,
        timestamp,
        fecha: timestamp.slice(0, 10),
        id_prospecto: row[1] || "",
        nombre: row[2] || "",
        id_vendedor: row[3] || "",
        vendedor: row[4] || "",
        tipo: String(row[5] || "").toUpperCase(),
        origen: row[6] || "",
        notas: row[7] || "",
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

function logKey(l) {
  const ts = l.timestamp || l.fecha || "";
  return `${l.id_prospecto}|${l.tipo}|${ts.slice(0, 16)}|${l.origen || ""}`;
}

export function mergeInteractionLogs(sheetLogs = [], localLogs = []) {
  const map = new Map();
  for (const l of sheetLogs) {
    map.set(logKey(l), l);
  }
  for (const l of localLogs) {
    if (!map.has(logKey(l))) map.set(logKey(l), l);
  }
  return [...map.values()];
}

export function countContactInteractions(
  logs,
  { vendorId, fechaMin, fechaMax, tipos = CONTACT_TYPES } = {}
) {
  return (logs || []).filter((l) => {
    if (vendorId && l.id_vendedor !== vendorId) return false;
    if (!tipos.has(l.tipo)) return false;
    const f = l.fecha || (l.timestamp || "").slice(0, 10);
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
    fecha: now.toISOString().split("T")[0],
    id_prospecto: prospecto.id,
    nombre: prospecto.nombre || "",
    id_vendedor: vendedor.id || "",
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
    await postMake("e7", {
      accion: "log_interaccion",
      timestamp: entry.timestamp,
      fecha: entry.fecha,
      id_prospecto: entry.id_prospecto,
      nombre_clinica: entry.nombre,
      id_vendedor: entry.id_vendedor,
      vendedor: entry.vendedor,
      tipo: entry.tipo,
      origen: entry.origen,
      notas: entry.notas,
    });
  } catch {
    /* el log local ya quedó guardado */
  }

  return entry;
}

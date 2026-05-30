/**
 * Clasificación de prospectos — una sola fuente de verdad: campo `estado`.
 * No depende de que Make escriba bien la columna AF.
 */

import { normalizeTel } from "./vendor.js";

export const ESTADOS_NEGATIVOS = new Set([
  "DESCARTADO",
  "CLIENTE_PERDIDO",
  "VISITADO_NO_INTERESADO",
  "NO_CONTESTA_MAX",
]);

export const ESTADOS_PIPELINE = new Set([
  "CITA_AGENDADA",
  "CLIENTE_ACTIVO",
]);

/** Grupo 1 — Dar Seguimiento solo por columna P (estado) */
export const ESTADOS_DAR_SEGUIMIENTO = new Set([
  "CALLBACK_SOLICITADO",
  "CLIENTE_REACTIVAR",
  "LLAMADA_PENDIENTE",
  "TEL_INVALIDO",
  "VISITADO_INTERESADO",
]);

/** Grupo 2 — estado P + resultado AF (col AF) */
const ESTADOS_GRUPO2 = new Set(["NUEVO", "NO_CONTESTA_1", "PRIMER_PEDIDO", ""]);
const RESULTADOS_AF_SEGUIMIENTO = new Set(["INTERESADO", "NECESITA_PENSAR"]);

const EXCLUIDOS_DAR_SEGUIMIENTO = new Set([
  "DESCARTADO",
  "CLIENTE_PERDIDO",
  "VISITADO_NO_INTERESADO",
  "CLIENTE_ACTIVO",
  "CITA_AGENDADA",
]);

const OVERRIDE_KEY = "ag_prospect_overrides";

function norm(val) {
  return String(val || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

/** Normaliza texto del Sheet o UI a claves internas */
export function normalizeResultadoKey(val) {
  const n = norm(val);
  if (!n) return "";
  const aliases = {
    INTERESADO: "INTERESADO",
    "LO PIENSA": "NECESITA_PENSAR",
    "NECESITA PENSAR": "NECESITA_PENSAR",
    "NO ESTABA": "NO_ESTABA",
    "NO INTERESADO": "NO_INTERESADO",
    "NO INTERESA": "NO_INTERESADO",
    LLAMADA: "LLAMADA",
    WHATSAPP: "WHATSAPP",
    EMAIL: "EMAIL",
    VISITA: "VISITA",
    ESPERAR: "ESPERAR",
  };
  if (aliases[n]) return aliases[n];
  for (const [k, v] of Object.entries(aliases)) {
    if (n.includes(k)) return v;
  }
  return val;
}

/** Resultado de visita → estado CRM */
export function estadoFromResultadoVisita(resultadoVisita) {
  const key = normalizeResultadoKey(resultadoVisita);
  switch (key) {
    case "INTERESADO":
      return "VISITADO_INTERESADO";
    case "NECESITA_PENSAR":
    case "NO_ESTABA":
      return "LLAMADA_PENDIENTE";
    case "NO_INTERESADO":
      return "VISITADO_NO_INTERESADO";
    default:
      return null;
  }
}

/** Próxima acción (tipo) → estado CRM */
export function estadoFromTipoAccion(tipoAccion) {
  const key = normalizeResultadoKey(tipoAccion);
  if (!key) return null;
  if (key === "NO_INTERESADO") return "VISITADO_NO_INTERESADO";
  if (["LLAMADA", "WHATSAPP", "EMAIL", "VISITA", "ESPERAR"].includes(key)) {
    return "LLAMADA_PENDIENTE";
  }
  if (key === "INTERESADO") return "VISITADO_INTERESADO";
  if (["NECESITA_PENSAR", "NO_ESTABA"].includes(key)) {
    return "LLAMADA_PENDIENTE";
  }
  return null;
}

/**
 * Ajusta estado si el Sheet trae NUEVO pero hay señales de seguimiento en otras columnas.
 */
export function enrichProspectFromSheet(p) {
  if (!p) return p;
  return { ...p, estado: p.estado || "NUEVO", seguimiento: p.seguimiento === true };
}

export function isDarSeguimiento(p) {
  if (!p) return false;

  const estado = String(p.estado || "").trim().toUpperCase();
  if (EXCLUIDOS_DAR_SEGUIMIENTO.has(estado)) return false;

  if (ESTADOS_DAR_SEGUIMIENTO.has(estado)) return true;

  const estadoGrupo2 = !estado || ESTADOS_GRUPO2.has(estado);
  if (estadoGrupo2) {
    const rv = normalizeResultadoKey(p.resultadoVisita);
    if (RESULTADOS_AF_SEGUIMIENTO.has(rv)) return true;
  }

  return false;
}

export function buildVisitaUpdate(form, prospecto) {
  const resultadoVisita = form.resultadoVisita || "";
  let estado =
    estadoFromResultadoVisita(resultadoVisita) || prospecto.estado || "NUEVO";

  if (form.tipoAccion && form.proximaAccion) {
    const fromTipo = estadoFromTipoAccion(form.tipoAccion);
    if (fromTipo && !ESTADOS_NEGATIVOS.has(fromTipo)) estado = fromTipo;
  }

  return {
    resultadoVisita,
    notas: form.notas,
    labActual: form.labActual,
    objecion: form.objecion,
    clinicaDigital: form.clinicaDigital,
    doctor: form.nombreDoctor,
    waOptIn: form.waOptIn,
    waNumero: form.waNumero
      ? normalizeTel(form.waNumero)
      : prospecto.waNumero || "",
    tipoAccion: form.tipoAccion || prospecto.tipoAccion || "",
    proximaAccion: form.proximaAccion || prospecto.proximaAccion || "",
    fechaCompromiso: form.fechaCompromiso || "",
    estado,
    seguimiento: false,
    ult_contacto: new Date().toISOString().split("T")[0],
  };
}

export function buildSeguimientoUpdate(form, prospecto) {
  const estado =
    form.estadoUpdate && form.estadoUpdate !== ""
      ? form.estadoUpdate
      : estadoFromTipoAccion(form.tipoAccion) ||
        prospecto.estado ||
        "LLAMADA_PENDIENTE";

  const upd = {
    tipoAccion: form.tipoAccion,
    proximaAccion: form.proximaAccion,
    fechaCompromiso: form.fechaCompromiso,
    estado,
    seguimiento: false,
    ult_contacto: new Date().toISOString().split("T")[0],
  };

  if (form.tipoAccion) upd.resultadoVisita = form.tipoAccion;
  if (form.telefonoUpdate) upd.telefono = normalizeTel(form.telefonoUpdate);
  if (form.waNumeroUpdate) upd.waNumero = normalizeTel(form.waNumeroUpdate);
  if (form.notasUpdate) upd.notas = form.notasUpdate;

  return upd;
}

export function buildSeguimientoCompletadoUpdate(prospecto, form) {
  const upd = { seguimiento: true };
  if (form.telefonoUpdate) upd.telefono = form.telefonoUpdate;
  if (form.estadoUpdate) upd.estado = form.estadoUpdate;
  if (form.notasUpdate) upd.notas = form.notasUpdate;
  return upd;
}

// ── Overrides locales (persisten clasificación aunque Make/Sheet tarde) ──

export function loadProspectOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveProspectOverride(id, fields) {
  if (!id || !fields) return;
  const all = loadProspectOverrides();
  all[id] = {
    ...(all[id] || {}),
    ...fields,
    _updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all));
  } catch {
    /* quota */
  }
}

export function mergeProspectWithOverrides(prospecto, overrides) {
  const o = overrides[prospecto.id];
  if (!o) return enrichProspectFromSheet(prospecto);
  const { _updatedAt, ...fields } = o;
  return enrichProspectFromSheet({ ...prospecto, ...fields });
}

/** Lista / Check / Dashboard */
export { ESTADOS_DAR_SEGUIMIENTO as DAR_SEGUIMIENTO_ESTADOS };

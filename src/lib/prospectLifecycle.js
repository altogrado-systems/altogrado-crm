/**
 * Clasificación de prospectos — una sola fuente de verdad: campo `estado`.
 * No depende de que Make escriba bien la columna AF.
 */

import { normalizeTel } from "./vendor.js";

export const ESTADOS_NEGATIVOS = new Set([
  "DESCARTADO",
  "CLIENTE_PERDIDO",
  "VISITADO_NO_INTERESADO",
  "TEL_INVALIDO",
  "NO_CONTESTA_MAX",
]);

export const ESTADOS_PIPELINE = new Set([
  "CITA_AGENDADA",
  "PRIMER_PEDIDO",
  "CLIENTE_ACTIVO",
]);

/** Aparecen en Lista → Dar Seguimiento, Check y Dashboard */
export const ESTADOS_DAR_SEGUIMIENTO = new Set([
  "CALLBACK_SOLICITADO",
  "EN_ZONA",
  "VISITADO_INTERESADO",
  "LLAMADA_PENDIENTE",
  "TRANSFERIDO_TECNICO",
  "CLIENTE_REACTIVAR",
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
  let estado = p.estado || "NUEVO";

  if (
    !ESTADOS_NEGATIVOS.has(estado) &&
    !ESTADOS_PIPELINE.has(estado) &&
    !ESTADOS_DAR_SEGUIMIENTO.has(estado)
  ) {
    const fromRv = estadoFromResultadoVisita(p.resultadoVisita);
    const fromTipo =
      p.proximaAccion && p.tipoAccion
        ? estadoFromTipoAccion(p.tipoAccion)
        : estadoFromTipoAccion(p.resultadoVisita);
    if (fromRv) estado = fromRv;
    else if (fromTipo) estado = fromTipo;
  }

  return { ...p, estado, seguimiento: p.seguimiento === true };
}

export function isDarSeguimiento(p) {
  if (!p) return false;
  if (ESTADOS_NEGATIVOS.has(p.estado)) return false;
  if (ESTADOS_PIPELINE.has(p.estado)) return false;
  return ESTADOS_DAR_SEGUIMIENTO.has(p.estado);
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
  if (form.telefonoUpdate) upd.telefono = form.telefonoUpdate;
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

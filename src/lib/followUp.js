/** Estados que siempre cuentan como Dar Seguimiento */
export const DAR_SEGUIMIENTO_ESTADOS = [
  "CALLBACK_SOLICITADO",
  "EN_ZONA",
  "VISITADO_INTERESADO",
  "LLAMADA_PENDIENTE",
  "TRANSFERIDO_TECNICO",
  "CLIENTE_REACTIVAR",
];

const NEGATIVE_ESTADOS = new Set([
  "DESCARTADO",
  "CLIENTE_PERDIDO",
  "VISITADO_NO_INTERESADO",
  "TEL_INVALIDO",
  "NO_CONTESTA_MAX",
]);

const PIPELINE_ESTADOS = new Set([
  "CITA_AGENDADA",
  "PRIMER_PEDIDO",
  "CLIENTE_ACTIVO",
]);

/** Valores positivos en col AF / Resultado de Visita o tipo de próxima acción */
const FOLLOWUP_TOKENS = new Set([
  "INTERESADO",
  "NECESITA PENSAR",
  "LO PIENSA",
  "NO ESTABA",
  "LLAMADA",
  "WHATSAPP",
  "EMAIL",
  "VISITA",
  "ESPERAR",
]);

function norm(val) {
  return String(val || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function isNegativeResultado(val) {
  const n = norm(val);
  if (!n) return false;
  return (
    n.includes("NO INTERES") ||
    n === "NO INTERESADO" ||
    n === "NO INTERESA" ||
    n.includes("DESCART")
  );
}

function matchesFollowUpToken(val) {
  const n = norm(val);
  if (!n || isNegativeResultado(n)) return false;
  if (FOLLOWUP_TOKENS.has(n)) return true;
  for (const token of FOLLOWUP_TOKENS) {
    if (n.includes(token)) return true;
  }
  return false;
}

/**
 * Prospecto en grupo "Dar Seguimiento" (Lista, Check, Dashboard, Embudo).
 * Incluye resultado AF positivo o estados de seguimiento activo.
 */
export function isDarSeguimiento(p) {
  if (!p) return false;
  if (NEGATIVE_ESTADOS.has(p.estado)) return false;
  if (PIPELINE_ESTADOS.has(p.estado)) return false;

  if (DAR_SEGUIMIENTO_ESTADOS.includes(p.estado)) return true;

  if (matchesFollowUpToken(p.resultadoVisita)) return true;
  if (matchesFollowUpToken(p.tipoAccion)) return true;

  return false;
}

export function countDarSeguimiento(prospectos, vendorId, belongsFn) {
  return prospectos.filter(
    (p) => (!vendorId || belongsFn(p, vendorId)) && isDarSeguimiento(p)
  ).length;
}

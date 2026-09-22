import {
  resolveVendorFieldsFromSheet,
  normalizeSheetDate,
  parseHoraFromSheetRow,
  normalizeTel,
} from "./vendor.js";
import {
  mergeProspectWithOverrides,
  loadProspectOverrides,
} from "./prospectLifecycle.js";

/** Retell/Make a veces mandan 0 en campos vacíos. */
function cell(val) {
  const s = String(val ?? "").trim();
  if (!s || s === "0") return "";
  return s;
}

function rowToProspect(row, overrides) {
  const telActualizado = normalizeTel(cell(row[4]));
  const telBase = normalizeTel(cell(row[3]));
  const base = {
    id: row[0] || "",
    nombre: row[1] || "",
    doctor: cell(row[2]),
    telefono: telActualizado || telBase,
    email: cell(row[5]),
    direccion: cell(row[6]),
    zona: row[13] || "",
    estado: cell(row[15]) || "NUEVO",
    ult_contacto: cell(row[17]),
    ult_resultado: cell(row[18]),
    intentos: parseFloat(row[19]) || 0,
    notas: cell(row[20]),
    ...resolveVendorFieldsFromSheet(row[21], row[22]),
    waOptIn: row[23] === "TRUE" || row[23] === true,
    waNumero: normalizeTel(row[24]),
    labActual: cell(row[25]),
    especialidad: cell(row[29]),
    fechaVisita: row[30] || "",
    resultadoVisita: row[31] || "",
    proximaAccion: normalizeSheetDate(row[32] || ""),
    tipoAccion: row[33] || "",
    esCliente: row[37] || "",
    seguimiento: row[41] === "YES" || row[41] === "TRUE",
    tipoTrabajo: row[39] || "",
    cuentaPrimerPedido: row[38] || "",
    fechaPrimerPedido: row[26] || "",
    fechaUltimoPedido: row[27] || "",
    facturacion: row[28] || "",
    fechaCompromiso: row[42] || "",
    score: parseFloat(row[12]) || 0,
    objecion: "",
    clinicaDigital: "",
    fechaCita: normalizeSheetDate(row[32] || ""),
    horaCita: parseHoraFromSheetRow(row),
  };
  return mergeProspectWithOverrides(base, overrides);
}

export function parseProspectosFromSheet(values) {
  const overrides = loadProspectOverrides();
  const byId = new Map();
  for (const row of values || []) {
    if (!row[0] || !row[1]) continue;
    byId.set(row[0], rowToProspect(row, overrides));
  }
  return [...byId.values()];
}

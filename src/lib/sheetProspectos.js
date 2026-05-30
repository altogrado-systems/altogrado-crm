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

export function parseProspectosFromSheet(values) {
  const overrides = loadProspectOverrides();
  return (values || [])
    .map((row) => {
      const base = {
        id: row[0] || "",
        nombre: row[1] || "",
        doctor: row[2] || "",
        telefono: normalizeTel(row[3]),
        email: row[5] || "",
        direccion: row[6] || "",
        zona: row[13] || "",
        estado: row[15] || "NUEVO",
        ult_contacto: row[17] || "",
        ult_resultado: row[18] || "",
        intentos: parseFloat(row[19]) || 0,
        notas: row[20] || "",
        ...resolveVendorFieldsFromSheet(row[21], row[22]),
        waOptIn: row[23] === "TRUE" || row[23] === true,
        waNumero: normalizeTel(row[24]),
        labActual: row[25] || "",
        especialidad: row[29] || "",
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
    })
    .filter((r) => r.id && r.nombre);
}

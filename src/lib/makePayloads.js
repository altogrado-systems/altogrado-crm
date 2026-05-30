/**
 * Payloads Escenario 7 (webhook app_escritura).
 * Todos los campos del blueprint se envían siempre (vacío/false si no aplican)
 * para que Make pueda redeterminar la data structure completa.
 */

import { normalizeTel } from "./vendor.js";

/** Unión de campos referenciados como {{1.campo}} en Escenario 7.blueprint */
export const E7_FIELD_DEFAULTS = {
  accion: "",
  id_prospecto: "",
  id_vendedor: "",
  vendedor: "",
  nombre: "",
  telefono: "",
  direccion: "",
  zona: "",
  doctor: "",
  notas: "",
  lab_actual: "",
  resultado_visita: "",
  proxima_accion: "",
  tipo_accion: "",
  clinica_digital: "",
  objecion: "",
  wa_opt_in: false,
  wa_numero: "",
  estado_update: "",
  estado_override: "",
  es_visita: false,
  telefono_update: "",
  whatsapp_update: "",
  notas_update: "",
  marca_hecho: false,
  semana: "",
  lunes: "",
  martes: "",
  miercoles: "",
  jueves: "",
  viernes: "",
  activo: false,
  fecha_primer_pedido: "",
  fecha_cita: "",
  hora_cita: "",
  nombre_clinica: "",
  nombre_doctor: "",
  duracion_minutos: "",
  timestamp: "",
  fecha: "",
  tipo: "",
  origen: "",
};

export function buildE7Payload(partial = {}) {
  return { ...E7_FIELD_DEFAULTS, ...partial };
}

export function payloadCompletarSeguimiento({
  prospecto,
  tipoAccion = "",
  proximaAccion = "",
  telefonoUpdate = "",
  waNumeroUpdate = "",
  estadoUpdate = "",
  notasUpdate = "",
  vendedorId = "",
  vendedorName = "",
  marcaHecho = false,
}) {
  return buildE7Payload({
    accion: "completar_seguimiento",
    id_prospecto: prospecto?.id || "",
    id_vendedor: vendedorId,
    vendedor: vendedorName,
    tipo_accion: tipoAccion,
    proxima_accion: proximaAccion,
    resultado_visita: tipoAccion,
    telefono_update: telefonoUpdate ? normalizeTel(telefonoUpdate) : "",
    whatsapp_update: waNumeroUpdate ? normalizeTel(waNumeroUpdate) : "",
    estado_update: estadoUpdate || "",
    notas_update: (notasUpdate || "").trim(),
    marca_hecho: marcaHecho,
  });
}

export function payloadRegistrarVisita({
  prospecto,
  form,
  estadoUpdate = "",
  waNumero = "",
  vendedorId = "",
  vendedorName = "",
}) {
  return buildE7Payload({
    accion: "registrar_visita",
    id_prospecto: prospecto?.id || "",
    id_vendedor: vendedorId,
    vendedor: vendedorName,
    doctor: form.nombreDoctor || "",
    notas: form.notas || "",
    lab_actual: form.labActual || "",
    resultado_visita: form.resultadoVisita || "",
    proxima_accion: form.proximaAccion || "",
    tipo_accion: form.tipoAccion || "",
    clinica_digital: form.clinicaDigital || "",
    objecion: form.objecion || "",
    wa_opt_in: !!form.waOptIn,
    wa_numero: waNumero ? normalizeTel(waNumero) : "",
    estado_update: estadoUpdate || "",
  });
}

/** JSON de muestra con todos los campos — pegar en Make → Redetermine data structure */
export function sampleE7PayloadForMakeRedetermine() {
  return buildE7Payload({
    accion: "completar_seguimiento",
    id_prospecto: "PRO-0001",
    id_vendedor: "VEND-001",
    vendedor: "Nombre Vendedor",
    tipo_accion: "WHATSAPP",
    proxima_accion: "2026-05-30",
    resultado_visita: "WHATSAPP",
    telefono_update: "525551234567",
    whatsapp_update: "525559876543",
    estado_update: "LLAMADA_PENDIENTE",
    notas_update: "Notas de prueba",
    nombre: "Clínica Demo",
    telefono: "525551234567",
    direccion: "Calle Demo 1",
    zona: "POLANCO",
    doctor: "Dr. Demo",
    notas: "Notas visita",
    lab_actual: "Lab Demo",
    clinica_digital: "DIGITAL",
    objecion: "PRECIO",
    wa_opt_in: true,
    wa_numero: "525559876543",
    estado_override: "NUEVO",
    es_visita: true,
    marca_hecho: false,
    semana: "2026-W22",
    lunes: "POLANCO",
    martes: "ROMA",
    miercoles: "CONDESA",
    jueves: "NARVARTE",
    viernes: "COYOACAN",
    activo: true,
    fecha_primer_pedido: "2026-05-30",
    fecha_cita: "2026-05-30",
    hora_cita: "10:00",
    nombre_clinica: "Clínica Demo",
    nombre_doctor: "Dr. Demo",
    duracion_minutos: "30",
    timestamp: new Date().toISOString(),
    fecha: new Date().toISOString().split("T")[0],
    tipo: "WHATSAPP",
    origen: "check_whatsapp",
  });
}

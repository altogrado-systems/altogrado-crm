/**
 * Payloads Escenario 7 — solo campos de cada acción (no mezclar rutas).
 * buildE7Payload / sampleE7Payload… son SOLO para redeterminar data structure en Make.
 */

import { normalizeTel } from "./vendor.js";

/** Catálogo completo — usar una vez en Make → Redetermine, NO en producción */
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

/** Solo para pegar en Make → Run once / Redetermine data structure */
export function buildE7Payload(partial = {}) {
  return { ...E7_FIELD_DEFAULTS, ...partial };
}

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

/** Dar Seguimiento — solo campos de esta ruta */
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
  const payload = {
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
  };
  const notas = (notasUpdate || "").trim();
  if (notas) payload.notas_update = notas;
  if (marcaHecho) payload.marca_hecho = true;
  return payload;
}

export function payloadRegistrarVisita({
  prospecto,
  form,
  estadoUpdate = "",
  vendedorId = "",
  vendedorName = "",
}) {
  const waNumero = form.waNumero ? normalizeTel(form.waNumero) : "";
  const payload = {
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
    estado_update: estadoUpdate || "",
  };
  if (waNumero) payload.wa_numero = waNumero;
  return payload;
}

export function payloadLogInteraccion(entry) {
  return {
    accion: "log_interaccion",
    timestamp: entry.timestamp,
    fecha: entry.fecha,
    id_prospecto: entry.id_prospecto,
    nombre_clinica: entry.nombre,
    id_vendedor: entry.id_vendedor,
    vendedor: entry.vendedor,
    tipo: entry.tipo,
    origen: entry.origen,
    notas: entry.notas || "",
  };
}

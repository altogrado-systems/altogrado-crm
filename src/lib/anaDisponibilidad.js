/**
 * Ana ya no agenda citas: captura días/horarios del doctor.
 * Contrato Sheet: ESTADO=DISPONIBILIDAD_VISITA y/o ÚLT. RESULTADO (col S).
 */

export const ESTADO_DISPONIBILIDAD = "DISPONIBILIDAD_VISITA";

export function notasAna(p) {
  return String(p?.ult_resultado || "")
    .trim()
    .replace(/^📞\s*/, "");
}

/** Extrae texto legible de horarios desde ult_resultado / estado */
export function textoDisponibilidadAna(p) {
  const raw = notasAna(p);
  if (p?.estado === ESTADO_DISPONIBILIDAD) {
    return raw || "Revisa notas de Ana en la ficha";
  }
  const tagged = raw.match(/DISPONIBLE:\s*(.+)/i);
  if (tagged) return tagged[1].trim();
  if (
    /disponib|horario|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|\d{1,2}:\d{2}/i.test(
      raw
    )
  ) {
    return raw;
  }
  return "";
}

export function tieneDisponibilidadAna(p) {
  return (
    p?.estado === ESTADO_DISPONIBILIDAD || Boolean(textoDisponibilidadAna(p))
  );
}

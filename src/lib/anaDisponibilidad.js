/**
 * Ana ya no agenda citas: captura días/horarios del doctor.
 * Contrato Sheet: ESTADO=DISPONIBILIDAD_VISITA y/o ÚLT. RESULTADO con prefijo DISPONIBLE:
 */

export const ESTADO_DISPONIBILIDAD = "DISPONIBILIDAD_VISITA";

/** Extrae texto legible de horarios desde ult_resultado / estado */
export function textoDisponibilidadAna(p) {
  const raw = String(p?.ult_resultado || "").trim();
  if (!raw) {
    return p?.estado === ESTADO_DISPONIBILIDAD
      ? "Revisa notas de Ana en la ficha"
      : "";
  }
  const tagged = raw.match(/DISPONIBLE:\s*(.+)/i);
  if (tagged) return tagged[1].trim();
  if (p?.estado === ESTADO_DISPONIBILIDAD) return raw.replace(/^📞\s*/, "");
  if (
    /disponib|horario|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|\d{1,2}:\d{2}/i.test(
      raw
    )
  ) {
    return raw.replace(/^📞\s*/, "");
  }
  return "";
}

export function tieneDisponibilidadAna(p) {
  return (
    p?.estado === ESTADO_DISPONIBILIDAD || Boolean(textoDisponibilidadAna(p))
  );
}

const ESTADO_ALIASES = {
  reactivar: "CLIENTE_REACTIVAR",
  "cliente reactivar": "CLIENTE_REACTIVAR",
  cliente_reactivar: "CLIENTE_REACTIVAR",
};

function norm(val) {
  return String(val || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Búsqueda en Lista: clínica (nombre), doctor, zona, id/teléfono y estado (ej. reactivar).
 */
export function matchesProspectSearch(prospecto, query, estadoConfig = {}) {
  const q = norm(query);
  if (!q) return true;

  const haystack = [
    prospecto.nombre,
    prospecto.doctor,
    prospecto.zona,
    prospecto.direccion,
    prospecto.id,
    prospecto.telefono,
  ]
    .filter(Boolean)
    .map(norm);

  if (haystack.some((field) => field.includes(q))) return true;

  const estado = prospecto.estado || "";
  if (norm(estado).includes(q.replace(/\s/g, "_"))) return true;

  const label = estadoConfig[estado]?.label;
  if (label && norm(label).includes(q)) return true;

  for (const [alias, estadoKey] of Object.entries(ESTADO_ALIASES)) {
    if (q.includes(norm(alias)) && estado === estadoKey) return true;
  }

  return false;
}

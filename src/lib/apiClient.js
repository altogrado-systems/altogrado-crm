function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem("ag_session") || "null");
  } catch {
    return null;
  }
}

function vendorHeaders() {
  const session = getSession();
  return session?.id_vendedor ? { "X-AG-Vendor": session.id_vendedor } : {};
}

async function parseJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

/** Login — valida PIN en servidor (no expone API key ni Sheet). */
export async function login(id_vendedor, pin) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_vendedor, pin }),
  });
  return parseJsonResponse(res);
}

/** Lee un rango permitido del Sheet vía proxy. */
export async function fetchSheetRange(range) {
  const res = await fetch(`/api/sheets?range=${encodeURIComponent(range)}`, {
    headers: vendorHeaders(),
  });
  return parseJsonResponse(res);
}

/** Envía acción a Make sin exponer URL del webhook. target: e5 | e7 | result */
export async function postMake(target, payload) {
  const res = await fetch(`/api/make?target=${encodeURIComponent(target)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...vendorHeaders() },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

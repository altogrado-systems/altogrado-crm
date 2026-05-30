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

const MAKE_FALLBACK = {
  e5: import.meta.env.VITE_MAKE_WEBHOOK_E5 || "",
  e7: import.meta.env.VITE_MAKE_WEBHOOK_E7 || "",
};

/** Envía a Make vía /api; si falla, respaldo con VITE_MAKE_WEBHOOK_* (urgencia en Vercel). */
export async function postMake(target, payload) {
  try {
    const res = await fetch(`/api/make?target=${encodeURIComponent(target)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...vendorHeaders() },
      body: JSON.stringify(payload),
    });
    return parseJsonResponse(res);
  } catch (apiErr) {
    const url = MAKE_FALLBACK[target];
    if (!url) throw apiErr;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Error al contactar Make");
    return { ok: true };
  }
}

const CACHE_KEY = "ag_geocode_cache";
const CACHE_VERSION = 1;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed.v !== CACHE_VERSION) return {};
    return parsed.entries || {};
  } catch {
    return {};
  }
}

function writeCache(entries) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ v: CACHE_VERSION, entries })
    );
  } catch {
    /* quota */
  }
}

let mapsLoadPromise = null;

export function loadGoogleMaps(apiKey) {
  if (!apiKey) {
    return Promise.reject(new Error("Falta VITE_MAPS_KEY"));
  }
  if (window.google?.maps?.Geocoder) {
    return Promise.resolve(window.google.maps);
  }
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-ag-maps="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google.maps));
      existing.addEventListener("error", () =>
        reject(new Error("No se pudo cargar Google Maps"))
      );
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.agMaps = "1";
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps no disponible"));
    };
    script.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(script);
  });

  return mapsLoadPromise;
}

function geocodeWithGoogle(maps, address) {
  return new Promise((resolve, reject) => {
    const geocoder = new maps.Geocoder();
    geocoder.geocode(
      { address, componentRestrictions: { country: "mx" } },
      (results, status) => {
        if (status === "OK" && results?.[0]) {
          const loc = results[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng() });
        } else {
          reject(new Error(status || "GEOCODE_FAILED"));
        }
      }
    );
  });
}

export async function geocodeAddress(apiKey, address) {
  const normalized = (address || "").trim();
  if (!normalized) {
    throw new Error("Sin dirección");
  }

  const cache = readCache();
  if (cache[normalized]) {
    return cache[normalized];
  }

  const maps = await loadGoogleMaps(apiKey);
  const coords = await geocodeWithGoogle(maps, normalized);
  cache[normalized] = coords;
  writeCache(cache);
  return coords;
}

async function geocodeItems(apiKey, items, getAddress, onSuccess, onError) {
  const errors = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const address = (getAddress(item) || "").trim();
    if (!address) {
      onError?.(item, "Sin dirección");
      continue;
    }
    try {
      const coords = await geocodeAddress(apiKey, address);
      onSuccess(item, i, coords);
    } catch (e) {
      onError?.(item, e.message || "Error");
      errors.push({ id: item.id, reason: e.message || "Error" });
    }
  }
  return errors;
}

export async function geocodeCitas(apiKey, citas) {
  const markers = [];
  const errors = [];
  await geocodeItems(
    apiKey,
    citas,
    (c) => c.direccion,
    (cita, index, coords) => markers.push({ cita, index, ...coords }),
    (cita, reason) => errors.push({ id: cita.id, reason })
  );
  return { markers, errors };
}

export async function geocodeProspectos(apiKey, prospectos) {
  const markers = [];
  const errors = [];
  await geocodeItems(
    apiKey,
    prospectos,
    (p) => p.direccion,
    (prospecto, _i, coords) => markers.push({ prospecto, ...coords }),
    (prospecto, reason) => errors.push({ id: prospecto.id, reason })
  );
  return { markers, errors };
}

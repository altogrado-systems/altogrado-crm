const EARTH_RADIUS_KM = 6371;

/** Distancia en km entre dos puntos (Haversine). */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distancia mínima (km) de un punto a cualquiera de las citas geocodificadas. */
export function minDistanceToCitas(lat, lng, citaMarkers) {
  let min = Infinity;
  let nearest = null;
  for (const m of citaMarkers) {
    const d = distanceKm(lat, lng, m.lat, m.lng);
    if (d < min) {
      min = d;
      nearest = m;
    }
  }
  return { km: min, nearestCita: nearest?.cita ?? null };
}

export function formatDistanceKm(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import { geocodeCitas, geocodeProspectos } from "../lib/googleGeocode.js";
import { minDistanceToCitas, formatDistanceKm } from "../lib/geo.js";
import "leaflet/dist/leaflet.css";

const CDMX_CENTER = [19.4326, -99.1332];
const NEARBY_KM = 1.5;
const MAX_CANDIDATES_GEOCODE = 35;

function numberedIcon(n, color = "#10B981") {
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;background:${color};border:2.5px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:white;box-shadow:0 2px 8px rgba(0,0,0,0.25);font-family:system-ui,sans-serif">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function nearbyIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;background:#F59E0B;border:2.5px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.2)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  });
}

function FitBounds({ positions }) {
  const map = useMap();
  const key = positions.map((p) => p.join(",")).join("|");

  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 14 });
  }, [map, key, positions]);

  return null;
}

function pickNearbyCandidates(prospectos, citas, vendedorId) {
  const citaIds = new Set(citas.map((c) => c.id));
  const zonasCitas = new Set(citas.map((c) => c.zona).filter(Boolean));

  return prospectos
    .filter(
      (p) =>
        (p.vendedor_id === vendedorId || p.id_vendedor === vendedorId) &&
        (p.direccion || "").trim() &&
        !citaIds.has(p.id) &&
        !["CLIENTE_ACTIVO", "DESCARTADO"].includes(p.estado)
    )
    .sort((a, b) => {
      const aZ = zonasCitas.has(a.zona) ? 0 : 1;
      const bZ = zonasCitas.has(b.zona) ? 0 : 1;
      if (aZ !== bZ) return aZ - bZ;
      return (b.score || 0) - (a.score || 0);
    })
    .slice(0, MAX_CANDIDATES_GEOCODE);
}

export default function CitasMap({
  citas,
  prospectos = [],
  vendedorId = "",
  mapsKey,
  onSelect,
  radioKm = NEARBY_KM,
}) {
  const [citaMarkers, setCitaMarkers] = useState([]);
  const [nearbyMarkers, setNearbyMarkers] = useState([]);
  const [nearbyList, setNearbyList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [error, setError] = useState(null);
  const [geocodeErrors, setGeocodeErrors] = useState([]);
  const [showNearby, setShowNearby] = useState(true);

  const citasKey = useMemo(
    () => citas.map((c) => `${c.id}:${c.direccion || ""}`).join("|"),
    [citas]
  );

  const candidatesKey = useMemo(() => {
    if (!showNearby || !vendedorId) return "";
    const candidates = pickNearbyCandidates(prospectos, citas, vendedorId);
    return candidates.map((p) => `${p.id}:${p.direccion}`).join("|");
  }, [prospectos, citas, vendedorId, showNearby, citasKey]);

  useEffect(() => {
    if (!citas.length) {
      setCitaMarkers([]);
      setNearbyMarkers([]);
      setNearbyList([]);
      setGeocodeErrors([]);
      setError(null);
      return;
    }
    if (!mapsKey) {
      setCitaMarkers([]);
      setError("Configura VITE_MAPS_KEY en .env para el mapa interactivo.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNearbyMarkers([]);
    setNearbyList([]);

    geocodeCitas(mapsKey, citas)
      .then(({ markers: m, errors }) => {
        if (cancelled) return;
        setCitaMarkers(m);
        setGeocodeErrors(errors);
        if (m.length === 0 && errors.length > 0) {
          setError("No se pudieron ubicar las citas en el mapa.");
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setCitaMarkers([]);
        setGeocodeErrors([]);
        setError(e.message || "Error al cargar el mapa");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [citasKey, mapsKey, citas.length]);

  useEffect(() => {
    if (!showNearby || !mapsKey || citaMarkers.length === 0 || !vendedorId) {
      setNearbyMarkers([]);
      setNearbyList([]);
      return;
    }

    const candidates = pickNearbyCandidates(prospectos, citas, vendedorId);
    if (!candidates.length) {
      setNearbyMarkers([]);
      setNearbyList([]);
      return;
    }

    let cancelled = false;
    setLoadingNearby(true);

    geocodeProspectos(mapsKey, candidates)
      .then(({ markers: geocoded }) => {
        if (cancelled) return;
        const nearby = [];
        for (const m of geocoded) {
          const { km, nearestCita } = minDistanceToCitas(
            m.lat,
            m.lng,
            citaMarkers
          );
          if (km <= radioKm) {
            nearby.push({
              ...m,
              km,
              nearestCita,
            });
          }
        }
        nearby.sort((a, b) => a.km - b.km);
        setNearbyMarkers(nearby);
        setNearbyList(nearby);
        setLoadingNearby(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNearbyMarkers([]);
        setNearbyList([]);
        setLoadingNearby(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    citaMarkers,
    candidatesKey,
    mapsKey,
    showNearby,
    vendedorId,
    prospectos,
    citas,
    radioKm,
  ]);

  const allPositions = useMemo(() => {
    const pts = citaMarkers.map((m) => [m.lat, m.lng]);
    if (showNearby) {
      nearbyMarkers.forEach((m) => pts.push([m.lat, m.lng]));
    }
    return pts;
  }, [citaMarkers, nearbyMarkers, showNearby]);

  const center = allPositions[0] || CDMX_CENTER;

  if (!citas.length) return null;

  if (!mapsKey) {
    return (
      <div
        style={{
          height: 180,
          background: "linear-gradient(135deg,#0F172A,#1E293B)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 6,
          padding: 16,
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: 24 }}>🗺️</span>
        <span style={{ fontSize: 13, color: "#94A3B8" }}>
          Añade VITE_MAPS_KEY en .env para ver el mapa interactivo
        </span>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "#F8FAFC",
          borderBottom: "1px solid #E2E8F0",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, color: "#64748B", display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10B981" }} />
          Citas
        </span>
        <span style={{ fontSize: 11, color: "#64748B", display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#F59E0B" }} />
          ≤{radioKm} km
        </span>
        <label
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontWeight: 600,
            color: "#475569",
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showNearby}
            onChange={(e) => setShowNearby(e.target.checked)}
          />
          Prospectos cercanos
        </label>
      </div>

      {(loading || loadingNearby) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1000,
            background: "rgba(248,250,252,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            color: "#64748B",
            fontWeight: 600,
            top: 36,
          }}
        >
          {loading ? "Ubicando citas…" : "Buscando prospectos cercanos…"}
        </div>
      )}

      {error && !loading && citaMarkers.length === 0 && (
        <div
          style={{
            padding: "12px 14px",
            background: "#FEF2F2",
            borderBottom: "1px solid #FECACA",
            fontSize: 12,
            color: "#B91C1C",
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}

      <MapContainer
        center={center}
        zoom={12}
        style={{ height: 240, width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {allPositions.length > 0 && <FitBounds positions={allPositions} />}
        {showNearby &&
          citaMarkers.map((m) => (
            <Circle
              key={`r-${m.cita.id}`}
              center={[m.lat, m.lng]}
              radius={radioKm * 1000}
              pathOptions={{
                color: "#0EA5E9",
                fillColor: "#0EA5E9",
                fillOpacity: 0.06,
                weight: 1,
                dashArray: "4 6",
              }}
            />
          ))}
        {citaMarkers.map((m) => (
          <Marker
            key={m.cita.id}
            position={[m.lat, m.lng]}
            icon={numberedIcon(m.index + 1)}
            eventHandlers={{ click: () => onSelect?.(m.cita) }}
          >
            <Popup>
              <div style={{ fontSize: 13, lineHeight: 1.35, minWidth: 140 }}>
                <strong>Cita: {m.cita.nombre}</strong>
                <br />
                {m.cita.horaCita || "—"}
              </div>
            </Popup>
          </Marker>
        ))}
        {showNearby &&
          nearbyMarkers.map((m) => (
            <Marker
              key={m.prospecto.id}
              position={[m.lat, m.lng]}
              icon={nearbyIcon()}
              eventHandlers={{ click: () => onSelect?.(m.prospecto) }}
            >
              <Popup>
                <div style={{ fontSize: 13, lineHeight: 1.35, minWidth: 150 }}>
                  <strong>{m.prospecto.nombre}</strong>
                  <br />
                  {formatDistanceKm(m.km)} de {m.nearestCita?.nombre || "cita"}
                  <br />
                  <span style={{ color: "#64748B", fontSize: 11 }}>
                    {m.prospecto.estado?.replace(/_/g, " ")}
                  </span>
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>

      {showNearby && !loading && !loadingNearby && citaMarkers.length > 0 && (
        <div style={{ borderTop: "1px solid #E2E8F0", background: "#FFFBEB" }}>
          <div
            style={{
              padding: "10px 12px 6px",
              fontSize: 12,
              fontWeight: 700,
              color: "#92400E",
            }}
          >
            Prospectos a ≤{radioKm} km de tus citas ({nearbyList.length})
          </div>
          {nearbyList.length === 0 ? (
            <div
              style={{
                padding: "0 12px 12px",
                fontSize: 12,
                color: "#B45309",
              }}
            >
              No hay prospectos activos tan cerca (se revisan hasta{" "}
              {MAX_CANDIDATES_GEOCODE} con dirección en tu zona).
            </div>
          ) : (
            <div
              style={{
                padding: "0 8px 8px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {nearbyList.map((m) => (
                <button
                  key={m.prospecto.id}
                  type="button"
                  onClick={() => onSelect?.(m.prospecto)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    background: "white",
                    border: "1.5px solid #FDE68A",
                    borderRadius: 10,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#F59E0B",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#0F172A",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.prospecto.nombre}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>
                      {formatDistanceKm(m.km)} · cerca de{" "}
                      {m.nearestCita?.nombre}
                      {m.nearestCita?.horaCita
                        ? ` (${m.nearestCita.horaCita})`
                        : ""}
                    </div>
                    <div style={{ fontSize: 10, color: "#94A3B8" }}>
                      {m.prospecto.estado?.replace(/_/g, " ")} · {m.prospecto.zona}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {geocodeErrors.length > 0 && !loading && (
        <div
          style={{
            padding: "8px 12px",
            fontSize: 11,
            color: "#92400E",
            background: "#FFFBEB",
            borderTop: "1px solid #FDE68A",
          }}
        >
          {geocodeErrors.length} cita(s) sin ubicación en mapa (revisa la dirección).
        </div>
      )}
    </div>
  );
}

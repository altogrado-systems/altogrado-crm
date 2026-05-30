# Memoria del proyecto — AltoGrado CRM

Documento de contexto para desarrollo y agentes. Actualizado: mayo 2026.

## Qué es

CRM React + Vite para vendedoras de AltoGrado. Lee prospectos de Google Sheets, acciones vía webhooks Make (Escenario 5 llamadas Ana, Escenario 7 escritura). Despliegue: Vercel (`altogrado-systems/altogrado-crm`), rama `main`.

## Dev local

```bash
npm run dev          # solo frontend
npm run dev:all      # frontend + scripts/local-api.mjs (proxy /api)
```

Variables: ver `.env.example`. **No commitear `.env`.**

- **Lectura Sheet + login PIN:** cliente con `VITE_API_KEY` + `VITE_SHEET_ID` (referrer HTTP).
- **Escritura:** Make webhooks E7/E5 (no Sheets write desde browser).
- **Mapa:** `VITE_MAPS_KEY`, componente `CitasMap.jsx` + `googleGeocode.js`.

## Vendedores (IDs)

| ID | Nombre |
|---|---|
| VEND-001 | Areli Rios |
| VEND-002 | Ivan Jimenez |
| VEND-003 | Daniela Rivera |
| VEND-004 | NPMC |
| VEND-005 | AGLD |

Filtro: `prospectBelongsToVendor()` en `src/lib/vendor.js` (cols V/W del Sheet).

Dashboard gerencia: VEND-002, VEND-004, VEND-005.

---

## Google Sheet — columnas clave (Prospectos)

| Col | Índice `row[]` | Campo app |
|---|---|---|
| A | 0 | id |
| B | 1 | nombre (clínica) |
| C | 2 | doctor |
| D | 3 | telefono |
| P | 15 | estado |
| AF | 31 | resultadoVisita |
| AG | 32 | proximaAccion |
| AH | 33 | tipoAccion |
| Y | 24 | waNumero |
| AP | 41 | seguimiento (YES/TRUE) |

Carga: `Prospectos!A2:AQ` → `parseProspectosFromSheet()` deduplica por ID.

### Overrides locales

`localStorage` key `ag_prospect_overrides` — persisten cambios si Make tarda. Merge en carga + al guardar (`saveProspectOverride`).

---

## Dar Seguimiento — criterio actual

Implementado en `isDarSeguimiento()` (`src/lib/prospectLifecycle.js`). **No auto-promover estado al cargar** — se lee lo que trae el Sheet (+ overrides).

### Grupo 1 — solo col P (estado)

Entran si estado es:

- `CALLBACK_SOLICITADO`
- `CLIENTE_REACTIVAR`
- `LLAMADA_PENDIENTE`
- `TEL_INVALIDO`
- `VISITADO_INTERESADO`

### Grupo 2 — col P + col AF

Estado = `NUEVO`, `NO_CONTESTA_1`, `PRIMER_PEDIDO` o vacío  
**Y** AF = `INTERESADO` o `NECESITA_PENSAR` (incluye alias "Lo piensa")

### Excluidos

`CITA_AGENDADA`, `CLIENTE_ACTIVO`, `DESCARTADO`, `VISITADO_NO_INTERESADO`, `CLIENTE_PERDIDO`, etc.

### Dónde se usa

- Lista → filtro "Dar Seguimiento"
- Check → pendientes (`!seguimiento`)
- Dashboard contadores
- Vista **Hoy** → sección "Seguimientos hoy/semana" (con `proximaAccion` col AG)

---

## Log de interacciones

Hoja **Log_Seguimiento** (append vía Make `accion: log_interaccion`).

| Col | Campo |
|---|---|
| A | timestamp |
| B | id_prospecto |
| C | nombre_clinica |
| D | id_vendedor |
| E | vendedor |
| F | tipo (LLAMADA/WHATSAPP/…) |
| G | origen |
| H | notas |

App registra en Check (Llamar/WA/Hecho) y modal. Local: `localStorage` `ag_interaction_log`. Dashboard cuenta desde log mergeado.

---

## Make — Escenario 7 (`app_escritura`)

**Regla:** cada `accion` manda **solo sus campos**. No enviar 40 variables en producción (riesgo de borrar datos si Make mapea sin `if()`).

Redeterminar data structure: usar JSON completo en `sampleE7PayloadForMakeRedetermine()` (`src/lib/makePayloads.js`) **una vez** en Make → Run once.

### Rutas y payloads

| accion | Origen app | Campos principales |
|---|---|---|
| `completar_seguimiento` | Modal Seguimiento, Check Hecho | `telefono_update`, `whatsapp_update`, `estado_update`, `notas_update` (notas solo si hay texto), `tipo_accion`, `proxima_accion`, `resultado_visita`, `marca_hecho` |
| `registrar_visita` | Modal Registrar | `wa_numero`, `estado_update`, `resultado_visita`, `doctor`, `notas`, … |
| `nueva_clinica` | Nueva clínica | `nombre`, `telefono`, `wa_numero`, `estado_override`, `es_visita`, … |
| `plan_semanal` | Plan | `semana`, `lunes`…`viernes` |
| `pausar_sistema` | Toggle 🤖 | `activo`, `id_vendedor` |
| `primer_pedido` | Modal / Nueva | `fecha_primer_pedido` |
| `book_appointments_cal` | Agendar cita | `fecha_cita`, `hora_cita`, `nombre_clinica`, … |
| `log_interaccion` | Botones contacto | `timestamp`, `tipo`, `origen`, … |

**Nombres distintos a propósito (no unificar sin revisar Make):**

- Seguimiento → `whatsapp_update`
- Visita / nueva clínica → `wa_numero`

### Escenario 5

Llamadas Ana: `postMake("e5", { zona, id_vendedor, max_llamadas, … })`.

---

## Módulos clave (`src/lib/`)

| Archivo | Rol |
|---|---|
| `prospectLifecycle.js` | `isDarSeguimiento`, `buildVisitaUpdate`, `buildSeguimientoUpdate`, overrides |
| `sheetProspectos.js` | Parse filas Sheet → objetos prospecto |
| `makePayloads.js` | Payloads por acción + sample redetermine |
| `interactionLog.js` | Log llamadas/WA local + Make |
| `prospectSearch.js` | Búsqueda Lista (clínica, doctor, zona, reactivar) |
| `vendor.js` | Vendedor, fechas cita, `getProximaAccionFecha`, teléfonos |
| `sheetsClient.js` | Fetch Sheet desde browser |
| `apiClient.js` | `postMake`, login API |

---

## UX / flujos

- **Guardar visita/seguimiento:** update local inmediato + webhook Make + sync Sheet ~2.5s después (`syncProspectosFromSheet`).
- **Seguimiento tab:** campos Actualizar Teléfono + **Actualizar WhatsApp** (`whatsapp_update` en Make).
- **Visita tab:** campo WhatsApp → `wa_numero` en Make.
- **Vista Hoy:** citas (`CITA_AGENDADA`) + seguimientos programados (Dar Seguimiento + proximaAccion AG), toggle hoy/semana.

---

## Commits recientes relevantes

| Commit | Tema |
|---|---|
| `90c0544` | Criterio Dar Seguimiento P+AF, seguimientos en Hoy, dedup IDs |
| `9255654` | Payloads Make por acción (no 40 campos siempre) |
| `ac93134` | Siempre telefono/whatsapp/estado/notas en completar_seguimiento |
| `8399586` | `whatsapp_update` en seguimiento |
| `47fd1a1` | wa_numero visita + sync Sheet tras guardar |
| `ee25593` | Log interacciones + búsqueda ampliada |
| `008ea8c` | prospectLifecycle + clasificación por estado |

---

## Pendiente / no tocar sin acuerdo

- **No renombrar variables Make** sin que el usuario revise Escenario 7.
- **No commitear** `.env`, `.DS_Store`.
- Escritura directa a Sheets desde código: posible vía service account en `/api`, pero hoy **Make es la vía de escritura**.

---

## Arquitectura (resumen)

```
Browser (Vite)
  ├─ read  → Google Sheets API (VITE_API_KEY)
  ├─ write → Make E7 webhook (accion + campos)
  └─ local → overrides + interaction log

Vercel
  ├─ /api/sheets (opcional, servidor)
  ├─ /api/make (proxy webhooks)
  └─ static dist/
```

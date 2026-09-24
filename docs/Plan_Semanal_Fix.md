# Plan Semanal — por qué no se guardaba y cómo quedó

## Cómo funciona la cadena

La pestaña `Plan Semanal` se indexa por la **columna R** (`PLAN_KEY`), que vale
`id_vendedor + "-" + semana`, por ejemplo `VEND-001-2026-W40`.

| Quién | Qué hace |
|---|---|
| Escenario 10 (cron) | `addRow` en `Plan Semanal` para la semana W2. Era el único que creaba filas. |
| Escenario 7, ruta `plan_semanal` | `filterRows` col R → `updateRow` columnas E–I. |
| Escenario 6 (cron Mar/Jue) | Lee las filas W1 y W2 por col R y arma `zonas_a_llamar` con las columnas E–I. **De ahí salen las llamadas de Ana (Retell).** |
| Escenario 2 | Lee W0/W1/W2 por col R para calcular disponibilidad. |

## La falla

Escenario 7 solo actualiza, nunca crea. Si no existe la fila con esa `PLAN_KEY`,
`filterRows` devuelve cero bundles, el `updateRow` no corre y Make responde 200 igual.
La app lo tomaba como éxito.

Y no basta con poner un Router con `addRow` después del `filterRows`: en Make **un router
solo puede enrutar bundles que recibe**, y un módulo de búsqueda sin resultados no emite
ninguno, así que ni el router ni sus ramas se evalúan.

## Lo corregido en la app

1. `getWeekKey()` calcula semana **ISO**, igual que `formatDate(now; "GGGG-[W]WW")` de Make.
   La fórmula anterior se desfasaba un número los domingos y cerca del cambio de año,
   generando llaves que nunca existían en el Sheet.
2. La app lee `Plan Semanal` **antes** de guardar y decide la acción:
   `plan_semanal` si la fila existe, `plan_semanal_nuevo` si hay que crearla.
   Así Make nunca depende de un buscador vacío.
3. Después de guardar relee con reintentos (hasta 4, ~1.5 s) y compara los cinco días.
   Si Make no escribió, sale un error en vez de un falso "guardado".
4. El plan inicial ya no trae zonas de demo (POLANCO, SANTA FE…). Antes, al recargar sin
   filas en el Sheet, reaparecían esas zonas y parecía que el guardado se revertía.
5. El cargador ya no descarta filas con la columna R vacía: reconstruye la llave con `D + B`.

6. El rango de lectura pasó de `Plan Semanal!A2:R50` a `Plan Semanal!A2:R` (sin tope).
   El cron de Escenario 10 agrega una fila por vendedora activa cada semana, así que la
   hoja ya pasó de la fila 50 y la app dejó de ver las filas nuevas: Make escribía bien,
   pero la app reportaba "no creó la fila" y al recargar el plan desaparecía.
7. Si hubiera filas duplicadas con la misma `PLAN_KEY`, la app se queda con la **primera**,
   que es la que actualiza Make (`limit: 1` en el `filterRows`).

El payload sigue usando **solo los campos que el webhook ya conoce**
(`accion`, `semana`, `id_vendedor`, `vendedor`, `lunes`…`viernes`). No hay que redeterminar
la estructura de datos: lo único que cambia es el *valor* de `accion`.

## Lo que hay que hacer en Escenario 7 (una sola vez)

### 1. Dejar la ruta `plan_semanal` como estaba

Borrar el Router 33 y el `addRow` 34 que se agregaron dentro de esa ruta.
Debe quedar: `filterRows` (10) → `updateRow` (17) → `WebhookRespond` (15).

En el `updateRow` (17), quitar el filtro `{{10.`1`}} exist` si quedó puesto: ya no hace falta.

### 2. Agregar una ruta nueva al router principal (módulo 2)

Filtro de la ruta: `{{1.accion}}` *Text operators: Equal to* → `plan_semanal_nuevo`

Un solo módulo: **Google Sheets → Add a Row**

- Spreadsheet: `AltoGrado_CRM_clean`
- Sheet: `Plan Semanal`
- Table contains headers: **Yes**
- Value input option: **User entered**

Mapeo de columnas:

| Col | Campo | Valor |
|---|---|---|
| A | ID PLAN | `PLAN-{{formatDate(now; "YYYYMMDD")}}-{{1.id_vendedor}}` |
| B | SEMANA | `{{1.semana}}` |
| C | Lunes Inicia en | ver fórmula abajo |
| D | ID VENDEDOR | `{{1.id_vendedor}}` |
| E | LUNES ZONA | `{{1.lunes}}` |
| F | MARTES ZONA | `{{1.martes}}` |
| G | MIÉRCOLES ZONA | `{{1.miercoles}}` |
| H | JUEVES ZONA | `{{1.jueves}}` |
| I | VIERNES ZONA | `{{1.viernes}}` |
| P | META VISITAS | `12` |
| R | PLAN_KEY | `{{1.id_vendedor + "-" + 1.semana}}` |

Las demás columnas se dejan vacías.

Fórmula de la columna C (el lunes de esa semana; usa las mismas funciones que Escenario 10,
`setDay(fecha; 2)` = lunes):

```
{{formatDate(setDay(if(1.semana = formatDate(now; "GGGG-[W]WW"); now; if(1.semana = formatDate(addDays(now; 7); "GGGG-[W]WW"); addDays(now; 7); addDays(now; 14))); 2); "YYYY-MM-DD")}}
```

Ni `lunes_inicia` ni `meta_visitas` viajan en el webhook: ambos se calculan aquí, por eso
no aparecen en la estructura de datos y no hay que tocarla.

### 3. Probar

1. En el CRM, pestaña Plan, ir a **Próx. semana**, poner zonas y **Guardar Plan**.
2. Debe salir `💾 Plan guardado en Sheet` y aparecer la fila en `Plan Semanal` con la
   `PLAN_KEY` correcta.
3. Volver a guardar con otra zona: ahora entra por la ruta `plan_semanal` (update) y
   debe modificar la misma fila, no crear una nueva.
4. Recargar el CRM y confirmar que las zonas siguen ahí.

Si sale `⚠️ Make no creó la fila …`, la ruta nueva no se está ejecutando: revisar que el
filtro sea exactamente `plan_semanal_nuevo`. Si sale `⚠️ Make no escribió las zonas`,
la fila existe pero falló el `updateRow` de la ruta vieja.

## Escenario 10 (cron que creaba filas W2)

Ya es redundante: la app crea la fila que falte con `plan_semanal_nuevo`. **Se puede apagar.**

Los duplicados que hubo salieron de la combinación del cron con el rango recortado: la app
no veía la fila creada por el cron (estaba más allá de la fila 50), creía que no existía y
mandaba `plan_semanal_nuevo`. Con el rango abierto eso ya no pasa, pero apagar el cron
elimina la única fuente de filas duplicadas y de filas vacías.

Efecto de apagarlo: si una vendedora no llena W1 o W2 en la app, esa semana no tendrá fila
y Escenario 6 se detendrá antes de llamar. Es el mismo resultado práctico que antes con una
fila de zonas vacías, así que no se pierde nada.

## Efecto en Ana

Escenario 6 arma `zonas_a_llamar` con las columnas E–I de las filas W1 y W2. Sin plan
guardado, esa variable queda vacía o con zonas viejas y Ana llama a nadie o a la zona
equivocada. Por eso esto bloqueaba las llamadas, independientemente del prompt nuevo.

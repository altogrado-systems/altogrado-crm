# Plan Semanal — por qué no se guardaba y qué falta en Make

## Cómo funciona la cadena

La pestaña `Plan Semanal` se indexa por la **columna R** (`plan_key`), que vale
`id_vendedor + "-" + semana`, por ejemplo `VEND-001-2026-W40`.

| Quién | Qué hace |
|---|---|
| Escenario 10 (cron) | `addRow` en `Plan Semanal` para la semana W2. Es el **único** que crea filas. |
| Escenario 7, ruta `plan_semanal` | `filterRows` col R = `plan_key` (limit 1) → `updateRow` columnas E–I. |
| Escenario 6 (cron Mar/Jue) | Lee las filas W1 y W2 por col R y arma `zonas_a_llamar` con las columnas E–I. De ahí salen las llamadas de Ana (Retell). |
| Escenario 2 | Lee W0/W1/W2 por col R para calcular disponibilidad. |

## La falla

Escenario 7 **solo actualiza**, nunca crea. Si no existe la fila con esa `plan_key`,
`filterRows` devuelve 0 bundles, el `updateRow` no corre y Make responde 200 igual.
La app lo tomaba como éxito.

## Lo corregido en la app

1. `getWeekKey()` ahora calcula semana **ISO**, igual que `formatDate(now; "GGGG-[W]WW")` de Make.
   La fórmula anterior se desfasaba un número los domingos y cerca del cambio de año,
   generando llaves que nunca existían en el Sheet.
2. Guardar Plan relee `Plan Semanal!A2:R50` y compara los cinco días. Si la fila no existe
   o Make no escribió, sale un toast de error en vez de "guardado".
3. El plan inicial ya no trae zonas de demo (POLANCO, SANTA FE…). Antes, al recargar sin
   filas en el Sheet, reaparecían esas zonas y parecía que el guardado se había revertido.
4. El payload a E7 incluye `plan_key`.
5. El cargador ya no descarta filas con la columna R vacía: reconstruye la llave con `D + B`.

## Estado en Make (revisión del blueprint del 24-sep)

Ya existe el router 33 después del módulo 10, con `updateRow` (17) y `addRow` (34).
La estructura y el mapeo de columnas del `addRow` están correctos.

**Pero la ruta del `addRow` nunca se ejecuta.** En Make, un módulo de búsqueda que no
encuentra nada devuelve **cero bundles** y la ruta se detiene ahí: el router 33 y sus dos
ramas no llegan a evaluarse. El filtro `{{10.`1`}} notexist` solo sirve cuando el módulo 10
sí produjo un bundle.

Hay que forzar que el módulo 10 siempre emita un bundle:

- **Opción A** — en los ajustes del módulo 10, activar
  *"Continue the route execution even if the module returns no results"* si aparece.
- **Opción B** (segura) — insertar un **Array aggregator** entre el módulo 10 y el router 33,
  con *Source module* = módulo 10. El aggregator siempre emite un bundle. Luego cambiar
  los filtros del router a `{{length(N.array)}}` *greater than* `0` (ruta update) y
  *equal to* `0` (ruta add), y en el `updateRow` usar
  `rowNumber = {{get(N.array; 1).__ROW_NUMBER__}}`.

Otros dos detalles menores del `addRow` (34):

- Falta la columna C (`Lunes Inicia en`). La app ya manda `lunes_inicia` con la fecha del
  lunes; mapear C a `{{1.lunes_inicia}}`. Requiere **redeterminar la estructura de datos**
  del webhook después de guardar un plan una vez.
- Falta la columna P (`META VISITAS`), que Escenario 10 llena con `12`.

El campo `plan_key` **no se manda desde la app**: Make lo arma con
`{{1.id_vendedor + "-" + 1.semana}}`, que es lo que ya hacen el filtro del módulo 10 y la
columna R del `addRow`.

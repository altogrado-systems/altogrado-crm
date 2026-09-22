# Ana → CRM: disponibilidad (sin agendar)

**Objetivo:** Ana obtiene **días y horarios**. La vendedora los ve en el CRM y confirma la visita.

## Qué está roto hoy (Escenario 1 + Retell v20)

El CRM lee:

| App | Sheet |
|-----|--------|
| estado | P (índice 15) |
| ult_resultado (notas Ana) | **S (índice 18)** |
| notas vendedora | U (índice 20) |
| telefono | D (3) **o E (4) si hay TEL Actualizado** |
| doctor | C (2) |
| direccion | G (6) |
| lab | Z (25) |
| especialidad | AD (29) |

### 1. Make no reconoce `DISPONIBILIDAD_VISITA`

Módulo **Set variable `nuevo_estado`** (después del filtro de llamada) termina en `"NUEVO"` si el resultado no es uno de la lista vieja (`CITA_AGENDADA`, `NO_CONTESTA`, etc.).

Ana ya manda `resultado = DISPONIBILIDAD_VISITA`. Make lo tira a **NUEVO** → el CRM no lo marca como horarios.

**Pegar esto en `nuevo_estado`:**

```
{{if(1.resultado = "DISPONIBILIDAD_VISITA"; "DISPONIBILIDAD_VISITA"; if(1.resultado = "CITA_AGENDADA"; "CITA_AGENDADA"; if(1.resultado = "NO_CONTESTA"; if(2.`19` < 2; "NO_CONTESTA_1"; "NO_CONTESTA_MAX"); if(1.resultado = "NO_CONTESTA_1"; "NO_CONTESTA_1"; if(1.resultado = "NO_CONTESTA_2"; "NO_CONTESTA_2"; if(1.resultado = "BUZON_VOZ"; "NO_CONTESTA_1"; if(1.resultado = "RECHAZO"; "VISITADO_NO_INTERESADO"; if(1.resultado = "CALLBACK_SOLICITADO"; "CALLBACK_SOLICITADO"; if(1.resultado = "NO_INTERESA_VOLVER"; "DESCARTADO"; if(1.resultado = "NO_INTERESA"; "DESCARTADO"; if(1.resultado = "TRANSFERIDO_TECNICO"; "TRANSFERIDO_TECNICO"; "NUEVO")))))))))))}}
```

### 2. Fórmulas `if(campo + "," + campo + "," + viejo)` no escriben bien

En **Update a row** (Prospectos) están así y suelen dejar vacío o basura:

- Campo 2 doctor
- Campo 6 dirección
- Campo 18 ÚLT. RESULTADO (notas de Ana)

**Reemplazar por:**

| Campo Make | Columna | Fórmula |
|------------|---------|---------|
| 2 | C Doctor | `{{if(1.nombre_doctor; 1.nombre_doctor; 2.`2`)}}` |
| 3 | D Teléfono | `{{if(1.telefono_confirmado; 1.telefono_confirmado; 2.`3`)}}` |
| 5 | F Email | `{{if(1.email; 1.email; 2.`5`)}}` |
| 6 | G Dirección | `{{if(1.direccion_confirmada; 1.direccion_confirmada; 2.`6`)}}` |
| 15 | P Estado | `{{4.nuevo_estado}}` |
| 17 | R Últ. contacto | `{{formatDate(now; "YYYY-MM-DD")}}` |
| 18 | S Últ. resultado | `{{if(1.resultado = "DISPONIBILIDAD_VISITA"; "DISPONIBLE: " + 1.notas_llamada; if(1.notas_llamada; 1.notas_llamada; 2.`18`))}}` |
| 19 | T Intentos | (dejar el parseNumber actual) |
| 25 | Z Lab | `{{if(1.lab_actual_detectado; 1.lab_actual_detectado; 2.`25`)}}` |
| 29 | AD Especialidad | `{{if(1.especialidad; 1.especialidad; 2.`29`)}}` |

Quitar o no mapear el campo **4 (TEL Actualizado)** con `telefono_confirmado` a secas: si Retell manda `0`, borra el dato. El teléfono visible del CRM es **D**, no E.

### 3. Retell: nombre del campo de lab

En el prompt Ana usa `lab_actual`. El tool `update_lead` y Make esperan **`lab_actual_detectado`**.

En el Paso 5 del prompt, cambiar `lab_actual` por `lab_actual_detectado`.

`notas_llamada` debe incluir días y horarios, p. ej.:

```
DISPONIBLE: Martes 10:00-12:00, Jueves 16:00-18:00. Dra. López.
```

## CRM (PWA)

La ficha Info muestra siempre el bloque **NOTAS DE ANA** con la columna S, más doctor, especialidad, lab, dirección y teléfono.

## Prueba

1. Corregir E1 en Make y guardar.
2. Llamada de prueba o ejecutar el módulo con payload de ejemplo.
3. En Sheet: P = `DISPONIBILIDAD_VISITA`, S con el texto de `notas_llamada`.
4. Recargar la app: ficha → bloque morado de notas + banner verde si hay horarios.

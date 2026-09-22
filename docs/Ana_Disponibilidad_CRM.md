# Ana → CRM: disponibilidad (sin agendar)

**Objetivo:** Ana solo obtiene **días y horarios** en que el doctor puede recibir visita. La vendedora ve eso **en grande** en el CRM y ella misma confirma / agenda.

## Contrato de datos (Sheet)

| Campo Sheet | Col | Qué escribe Ana / post-llamada |
|-------------|-----|--------------------------------|
| ESTADO | P | Preferido: `DISPONIBILIDAD_VISITA` (si el doctor dio horarios). Alternativa: `CALLBACK_SOLICITADO`. **No** usar `CITA_AGENDADA` salvo que la vendedora confirme. |
| ÚLT. RESULTADO | S | Texto legible con prefijo fijo: `DISPONIBLE: Mar 10–12 / Jue 16–18` |
| ÚLT. CONTACTO | R | Fecha de la llamada `YYYY-MM-DD` |
| PRÓXIMA ACCIÓN | AG | (Opcional) primer día sugerido `YYYY-MM-DD` |
| TIPO ACCIÓN | AH | `VISITA` o `LLAMADA` |
| SEGUIMIENTO_COMPLETADO | AP | `FALSE` / vacío hasta que la vendedora actúe |

### Ejemplo ÚLT. RESULTADO

```
DISPONIBLE: Martes 10:00-12:00, Jueves 16:00-18:00. Hablar con Dra. López.
```

El CRM detecta el prefijo `DISPONIBLE:` **o** el estado `DISPONIBILIDAD_VISITA` y muestra banner verde.

## Retell (Ana)

1. Quitar / no usar `book_appointments_cal` en el happy path.
2. Tras obtener horarios, llamar `update_lead` (o el webhook E1) con:
   - `resultado` = `DISPONIBILIDAD_VISITA` (nuevo) **o** mapear en Make/n8n desde un flag `tiene_disponibilidad=true`
   - `notas_llamada` = `DISPONIBLE: …` (horarios en texto claro)
3. No inventar cita confirmada en Calendar.

## Make E1 / n8n (post-llamada)

Cuando `resultado` indique disponibilidad positiva:

- ESTADO → `DISPONIBILIDAD_VISITA`
- Col S → `notas_llamada` (con prefijo `DISPONIBLE:`)
- No crear evento de Calendar
- No poner `CITA_AGENDADA` automáticamente

## CRM (PWA)

Ya muestra:

- Banner **🤖 ANA — HORARIOS PARA VISITA** en ficha Info
- Bloque en **Hoy**
- Filtro **Horarios Ana** en Lista
- Prioridad en **Check**
- Notificación 🔔 al cargar Sheet

## Prueba rápida en Sheet copia

1. En una fila de prueba poner ESTADO = `DISPONIBILIDAD_VISITA` y ÚLT. RESULTADO = `DISPONIBLE: Lun 11:00, Mie 17:00`.
2. Recargar la PWA (apuntando al Sheet copia).
3. Debe aparecer en Hoy + banner en ficha + filtro Lista.

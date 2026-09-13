# La auditoría de una cita no lleva al paciente

**13/09/2026 · Jorge (arreglo de una regla que ya existía) · `citas` + seguridad transversal (`master.audit_logs`)**

## Qué pasaba

CLAUDE.md lo dice desde el repaso de seguridad del 28/07/2026
(`2026-07-28-repaso-de-seguridad.md`): la auditoría guarda **un RESUMEN, nunca
la fila entera**, porque vive en `master` —compartida por todos los clientes— y
los datos personales y de salud no se duplican ahí.

Citas no lo cumplía en cinco llamadas y un script, todas anteriores a esa
regla y nunca revisadas después:

| Dónde | Qué volcaba |
| --- | --- |
| `app/api/citas/bookings/route.js` (alta desde el panel) | `after: { ...row.toJSON(), source: "manual" }` |
| `app/api/public/c/[tenantSlug]/book/route.js` (reserva pública) | `after: { ...row.toJSON(), source: "landing" }` |
| `app/api/citas/bookings/[id]/route.js`, PATCH | `before` y `after` enteros |
| `app/api/citas/bookings/[id]/route.js`, DELETE que cancela | `before` entero |
| `lib/citas/cancelBooking.js` (cancelar desde el correo y desde el portal) | `before` entero |
| `scripts/convertir-bloqueos-en-citas-de-taller.js` (`@vivo`) | `after` entero |

La fila entera de `bookings` lleva el nombre, el correo y el teléfono de la
familia, las notas internas, el motivo de la falta, las respuestas del
formulario de la cita, el texto del cobro y **el `cancellationToken`**, que es
el secreto del enlace «cancelar» de los correos.

Además, la huella de una cita BORRADA (`huellaDeCita`, entonces en
`lib/citas/borrarCita.js`) guardaba `cliente: row.clientName`.

Recuento en producción el 13/09/2026, solo recuentos:

- **1.550 filas** con la cita entera (aumenta 1.154 altas y 165 ediciones;
  nutri_laura 76 altas, 106 ediciones y 15 cancelaciones; demo_clinica 32; 2
  con `tenant_id` NULL).
- **129 huellas** de borrado con el nombre (125 de aumenta, 4 de nutri_laura).
- **913 citas futuras y vivas** con su `cancellationToken` vigente copiado en
  master.
- Unas **75 filas nuevas al día** en Aumenta.

La causa: `logCitasAudit` confiaba en que quien llama le pasara un resumen.
Nadie en la app lee `before`/`after` de las citas (`/api/actividad` pide solo
`id`, `userId`, `action` y `createdAt`), así que nada se rompía y nadie lo vio.

## Qué se decide

1. **Resumen por lista BLANCA** (`lib/citas/resumenDeCita.js`,
   `resumenDeCita`): ids, hora, duración, modalidad, estado, dinero y los
   punteros (`eventTypeId`, `scheduledAt`, `duration`, `modality`, `status`,
   `teamMemberId`, `patientId`, `clientId`, `packId`, `sessionNumber`,
   `tallerGrupoId`, `paymentStatus`, `amount`, las cuatro de cobro salvo el
   texto, `diagnosticoId`/`diagnosticoTramo`…). Fechas en ISO, sin nulos. Si
   una columna no está en la lista, no sale.
2. **Lo privado** (`CAMPOS_PRIVADOS_CITA`): `clientName`, `clientEmail`,
   `clientPhone`, `additionalData`, `notes`, `noShowReason`, `formAnswers`,
   `cobroTexto` y `cancellationToken`. `formAnswers` y `cobroTexto` son texto
   libre de la familia o del centro, igual que `notes` (hay 605 citas con
   `cobroTexto` relleno).
3. **Al editar** (`cambiosDeCita`): de la lista blanca, el valor de antes y el
   de después (null explícito cuando se vacía); de lo privado, **solo el nombre
   del campo** en `cambiadosSinValor`. El valor vigente sigue en `bookings`.
   Y **siempre, en los dos lados**, cambien o no, hora, duración, profesional,
   estado, tipo y paciente (`fijosDeCita`, `CAMPOS_FIJOS_EDICION`, con null
   explícito para distinguir «sin profesional» de «no se guardó»): mover solo
   la hora tiene que decir de quién es la cita y cuánto dura, y la comprobación
   de huecos forzados sobre bloqueos lee `after->>'duration'`, `'teamMemberId'`,
   `'status'` y `'patientId'` de esa fila.
4. **La huella del borrado va sin nombre**: `clientId`, `patientId`,
   `tallerGrupoId`, hora, estado, tipo, profesional y número de sesión.
   `huellaDeCita` se muda a `resumenDeCita.js` y `borrarCita.js` la re-exporta.
5. **Una red dentro de `logCitasAudit`** (`ladosParaAuditar`): con
   `entity: "Booking"` quita lo privado y las asociaciones anidadas
   (`patient`, `client`, `diagnostico`… si la fila se cargó con `include`)
   aunque quien llama se los pase. Con cualquier otra entidad —`EventType`,
   `Availability`, `TeamBlock`, `SessionPack`— devuelve los mismos objetos sin
   tocarlos. Motivo: eran cinco llamadas y un script; arreglar solo esas deja la
   puerta abierta a la siguiente ruta que se olvide.
6. **Las listas cubren exactamente las columnas** de `Booking.model.js`: la
   prueba `scripts/_smoke-citas-auditoria.mjs` falla si aparece una columna sin
   decidir («decide si va al resumen, es privada o queda fuera»), y si aparece
   un alias de Booking en `tenantDb.js` que la red no conoce.

## Precedentes

- **`auditSummary` en `lib/clinica/audit.js` (23/07/2026)**, el más fuerte: quitó
  el `row.toJSON()` de los registros clínicos con una lista blanca de ids y
  estados, «Ante la duda, fuera». Es el mismo criterio con las claves de otro
  modelo, por eso no se reutiliza.
- Las auditorías de septiembre ya se escriben sin nombres:
  `app/api/citas/bookings/[id]/taller/route.js` («Sin nombres: la auditoría
  vive en master y aquí hay datos de menores»), las inscripciones de talleres,
  `scripts/fusionar-pacientes.js` y Diagnósticos (solo ids).
- **Por qué no `resumen()` de `lib/utils/auditoria.js`**: pasa las fechas por
  `String()` (fecha local, no ISO), devuelve null si queda vacío e importa
  `masterDb`, con lo que su prueba no sería ligera. `resumenDeCita.js` va sin
  imports, como `gastaSesion.js`.

## Precedente en contra, sabido

`client.created` / `client.updated` / `client.deleted`
(`app/api/clients/route.js`, `app/api/clients/[id]/route.js`) y los leads
(`app/api/leads/[id]/route.js`) guardan nombre, correo y teléfono con
`resumen()`. O sea: el nombre de una familia sí sobrevive en master por otra
puerta. Por eso quitar el nombre de la huella **no** se argumenta por
«coherencia con borrar el rastro», sino por el texto de CLAUDE.md y los
precedentes de arriba. Esas rutas no se tocan aquí: tarea aparte.

## Caso límite, sabido

La reserva pública crea citas sin ficha: `book/route.js` deja `clientId` null
cuando el correo no casa con ningún `Client`, y el modelo lo documenta como
válido. Si se borra una cita así, la huella se queda con hora, tipo y
profesional, sin forma de saber de quién era. Se acepta: es lo que pide
CLAUDE.md, y la cita de alguien que no es cliente no tiene otra identidad que
sus datos personales.

## Por qué `cancellationReason` y `meetUrl` se quedan en sus líneas

No entran en el resumen de la fila y, en un diff, solo sale su nombre. Pero
tienen **su propia línea explícita** que ya los guardaba antes de esto:
`citas.booking_status_changed`, `_cancelled` y `_rejected` llevan el motivo, y
`appointment.meet_link_set` el enlace. El 12/09/2026 `siguientes` y
`desprogramar` también guardan `motivo`. Criterio de esta tarea: se quita lo que
solo llegaba con la fila entera; lo que tiene su línea no cambia de
comportamiento aquí. Si se quieren fuera, se pasan a `CAMPOS_PRIVADOS_CITA` y
esas cuatro líneas guardan booleanos (`conMotivo`, `conEnlace`).

## Descartado

- **Filtrar en el hook de `AuditLog.model.js`**: master tendría que conocer los
  campos de un modelo de tenant.
- **Solo arreglar las cinco llamadas, sin red**: la siguiente se olvidaría.

## Lo que se pierde, a propósito

Tras editar una cita no queda en master el valor anterior del contacto ni de
las notas, solo que cambiaron. El vigente sigue en el tenant.

## Queda para Jorge

**Lo ya escrito no se toca en esta tarea.** CLAUDE.md: los logs «no se borran
ni modifican salvo `scripts/podar-audit-logs.js`»; y
`lib/provisioning/bajaTenant.js` lo repite («El CONTENIDO de un registro de
auditoría no se modifica»). Hay que decidir:

- **Las 1.679 filas** (1.550 enteras + 129 huellas con nombre): reescribirlas en
  sitio con un script en seco por defecto que reduzca `before`/`after` a
  `CAMPOS_RESUMEN_CITA` más las claves propias de cada línea y quite `cliente`
  de las huellas (recomendado, añadiendo la excepción en CLAUDE.md), borrarlas
  (se pierde quién creó, editó o borró cada cita) o dejarlas caducar a los 3
  años.
- **Los 913 tokens de cancelación vigentes** copiados en master: no rotarlos
  (recomendado si se limpian las filas: solo Salamandra lee master y cada token
  muere con su cita) o rotar `bookings.cancellation_token`, que rompe el enlace
  «cancelar» de los correos ya enviados.

Mientras no se decida, el arreglo impide que crezcan, no que existan.

# Todo registro tiene un cliente y un miembro del equipo (sprint 2026-07-23)

**Fecha:** 23/07/2026 (reparación del histórico el 27/07) · **Quién:** Jorge ·
**Módulos:** clients, citas, clinica, pacientes, documents, nutricion,
formularios, team · **Lo que quedó en `CLAUDE.md`:** el principio y el
chequeo `npm run db:check-links` (sección «Conexión cliente/equipo»).

## Qué se decidió

**Todo registro del CRM tiene un CLIENTE (externo, para quién es) y un miembro
del EQUIPO (interno, quién lo hace/posee)**, y el enlace es una FK real, no un
texto ni un email.

## Por qué

Los módulos se construyeron independientes y varios cruzaban por texto/email en
vez de por FK real, lo que dejaba registros huérfanos en silencio (p. ej. citas
de Aumenta sin cliente durante meses, porque el cruce ficha↔cita era por email).

## Qué cambió en el código

Enlaces reales añadidos (todos UUID nullable, FK `ON DELETE SET NULL`):

| Tabla | Columna nueva | Enlace |
| --- | --- | --- |
| `bookings` | `client_id` | cita → ficha (sprint citas) |
| `documents` | `client_id` | documento → cliente |
| `clinic_sessions` | `client_id` | sesión → cliente (foto del paciente) |
| `clinical_reports` | `client_id` | informe → cliente |
| `coordinations` | `client_id` | coordinación → cliente |
| `plans` | `team_member_id` | plan → nutricionista |
| `interactions` | `team_member_id` | interacción → autor |
| `client_notes` | `team_member_id` | nota → autor |
| `form_submissions` | `handled_by_team_id` | solicitud → quién la atendió |

Los registros clínicos toman `client_id` del paciente **al crearse** (foto, no
se resincroniza) para no depender del salto paciente→cliente, que es frágil
(`patients.client_id` es nullable y a menudo vacío).

Auto-relleno en el alta: `lib/team/currentTeamMember.js` resuelve el
`TeamMember` del usuario logueado (por `x-user-id`);
`lib/clinica/patientClient.js` resuelve el cliente de un paciente. Los campos
de texto viejos (`created_by`, `handled_by`) se conservan por compatibilidad.

## La red que faltaba

`npm run db:check-links` (solo lectura) recorre los schemas y cuenta registros
sueltos por tabla. Nada avisaba cuando algo se quedaba sin conectar. Se lanza
tras cada sprint que toque estos módulos.

## Reparación del histórico (27/07/2026)

`scripts/backfill-patients-client.js` (ONE_OFF, dry-run por defecto) deduce el
pagador de las PROPIAS citas/sesiones/informes del paciente y enlaza solo si
todas coinciden en el mismo cliente; los ambiguos (padres separados) se listan
para revisión humana. **NO cruza por nombre a propósito**: el cliente es el
tutor que paga y confundir familias sería una fuga de datos clínicos. Deja un
`.rollback.sql` con las filas exactas que tocó.

Estado real comprobado en producción el 27/07/2026: `aumenta` no tenía ningún
paciente suelto (`check-links` lo daba como «todo conectado»), porque el reset
del 24/07 dejó el módulo clínico vacío y los pacientes nuevos ya nacen
enlazados. Los únicos huérfanos estaban en `demo`/`demo_golden` (datos falsos,
sin ninguna prueba de la que deducir el pagador). El script queda como red para
cuando Aumenta cargue pacientes de verdad.

## Pendiente (fuera de aquel sprint)

Llevar estos enlaces a la UI (mostrar y reasignar el cliente desde cada ficha).

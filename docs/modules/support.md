# Módulo Soporte (`support`)

Helpdesk con el que el TENANT atiende a **sus** clientes: tickets numerados
(TK-0042), hilo de conversación con notas internas, adjuntos, categorías,
plantillas de respuesta, SLA con avisos, informes, IA a demanda y un portal
público para el cliente final. Implementado 2026-07-27 (fases 1–3 completas).

**No confundir con:**
- El canal tenant→Salamandra: cuando el tenant NO tiene el módulo, `/soporte`
  degrada a la tarjeta de contacto (mailto a info@salamandrasolutions.com). La
  llave inglesa del pie del sidebar la ve todo el mundo, con o sin módulo.
- `Incidencia` (Clínica): helpdesk interno del Programa de Excelencia.

## Modelos (`models/tenant/`)

| Modelo | Tabla | Notas |
| --- | --- | --- |
| `Ticket` | `tickets` | Ampliado 2026-07-27: `number` (secuencia `ticket_number_seq` por schema, DEFAULT en BD — la app NO asigna números), `contactId`, `categoryId`, `channel` (`manual`/`portal`), `portalToken` (llave única del portal), `requesterName/Email` (foto del alta), `createdBy`, hitos SLA (`firstResponseAt`, `firstResponseDueAt`, `resolutionDueAt`, `closedAt`), `lastMessageAt` (ordena la bandeja). El JSONB `messages` original quedó en BD sin uso. |
| `TicketMessage` | `ticket_messages` | El hilo. `authorType` `team`/`client`/`system`, `isInternal` (jamás sale por portal/email), `emailStatus` (`sent`/`failed`/`skipped`) anota el resultado del email al cliente. |
| `TicketAttachment` | `ticket_attachments` | Metadatos; el binario va a disco `uploads/support/{slug}/{ticketId}/` (`lib/support/ticketStorage.js`, 10 MB/archivo). Adjunto de nota interna NUNCA se sirve por el portal. |
| `TicketCategory` | `ticket_categories` | Configurables por el tenant (nombre + color). |
| `TicketTemplate` | `ticket_templates` | Plantillas de respuesta (macros). |
| `SupportSettings` | `support_settings` | UNA fila: `slaEnabled`, `slaConfig` (horas por prioridad), `portalEnabled`, `portalIntro`, `notifyEmails`, `autoClassify`. |

Migración: `scripts/migrate-support-module.js` (en `MODULES.support`). Dos
pasadas: crear por módulo activo + ampliar/blindar por existencia de `tickets`
(la tabla existe en TODOS los schemas porque el modelo es global). FKs
condicionales con ON DELETE (ticket borrado arrastra hilo y adjuntos; borrar
cliente/categoría/miembro deja el ticket con el campo a NULL).

## SLA (`lib/support/sla.js`)

Objetivos de PRIMERA RESPUESTA y RESOLUCIÓN por prioridad, en horas. Defaults:
critical 2/8 · high 4/24 · medium 8/72 · low 24/120; el tenant los ajusta en la
config del módulo. Los `dueAt` se fijan al crear; si cambia la prioridad se
recalculan los hitos NO cumplidos desde el ALTA. `firstResponseAt` = primera
respuesta PÚBLICA del equipo. Estados por hito: `pending`/`breached`/`met`/
`missed`/`none`. **v1 asume que el reloj NO se pausa en `waiting`** (pausarlo
exige acumular intervalos; se hará si un tenant lo pide).

## Flujo de estados

`open` ⇄ `in_progress` → respuesta pública ⇒ `waiting` → el cliente responde
por el portal ⇒ vuelve a `open` (y si estaba `resolved`, se REABRE limpiando
`resolvedAt`). `resolved` ⇒ email al cliente con enlace por si quiere reabrir.
`closed` = definitivo: el portal no admite más respuestas. Los cambios de
estado dejan nota `system` (interna) en el hilo con quién y cuándo.

## API interna (`app/api/tickets/*`, gate `hasModule("support")`)

- `GET/POST /api/tickets` — bandeja (filtros `status|active`, `priority`,
  `categoryId`, `assignedTo` (`me`/`none`/uuid), `clientId`, `q` — "TK-12"
  busca por número) + recuentos y nº de SLA vencidos; alta manual (valida
  pertenencia de ids, genera SIEMPRE `portalToken`, `notifyClient` opcional).
- `GET/PATCH/DELETE /api/tickets/[id]` — detalle con hilo; cambios con efectos
  (resolved→email, prioridad→recalcula SLA, asignación→aviso); DELETE solo
  admin (borra disco + hilo).
- `POST /api/tickets/[id]/messages` — JSON o multipart (hasta 5 adjuntos).
  Respuesta pública: marca 1ª respuesta, pasa a `waiting`, email al cliente
  (resultado en `emailStatus`). Nota interna: no toca nada.
- `POST /api/tickets/[id]/ai` — `summarize` | `draft` | `classify`. BYOK del
  tenant (`lib/ai/anthropicKey.js`); sin clave → 503. SIEMPRE a demanda.
- `categories`, `templates`, `settings` — CRUD/ajustes (escritura solo admin).
- `GET /api/tickets/stats?months=N` — serie mensual, tiempos medios, % SLA,
  por categoría y por responsable.
- `GET /api/tickets/attachments/[id]` — descarga por stream (attachment+nosniff).

Roles: cabecera `x-user-role` (`ADMIN_ROLES`). Asignación = `TeamMember.id`
(mismo criterio que `Incidencia.assignedToId`); el aviso resuelve su User
master vía `TeamMember.userId`.

## Portal público (`/widget/c/{slug}/soporte`)

API en `app/api/public/c/[tenantSlug]/soporte*` (patrón `withPublicTenant` +
`enforceRateLimit`, como formularios; NUNCA `getTenantContext` en público):

- `GET /soporte` — config (marca, intro, categorías) para pintar el formulario.
- `POST /soporte` — abrir ticket (5/min por IP, honeypot `_hp`, hasta 3
  adjuntos). Matching de ficha por email (`Contact` → `Client`); si
  `autoClassify` está activo y hay clave IA, clasifica prioridad+categoría
  (best-effort, jamás bloquea). Avisos: email de confirmación al cliente con
  su enlace, campana a admins (`ticket_new`) y email a `notifyEmails`.
- `GET/POST /soporte/t/[token]` — seguimiento y respuesta del cliente (reabre;
  aviso `ticket_reply` al asignado o a admins). Token = única llave, 404 sin
  pistas si no casa. `closed` → 409.
- `GET .../attachments/[id]` — descarga con doble candado (ticket del token y
  no-interno).

Páginas: `app/widget/c/[tenantSlug]/soporte/page.jsx` (alta) y
`soporte/t/[token]/page.jsx` (seguimiento). La URL del portal se copia desde
la config del módulo.

## UI dashboard (`modules/support/`)

`SupportModule` (bandeja: pestañas por estado con recuentos, aviso rojo de SLA
vencidos, filtros, deep-links `?ticket=` y `?client=` **leídos de
window.location — NO useSearchParams**: ese hook metía el módulo en una
Suspense boundary del SSR que en Next 16 no se resolvía al hidratar y la página
se quedaba en "Cargando"), `TicketDetail` (drawer regla #13, hilo + propiedades
+ composer respuesta/nota con plantillas y Borrador IA), `NewTicketModal`,
`SupportReports` (KPIs + barras CSS), `SupportConfig` (portal, SLA, avisos,
IA, categorías, plantillas). Sin módulo → la API responde 403 y la UI degrada
a la tarjeta de contacto con Salamandra.

Pie del sidebar (pedido del socio 2026-07-27): **Soporte · Configuración ·
Cerrar sesión**, en ese orden.

## Conversación por CORREO (bidireccional, 2026-07-27 tarde)

El email de Resend es UNA posibilidad, no una obligación:

- **Correo de soporte propio** (`support_settings.support_email`, p.ej.
  soporte@empresa.com): si está, los emails de Resend salen con reply-to a ESE
  buzón — la conversación puede seguir en el Outlook/Gmail del tenant.
- **Dirección de captura** `soporte-{slug}@{RESEND_INBOUND_DOMAIN}`: todo lo
  que llegue ahí lo procesa `app/api/webhooks/resend-inbound/route.js` (firma
  svix verificada a mano con `RESEND_WEBHOOK_SECRET`, ±5 min, rate limit; tras
  firma válida SIEMPRE 200 para no provocar reintentos eternos). Sin
  `support_email`, el reply-to ES la captura (respuesta directa al CRM). El
  buzón propio del tenant captura TODO reenviando a esta dirección (y CC al
  responder desde Outlook) — instrucciones en la config del módulo.
- **Matching del entrante**: nº TK-XXXX en el asunto → remitente con ticket
  activo → si nada, ABRE ticket (email-to-ticket, channel "email"). Remitente ∈
  {support_email, users master del tenant, team_members.email} → mensaje del
  EQUIPO (marca 1ª respuesta y pasa a waiting; no reenvía nada); resto →
  CLIENTE (reabre y avisa). Dedupe de reintentos por (ticket, body, 10 min).
  Cita del reply recortada best-effort (stripQuotedReply); adjuntos solo si
  vienen inline base64 (si no, se anota "(N adjuntos no importados)").
- **Trazabilidad**: `ticket_messages.via` ("crm"/"portal"/"email") +
  `author_email` — el hilo enseña "✉ por correo · quien@escribio.com", también
  si se une un tercero a la conversación.
- **Composer**: checkbox "Enviar por email al cliente" (default sí). Desmarcado
  → la respuesta solo se registra (`email_status` "manual"), para quien
  contesta desde su buzón y no quiere gastar envíos de Resend.
- Envs (plataforma, no por tenant): `RESEND_INBOUND_DOMAIN` +
  `RESEND_WEBHOOK_SECRET` (setup en `.env.production.example`). Sin ellas no
  hay captura y el portal sigue siendo el camino de vuelta.

## SLA por ticket

Los plazos de la config son el punto de partida; cada ticket puede pactarse
aparte: el drawer (SLA → "Ajustar") edita `first_response_due_at` /
`resolution_due_at` (o los quita), y "Según prioridad" los recalcula desde el
alta (PATCH `slaReset: true`). Cambiar la prioridad después vuelve a recalcular
los hitos no cumplidos.

## IA simulada en la demo

La IA del módulo responde en modo SIMULADO en la demo pública
(`demoForcesFakeAi`, como el resto del CRM): resumen/borrador/clasificación
deterministas construidos con los datos del ticket, sin API real (arregla el
401 de "Borrador IA" en demo). El envío de correo real también está cortado en
demo (`isDemoTenant` en emailClient/emailTeam): la demo da admin a anónimos.

## Campana y emails

- `lib/notifications/alerts.js`: `syncSupportAlerts` (tipo auto `ticket_sla`)
  — tickets activos con hito vencido, del TeamMember del usuario y, si es
  admin, también los SIN asignar. Directas: `ticket_assigned`, `ticket_reply`,
  `ticket_new`. `notificationLink("Ticket", id)` → `/soporte?ticket={id}`.
- Plantillas: `lib/email/templates/soporte/ticketClient.js` (created/reply/
  resolved, con enlace del portal) y `ticketTeam.js` (new_portal/assigned/
  client_reply, con enlace al CRM). Vía `sendEmail` (Resend, dry-run sin key).
- URLs absolutas de email: `requestBaseUrl(request)` (x-forwarded-* o origin).

## Demo

`scripts/seed-support-demo.js` — 4 categorías, 2 plantillas y 8 tickets con
hilo y SLA variados (solo si `crm_demo` no tiene tickets). **Tras re-sembrar,
regenerar la foto dorada** (`scripts/demo-golden-snapshot.js`): el demo-reset
del login restaura `crm_demo` desde ella (hecho 2026-07-27, la foto ya incluye
el módulo).

## Deuda conocida

- El reloj SLA no se pausa en `waiting` (ver arriba).
- Adjuntos del correo entrante: solo se importan si el webhook los trae inline
  (base64). Si Resend manda solo referencias, se anota en el hilo sin importar.
- `scripts/enable-module.js` no arranca en Node puro local por la cadena
  `tenantResolver → lib/utils/errors.js → next/server` (preexistente). Rodeo
  usado: fila en `master.tenant_modules` a mano + `ensure-tenant-schema.js`.

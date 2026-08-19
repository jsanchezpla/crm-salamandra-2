# Revisión de la documentación de módulos — 19/08/2026

Lo que salió al escribir el `## Mapa` de los 21 docs de `docs/modules/`
verificando cada ruta contra el código y contra la foto de producción de ese
día (commit desplegado `a24864f`). Son **discrepancias entre lo que dice el doc
y lo que hace el código**, y unas pocas de código. **Ninguna está corregida**:
este fichero es la lista de la compra, no el arreglo. Cuando se corrija un doc,
se borra su sección de aquí (o el fichero entero cuando quede vacío) — una lista
de fallos ya arreglados miente igual que cualquier otra lista a mano.

Regla para corregir: si código y doc discrepan, manda el código; se actualiza
el doc y, si el fallo es de código, se apunta en `docs/backlog.md` por la vía
de `docs/como-apuntar-en-el-tablero.md`.

**Las tres que son de CÓDIGO, no de doc:**
1. `fichaje`: audita `fichaje.volcado`, `fichaje.corregido`, `fichaje.creado_a_mano`,
   `fichaje.dado_de_baja`, `fichaje.volcado_deshecho` y **ninguna tiene frase en
   `lib/actividad/etiquetas.js`** (ni el prefijo en `MODULOS`): en Equipo →
   Actividad salen con el traductor genérico.
2. `pacientes`: la tabla `patients` solo la crea `migrate-clinica-module`, que
   está en el bloque `clinica` de `scripts/_module-migrations.js`. Un
   `enable-module.js <slug> pacientes` sin `clinica` correría las 6 ALTER del
   bloque `pacientes` sobre una tabla que no existe. Hoy no muerde porque
   `clinica` exige `pacientes` y no al revés.
3. Pruebas invisibles para `npm test`: las 4 de outreach se llaman
   `_outreach-*.mjs` y las 5 de nutrición `smoke-nutri-laura-recetario-*.mjs`;
   `scripts/pruebas.mjs` solo recoge `_smoke-*` y `smoke-test-*`.
   `_outreach-ai-unit.mjs` es pura y entraría en `npm test` con renombrarla.

Comentarios de código desfasados vistos de paso: `components/layout/Sidebar.jsx:76`
(«ocho overrides»), cabecera de `scripts/_smoke-leads-etapas.mjs` («SIETE
pantallas»), `lib/provisioning/dependencias.js:452` («siete modelos» de
training), `lib/provisioning/catalogo.js:68` (inventario con «lotes, fórmulas»),
`app/api/outreach/leads/[id]/enviar-correo/route.js:31` (dry-run sin
`RESEND_API_KEY`), `lib/email/resendClient.js:10-11` (`re_test_` fuerza
dry-run y `isDryRun()` no lo implementa), `scripts/dev-mint-wpsso.js:52`
(URL `/mis-citas`), `scripts/seed-support-demo.js:38` (tenant `sandbox` por
defecto). Componentes huérfanos: `components/projects/{ClientProjectsSection,
EmployeeProjectsSection,ConvertLeadToProjectButton}.jsx`,
`app/(dashboard)/clinica/_components/dummyData.js` y
`app/(dashboard)/pacientes/_components/dummyData.js`.

---

## training.md
- «Siete modelos» → son nueve (faltan `CourseRegistration`, `TrainingSyncLog`); `lib/provisioning/dependencias.js:452` repite el «siete».
- Líneas de `lib/db/tenantDb.js` desfasadas (asociaciones hoy en 462-483; `Training` en 139).
- Cita `modules/overrides/aumenta/FormacionOverview.jsx` como vivo (se borró el 18/08); los rótulos están en DOS sitios, no tres.
- «`/api/cuestionarios` acepta `training` o `cuestionarios`» → solo `training`.
- Tabla resumen de webhooks dice `RETORIKA_WEBHOOK_SECRET` → hoy `CRM_WEBHOOK_SECRETS` por tenant.
- «`seed-cuestionarios-demo.js` activa el módulo `cuestionarios`» → comprueba `training`.
- «No registra eventos en AuditLog» → sí: `training.course_registration.created`, `training.sync_manual(_fallida)`.
- `components/training/`: los badges viven en `TrainingBadge.jsx`; faltan 4 componentes.
- «Cuatro rutas sin middleware» → la tabla lista seis.
- Endpoints sin mencionar: `POST /api/training/sync`, `companies/[id]/courses/bulk`, `users/import/preview`, `users/import/template`.
- Código: `lib/provisioning/dependencias.js:452` «siete modelos».

## inventory.md
- «`seed-inventario-demo.js` llena el almacén de la demo» → desde 18/08 lo siembra `seed-sandbox-data.js` (vía rebuild/crear-demos); el otro es extra opcional.
- Código: `lib/provisioning/catalogo.js:68` describe `inventory` con «lotes, fórmulas» (se fueron el 02/08).
- Hueco: no menciona `app/api/proveedores/**` (gateado `billing || inventory`) ni la auditoría `inventory.*`.

## fichaje.md
- «Sus frases están en `lib/actividad/etiquetas.js`» → NO hay ninguna entrada `fichaje.*` ni el prefijo en `MODULOS`: salen con el traductor genérico. (Es un hueco de CÓDIGO, no solo del doc.)

## leads.md
- Habla de «siete overrides», de quality-energy, abarcaia y Referidos (secciones, tabla, seeds, scripts): hoy son 4 overrides y nada de eso existe.
- «No hay endpoint que cree un Project a partir de un lead» → existe `POST /api/leads/[id]/convert-to-project`.
- «No hay rate limiting en /api/public/leads» → hay `enforceRateLimit` (30/min) + `sanearCustomFields` + `notifyAdmins`.
- «El módulo no audita nada» → PATCH/DELETE `[id]` y convert-to-project auditan.
- «12 stages» → 15 (`ALLOWED_STAGES`); «leads o sales» → solo `leads`.
- `GET /api/leads` acepta `desglose=1` (+`excluirOrigen`); plantillas por tenant: solo `spain_enzymes`.
- «No existe migración multi-tenant» → dos registradas en `_module-migrations.js`.
- No menciona `/leads/estadisticas`, `GET /api/leads/estadisticas`, `lib/leads/estadisticas.js`.
- Líneas por override desfasadas (base 779, retorika 582, spain-enzymes 1062, nutri-laura 1877).
- Código: `components/layout/Sidebar.jsx:76` («ocho overrides») y cabecera de `_smoke-leads-etapas.mjs` («SIETE pantallas») desfasados.

## formularios.md
- Título «Módulo Formularios» → en menú/página es «Leads Comerciales» desde 01/08.
- `retentionDays` no lo lee nadie (solo seeds).
- Faltan en la tabla `DELETE /api/formularios/{id}` (solo descartadas) y los firmados `registro-web` / `registro-web/sync`.
- «Cazar a quien entra con otro correo»: el canje SSO ya no deja solicitud (05/08); `registro-web` responde 200 sin crear; solo `sync` crea en lote.
- `enable-module.js` ya abre las dos puertas para admins; el doc solo cita `grant-module-access.js`.

## analytics.md
- «`--force` necesario la primera vez» → sobra: `analytics` está en `_module-migrations.js`.
- Cita «regla 14» para secretos → es la #15.

## clinica.md
- «Activado solo en aumenta» → también demo, demo_clinica, somos.
- Lista de endpoints corta (6) → hay 35 route.js; «cuatro modelos» → 10; páginas «2» → 5, equipo «5» → 6.
- Tablas de modelos desfasadas: `ClinicSession.therapistId` ya nullable; `status` ENUM tiene draft/ai_pending/registered/published (default registered); faltan campos (prepText, prepFiles, parentFeedback, clientId, scope, externalEntity, deliveredDocumentId, roleKey/areaScores…); `reportType` añade `referral`; `proposedIncentive` va por tramos, no IA.
- Sidebar: Clínica tiene también Coordinaciones/Talleres/Estadísticas; Equipo usa `requiresAll: ["team_avanzado","clinica"]`.
- Sección «Migración» presenta `migrate-clinica-sprint-1.js` (ONE_OFF) como la viva; la viva es `migrate-clinica-module.js`.
- «Tenants»: lista quality_energy y abarcaia (purgados).
- `app/(dashboard)/clinica/_components/dummyData.js` y `pacientes/_components/dummyData.js` sobreviven sin que nadie los importe.

## pacientes.md
- «Solo en aumenta» → también demo, demo_clinica, somos.
- «`clients` no se usa en el flujo clínico», «vinculación pendiente» → ya existe `patients.client_id`, `ClientPatientsSection`, `PacientesDelAlta`, backfill.
- Tabla del modelo sin `clientId, careType, specialties, objectives, dni, address, relationship, consents`.
- «4 tabs» → la ficha tiene además consentimientos, contactos externos, plan, documentos, facturación.
- «Migración» describe el ONE_OFF; backlog «CRUD Patient» ya hecho.
- ⚠️ CÓDIGO: la tabla `patients` solo la crea `migrate-clinica-module` (bloque `clinica` de `_module-migrations.js`); `enable-module.js <slug> pacientes` sin `clinica` correría 6 ALTER sobre una tabla que no existe. Hoy no muerde porque clinica exige pacientes y no al revés.

## outreach.md
- «Falta desplegar en producción» → está en 5 tenants de prod; `sandbox` no existe en prod (las pruebas con servidor firman JWT de `admin@sandbox.local`).
- Cita «regla #14» para secrets → #15.
- «Sin RESEND_API_KEY el envío es dry-run» → la clave es por tenant sin fallback de entorno; comentario viejo también en `enviar-correo/route.js:31`.
- Puesta en marcha no menciona `enable-module.js`.
- Sus 4 pruebas se llaman `_outreach-*.mjs` y `npm test` NO las ve (solo recoge `_smoke-*` y `smoke-test-*`); `_outreach-ai-unit.mjs` es pura y podría entrar renombrándola.

## nutricion.md
- «23 endpoints» → 24 (`recipes/[id]/propagate` del 13/08). «Tenant activo: nutri_laura únicamente» → cinco.
- §1 aún habla de OpenFoodFacts y «otros tenants: NO disponible; replicar = re-ejecutar scripts» — contradice §2 (`enable-module.js`).
- §3 esquema pre-rework: faltan `recipes`, `recipe_foods`, `plan_meal_option_recipes`, `plan_meal_option_recipe_foods` y columnas (`day_comments`, `show_macros`, `team_member_id`, `weekday`, `photo_path/steps`, `*_snapshot`).
- §5 tabla de endpoints se queda en C1/C2 (faltan `foods/tags`, `recipes/**`, `plans/[id]/pdf|send-email`, `options/[optionId]/recipes/**`).
- §8: los `smoke-nutri-laura-recetario-*.mjs` NO los descubre `npm test` (solo `_smoke-*`/`smoke-test-*`); C1 hoy comprueba 404 de OFF.
- §9 omite 6 migraciones vivas y enseña como comando los dos scripts históricos.
- `ClientPlansPanel.jsx` vive en `modules/nutricion/`, no «dentro de default/ClientDetailModule`.

## configuracion.md
- «`always: true` en el sidebar» → no existe; es el engranaje del pie, solo admin; `GET /api/tenant/settings` también solo admin.
- «Razón de ser: claves de IA para Outreach» / «dos tarjetas» → hoy Stripe, Cloudflare, WhatsApp, Resend, candado IA, 10 interruptores de Citas, categorías externas, derivaciones.
- GET/PATCH: listas cortas; el código devuelve/acepta mucho más (openai, cloudflare, whatsapp, resend, stripe, aiAccess, citas.*, categoriasExternas).
- «Interruptores de Citas: cuatro» → diez. «`vetoAi` en 7 endpoints» → 11.

## documents.md
- «Implementados en local, sin desplegar» → en prod en 6 tenants (avanzado en 3). «Tenants: demo, sandbox» obsoleto.
- §2 describe `enable-documents-all-tenants.js` + `sprint-1`; hoy `enable-module.js` con las 5 migraciones. Los npm `db:*:documents:prod` llevan `--env-file=.env.production` que no vale.
- §3.2 modelo incompleto (`client_id`, `patient_id`, `source`, `client_visible`, `uploaded_by_client`); `mime_type` ya libre (VARCHAR 150), no CHECK pdf/docx/xlsx.
- «Todos con `hasModule("documents")`» → 7 de 9 exigen `documents_avanzado`; faltan `contrato-servicios(/download)` en la tabla.
- Backlog «cuota vía featureFlags» no existe. §9 sin `ContratoServiciosCard.jsx` ni prop `avanzado`.

## citas.md
- «Tenants: nutri_laura única con flujo activo» → 6 tenants (aumenta con 12.030).
- `/equipo/ocupacion` «moduleKey citas» → `requiresAll: ["team_avanzado","citas"]`.
- «`Booking` NO tiene FK a `Client`; cruce por clientEmail» (×3 sitios + backlog) → ya hay `clientId`, `patientId`, `teamMemberId`, `packId`.
- «Cancelar no dispara email; pendiente» → existe `notificarCancelacion.js` + plantilla.
- Tablas de endpoints incompletas (públicos: `availability/month`, `pagar/[token]`; portal: `admision`, `avisos`, `comunicaciones`, `consentimiento-imagen`, `mis-datos`; admin: `avisos`, `pedir-tarjeta`, `reschedule-request`, `suggest-slots`, `reschedule-requests`, `sin-profesional`).
- «default sin lista de espera» → la lleva desde 22/07. «Override nutri_laura CitasModule.jsx» y `overrides/nutri-laura/ClientBookingsPanel.jsx` → NO existen (default; panel en `components/clients/`).
- «Migraciones: solo migrate-booking-pending» → 15 en `MODULES.citas`.

## citas-embed.md
- «Reemplazar cuando lleguen emails y restricción de dominio» → llegaron; CSP ya es por tenant (`WIDGET_FRAME_ANCESTORS`); `?wpa=1` ya no prueba nada (05/08); `/mis-citas` es redirect a `mi-perfil` (también en `dev-mint-wpsso.js:52`); portal tiene 13 endpoints, no 3; `configure-nutri-laura-citas-portal.js` superado por `configure-portal-citas.js`; TODO emails ya hecho.

## emails.md
- «3 templates de citas» → 16 plantillas en 6 carpetas.
- «Configuración: RESEND_API_KEY en .env.production» → modelo BYOK por cliente (`settings.integrations.resendApiKey`), la del entorno va vacía a propósito; el doc no menciona BYOK ni `OUTREACH_FROM_EMAIL/REPLY_TO`.
- «Añadir template» propone try/catch a secas; no menciona `envioRealizado`, `apiKey`, `attachments`, `tags`, guard de demo, ni el correo ENTRANTE (`webhooks/resend-inbound`).
- Código: cabecera de `lib/email/resendClient.js:10-11` dice que `re_test_` fuerza dry-run y `isDryRun()` no lo implementa.

## billing.md
- «`POST /invoices/[id]/send` informativo / botón Marcar como enviada» → envía el PDF por Resend.
- «`Cost.inventoryProductId` asociado en Sequelize» → no hay asociación.
- «líneas con `outboundProductId` disparan FIFO sobre `InboundBatch`» → desde 02/08 solo AVISA; `InboundBatch`/`Formula` no existen.
- «cada línea se escribe a mano» → el editor elige producto de Inventario.
- Páginas: lista 10, hay 17 (faltan presupuestos, proveedores, arqueo, cumplimiento, analitica/socios); `/facturacion` es el Panel y los KPIs están en `/resumen`.
- Endpoints: faltan `quotes` (4), `pdf`, `bulk-pdf`, `analytics/partners`, `exports/*` (7), `morosidad`, `operations`, y `arqueo`/`proveedores` fuera de la raíz.
- Modelos: `patientId` no es legacy (`patientLink.js`); faltan `partnerId`, `irpf*`, `correctionReason`, `Cost.supplierId`, `type` `tax`; sin sección `Quote`, `Supplier`, `CashPoint`, `CashClose`.
- «`master.tenants WHERE status='active'`» → usa `_schema-targets.js` sin filtro. `npm run …:prod` + `docker cp` → patrón es `docker exec`. Backlog: PDF y Presupuestos ya existen.

## pagos.md
- **Grande**: §4 entera + fase 4 + §7 hablan de reembolso automático; desde 07/08 (Rodrigo) `politicaReembolso.js`: NO se devuelve nunca, solo se sueltan retenciones (`_smoke-no-se-devuelve.mjs`).
- «`checkout.js` sin llamantes» → `book/route.js:928` lo llama (bonos y plazos).
- «Pedir otra tarjeta no está construido» → construido (endpoint, token, página, plantilla, botón, 3 pruebas).
- «la lista de espera se elimina» contradice §3 paso 5 y el código.
- `healim` como tenant (purgado). Hold «15 min» vs 20 (`VENTANA_TARJETA_MS`).
- «No hay framework de tests» → `npm test` desde 18/08; la tabla se quedó en 29/07 (faltan 9 pruebas).
- No menciona plazos (`fraccionado.js`), bonos (`SessionPack`), vigilante (`vigilar-retenciones.js`), `dinero.js`, `stripe_webhook_events`.

## support.md
- Fallback sin módulo «mailto info@» → desde 13/08 enlaza a `/ayuda` (Buzón).
- Pie del sidebar → Ayuda · Soporte · Configuración · Cerrar sesión.
- Deuda «`enable-module.js` no arranca en Node local» → sí arranca; el rodeo sobra.
- Tenant de ejemplo `sandbox` (doc y `seed-support-demo.js:38` por defecto) no existe en local ni prod.
- `attachments/[id]` → carpeta real `[attachmentId]` (cosmético).

## clients.md
- «Tenants: spain_enzymes, nutri_laura, demo, retorika» → `clients` está en los 11.
- Tabla de endpoints: faltan 9 de 26 (`contact-methods`, `comunicaciones`, `module-assignments`, `portal-user`, `plans`, `waitlist`, `urgentes`, `contract/firmado/[documentoId]`, PATCH de attachments).
- «seis pestañas desde 12/08» → `pestanasDe()` define nueve.
- «`migrate-client-module-assignments.js` solo nutri_laura» → corre en todos; solo la fase C es de ella.

## projects.md
- «Sprint 2 pendiente de deploy» / «tenants: demo, aumenta» → desplegado; 5 tenants en prod. Sección 12 «pasos para subir» caducada.
- Activar con `INSERT INTO master.tenant_modules` → `enable-module.js`.
- «`/proyectos/[id]` 6 tabs» → 4 (Resumen, Equipo, Fases, Configuración).
- No aparecen la IA de Proyectos (`AiProjectModal`, `AiEditModal`, `lib/projects/ai/`, 4 endpoints), `PriorityBadge`/`StatusBadge`, `checklist.js`, `lib/calendar/projectEvents.js`.
- SQL de detección con `status='active'` (regla 12).
- Código: `ClientProjectsSection.jsx`, `EmployeeProjectsSection.jsx`, `ConvertLeadToProjectButton.jsx` huérfanos (nadie los importa).

## team.md
- «Una sola página, un solo modelo» → 10 páginas bajo /equipo, 3 modelos.
- «Lo que NO hace: permisos por módulo» → sí (`/api/team/[id]/access`, 27/07).
- Tabla de campos sin `blockColor`, `annualGross`, `paymentPeriods`, `specialties`, `weeklyDirectHours`.
- Endpoints: faltan `me`, `me/documents(+[id])`, `[id]/hours`, `[id]/modules`, `[id]/projects`.
- «Actividad sin moduleKey» → `team_avanzado` (Sidebar y `GET /api/actividad`).
- «schemas activos» en migrate-team-fields → ya no filtra.
- CLAUDE.md dice «16 endpoints» de team_avanzado → son 18.

## buzon.md
- Solo omisiones: no menciona `lib/buzon/quienEscribe.js` ni `scripts/buzon-triaje.mjs` / skill `incidencias-buzon`.

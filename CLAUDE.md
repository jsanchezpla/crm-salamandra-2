# CRM SaaS Salamandra Solutions

## Quién soy

Soy Jorge, informático de Salamandra Solutions. Construyo un CRM SaaS
multi-tenant para vender como producto a empresas. Actúas como mi arquitecto y
senior developer de referencia.

> **Este fichero son las REGLAS y las TABLAS.** El porqué de cada regla —qué
> pasó, con qué cliente, qué se midió— vive en `docs/decisions/` (una decisión
> fechada por fichero, índice en su README). Adelgazado de 1.012 a menos de 400
> líneas el 19/08/2026 para que quepa en la cabeza sin echar a nada.

---

## Documentación

**Antes de tocar un módulo, lee el `## Mapa` de su doc** (las 30 primeras
líneas: dónde vive cada cosa, verificado contra el código el 19/08/2026) y
luego lo que toque del resto. Si código y doc discrepan, **manda el código**:
actualiza el doc.

| Doc (`docs/modules/`) | moduleKey | Doc | moduleKey |
| --- | --- | --- | --- |
| `clients.md` | `clients`, `clients_avanzado` | `training.md` | `training` (incluye Cuestionarios) |
| `leads.md` | `leads` | `citas.md`, `citas-embed.md` | `citas` |
| `formularios.md` | `formularios` (requiere `leads`) | `pacientes.md` | `pacientes` |
| `projects.md` | `projects` | `clinica.md` | `clinica` |
| `billing.md`, `pagos.md` | `billing` | `nutricion.md` | `nutricion` |
| `team.md` | `team`, `team_avanzado` | `outreach.md` | `outreach` |
| `inventory.md` | `inventory` | `support.md` | `support` |
| `documents.md` | `documents`, `documents_avanzado` | `analytics.md` | `analytics` |
| `booking.md` | `booking` | `tienda.md` | `tienda` |
| `fichaje.md` | `fichaje` | `configuracion.md` | — (siempre visible) |
| `emails.md` | — (infra transversal) | `buzon.md` | — (todos, `/ayuda`) |
| `banco.md` | `banco` | | |

Sin doc dedicado: `calendar`, `orders`, `provisioning` (`lib/provisioning/`).
`docs/base/` es una foto técnica del 07/08/2026 (léela con su aviso);
`docs/refactor-base-override/` está **superado** (18/08). **Registro** (backlog
y resuelto): desde el 19/08/2026 vive en `master.tablero_documentos`, NO en el
repo; se baja, se edita y se publica con `node scripts/registro.mjs
bajar|subir` (copia de trabajo en `docs/registro/`, gitignored), sin commit ni
despliegue. Desde el 24/08 **también se escribe desde `/admin/tablero`**
(apuntar, cambiar prioridad, reescribir, cerrar, borrar y colgar capturas), por
la MISMA puerta: mismos frenos, misma versión, mismo historial. Secciones:
`Alta`/`Media`/`Baja` + `Pendiente de una decisión suya` + `Sin comprobar` (las
viejas `P0`…`P3` se leen, no se escriben). Antes de apuntar nada,
`docs/como-apuntar-en-el-tablero.md`.

---

## Stack técnico

| Capa | Tecnología |
| --- | --- |
| Frontend+Backend | Next.js 16 (App Router + Route Handlers), **JavaScript puro, sin TypeScript, sin `src/`** |
| Base de datos / ORM | PostgreSQL / Sequelize · un schema por tenant (`crm_{slug}`) |
| Estilos | Tailwind CSS 4 |
| Despliegue | VPS propio, Docker Compose, nginx nativo |
| Automatizaciones | n8n (instancia propia); el CRM dispara webhooks |
| IA | Claude (Anthropic) + Whisper (OpenAI), **clave por tenant** (BYOK) |
| Editor / lint | VS Code, ESLint 9 flat, Prettier 3 (config en sus ficheros) · terminal **PowerShell** en local, bash en el VPS (`curl.exe` en local, `curl` allí) |

---

## Local vs producción

Dos entornos con bases de datos independientes; el schema viene del código y
es el mismo, **los datos y la lista de tenants/módulos NO** (`spain_enzymes`
tiene módulos en local que en producción están apagados). Nada de scripts con
slugs hardcodeados: se lee `master.tenants` en tiempo de ejecución.

| | Local | Producción (VPS) |
| --- | --- | --- |
| Arranque | `npm run dev` (Windows 10) | `docker compose` en `/opt/crm-salamandra` |
| Config | `.env.local` (gitignored) | `.env.production` en el VPS (gitignored, NUNCA en el repo; ejemplo en `.env.production.example`) |
| Contenedores | — | `crm-salamandra-app-1` (Next, `127.0.0.1:3000`), `crm-salamandra-db-1` (postgres 16), `n8n` (`127.0.0.1:5678`), `n8n-postgres` |
| Scripts | `node --env-file=.env.local scripts/x.js` | `docker exec -it crm-salamandra-app-1 node scripts/x.js` (sin `--env-file`; **nunca `npm run *:prod` en el host**) |
| Consultas de solo lectura desde local | — | `ssh crm-vps 'docker exec -i crm-salamandra-app-1 node --input-type=module -' < consulta.mjs`; nunca imprimir filas con datos personales |
| Scripts que leen el repo (`sincronizar-ui-override.mjs`) | — | `docker run` montando `/opt/crm-salamandra` (la imagen NO lleva `app/` ni `docs/`) |

**Deploy** (`./deploy.sh` en el VPS, a mano): `git pull` → si `package.json`
no cambió, `npm run build` en el host y `docker compose up -d --build --no-deps
app`; si cambió (o `--full`), `npm ci` + build + `down` + `up`. El build va en
el host porque necesita devDependencies; el Dockerfile (`node:22-alpine`,
usuario `nextjs`, `npm ci --omit=dev`) solo copia `.next/`, `public/`, `lib/`,
`models/`, `scripts/`, `next.config.mjs`.

---

## Arquitectura multi-tenant

```
PostgreSQL DB: salamandra
├── schema: master             ← tenants, users, tenant_modules, audit_log, tablero_estado, buzon_*
├── schema: crm_{slug}         ← un schema por cliente
└── schema: crm_{slug}_golden  ← foto limpia de cada demo, para reponerla (lib/demo/resetDemo.js)
```

- Siempre `getTenantContext` / `withTenant` (`lib/tenant/`): cachea 60 s y da
  `hasModule`, `hasFeatureFlag`, `getLogicOverride`. Al tocar config de un
  tenant → `invalidateTenantCache(slug)`. Nunca conectar directo a PostgreSQL.
- **Personalización por módulo** (`master.tenant_modules`), en orden de coste
  y con lo que el código LEE de verdad (comprobado en producción el 19/08/2026):
  `featureFlags` (interruptores; hoy el código lee TRES: `training.formacionAbierta`,
  `nutricion.autoAsignarEnAlta`, `citas.autoConfirmPublicBookings`),
  `logicOverrides` (parámetros; **primer lector real el 26/08/2026**:
  `documents.quotaBytes` — la cuota de disco por cliente,
  `lib/documents/documentStorage.js` `quotaBytesDe(ctx)`; los `training` de
  aumenta y nutri_laura siguen inertes), `schemaExtensions` (**decorativos**, el código no
  los lee) y `uiOverride` (**letrero**: la pantalla la elige el mapa
  `UI_OVERRIDES` de cada página; se mantiene fiel con
  `scripts/sincronizar-ui-override.mjs` y solo la enseña `/admin/modulos`).
- Marca por tenant en `tenant.settings.brand` (`primaryColor`,
  `secondaryColor`, `logoUrl`) → `var(--color-primary)` / `--color-secondary`
  en el layout. El login de Salamandra usa paleta fija (`#FAFAF8` + `#1B3A2D`).

**Carpetas**: `app/` (rutas: `/api`, `(auth)`, `(dashboard)`, `admin/`,
`portal/`, `widget/`), `components/`, `lib/` (33 carpetas: db, tenant, auth,
billing, team, leads, training, clients, clinica, citas, nutricion, outreach,
provisioning, demo, email, ai, pdf, utils…), `models/` (`master/`, `tenant/`),
`modules/` (UI base por módulo; `modules/overrides/{slug-con-guion}/` solo
para lo propio de UN cliente), `scripts/` (seeds, migraciones, mantenimiento;
`_smoke-*.mjs` son las pruebas; lo que ya se ejecutó y no volverá vive en
`scripts/_hechos/` —criterio y mecánica en su README— y
`node scripts/_inventario-scripts.mjs` dice qué está vivo y quién lo llama;
un script sin referencias que se ha leído y sigue vivo lo declara con
`// @vivo — motivo` en su cabecera), `docs/`.

---

## Modelos

**`master`**: `Tenant` (slug, plan, status, settings JSONB), `User` (email,
passwordHash, role, tenantId, `moduleAccess`), `TenantModule` (moduleKey,
enabled, uiOverride, logicOverrides, featureFlags, schemaExtensions),
`AuditLog`, `BuzonAviso`/`BuzonMensaje`/`BuzonAdjunto` (el cliente nos escribe
a NOSOTROS; en master y **sin FK** a propósito, para sobrevivir a su baja —ver
`docs/modules/buzon.md`), `TableroDocumento` (el TEXTO del Registro: backlog y
resuelto, una fila por versión, append-only), `TableroEstado` (tick, reparto y
solución, encima del texto, casados por título normalizado) y `TableroAdjunto`
(capturas; cuelgan de la **ficha** `<!--id:…-->` escrita dentro del texto, NO
del título, para que no queden huérfanas; sin FK, las caduca
`podar-tablero-adjuntos.js`).

**Tenant** (`models/tenant/`): `Client`, `Contact`, `Lead` (oportunidad
comercial), `Project`/`Task` (Kanban), `Ticket*`/`SupportSettings` (helpdesk
del tenant hacia SUS clientes), `Invoice`/`RecurringInvoice`/`Payment`/`Cost`/
`Rate` (FK a `TeamMember` se llama `employeeId`, alias `employee`),
`TeamMember`, `Asset`, `Product`/`StockEntry`/`StockMovement` (inventario
rehecho el 02/08/2026: el stock es la suma de movimientos; `Supplier` compartido
con Gastos), `CashPoint`/`CashClose` (arqueo: `difference` es la foto del día),
`Course`/`CompanyCourse`/`TrainingUser`/`CourseEnrollment`/`QuizAttempt`/
`Company`/`Training`, `OutreachLead`/`OutreachContact`/`OutreachAnalysis`/… (**no
confundir `OutreachLead` con `Lead`**: empresa captada vs oportunidad; sin FK
entre ellos), `Patient`, `ClinicSession`, `ClinicalReport`, `Coordination`,
`PerformanceMetric`, `Notification`, `Message`.

⚠️ `Client.address` es JSONB, no texto (tumbó la ficha una vez; ver
`docs/decisions/2026-08-01-alta-de-clientes-por-perfil.md`).

---

## Tenants (foto de producción del 19/08/2026)

Slugs y schemas con **underscore** (`nutri_laura`, regex `[a-z0-9_]`); las
carpetas de `modules/overrides/` con guión (`nutri-laura/`). **Aquí no se
listan los módulos de cada cliente**: la lista a mano mintió en 5 de 8 (ver
`docs/decisions/2026-08-10-las-listas-copiadas-a-mano-mienten.md`); se miran
en **`/admin/modulos`**, `/admin/integraciones` o
`node scripts/inspect-tenant-modules.js <slug>`. Aquí va lo que la base de
datos NO sabe: quién es cada uno y qué no se le puede tocar.

| Slug | Quién es y qué hay que saber |
| --- | --- |
| `aumenta` | Centro de psicología y formación, **la reina del módulo clínico y el que más usa el CRM**: 1.083 fichas, 1.174 pacientes, 12.030 citas, 22.045 sesiones, 14.243 facturas, 15 personas (13 logins `nombre_aumenta` con rol `user`; dirección usa admin@aumenta.es). CRM en uso REAL desde 24/07/2026: **NO wipear ni sembrar sin permiso.** Agenda compartida ENCENDIDA (01/08, Rodrigo): todo el equipo ve la agenda y los datos de contacto. Desempeño/Dirección/Productividad SOLO admin. Nutrición **sin** `autoAsignarEnAlta` (=apagado): con 1.083 familias marcaría de dietas a quien solo va a terapia; no encender sin que lo pidan (`backfill-nutricion-assignments.js` respeta el flag). Formación con `formacionAbierta` encendido (portada abierta, sin Empresas ni Cuestionarios). Su única pantalla propia: Leads, idéntica al base salvo el rosa `#FF1F96` — se conserva a propósito. El sidebar dice «Interesados». |
| `nutri_laura` | Laura, nutricionista: **la reina de Nutrición**. `clients` se rotula «Pacientes» (`lib/clients/vocabulario.js`): **NO tiene `clinica` ni `pacientes`**, sus pacientes son `Client` con plan. Pantallas propias: ficha de cliente (cabecera + tarjeta + pestañas, con los paneles compartidos de `components/clients/`) y embudo de Leads. Interruptores: `nutricion.autoAsignarEnAlta=true`, `citas.autoConfirmPublicBookings=false`. 82 solicitudes de formularios, 16 fichas, 4 pautas. **No cambiar su comportamiento ni sus datos sin permiso.** |
| `retorika` | Academia online (WordPress + TutorLMS): la referencia de Formación completa. 8 cursos, 526 intentos de cuestionario reales — la tabla `quiz_attempts` no se toca. Pantalla propia: Leads. |
| `spain_enzymes` | Cliente real (**sigue siéndolo**). Su web (spainenzymes.com, WordPress) manda leads a `/api/public/leads`. En producción tiene ENCENDIDOS `analytics`, `clients`, `leads` (pantalla propia) y APAGADOS `billing`, `inventory`, `orders`, que en local sí están: no dar por buena la lista de local. |
| `somos` | Alta 12/08/2026, 21 módulos (todo lo que se vende), **sin un solo dato aún**, paleta `#124A55` + `#F59C00` (`scripts/_hechos/update-somos-brand.js`). Quién es y qué no se le puede tocar lo sabe Jorge o Rodrigo: sigue sin escribir. |
| `gm_alvar_alonso` | Alta 14/08/2026, plan starter, `clients` + `leads` + `team`, sin datos, 1 admin. **No aparecía en este fichero hasta el 19/08/2026**; quién es, lo sabe Jorge o Rodrigo. Ve el módulo base de Leads. |
| `demo` | Escaparate con datos FALSOS y casi todos los módulos. **Pública y da sesión de admin a cualquiera**: todo endpoint que mande correo, gaste IA o escriba en master necesita el guard de `lib/demo/isDemo.js`. No es la reina de nada. |
| `demo_clinica`, `demo_nutricion`, `demo_agencia` | Demos por oficio (13/08/2026): el visitante entra por `demo` y salta desde unas pestañas. Públicas, mismos guards (`isDemo.js` cubre a las cuatro). Quién es cada una en `lib/demo/demos.js`; se rehacen con `scripts/crear-demos-por-oficio.js`, **no se dan de baja desde el panel**. |
| `salamandra_solutions` | Nosotros. Único con `provisioning` (abre el back-office `/admin`). No es un cliente: no cuenta en los recuentos. En local solo la ficha, sin schema. |

Bajas del 12/08/2026 (`abarcaia`, `quality_energy`, `healim`): purgadas, volcado
en el VPS, sus nombres siguen a propósito en `app/api/admin/tablero/route.js`
(ver `docs/decisions/2026-08-12-bajas-abarcaia-quality-healim.md`).

**Las reinas mandan sobre el default**: un cambio en un módulo va a TODOS los
que lo tienen (incl. demo) por defecto; `overrides/{slug}/` solo cuando un
cliente se desvía DE VERDAD. Cuando un segundo cliente pide algo distinto en un
módulo, la primera pregunta es «¿la reina querría esto también?».

**Overrides hoy** (19/08/2026, letrero de prod = código): **5 pantallas propias
en 4 clientes** — Leads de aumenta, nutri_laura, retorika y spain_enzymes, y la
ficha de nutri_laura. Se encogen por oportunidad, nunca en un sprint; nada
nuevo entra salvo lo propio de UN cliente; un dato que el servidor necesita se
declara en `lib/` (`lib/leads/embudos.js` + `_smoke-leads-etapas.mjs`). La
historia y lo que ya encogió, en
`docs/decisions/2026-08-18-la-piramide-invertida-de-leads.md`.

---

## Módulos

La fuente de qué módulos existen como concepto es `components/layout/Sidebar.jsx`.
Placeholders sin página (nadie los activa): `planning`, `ai`, `automations`,
`integrations`, `communications`. Retirados: `sales` (12/08/2026: la única clave
comercial es `leads`), `referidos` (12/08), `cuestionarios` (10/08: pantalla de
`training`). Las filas apagadas que quedan en `tenant_modules` no molestan.

| moduleKey | Qué es | Notas |
| --- | --- | --- |
| `clients` / `clients_avanzado` | Fichas (o «Pacientes» donde el cliente ES el paciente) / lista de espera de admisión + «Fichas a completar» (`/clientes/urgentes`) | Rótulo por módulos en `lib/clients/vocabulario.js`; alta por perfil (`salud`/`comercial`) en `lib/clients/formularioAlta.js`; paneles de la ficha por módulos en `lib/clients/piezasFicha.js`. `urgentes` gatea las TRES puertas (menú, página con `notFound()`, endpoint). |
| `leads` / `formularios` | Grupo «Leads»: Profesionales (embudo, `/leads`) / Comerciales (web → bandeja, `/formularios`); el padre del grupo es `/leads/estadisticas` | `formularios` requiere `leads`. Etapas por cliente en `lib/leads/embudos.js`. |
| `projects` | Kanban | — |
| `billing` | Facturas, cobros, morosidad, gastos, tarifas, recurrentes, arqueo, Verifactu | FK a equipo = `employeeId`. Desde el 29/08/2026 el webhook de Stripe registra los cobros online solo (`lib/billing/cobroDesdeStripe.js`) y Cobros enlaza a Stripe y al banco. |
| `banco` | Extracto real del banco (PSD2, solo lectura, GoCardless) y conciliación con cobros y gastos; del cobro se salta al movimiento | Requiere `billing`. Credenciales BYOK en Configuración → Conexiones; pantalla `/facturacion/banco`. |
| `team` / `team_avanzado` | Plantilla, usuarios, roles / Desempeño, Dirección, Productividad, Incidencias, Bandeja, Ocupación, Actividad | Los submenús del avanzado exigen `requiresAll` (avanzado + el módulo que aporta el contenido). |
| `documents` / `documents_avanzado` | Solo el contrato del centro / archivo completo (carpetas, buscador, cuota) | **Ya NO exige `citas`** (24/08/2026, Rodrigo): era una regla de venta, no del código. Sin Citas se sube, se ve y se descarga, pero no hay área privada donde firmarlo. Sigue exigiendo `clients`. |
| `inventory` | Productos, entradas, movimientos; `Supplier` compartido con Gastos | — |
| `training` | Cursos, alumnos, matrículas, empresas, cuestionarios; TutorLMS por webhooks HMAC | Interruptor `formacionAbierta` (`lib/training/formacionAbierta.js`) esconde Empresas y Cuestionarios. |
| `citas` | Reservas, portal SSO, widget público | Interruptor `autoConfirmPublicBookings`. |
| `calendar`, `orders` | Calendario; pedidos | Sin doc. |
| `tienda` | Ecommerce encima de Inventario: escaparate público (widget + shortcode `[crm_tienda]`), carrito y pago con Stripe | Requiere `inventory`+`orders`+`clients`. Los productos SON los de Inventario (solo añade campos de escaparate y variantes); el pedido nace en `draft` y **solo el webhook** confirma y descuenta stock. Pantalla `/tienda`. Reina: `laura_ubeda`. |
| `pacientes` / `clinica` | Fichas de paciente / sesiones (audio→Whisper→Claude), informes, coordinaciones (`/clinica/coordinaciones`), estadísticas del centro (`/clinica/estadisticas`, solo dirección) | El cliente es la familia que paga; el paciente, el hijo. Alta con pacientes en la misma transacción. |
| `nutricion` | Recetario, alimentos, plantillas, Pautas (`/nutricion/asignados`) | Componentes en `modules/nutricion/`; `enable-module.js` siembra 497 alimentos. Interruptor `autoAsignarEnAlta`. |
| `outreach` | Captación: empresas + scoring con IA | — |
| `booking` | Contratación de actuaciones (agencias de management y artistas) | **No trae pantallas: cambia las que hay.** Embudo de Leads → `EMBUDO_BOOKING` (`lib/leads/embudos.js`), `/leads` se rotula «Propuestas» y Clientes «Contratantes» (`lib/clients/vocabulario.js`). Requiere `clients` + `leads`. Es el primer módulo que decide vocabulario y embudo, y **se pregunta por módulo, nunca por slug**. Reina: `laura_ubeda`. |
| — | **Correo** (`/correo`): un mensaje a muchos, eligiendo remitente | Sin `moduleKey`: se ve con `clients` **o** `outreach`. Manda UNO POR DESTINATARIO (nadie ve la lista de los demás). Remitentes en `settings.integrations.remitentes` (`lib/email/remitentes.js`), con caída al `resendFromEmail` de siempre. El dry-run se cuenta como «simulado», nunca como enviado. Desde el 26/08/2026 habla el idioma del centro (`vocabulario.js`, nada de «Contratantes» en una clínica), con `pacientes` lista tutores+pacientes y filtra por profesional/terapia, y tiene listas guardadas, plantillas ilimitadas, adjuntos (imagen/PDF) y pies de firma por persona (tablas `correo_*`, `lib/correo/`). |
| `support` | Helpdesk hacia SUS clientes: nº correlativo, SLA, portal público | Correo ENTRANTE aún sin dar de alta en Resend. |
| `analytics` | Visitas web (Cloudflare) | Credenciales POR CLIENTE; sin ellas, «sin configurar». Vive en el área Comercial del menú. |
| `fichaje` | Control horario desde el Excel del reloj | Universal por dentro; cada cliente = un lector en `lib/fichaje/parsers/` + línea en `POR_TENANT`. Requiere `team`, NO `team_avanzado`. |
| `provisioning` | Back-office: alta, edición, suspensión, credenciales y baja de clientes | Solo `salamandra_solutions`. Piezas: `altaTenant.js`, `cicloVida.js`, `credencialesCliente.js` (solo escribe), `bajaTenant.js`. **La baja aparta** (`zzz_baja_<slug>_<fecha>` + `.rollback.sql`); destruir es SSH: `scripts/borrar-tenant.js <slug> --purgar`; la red caduca con `podar-bajas.js`. |
| — | Configuración (ajustes + claves IA), Buzón (`/ayuda` → `/admin/buzon`) | Sin `moduleKey`, siempre visibles. |

**Activar un módulo tiene dos puertas**: `tenant_modules` y `users.module_access`.
`scripts/enable-module.js <slug> <moduleKey>` abre las dos (admins solos;
`--grant-users` para el resto) y siembra lo de fábrica; `npm run
db:check-access` lista quién no ve qué. Lanzarlo tras activar y en cada
despliegue que toque módulos.

**Sprint Aumenta (31/07–01/08/2026)**: detalle en `docs/sprint-aumenta-2026-07.md`.

---

## Decisiones técnicas cerradas

- **Verifactu**: API de Facturantia (10 €/mes). CRM crea factura → Facturantia
  → `qrUrl` + número → PDF con QR. Campos `facturantiaId`, `qrUrl`,
  `verifactuStatus`, `verifactuSentAt`. Detalle en `docs/modules/billing.md`.
- **IA**: Claude para análisis de leads (`lib/outreach/analysis/`) y estructura
  de sesiones clínicas (`lib/clinica/structureSession.js`); Whisper SOLO para
  transcribir audio clínico (`lib/clinica/whisper.js`). **Clave y modelo POR
  TENANT** (Configuración → IA; `lib/ai/anthropicKey.js`, `anthropicModel.js`,
  `openaiKey.js`; Sonnet por defecto). **NO se usan las claves del entorno**:
  sin clave → 503. Patrón: datos → prompt → pedir solo JSON → parsear con
  try/catch → persistir. Nada de IA se dispara solo: cuesta dinero.
- **n8n** como motor de automatizaciones externo; el CRM dispara webhooks.
- **Configuración universal** (Rodrigo, 01/08/2026): las tarjetas de
  integración (WhatsApp, Cloudflare, Anthropic, OpenAI, Google Places, Resend)
  y los interruptores del tenant se ven en TODOS los clientes; lo que gatea el
  módulo es la FUNCIÓN, no dónde se pegan las credenciales.

---

## Reglas de trabajo

1. Verificar si un fichero ya existe antes de crearlo.
2. No modificar `/lib/` sin explicar el motivo.
3. Schemas base de tenant → `models/tenant/`.
4. Overrides de UI por cliente → `modules/overrides/{slug}/`, y solo por la
   escalera de la regla 16.
5. Cambios que afecten a la arquitectura multi-tenant → consultar antes.
6. Módulo nuevo: modelo → endpoints → frontend, gateado por su `moduleKey`,
   doc en `docs/modules/`, sidebar, `enable-module.js`.
7. Siempre `getTenantContext` en las rutas — nunca conectar directo a PostgreSQL.
8. Terminal PowerShell (Windows), no bash. 9. JavaScript puro. 10. `app/` en
   la raíz, sin `src/`.
11. **Commits: los hace Claude SOLO cuando se lo piden.** Flujo desde
    19/07/2026: commits directos a `master`, sin PRs. Cuando lo pidan: `git
    add` sin `.env*` ni secretos, Conventional Commits + trailer
    `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, **`npm test` y
    `npm run build` en verde ANTES del push**, `git push origin master`,
    enseñar qué se commiteó. **Antes de nada, sincronizar**: `git fetch origin
    && git diff --name-only HEAD origin/master`; si ningún fichero es tuyo,
    `git pull --ff-only`; **si alguno coincide, PARA Y PREGUNTA** (dos personas
    empujan a `master`). **Los commits son para código** (Jorge, 19/08/2026):
    apuntar en el Registro no pasa por git, va por `scripts/registro.mjs`, y
    el solape entre dos personas lo frena el propio script por versión.
    Prohibido reescribir historia (`push --force`,
    `reset --hard` sobre lo subido): se arregla con commit nuevo o `revert`.
    Housekeeping local (`fetch`, `pull`, `branch -d` de fusionadas) sí, cuando
    lo pidan.
12. **Migraciones**: leen los schemas de `master.tenants` en tiempo de
    ejecución (nunca slugs a mano) y **sin filtrar por `status`** — el estado
    decide quién puede entrar, no qué forma tiene su schema
    (`scripts/_schema-targets.js`). Excepción: seeds y backfills SÍ miran
    `status` (no se siembra en un cliente apagado).
13. **Responsivo**: todo modal o drawer respeta la barra móvil (`top-14
    lg:top-0 … bottom-0`). Capas: backdrop `z-40` + panel `z-50`; widgets
    flotantes (campana, Salamandrobot) `z-30`, por debajo.
14. **La Configuración es universal** (ver «Decisiones técnicas cerradas»).
15. **Secrets de producción NUNCA pasan por chats con LLMs ni canales no
    seguros**: se generan en local, se ponen en `.env.production` por SSH y se
    comunican por canal cifrado. Si uno se ha visto en un chat, está
    comprometido: rotarlo.
16. ⚠️ **CUANDO UN CLIENTE PIDE ALGO: LA ESCALERA, Y EL OVERRIDE ES EL ÚLTIMO
    PELDAÑO** (Jorge, 18/08/2026: «importante que esto se tenga muy en cuenta
    en el futuro»). Se aplica ANTES de abrir un fichero. Tres casos y solo tres:

    **Caso 1 — pide un módulo que ya tenemos.** No se toca código: es un alta.
    `/admin/modulos` para ver qué tiene, `enable-module.js <slug> <moduleKey>`,
    `npm run db:check-access`. Minutos, sin despliegue. **Si el caso 1 lleva a
    abrir un fichero de código, algo va mal.**

    **Caso 2 — pide ese módulo con un cambio pequeño.** Se sube peldaño a
    peldaño y se para en el PRIMERO que sirva; cuanto más arriba, más caro:

    | # | Cuándo | Dónde | Ya existe así |
    | --- | --- | --- | --- |
    | 1 | Solo cambia cómo se llama algo | Regla por MÓDULOS en `lib/…/vocabulario.js`; `TENANT_TITLE_OVERRIDES` solo si es de verdad de uno | «Pacientes» en nutrición; «Interesados» en Aumenta |
    | 2 | Cambia un dato: una lista, un embudo, unos campos | Se declara en `lib/` por cliente y el base lo LEE (por props) | `lib/leads/embudos.js`, `lib/clients/formularioAlta.js`, `lib/clients/piezasFicha.js` |
    | 3 | «Esto sí / esto no» | `featureFlags` del módulo (`hasFeatureFlag`) | `formacionAbierta` en Aumenta; `autoAsignarEnAlta` en Laura |
    | 4 | Lo mismo con otro valor | `logicOverrides` (`getLogicOverride`) | — (hoy nadie lo usa) |
    | 5 | Nada de lo anterior sirve Y es de UN solo cliente | `modules/overrides/{slug}/`, pero FINA: una cabecera o un reparto que reutiliza piezas compartidas, nunca una copia del base | La ficha de Laura |

    Dos preguntas dicen el peldaño: **«Si mañana lo pide otro cliente,
    ¿tendría que copiar código?»** (si sí, no es override: es mejora del base
    gateada) y **«Si cambio el base, ¿este cliente tiene que cambiar
    también?»** (si sí, no puede tener pantalla propia: se quedará atrás en
    silencio, como demo y sandbox). Si hace falta código, **primero gana el
    base** (con su prueba en `npm test` y su línea en `docs/modules/`), y lo
    del cliente es lo más pequeño posible encima. Si acaba en pantalla propia:
    entrada en el mapa `UI_OVERRIDES` de la página + `sincronizar-ui-override.mjs`.

    **Caso 3 — pide ese módulo pero funciona prácticamente distinto.** Es de
    producto, no técnico, y solo tiene DOS respuestas: (a) **es otro producto
    → módulo nuevo** con su `moduleKey`, que se vende aparte (como
    `formularios`, `clients_avanzado`, `team_avanzado`, `fichaje`); reutiliza
    piezas de `components/` y `lib/`, no hereda la pantalla del otro. La
    prueba: **¿se lo venderíamos a un segundo cliente?** (b) **es un capricho
    de uno → se decide en el despacho**: se dice que el CRM hace lo que hace,
    o se cobra como encargo y AUN ASÍ se construye como (a). **Nunca más la
    tercera vía**: copiar el módulo entero a `overrides/{slug}/` y retocarlo.

    **Las reinas ordenan todo**: «¿la reina querría esto también?» → base
    (peldaños 1–2); si no → interruptor (3) o módulo nuevo (3a). **Los tres
    peros, sabidos**: cada «si tiene X no enseñes Y» es un `if` con nombre en
    `lib/` y con prueba, no suelto por el JSX; `featureFlags`/`logicOverrides`
    son JSON sin inventario (`/admin/modulos` enseña que existen, no qué
    hacen); nada impide copiar otra vez, lo que hay es que SE VE (contador
    rojo, pruebas de deriva). Si llegan tres o cuatro clientes del mismo oficio
    con variaciones parecidas, la escalera se queda corta en el 3–4 y tocará
    algo intermedio (presets por oficio); se construye cuando lo pida la
    realidad.

**Pruebas**: `npm test` lanza las ~40 pruebas ligeras de `scripts/_smoke-*.mjs`
(`scripts/pruebas.mjs` las clasifica solo: ligera = no hace `fetch` ni toca
Sequelize; la marca `// @prueba ligera|pesada` en la cabecera manda si hace
falta) y se pasa antes de cada push o deploy sin preguntar; `npm run
test:todo` añade las que piden base de datos y `npm run dev`. **Una prueba
nueva de una función de `lib/` se escribe con `node:test` + `node:assert/strict`**
(dentro de Node 22, cero dependencias; ejemplar `_smoke-citas-dinero.mjs`,
19/08/2026): prueba lo que DEVUELVE, no cómo está escrito; el runner la lanza
igual y, si falla, pinta el nombre y el diff. Las regex sobre el código fuente
quedan para lo que de verdad es texto (¿sigue el `if` donde estaba?). **Skills** (usar solas cuando toque): `frontend-design` (React/Tailwind,
mobile-first, el CRM en escritorio es prioritario), `xlsx`, `docx`, `pdf`,
`file-reading`.

---

## Seguridad — reglas obligatorias

- Validar JWT antes de resolver tenant; JWT en cookies httpOnly, refresh con
  rotación. **El rol se lee SIEMPRE fresco de BD**: `withTenant` reescribe
  `x-user-role` con el rol real antes del handler (degradar a alguien surte
  efecto al instante en los ~90 endpoints que gatean por esa cabecera).
- Rate limiting en auth con **cerrojo por CUENTA+IP** (`lib/auth/loginGuard.js`),
  nunca por cuenta a secas (sería un DoS gratuito contra logins adivinables).
- **Endpoint nuevo que envíe correo, gaste IA o escriba en master → guard de
  `lib/demo/isDemo.js`** (las cuatro demos son públicas con sesión de admin).
- Aislamiento: nunca queries sin `getTenantContext`; verificar que el recurso
  pertenece al tenant; `hasModule()` en cada endpoint; endpoints que dependen
  de un módulo «avanzado» lo exigen. Portal cliente (`/app/portal/`) aislado.
- Passwords bcrypt ≥ 12 rounds; nunca devolver `passwordHash`; credenciales en
  `.env*` (gitignored), nunca hardcodeadas.
- Inputs validados; siempre métodos de Sequelize; si SQL raw es inevitable,
  `sequelize.escape()`. Sin stack traces en producción; CORS explícito; HTTPS.
- **Auditoría** (`lib/utils/auditoria.js` o el helper del módulo): SIEMPRE lo
  destructivo y lo que mueve dinero; DESPUÉS de la mutación y FUERA de la
  transacción; un RESUMEN, nunca la fila entera (datos personales y de salud no
  se duplican en master); cada acción con su frase en
  `lib/actividad/etiquetas.js`; **los campos del resumen tienen que existir en
  ese modelo** (`Cost` no tiene `amount`). Los logs no se borran ni modifican
  salvo `scripts/podar-audit-logs.js` (demo 7 días; reales 3 años, suelo 1).
  Detalle: `docs/decisions/2026-07-28-repaso-de-seguridad.md`.

---

## Conexión cliente/equipo

**Todo registro tiene un CLIENTE (para quién es) y un miembro del EQUIPO (quién
lo hace)**, por FK real (`bookings.client_id`, `documents.client_id`,
`clinic_sessions.client_id`, `clinical_reports.client_id`,
`coordinations.client_id`, `plans.team_member_id`, `interactions.team_member_id`,
`client_notes.team_member_id`, `form_submissions.handled_by_team_id`), nunca por
texto o email. Los registros clínicos toman `client_id` del paciente al crearse
(foto). Auto-relleno con `lib/team/currentTeamMember.js` y
`lib/clinica/patientClient.js`. **`npm run db:check-links`** (solo lectura)
cuenta huérfanos por tabla: lanzarlo tras cada sprint que toque estos módulos.
Historia y backfill en `docs/decisions/2026-07-23-conexion-cliente-equipo.md`.

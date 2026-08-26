# Módulo Clínica (`clinica`)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es
> este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla.
> **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda
> vieja): `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `clinica` · requiere `pacientes` (que a su vez requiere `clients`; `lib/provisioning/catalogo.js` y `lib/provisioning/dependencias.js`). Casi todos sus endpoints abren con `clinica` **o** `pacientes`; los 16 de gestión de equipo exigen además `team_avanzado`, y «Enviar al paciente» necesita la tabla `documents` (503 sin ella) y, para que la familia lo lea, el portal de `citas` (dependencia «parcial» en `lib/provisioning/dependencias.js`). |
| **Reina** | `aumenta` — centro de psicología con 22.045 sesiones y 1.174 pacientes en producción. «Cambios en Aumenta» = cambios en este módulo base, para todos los que lo tengan; no un `overrides/aumenta/`. |
| **Pantallas** | `app/(dashboard)/clinica/` (5): `/clinica` (landing con KPIs), `/clinica/informes`, `/clinica/coordinaciones`, `/clinica/talleres`, `/clinica/estadisticas` (solo admin; Excel y PDF) · Pacientes en `app/(dashboard)/pacientes/` (3, ver `pacientes.md`) · gestión de equipo en `app/(dashboard)/equipo/` (6, menú `requiresAll: ["team_avanzado", "clinica"]`): `/equipo/mi-desempeno`, `/equipo/direccion`, `/equipo/productividad`, `/equipo/incidencias`, `/equipo/bandeja` y `/equipo/desempeno-config` (sin entrada de menú: se llega desde Dirección y Desempeño); sus piezas exclusivas en `equipo/_components/` (`PerformanceEditor`, `IncentiveTiersEditor`, `IncentiveItemsEditor`, `IncidenciaModal`, `performanceIcons`). Las URL viejas `/clinica/{mi-desempeno,…}` redirigen desde `next.config.mjs`. |
| **Endpoints** | `app/api/clinica/**` (35 `route.js`): `sessions/**` (5; `sessions/transcribe` ⚡ **Whisper + Claude**), `reports/**` (5; `reports/[id]/pulir` ⚡ **Claude**, `reports/[id]/desde-sesiones` volcado sin IA, `reports/[id]/enviar` genera el PDF y lo publica en `documents`), `coordinations`, `derivaciones` (catálogo, PUT solo admin), `talleres/**` (3), `overview`, `estadisticas/**` (2, solo admin) y los de equipo, que exigen `team_avanzado`: `performance/**` (9; `performance/config/ai` ⚡ **Claude** propone áreas por rol; `performance/planes` es la excepción, solo clínica), `productividad/**` (2), `incentive-items/**` (2), `incidencias/**` (2), `bandeja`, `dashboard`. Los tres ⚡ pasan por `lib/demo/isDemo.js` (`assertNotDemoPaidCall` / `demoForcesFakeAi`). |
| **Lógica** | `lib/clinica/` (26): `serialize.js` (fila Sequelize → forma de la UI: `serializePatient/Session/Report/Coordination/Performance/RankingRow`), `whisper.js` (audio → texto, REST de OpenAI con la clave del tenant), `structureSession.js` (texto → registro estructurado, Claude), `redactarInforme.js` (borrador desde las sesiones, sin IA) + `pulirInforme.js` (redacción IA que no pisa ni inventa: `verificarSinInventar`, `avisosDePerdida`), `reportPdf.js` (el PDF que recibe la familia; el tipo `beca` imprime la cabecera con los nombres oficiales, sus tres apartados y la firma), `beca.js` (el informe para la beca NEAE, 26/08/2026: denominaciones oficiales de la convocatoria — logopedia → «Reeducación del lenguaje»; psicología/TO/pedagogía → «Reeducación pedagógica y habilidades sociales» — y sus apartados: motivo de consulta, objetivos, metodología), `prepFiles.js` (adjuntos de preparación, fuera de `documents`), `estadisticas.js` + `estadisticasExport.js` (cifras del centro y su Excel/PDF), `incentives.js` / `incentiveItems.js` / `performanceAreas.js` / `performanceConfig.js` / `performancePresets.js` / `productivity.js` / `productivityQuery.js` / `period.js` (desempeño e incentivos), `incidencias.js` (taxonomía y serializer), `derivaciones.js` / `specialties.js` / `trimestres.js` (catálogos), `consents.js` (RGPD con traza), `contractStorage.js` (PDF legado del paciente), `patientClient.js` (de qué pagador es un paciente), `audit.js`. Fuera de la carpeta: `lib/notifications/alerts.js` (`syncClinicaAlerts`: informe vencido, incidencia asignada → campanita). |
| **UI** | Sin `modules/clinica/`. `components/clinica/` (6): `InformeDrawer.jsx` (aquí se escribe y se pule el informe), `NuevaCoordinacionModal.jsx` (alta desde el listado y desde la ficha), `InterventionPlanSection.jsx`, `PatientDocumentsSection.jsx`, `PatientExternalContactsSection.jsx`, `SpecialtyPicker.jsx`. En `app/(dashboard)/clinica/_components/` ya solo queda `PreviewBanner.jsx`, que devuelve `null`; el `dummyData.js` de la maqueta se borró el 20/08/2026 (no lo importaba ninguna página — ver «Componentes»). |
| **Modelos** | `ClinicSession` → `clinic_sessions` · `ClinicalReport` → `clinical_reports` · `Coordination` → `coordinations` · `PerformanceMetric` → `performance_metrics` · `Incidencia` → `incidencias` + `IncidenciaAssignee` → `incidencia_assignees` · `IncentiveItem` → `incentive_items` · `Taller` → `talleres` + `TallerInscripcion` → `taller_inscripciones` · `InterventionPlan` → `intervention_plans` · `ExternalContact` → `external_contacts`. Las FK clínicas apuntan a `patients` (ver `pacientes.md`) y las tres tablas de registro guardan además `client_id`, foto del pagador al crearse. |
| **Interruptores y parámetros** | `featureFlags` / `logicOverrides`: ninguno que lea el código. Lo que sí lee es `master.tenants.settings.clinica.*`: `incentiveTiers` (`lib/clinica/incentives.js`), `performanceRoles` (`lib/clinica/performanceConfig.js`), `referralSpecialties` (`lib/clinica/derivaciones.js`) y `trimestreConJulio` (`lib/clinica/trimestres.js`); los cuatro se escriben desde sus endpoints (solo admin) e invalidan la caché del tenant. |
| **Pantallas propias** | ninguna (`modules/overrides/*/` no tiene nada de clínica y ningún `UI_OVERRIDES` la carga). |
| **Scripts** | Activar: `node scripts/enable-module.js <slug> clinica` (avisa si falta `pacientes`; `ensure-tenant-schema.js` corre las 14 del bloque `clinica` de `scripts/_module-migrations.js`: `migrate-clinica-module` —crea `patients` y las cuatro tablas base—, `migrate-external-contacts`, `migrate-contactos-externos-nombre-opcional`, `migrate-talleres`, `migrate-coordinaciones-autor-libre`, `migrate-sesion-terapeuta-opcional`, `migrate-clinica-client-link`, `migrate-patients-care-type`, `migrate-patients-specialties`, `migrate-documents-patient-link`, `migrate-incidencias-module`, `migrate-incidencias-verificacion`, `migrate-incentive-items`, `migrate-clinica-performance-roles`, `migrate-informe-beca` —añade 'beca' al enum de tipos de informe; VA ANTES del despliegue—; `intervention_plans` y `notifications` llegan por las CORE). Seed: `seed-clinica-demo.js <slug>` (pacientes + clínica; **VACÍA** la historia clínica antes, solo escaparate; lo lanza `crear-demos-por-oficio.js` para `demo_clinica`). Importación de Organízate para Aumenta, ya corrida: `_hechos/import-aumenta-sesiones.js` e `_hechos/import-aumenta-coordinaciones.js` (simulan sin `--confirm`). Backfill de datos: `backfill-patients-client.js` (dry-run; ver `pacientes.md`). `_hechos/migrate-clinica-sprint-1.js` es ONE_OFF de la maqueta (solo `crm_aumenta`, ya ejecutado): no usarlo. |
| **Pruebas** | `scripts/_smoke-pulir-informe.mjs` — entra en `npm test`, sin base de datos: las dos reglas del informe (solo cinco apartados viajan al modelo; se rechaza lo que inventa números o meses). `scripts/_smoke-piezas-ficha.mjs` (`@prueba ligera`) fija que con la forma de Aumenta (clínica + archivo avanzado + citas) la ficha de cliente NO gana los paneles de Laura. `scripts/_smoke-fechas-trimestres-madrid-parseDate.mjs` (`node:test`, 19/08/2026, en `npm test`) en su parte de `lib/clinica/trimestres.js`: T1 septiembre–diciembre, T2 enero–marzo, T3 abril–junio y julio SOLO si `settings.clinica.trimestreConJulio === true` de verdad (Rodrigo, 28/07/2026), agosto no es de nadie, el curso se nombra por el año en que empieza, `trimesterRange` con fin exclusivo; fija también que el fichero entero mira la zona del proceso (a las 00:30 de Madrid del 1 de septiembre es T1 en Madrid y nada en UTC; por eso el contenedor corre en `Europe/Madrid` desde el 19/08/2026) y, como SOSPECHOSO, que `trimesterOf(null)` cae en 1969. `scripts/_smoke-clinica-config-incidencias-export.mjs` (`node:test`, 20/08/2026, en `npm test`): `lib/clinica/performanceConfig.js` —la promesa es la compatibilidad: un tenant sin config de desempeño guardada, o con una corrupta, se comporta EXACTAMENTE como siempre (las 7 áreas históricas, pesos intactos, semáforo 85/70); `normalizeRoles` repara lo reparable (textos, defaults, el único rol sin marcar queda como el por defecto) y devuelve null a lo irreparable, como pesos que no suman 100—; `lib/clinica/incidencias.js` —la taxonomía es fija (8 categorías del Programa de Excelencia, solo Administrativa con subcategorías) y la verificación GOBIERNA el estado con un solo control: resuelta→resolved, parcial y no_resuelta→in_progress, sin verificar→pending, nunca resuelta y pendiente a la vez; la forma exacta de `serializeIncidencia` y los responsables sincronizados (la pivote queda como el formulario y el espejo apunta al primero)—; y `lib/clinica/estadisticasExport.js` —el Excel y el PDF de dirección salen del MISMO objeto que pinta la pantalla, comprobado celda a celda abriendo el buffer que devuelven—. `scripts/_smoke-pdf-factura-informe.mjs` (`node:test`, 21/08/2026, ligera, en `npm test`) cubre en su otra mitad `lib/clinica/reportPdf.js`, el informe que recibe la FAMILIA: genera el PDF de verdad y lo lee por dentro —el nombre del fichero que ve la familia (`reportPdfFilename`: tipo, paciente y fecha, con los caracteres prohibidos borrados y sin guiones sueltos), la cabecera con el nombre del centro, la ficha de datos (las filas sin valor no se imprimen, ni su rótulo), las siete secciones SIEMPRE en el orden de lectura y solo las que tienen contenido, el respaldo al texto bruto de la IA cuando no hay secciones (y que con secciones ese texto NO se cuela además), la frase de «todavía no tiene contenido» en vez de un folio en blanco, el color de marca del cliente en la regla del título, y que un informe largo no pierde el final ni dos informes a la vez se mezclan—. Marca con `// SOSPECHOSO` que la especialidad de derivación sale del catálogo GLOBAL y no del del centro (el generador no recibe el tenant), y que la fecha se lee como instante UTC y no como día de calendario. `scripts/_smoke-informe-beca.mjs` (`node:test`, 26/08/2026, ligera, en `npm test`): el informe para la beca dice lo que la convocatoria pide y nada más — la cabecera con los nombres OFICIALES (y sin inventar nombre a una especialidad no cubierta), solo sus tres apartados aunque el resto esté escrito, el texto bruto de la IA no se cuela, la firma «Fdo.:» también con el informe vacío, y el evolutivo sigue exactamente igual (sin firma, rótulos de siempre). No hay ninguna con base de datos propia del módulo. |
| **Decisiones** | `../decisions/2026-07-23-conexion-cliente-equipo.md` · `../decisions/2026-07-28-repaso-de-seguridad.md` · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` · `../decisions/2026-08-04-clientes-se-llama-pacientes-en-nutricion.md` |
| **En este doc** | Dónde vive cada pantalla (traslado del 2026-07-27) · Programa de Excelencia (2026-07-24) · Registro de sesión en 3 partes (sprint Aumenta 2026-07, punto 4) · Preparar una sesión antes de darla (26/08/2026) · Redactar un informe (31/07/2026) · Redactar con IA (14/08/2026) · «Enviar al paciente» (sprint Aumenta 2026-07, punto 3.2) · Modelos · Frontend |

> Documentación de detalle. Referencia rápida en `CLAUDE.md`. Si
> encuentras una discrepancia con el código, **prevalece el código**:
> actualiza este fichero.

## Visión general

Módulo de gestión del trabajo clínico de un centro de psicopedagogía:
registro de sesiones con paciente, coordinaciones (familia, colegio,
profesionales externos), informes clínicos (evolutivos, admisión, alta)
y sistema de desempeño + incentivos del equipo de terapeutas.

**Histórico (hasta 06/2026):** se implementó **inicialmente como sprint
visual** para la demo del **9 de junio de 2026** con el equipo de Aumenta, con
las pantallas sobre datos dummy y sin backend. Hoy todo lo de abajo es real
(endpoints, IA, PDF, desempeño) y de la maqueta **ya no queda nada**: los dos
`dummyData.js` que sobrevivían sin que nadie los importara se borraron el
20/08/2026 (ver «Componentes»).

Se activa con `scripts/enable-module.js <slug> clinica` (requiere `pacientes`).
Quién lo tiene NO se lista aquí: `/admin/modulos` o
`scripts/inspect-tenant-modules.js <slug>`. A 19/08/2026 está encendido en
`aumenta` (la reina, con datos reales), `demo`, `demo_clinica` y `somos`.

## Estado: Fase 1 (backend real) — registros clínicos

Los **registros clínicos** (sesiones, informes, coordinaciones) y **Pacientes**
tienen backend real: endpoints CRUD + persistencia + KPIs computados. Las páginas
`/clinica` (landing), `/clinica/informes`, `/pacientes` y `/pacientes/[id]` leen y
escriben datos reales (los `dummyData.js` de la maqueta dejaron de usarse
entonces y se borraron del repo el 20/08/2026).

**Fase 2 (desempeño/incentivos) también real:** `/equipo/mi-desempeno` y
`/equipo/direccion` leen de `/api/clinica/performance/*` (scoring por áreas,
ranking, media de equipo, alertas computadas, aprobación de incentivos con
auditoría). Áreas por defecto en `lib/clinica/performanceAreas.js`; desde el
desempeño por roles (`lib/clinica/performanceConfig.js`, `/equipo/desempeno-config`)
cada tenant puede definir las suyas por rol. Ambas pantallas exigen además
`team_avanzado` y rol admin.

**Fase 3 (audio → IA) real:** `/pacientes/[id]/sesiones/nueva` sube el audio →
`POST /api/clinica/sessions/transcribe` (**Whisper de OpenAI** transcribe + **Claude**
estructura) → la terapeuta revisa/edita → guarda la sesión. Modo demo *canned* en
local sin claves (auto si faltan claves y `NODE_ENV≠production`, o `CLINICA_FAKE_AI=1`;
bloqueado en producción). En la demo pública la transcripción se corta antes de
gastar (`assertNotDemoPaidCall`, `lib/demo/isDemo.js`). **Ya no queda ninguna
pantalla en maqueta.**

**La segunda puerta: preparar sin audio (26/08/2026).** Esa misma pantalla
acepta `?preparar=1&fecha=<ISO>` y entra directa a un formulario de preparación
—día y hora, texto y adjuntos— que crea la sesión en `draft` por el POST de
siempre, sin tocar ni un campo de IA. Existe porque hasta ese día **una sesión
solo nacía subiendo un audio**, o sea que para preparar una había que haberla
dado ya. La contradicción se ve en producción: 22.045 sesiones en Aumenta y CERO
con `prep_text`. El contrato de la URL y el cuerpo del alta viven en
`lib/clinica/prepararSesion.js` (`_smoke-clinica-preparar.mjs`), porque lo monta
el modal de una cita y lo lee esta pantalla.

⚠️ Es la primera vez que una sesión puede tener **fecha futura**. Por eso las
estadísticas del centro cortan el periodo por hoy (`hastaHoy`): una sesión
preparada para el jueves no es trabajo hecho, y contarla infla la actividad del
equipo sin que se note. Se corta por la FECHA y no por el estado porque en las
demos hay 39 sesiones en `draft` que sí se dieron.

- Endpoints: `/api/pacientes/*` (11 `route.js`, ver `pacientes.md`) y
  `/api/clinica/**` (35 `route.js`): `sessions/**` (5: CRUD, `transcribe`,
  `prep-files`), `reports/**` (5: CRUD, `desde-sesiones`, `pulir`, `enviar`),
  `coordinations`, `derivaciones`, `talleres/**` (3), `overview`,
  `estadisticas/**` (2) y los de gestión de equipo (`performance/**` (9),
  `productividad/**` (2), `incentive-items/**` (2), `incidencias/**` (2),
  `bandeja`, `dashboard`), que además de `clinica`/`pacientes` exigen
  `team_avanzado`. El desglose con qué hace cada uno está en el `## Mapa`.
- Transcripción: `lib/clinica/whisper.js` (API de OpenAI, clave del tenant). Estructura:
  `lib/clinica/structureSession.js` (Claude, reutiliza el proveedor de Outreach).
- Serializers: `lib/clinica/serialize.js` (fila Sequelize → forma de la UI).
- Migración **generalizada** `scripts/migrate-clinica-module.js` (lee `master.tenants`,
  ya no aumenta-only); la corre `enable-module.js` como parte del bloque `clinica`
  de `scripts/_module-migrations.js`. Seed `scripts/seed-clinica-demo.js`.
- Lo que en esta fase quedaba pendiente ya llegó después: PDF del informe
  (`reportPdf.js`, «Enviar al paciente»), redacción con IA (`pulir`), Excel/PDF
  de Estadísticas (`estadisticasExport.js`), talleres y coordinaciones con
  listado propio. Las secciones siguientes lo cuentan.

## Dónde vive cada pantalla (traslado del 2026-07-27)

Las herramientas de **gestión de equipo** (Desempeño, Dirección, Productividad,
Incidencias y Bandeja de trabajo) ya **no cuelgan de Clínica**: son de gestión
del equipo, no clínicas. Se movieron de `/clinica/*` a **`/equipo/*`** (páginas,
menú, migas "Equipo · X" y enlace "Volver a Equipo"). Las URLs viejas redirigen
de forma permanente (`next.config.mjs`), así que los marcadores del equipo de
Aumenta siguen funcionando.

Lo que NO cambió (es interno, no lo ve el usuario):
- los **endpoints** siguen en `/api/clinica/*`,
- la **lógica** sigue en `lib/clinica/*`,
- el **gating** sigue exigiendo `clinica` — un tenant con `team` pero
  sin `clinica` (p. ej. nutri_laura) NO ve estas pantallas. Desde la separación
  Equipo básico/avanzado (27/07/2026) exigen ADEMÁS `team_avanzado`: en el menú
  van con `requiresAll: ["team_avanzado", "clinica"]` y sus endpoints lo
  comprueban.

En `/clinica` se quedan la landing y **Informes**, y después llegaron
**Coordinaciones** (listado general), **Talleres** (02/08/2026) y
**Estadísticas** (solo admin); Pacientes sigue en `/pacientes`.
Los componentes exclusivos de esas pantallas (`PerformanceEditor`,
`IncentiveTiersEditor`, `IncentiveItemsEditor`, `IncidenciaModal`) se movieron a
`app/(dashboard)/equipo/_components/`.

## Programa de Excelencia (2026-07-24)

Cuatro bloques nuevos del "Programa de Excelencia" de Aumenta. Todo gated por
`clinica`/`pacientes`, así que se propaga a todos los tenants con el módulo
(Aumenta reina + demo). **Sin personas dadas de alta**: la maquinaria está, las
terapeutas y sus horas/roles se cargan aparte.

### 1. Incentivos REALES (antes eran dummy)

- `lib/clinica/incentives.js`: `computeTotalScore` (media ponderada de las áreas
  con los pesos de `performanceAreas.js`), `proposeIncentive` (tramos → €),
  `normalizeTiers`/`tiersFromTenant`.
- **Tramos configurables** por tenant en `tenant.settings.clinica.incentiveTiers`
  (JSONB, sin migración). API `GET/PUT /api/clinica/performance/incentive-tiers`
  (PUT solo admin, invalida caché). Default en `DEFAULT_INCENTIVE_TIERS`.
- La propuesta se deriva **en vivo** de `totalScore` + tramos en los serializers
  (`serializePerformance`/`serializeRankingRow` aceptan `tiers`); el campo
  `proposed_incentive` almacenado pasa a ser caché. `approve`/`approve-all` usan
  la propuesta viva, no el valor guardado.
- **Editor de evaluación**: `POST /api/clinica/performance` (upsert por
  terapeuta+periodo; calcula total y propuesta al guardar). UI:
  `PerformanceEditor.jsx` (áreas + complementos + notas, vista previa en vivo) y
  `IncentiveTiersEditor.jsx`, ambos en `/equipo/direccion`.

### 2. Productividad

- `lib/clinica/productivity.js`: `workingDaysInMonth`, `computeProductivity`
  (% horas directas / disponibles), `occupationFromPct`.
- Horas directas = suma de `duration` de las **citas** (`bookings`
  confirmed/completed) del profesional en el mes. Horas disponibles =
  `team_members.weekly_direct_hours` ÷ 5 × días laborables (nueva columna,
  `migrate-team-weekly-hours.js`, módulo `team`). El "-5h/semana" de ciertos
  roles = un número menor, sin hardcodear a nadie.
- API `GET /api/clinica/productividad` + `PUT /api/clinica/productividad/hours`.
  UI `/equipo/productividad`. Conecta con incentivos: botón "traer ocupación" en
  el editor de evaluación. Desde el 26/08/2026 cada persona de la tabla es un
  enlace a su perfil (`/equipo/mi-desempeno?therapistId=`), el mismo destino que
  el «Ver» de Dirección; `mi-desempeno` lee ese parámetro con `useSearchParams`
  (antes el enlace de Dirección existía pero la página lo ignoraba y abría
  siempre el desempeño del usuario logueado).

### 3. Incidencias

- Modelo `Incidencia` (tabla `incidencias`, `migrate-incidencias-module.js`,
  módulo `clinica`). Categorías + subcategorías, responsable (`assignedToId`),
  estados Pendiente/En proceso/Resuelta, prioridad, comentarios (JSONB), paciente
  y cliente-foto opcionales. Taxonomía/serializer en `lib/clinica/incidencias.js`.
  Desde el sprint Aumenta 2026-07-28 admite **varios responsables**
  (`IncidenciaAssignee` → `incidencia_assignees`, N-a-N con `team_members`;
  `assignedToId` queda como espejo del primero) y una `verification` al resolver
  (resuelta / parcial / no resuelta; `migrate-incidencias-verificacion.js`).
- API `GET/POST /api/clinica/incidencias` + `GET/PATCH/DELETE
  /api/clinica/incidencias/[id]` (crear/comentar/cambiar estado por cualquier
  usuario del módulo; borrar solo admin). UI `/equipo/incidencias` +
  `IncidenciaModal.jsx`. Sin auditoría a master (pueden citar datos clínicos).
  Los responsables se eligen en un **desplegable** multi-selección
  (`ResponsablesDropdown`, 26/08/2026): los chips de antes desbordaban la
  columna con los 15 de Aumenta y el control se veía cortado.
- **Documentos adjuntos** (26/08/2026, Aumenta): una incidencia admite hasta 20
  documentos, que van al archivo central (`documents.incidencia_id`,
  `migrate-documents-incidencia-link.js`, **CORE**; `source='incidencia'`,
  `visibility='shared'`). Con paciente, el documento hereda su
  `patientId`/`clientId` y aparece también en la ficha (los endpoints de
  `/api/pacientes/[id]/documents` listan y descargan `source` paciente **e**
  incidencia, pero solo borran los suyos: los de incidencia se borran desde la
  incidencia). Cambiar el paciente de la incidencia re-enlaza sus documentos; sin
  paciente quedan como internos del archivo. API
  `GET/POST /api/clinica/incidencias/[id]/documents` +
  `DELETE …/[docId]` + `GET …/[docId]/download` (gate clinica/pacientes +
  `team_avanzado`; nombre obligatorio al subir, mismo patrón que pacientes). En
  una incidencia NUEVA los ficheros quedan en cola y se suben tras crearla. El
  listado enseña un clip con el nº de adjuntos (`docsCount`). Borrar la
  incidencia NO borra sus documentos (FK `ON DELETE SET NULL`): pueden estar en
  la ficha de un paciente.

### 4. Bandeja de trabajo

- API `GET /api/clinica/bandeja` (resuelve el TeamMember logueado; admin puede ver
  otra con `?therapistId=`). Agrega "lo mío pendiente": informes sin entregar
  (vencidos marcados), incidencias asignadas sin resolver y citas de hoy. UI
  `/equipo/bandeja`.

### 5. Dashboard de Dirección ampliado (punto 6)

- `GET /api/clinica/dashboard`: totales de productividad del mes +
  resumen de incidencias (abiertas/pendientes/en proceso, urgentes = prioridad
  alta abiertas, resueltas del mes, por categoría, y las 5 más recientes).
- La página `/equipo/direccion` añade la sección "Operativa del mes" con esas
  tarjetas + barras por categoría + lista de incidencias recientes.
- La agregación de productividad se factorizó a `lib/clinica/productivityQuery.js`
  (`aggregateTeamProductivity`), compartida por `/productividad` y `/dashboard`.

### 6. Alertas automáticas + campanita (punto 7)

- Modelo `Notification` (antes durmiente) + tabla creada por
  `migrate-notifications-table.js` (**CORE**, todos los schemas crm_*; índice
  único parcial `(user_id, type, entity_id)` para deduplicar).
- `lib/notifications/alerts.js`: `syncClinicaAlerts` recomputa al vuelo las
  alertas del usuario (informe vencido, incidencia asignada Pendiente) y hace
  upsert (crea las que faltan, borra las que ya no aplican, preserva "leído").
  Sin job en background: se sincroniza al consultar la campanita.
- API `GET /api/notifications` (sincroniza + lista + nº sin leer, tolerante a
  fallos) y `POST /api/notifications/read`. Componente `NotificationBell.jsx`
  (flotante abajo-derecha, sondeo cada 60s) montado en `DashboardShell` → visible
  en todo el dashboard.

### 7. Incentivos ESCRITOS a mano (2026-07-24)

- Modelo `IncentiveItem` (tabla `incentive_items`, `migrate-incentive-items.js`,
  módulo `clinica`): concepto concreto ("Cambiar la bombilla del centro") por
  terapeuta y mes, con `valueType` 'fixed' (€) o 'percent' (% del SUELDO MENSUAL
  de la ficha de Equipo). `resolvedAmount` = FOTO del importe al crear/editar
  (si el sueldo cambia después, los items ya escritos no bailan); `salaryBase`
  guarda la base usada. Percent sin sueldo configurado → 422 con aviso.
- API `GET/POST /api/clinica/incentive-items` + `PATCH/DELETE .../[id]`
  (SOLO admin, auditado). El POST garantiza la fila de PerformanceMetric del
  periodo (findOrCreate) para que la persona salga en la propuesta sin evaluar.
- Integración: `serializeRankingRow` acepta `extras` → expone `extrasIncentive`
  y `totalProposed` (tramos + escritos). `approve`/`approve-all` aprueban ese
  TOTAL. UI: sección "Incentivos escritos" en `/equipo/direccion`
  (`IncentiveItemsEditor.jsx`) + columnas Por puntuación / Escritos / Propuesto
  en la tabla de propuesta.

### Pendiente del programa

Editar coordinaciones + "próxima fecha" estructurada, y organización documental
por trimestre. Nota: la productividad del **mes en curso** compara horas directas
acumuladas contra las disponibles del mes COMPLETO (se llena según avanza el mes);
para un mes cerrado es exacta.

> Las secciones "Lo que NO hace" y "Backlog" de abajo describen el Sprint 1 visual
> original; parte ya está cubierta por Fase 1.

## Registro de sesión en 3 partes (sprint Aumenta 2026-07, punto 4)

Una sesión ya no es solo el informe de lo que pasó dentro:

1. **Preparación** (opcional) — `prepText` + `prepFiles`: lo que la terapeuta
   prepara ANTES (material, hipótesis, qué observar) y los adjuntos que trae
   (fotos, notas de voz, un PDF).
2. **Informe** (obligatorio) — los campos de siempre: objetivos, actividades,
   desempeño y observaciones, por audio o escritos a mano.
3. **Devolución de la familia** (opcional) — `parentFeedback`: lo que cuentan
   los padres al recoger.

Las partes 1 y 3 se pueden rellenar **después**: van en `PATCH
/api/clinica/sessions/[id]` (además del POST de creación), porque la
preparación se escribe antes y la devolución llega a veces días más tarde. En
la UI están tanto en «Nuevo registro» como en el cajón de la sesión de la
ficha del paciente.

**Desde el 26/08/2026 por la tarde (Rodrigo), el registro se ESCRIBE y el
audio es opcional.** El botón de la ficha dice «Nuevo registro» (antes «Subir
audio») y `/pacientes/[id]/sesiones/nueva` abre directamente el registro
completo en texto —las tres partes—, con el audio como bloque opcional dentro:
si se sube y procesa, la IA rellena SOLO los apartados vacíos del informe (lo
escrito a mano no se pisa, la misma regla que el volcado de informes), la
transcripción queda a la vista, y los campos de IA (`aiTranscription`,
`aiReviewedAt`…) solo viajan al POST si de verdad hubo audio — un registro a
mano no debe decir «transcrito por IA» (lo vigila `_smoke-clinica-preparar.mjs`
por el lado del alta de preparación).

Y desde esa misma mañana la parte 1 se puede escribir **antes de que la sesión
exista**: «Guárdala solo como preparación» dentro de «Nuevo registro», o
«Preparar sesión» en el modal de una cita (`?preparar=1`), que además le pasa
el día y la hora de esa cita. La sesión nace en `draft` y el cajón de la ficha
la completa después —informe y devolución— sin crear otra.

**Adjuntos de preparación**: `POST /api/clinica/sessions/[id]/prep-files`
(multipart) y `GET/DELETE …/prep-files/[fileId]`. Máximo 10 por sesión, 25 MB
cada uno, solo fotos / audio / PDF (`lib/clinica/prepFiles.js`).

> **No son documentos del archivo**: NO se crea fila en `documents` a propósito.
> Es material de trabajo interno; si fuese un Document aparecería en el buscador
> del CRM y podría acabar colándose en el área privada de la familia. Solo se
> reutilizan las primitivas de disco de `documentStorage` para no montar un
> cuarto almacén. La metadata vive en `clinic_sessions.prep_files` (JSONB) y el
> serializador NO expone `storagePath`.

## Redactar un informe (31/07/2026)

El informe **se escribe en el CRM**. Hasta el 31/07 el cajón solo mostraba lo
que hubiera y, sin contenido, decía que la redacción asistida por IA llegaría
«en una fase posterior»: en la práctica, no se podía redactar un informe.

- Editor completo en `components/clinica/InformeDrawer.jsx`: motivo,
  objetivos, evolución, logros, dificultades, recomendaciones, propuesta de
  continuidad y —en los de derivación— la especialidad de destino. Guarda con
  `PATCH /api/clinica/reports/[id]` sobre `contentSections`.
- **Volcado desde las sesiones**: `POST /api/clinica/reports/[id]/desde-sesiones`
  con `{ sessionIds }`. Compone el borrador con lo escrito en esas sesiones
  (`lib/clinica/redactarInforme.js`): objetivos, evolución fechada, lo que
  refiere la familia identificado como tal, incidencias en «dificultades» y
  tareas/notas en «recomendaciones».
  - **No pisa lo escrito**: rellena lo vacío y añade a las listas lo que falta,
    comparando sin mayúsculas ni espacios. Volcar dos veces no duplica nada.
  - **No inventa**: cada línea sale literal de un registro, con su fecha. Un
    informe clínico acaba en manos de una familia y a veces de un juzgado.
  - Solo sesiones **del mismo paciente** y **completadas** (`registered` o
    `published`). Cruzar pacientes sería un incidente de datos de salud.
  - Un informe ya **entregado** no se puede volcar: la familia tiene un PDF que
    dejaría de coincidir con el CRM.
  - Devuelve `aporte` (cuántas líneas ha traído cada apartado) para que la
    pantalla pueda decirlo: si no, parece que el botón no ha hecho nada.
- La IA **parte de esto**, no lo sustituye: primero se junta lo que dicen las
  sesiones, luego se pule. Ver el apartado siguiente.

## Redactar con IA (14/08/2026)

`POST /api/clinica/reports/[id]/pulir` coge el volcado y lo redacta.
`lib/clinica/pulirInforme.js`. Clave BYOK del tenant; sin clave, 503. En la demo,
simulado (`demoForcesFakeAi`), y el simulado pasa la misma verificación que el de
verdad.

⚠️ **NO GUARDA NADA, y es el diseño.** Devuelve `{ propuesta, avisos }` y el
cajón la pinta al lado de lo que hay, apartado por apartado, con su «Usar este
texto» y un «Usar todos». Nada llega a la base de datos hasta que la profesional
guarda. Un informe clínico lo firma una persona: el día que este endpoint escriba
solo, lo que la familia recibe habrá dejado de ser lo que ella escribió.

**Las dos reglas de `redactarInforme.js`, aquí cumplidas en código:**

- **No pisa lo escrito.** Además de no guardar, de los ocho apartados solo se le
  mandan al modelo los CINCO que salen del volcado (`SECCIONES_PULIBLES`:
  objetivos, evolución, logros, dificultades, recomendaciones). El motivo de
  intervención y la propuesta de continuidad los escribe ella y **ni siquiera
  viajan** al modelo, así que no hay forma de que se los reescriba.
- **No inventa.** Se le pide en el prompt y además se comprueba:
  `verificarSinInventar` rechaza la propuesta ENTERA —502 con el detalle— si
  aparece cualquier número o cualquier mes que no estuviera en el volcado. Una
  edad, un porcentaje o una sesión que no hubo son la invención que más daño hace
  en un informe y la única que se puede comprobar sin opinar. Repetir un número
  que ya estaba, claro, pasa.

`avisosDePerdida` no rechaza: señala los apartados que encogen a menos de la
mitad o se quedan vacíos, y el cajón los pinta en ámbar. Unir dos anotaciones
acorta con razón; perder un hecho, no.

Se fija en `scripts/_smoke-pulir-informe.mjs` (sin base de datos ni servidor).

## «Enviar al paciente» (sprint Aumenta 2026-07, punto 3.2)

`POST /api/clinica/reports/[id]/enviar` sustituye al viejo «Marcar como
entregado», que era un cambio de estado que **no entregaba nada**: la familia no
recibía el informe por ningún sitio.

Ahora el endpoint exporta el informe a PDF (`lib/clinica/reportPdf.js`, pdfkit +
Poppins, solo las secciones con contenido), lo publica como documento del
archivo central (`source='informe'`, `client_visible=true`, con `clientId` y
`patientId`) y lo enlaza en `ClinicalReport.deliveredDocumentId`, además de
sellar `status='delivered'` y `deliveredAt`. La familia lo ve en «Mis
documentos» de su área privada.

- **Reenviar es reemplazar**: se genera un PDF nuevo y se borra el anterior,
  para que nadie tenga dos versiones del mismo informe. El botón pasa a decir
  «Volver a enviar».
- Un informe de un paciente **sin cliente pagador** no se puede entregar (el
  portal filtra por cliente): responde 409 explicándolo, no falla en silencio.
- Auditoría: `clinica.report.sent`, sin el nombre del paciente (dato de salud;
  `AuditLog` vive en el schema `master`, compartido).
- Si el centro tiene el bloqueo por impago encendido, el informe queda sujeto a
  la regla del mes como cualquier otro documento — ver `docs/modules/citas.md`.

## Lo que NO hace (Sprint 1)

> Sección histórica: varias de estas líneas ya NO son ciertas (hay endpoints
> CRUD, transcripción con Whisper, desempeño e incentivos, auditoría y envío de
> informes a familias). Se conserva como registro del punto de partida.

- No hay endpoints CRUD (`/api/clinica/*` no existe).
- No hay dictado de voz ni transcripción automática.
- No hay integración con OpenAI / Whisper.
- No hay generación real de informes.
- No hay cálculo automático del desempeño ni de incentivos.
- No hay auditoría (`master.AuditLog` no recibe eventos).
- No hay envío de informes a familias.
- El dummy data de la landing y el panel de Dirección estaba hardcoded a
  6 terapeutas + Diego Martín, y cambiar el equipo exigía editar
  `dummyData.js`. **Esto ya no aplica de ninguna manera**: el equipo sale del
  módulo `team` desde la Fase 1 y ese fichero se borró el 20/08/2026.

## Modelos

Diez modelos en `models/tenant/` registrados en `tenantDb.js` (nacieron cuatro
en el sprint visual; el resto llegó con el Programa de Excelencia y el sprint
Aumenta 2026-07). **Las FKs apuntan a `patients`, no a `clients`** — ver
[`docs/modules/pacientes.md`](pacientes.md) para el porqué. Las tres tablas de
registro (`clinic_sessions`, `clinical_reports`, `coordinations`) guardan
además `clientId` (`client_id`): foto del pagador tomada del paciente al
crearse, sin resincronizar (`migrate-clinica-client-link.js`, 23/07/2026).

Los cuatro de siempre, en detalle abajo: `ClinicSession`, `Coordination`,
`ClinicalReport`, `PerformanceMetric`. Los otros seis, descritos en su sección:
`Incidencia` + `IncidenciaAssignee` (→ Incidencias), `IncentiveItem`
(→ Incentivos escritos a mano), `Taller` → `talleres` + `TallerInscripcion` →
`taller_inscripciones` (actividades de grupo a las que se apunta quien quiere,
02/08/2026; NO son especialidades), `InterventionPlan` → `intervention_plans`
(plan de intervención del paciente, uno por paciente, `CASCADE`) y
`ExternalContact` → `external_contacts` (agenda de profesionales externos del
paciente; las actas apuntan ahí con `externalContactId`). `Patient` se
describe en `pacientes.md`.

### ClinicSession

Tabla: `clinic_sessions`. Registro estructurado de una sesión clínica.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `patientId` | UUID NOT NULL | FK a `patients` (ON DELETE RESTRICT). |
| `therapistId` | UUID **nullable** | FK a `team_members`. Opcional desde el 02/08/2026 (`migrate-sesion-terapeuta-opcional.js`): al importar cuatro años de Aumenta salieron 4.045 sesiones firmadas por gente que ya no está; una nota sin firma es mejor que una atribuida a otra persona. |
| `sessionDate` | TIMESTAMPTZ NOT NULL | Fecha y hora de la sesión. |
| `duration` | INTEGER nullable | Minutos. |
| `objectives` | JSONB NOT NULL DEFAULT `[]` | Array de objetivos trabajados (chips). |
| `activities` | TEXT | Actividades realizadas en la sesión. |
| `performance` | TEXT | Desempeño del paciente. |
| `observations` | JSONB NOT NULL DEFAULT `{}` | `{ familyComments, nextSessionNotes, homeworkTasks, incidents }`. |
| `prepText` | TEXT | Preparación previa (parte 1 del registro en 3 partes). |
| `prepFiles` | JSONB NOT NULL DEFAULT `[]` | Adjuntos de preparación `[{ name, path, mimeType, size }]`; NO son `documents` (ver «Registro de sesión en 3 partes»). |
| `parentFeedback` | TEXT | Devolución de la familia (parte 3). |
| `aiTranscription` | TEXT | Transcripción literal (Whisper). |
| `aiStructured` | JSONB | Resultado IA crudo (Claude). |
| `audioDurationSec` | INTEGER nullable | Duración del audio original, en segundos. |
| `aiReviewedAt` | TIMESTAMPTZ nullable | Cuándo terminó la IA de procesar/estructurar. |
| `status` | ENUM | `draft`, `ai_pending`, `registered`, `published`. Default **`registered`** (`migrate-clinica-module.js` añade los dos valores nuevos al enum). |
| `clientId` | UUID nullable | `client_id`: pagador, foto del paciente al crear. |

Índices: `(patient_id, session_date)`, `(therapist_id, session_date)`.

### Coordination

Tabla: `coordinations`. Acta de una reunión de coordinación.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `coordinationType` | ENUM | `family`, `school`, `psychiatrist`, `neuropediatrician`, `other_therapist`, `orientator`, `other`. |
| `participants` | JSONB DEFAULT `[]` | Asistentes. **Dos formas conviven** (ver abajo). |
| `coordinationDate` | TIMESTAMPTZ NOT NULL | Fecha. |
| `topics` | JSONB DEFAULT `[]` | Temas tratados. |
| `agreements` | JSONB DEFAULT `[]` | Acuerdos alcanzados. |
| `nextActions` | JSONB DEFAULT `[]` | Próximas actuaciones con responsable. |
| `relatedPatientId` | UUID nullable | FK a `patients` (ON DELETE SET NULL). |
| `scope` | ENUM nullable | `internal` (entre terapeutas del centro) / `external` (colegios, hospitales, otros profesionales). Sprint Aumenta 2026-07-28; las actas antiguas quedan sin clasificar. |
| `externalEntity` | VARCHAR(200) nullable | Con `external`, con quién («Colegio San José»). |
| `externalContactId` | UUID nullable | FK a `external_contacts`: a quién pertenece la relación, sin sustituir a `participants` (02/08/2026). |
| `aiTranscription` | TEXT | Sin IA de actas todavía. En las actas importadas, el texto original entero. |
| `aiActaGenerated` | TEXT | Acta IA (no se genera hoy). |
| `createdById` | UUID **nullable** | FK a `team_members`. Quién la registró. |
| `createdByName` | VARCHAR(200) nullable | Su nombre, cuando no hay ficha a la que apuntar. |
| `clientId` | UUID nullable | `client_id`: pagador, foto del paciente relacionado. |

#### Quién firma el acta (02/08/2026)

`createdById` era NOT NULL. Dejó de serlo al traer las 700 actas de Organízate:
171 las firma gente que ya no está en el centro, o cuentas que no son personas
(«NADIE», «FISIO»). Las dos salidas que había eran malas —tirar actas de
reuniones reales, o atribuírselas a otro—, así que Rodrigo pidió una tercera: el
nombre en texto libre.

- Si hay ficha de equipo, **manda la ficha**. `createdByName` es el resto.
- El serializer expone `createdByLabel` ya resuelto: nadie debe repetir esa
  precedencia en una pantalla.
- La ficha de coordinaciones lo pinta al pie: «Firmado por X».
- Migración: `migrate-coordinaciones-autor-libre.js`.

⚠️ La firma es **quien escribió el acta**, NO el terapeuta actual del paciente.
De las 171 sin ficha, 61 son de niños que hoy sí tienen terapeuta: los
reasignaron cuando esas profesionales se fueron. Poner al terapeuta de hoy
falsearía quién estuvo en aquella reunión.

#### Asistentes: dos listas, y dos formatos

Un asistente puede ser **del centro** o **de fuera**, y no da igual: el del
centro se conecta con la plantilla, el de fuera con la agenda de contactos
externos del paciente (`external_contacts`).

`participants` guarda hoy objetos
`{ kind, name, role, teamMemberId, externalContactId }`, pero el alta manual
sigue escribiendo texto suelto (`["Marga", "Paloma"]`) y las actas antiguas
también lo tienen así. Un texto suelto **no dice de qué lado está esa persona**,
así que el serializer lo devuelve con `kind: null` en vez de repartirlo a ojo, y
la pantalla cae a la línea «Participantes: …» de siempre.

Campos del serializer: `participants` (cadena legible),
`participantsInternal`, `participantsExternal`.

### ClinicalReport

Tabla: `clinical_reports`. Informe clínico generado.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `patientId` | UUID NOT NULL | FK a `patients`. |
| `therapistId` | UUID NOT NULL | FK a `team_members`. |
| `reportType` | ENUM | `evolution`, `admission`, `discharge`, `referral`. Default `evolution`. `referral` (Derivación) desde el sprint Aumenta 2026-07-28: la especialidad de destino va en `contentSections.referralSpecialty` (claves de `lib/clinica/derivaciones.js`). `admission` se ETIQUETA «Entrevista inicial» desde ese sprint (el valor en BD no cambia). |
| `reportDate` | DATEONLY NOT NULL | Fecha de redacción. |
| `dueDate` | DATEONLY nullable | Fecha límite de entrega. |
| `deliveredAt` | TIMESTAMPTZ nullable | Marca de entrega real (la sella «Enviar al paciente»). |
| `aiGenerated` | TEXT | Texto IA crudo. «Redactar con IA» NO escribe aquí: devuelve la propuesta y no guarda nada. |
| `contentSections` | JSONB DEFAULT `{}` | `{ motiveOfIntervention, objectives, evolution, achievements, persistentDifficulties, recommendations, continuityProposal, referralSpecialty?, sourceSessionIds? }`. |
| `attachments` | JSONB DEFAULT `[]` | URLs/IDs de adjuntos. |
| `status` | ENUM | `draft`, `reviewed`, `delivered`. Default `draft`. |
| `deliveredDocumentId` | UUID nullable | FK lógica al `Document` (PDF) que creó «Enviar al paciente»; reenviar lo reemplaza. |
| `clientId` | UUID nullable | `client_id`: pagador, foto del paciente al crear. |

Índices: `(patient_id, report_date)`, `(therapist_id, report_date)`, `(status, due_date)`.

### PerformanceMetric

Tabla: `performance_metrics`. Puntuación mensual por terapeuta.

7 áreas (la 5 se omite intencionadamente porque el documento original
de Aumenta saltó la numeración) + 3 complementos. Desde el **desempeño por
roles** (29/07/2026, `lib/clinica/performanceConfig.js`) las áreas las define
cada tenant por rol en `settings.clinica.performanceRoles`; sin config guardada
se comporta EXACTAMENTE como antes (`LEGACY_ROLE` sintetizado de
`performanceAreas.js`, umbrales 85/70).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `therapistId` | UUID NOT NULL | FK a `team_members`. |
| `periodMonth` | INTEGER NOT NULL | 1-12. |
| `periodYear` | INTEGER NOT NULL | 2020-2100. |
| `roleKey` | VARCHAR(64) nullable | `role_key`: rol de desempeño con el que se evaluó la fila. |
| `areaScores` | JSONB nullable DEFAULT `{}` | `area_scores`: puntuaciones por clave de área — la fuente de verdad nueva (`migrate-clinica-performance-roles.js`). |
| `area1Score`…`area8Score` | INTEGER nullable | 0-100. Sin `area5Score`. **Legacy pero se quedan**: se espejan al escribir las claves `area1..area8` y son el fallback de lectura de las filas históricas de Aumenta. |
| `complementOccupation` | INTEGER nullable | % ocupación clínica (0-100). |
| `complementSeniority` | INTEGER nullable | Años de antigüedad. |
| `complementAttendance` | BOOLEAN nullable | Asistencia perfecta. |
| `totalScore` | INTEGER nullable | 0-100. Media PONDERADA de las áreas al guardar (`computeTotalScore`). |
| `proposedIncentive` | DECIMAL(8,2) | Por **tramos** de `totalScore` (`proposeIncentive`, `settings.clinica.incentiveTiers`), sin IA; el valor guardado es caché, se recalcula en vivo. |
| `approvedIncentive` | DECIMAL(8,2) | Tras revisión de dirección. |
| `approvedById` | UUID nullable | FK a `team_members`. |
| `approvedAt` | TIMESTAMPTZ nullable | Marca de aprobación. |
| `notes` | TEXT nullable | Notas de la evaluación. |

Índice UNIQUE: `(therapist_id, period_year, period_month)`; además `(period_year, period_month)`.

## Frontend

Las pantallas del área viven en DOS carpetas desde el traslado del 2026-07-27
(ver "Dónde vive cada pantalla" arriba). Todas son `"use client"` y leen datos
REALES de la API (ya no hay datos hardcoded).

**En `app/(dashboard)/clinica/` (5 páginas):**

| Ruta | Propósito |
| --- | --- |
| `/clinica` | Landing del módulo. KPIs (sesiones, informes pendientes, coordinaciones, próxima entrega), accesos rápidos a Pacientes e Informes, pacientes recientes. H1: "Área clínica". |
| `/clinica/informes` | Listado de informes con filtros. Click en fila abre **drawer** con el informe completo (`InformeDrawer.jsx`: editor, volcado desde sesiones, IA, envío). |
| `/clinica/coordinaciones` | Listado GENERAL de coordinaciones del centro con filtros por tipo y ámbito, y alta (`NuevaCoordinacionModal.jsx`). Hasta el sprint 2026-07 solo se veían paciente a paciente. |
| `/clinica/talleres` | Talleres: actividades de grupo e inscripciones (02/08/2026). |
| `/clinica/estadisticas` | Estadísticas del centro (solo admin): actividad clínica, agenda y ausencias, captación; Excel y PDF. El dinero vive en Facturación a propósito. |

**En `app/(dashboard)/equipo/` (6 páginas, gestión de equipo; menú
`requiresAll: ["team_avanzado", "clinica"]`):**

| Ruta | Propósito |
| --- | --- |
| `/equipo/mi-desempeno` | Scorecard del terapeuta logueado: anillo SVG con puntuación total, áreas semáforo, complementos e histórico de 6 meses. |
| `/equipo/direccion` | Panel de dirección: KPIs, ranking del equipo, alertas, evolución, "Operativa del mes" y propuesta de incentivos (tramos + escritos). |
| `/equipo/productividad` | % de horas de intervención directa sobre disponibles, por profesional, y edición de las horas/semana objetivo. |
| `/equipo/incidencias` | Registro y seguimiento de incidencias (categorías, responsables, estados, verificación, comentarios). |
| `/equipo/bandeja` | "Lo mío pendiente" por terapeuta: informes sin entregar, incidencias asignadas y citas de hoy. |
| `/equipo/desempeno-config` | Configuración del desempeño por ROLES (solo admin): áreas, pesos, metas y umbrales por rol, desde un preset, en blanco o con propuesta de IA. Sin entrada de menú: se llega desde Dirección y Desempeño. |

Cada página interna lleva un mini-link de vuelta arriba: **"← Volver a Clínica"**
en `/clinica/informes` (Coordinaciones, Talleres y Estadísticas no lo llevan),
y **"← Volver a Equipo"** en las seis de `/equipo/*`. Las landings no lo llevan
(son el destino).

### Componentes

- `clinica/_components/PreviewBanner.jsx`: **desactivado** (devuelve `null`); se
  conserva por si hiciera falta reactivarlo. Lo siguen importando la landing,
  Informes y el módulo Pacientes; las páginas movidas a `/equipo/*` ya no.
- `clinica/_components/dummyData.js` y `pacientes/_components/dummyData.js`
  (este último re-exportaba del primero): **borrados el 20/08/2026**. Eran el
  resto histórico de la maqueta de junio —el array `THERAPISTS` con seis
  terapeutas inventadas, sesiones y KPIs de mentira— y llevaban desde la Fase 1
  sin que ninguna página los importara. Se anotaron varias revisiones como
  «sobreviven sin uso», que es exactamente el problema: cada repaso del módulo
  costaba abrirlos para confirmar que no hacían nada. Al borrar el de
  `pacientes/` desapareció también su carpeta `_components/`, que no contenía
  otra cosa. Si alguien busca esos nombres: no hay nada que reactivar, los
  datos de verdad vienen de la base y las terapeutas de `team` (ver
  `pacientes.md`).
- `components/clinica/` (6): `InformeDrawer`, `NuevaCoordinacionModal`,
  `InterventionPlanSection`, `PatientDocumentsSection`,
  `PatientExternalContactsSection`, `SpecialtyPicker`. Las piezas de clínica
  que se montan desde más de una pantalla (informes, ficha del paciente,
  listado de coordinaciones).
- `equipo/_components/`: componentes exclusivos de las pantallas de gestión de
  equipo — `PerformanceEditor`, `IncentiveTiersEditor`, `IncentiveItemsEditor`,
  `IncidenciaModal` y `performanceIcons`.

### Sidebar

Las pantallas del área cuelgan de **dos grupos distintos** (`components/layout/Sidebar.jsx`):

**Grupo "Clínica"** (sección «Salud», icono heartbeat, gating: módulo
`clinica`), se auto-expande en `/clinica/*` y `/pacientes/*`:

- **Pacientes** (`/pacientes`) — primero, es el dato del área clínica.
- **Informes** (`/clinica/informes`)
- **Coordinaciones** (`/clinica/coordinaciones`)
- **Talleres** (`/clinica/talleres`)
- **Estadísticas** (`/clinica/estadisticas`) — `adminOnly`

**Grupo "Equipo"** (sección «Gestión»; `visibleModules: ["team", "clinica"]`,
para que la terapeuta lo vea aunque no tenga `team`). Sus 5 hijos clínicos
llevan `requiresAll: ["team_avanzado", "clinica"]` (separación Equipo
básico/avanzado del 27/07/2026), así que un tenant con `team` pero SIN
`clinica` —o sin `team_avanzado`— NO los ve:

- **Desempeño** (`/equipo/mi-desempeno`) — `adminOnly`
- **Dirección** (`/equipo/direccion`) — `adminOnly`
- **Productividad** (`/equipo/productividad`) — `adminOnly`
- **Incidencias** (`/equipo/incidencias`) — todo el equipo
- **Bandeja de trabajo** (`/equipo/bandeja`) — todo el equipo

Los otros hijos del grupo no son de este módulo: **Fichaje** (`fichaje`),
**Ocupación** (`requiresAll: ["team_avanzado", "citas"]`) y **Actividad**
(`team_avanzado`). `/equipo/desempeno-config` no tiene entrada de menú.

Ya **no** hay entrada "Pacientes" a nivel raíz: vive dentro de Clínica.

## Migración

La viva es **`scripts/migrate-clinica-module.js`**: lee `master.tenants` en
tiempo de ejecución (regla #12), procesa cualquier tenant con `clinica` o
`pacientes` activo, crea (IF NOT EXISTS) los enums, `patients` y las cuatro
tablas base con las FK ya a `patients`, y añade a las tablas existentes las
columnas que han ido llegando. Idempotente. No hace falta lanzarla a mano: está
en el bloque `clinica` (y en el de `pacientes`) de
`scripts/_module-migrations.js`, así que la corre `enable-module.js <slug>
clinica` junto con las otras trece del bloque (vía `ensure-tenant-schema.js
<slug>`, que también lanzan el alta desde el panel y la reactivación). En
producción, si hiciera falta suelta:
`docker exec crm-salamandra-app-1 node scripts/migrate-clinica-module.js`
(el hostname `db` solo resuelve dentro de la red Docker).

**Histórico (hasta 06/2026):** `scripts/_hechos/migrate-clinica-sprint-1.js` (solo
`crm_aumenta`, hardcoded) creó los 4 enums y las 4 tablas de la maqueta con
`client_id`, y `_hechos/migrate-pacientes-sprint-1.js` las re-apuntó después a
`patient_id`. Las dos son ONE_OFF en `_module-migrations.js` y ya se
ejecutaron: **no usarlas**. Los npm `db:migrate:clinica(:prod)` siguen
apuntando a la vieja; el `:prod` con `--env-file=.env.production` ni siquiera
vale desde el host (el patrón es `docker exec`).

## Tenants

Quién tiene el módulo no se lista aquí (una lista a mano se queda vieja, y la
que hubo aquí llegó a citar dos clientes ya purgados): `/admin/modulos` o
`scripts/inspect-tenant-modules.js <slug>`. Lo que sí hay que saber: `aumenta`
es la reina (datos reales, NO wipear ni sembrar sin permiso); `demo` y
`demo_clinica` son escaparate y se siembran con `seed-clinica-demo.js`.

`'clinica'` **no** está en `ALL_MODULES` (`scripts/db-sync.js`): ese array
solo siembra la demo local. Se activa con `scripts/enable-module.js <slug>
clinica`, que abre las dos puertas (`tenant_modules` y `users.module_access`).

## Backlog (Sprint 2+)

> Lista escrita tras el sprint visual. Lo tachado ya está; lo demás sigue
> abierto.

- ~~Endpoints CRUD para los 4 modelos.~~ **HECHO** (Fase 1; hoy 35 `route.js`).
- ~~Subida y procesamiento de audio~~ **HECHO** (Fase 3: el CRM no graba,
  recibe el archivo del móvil de la terapeuta y lo pasa por Whisper + Claude).
- ~~Generación IA de informes a partir de N `ClinicSession` del
  paciente.~~ **HECHO** en dos pasos y sin que la IA escriba sola: volcado
  literal (`desde-sesiones`, 31/07) + redacción (`pulir`, 14/08), ver arriba.
- Generación IA de actas de coordinación (`aiActaGenerated` sigue vacío).
- Cálculo automático del desempeño mensual a partir de
  `ClinicSession`, `ClinicalReport`, asistencia y coordinaciones. Hoy las
  puntuaciones las introduce Dirección en el editor; lo único que se trae solo
  es la ocupación desde Productividad.
- ~~Workflow de aprobación de incentivos con auditoría en
  `master.AuditLog`.~~ **HECHO** (`approve`/`approve-all`, auditados como
  `clinica.performance.*`).
- ~~Filtrado de vistas por rol~~ **HECHO (2026-07-24)**: las terapeutas son
  rol `user` con `moduleAccess` [calendar, citas, clinica, pacientes] (admón.
  además billing+documents). "Mi desempeño", "Dirección" y "Productividad" son
  SOLO admin: gates de rol en `/api/clinica/performance/*` (GET incluidos),
  `/api/clinica/productividad` y `/api/clinica/dashboard`, ocultos también en
  Sidebar (`adminOnly`) y en la landing de Clínica. El Sidebar además filtra
  módulos por `user.moduleAccess` (espejo de `hasModule`). Login por NOMBRE DE
  USUARIO (p. ej. `arantxa_aumenta` en `users.email`, creado con
  `validate:false`); el formulario de login acepta email o usuario.
- ~~Descarga PDF de informes~~ **HECHO** (`reportPdf.js`, «Enviar al
  paciente»); sin QR ni plantilla del centro todavía.

## Decisiones cerradas

- ~~**Solo aumenta**: el módulo es específico de Aumenta hasta que un
  segundo cliente lo necesite.~~ **Superada**: es un módulo más del catálogo
  (`lib/provisioning/catalogo.js`), `aumenta` es su reina y lo tienen también
  `demo`, `demo_clinica` y `somos`. Lo que sí se mantiene: un cambio clínico
  va al base para todos, nunca a un `overrides/aumenta/`.
- **Sin cuestionarios** (no aplica aquí, sino al módulo Formación de
  Aumenta — ver `training.md`).
- **Nombres de terapeutas 100% ficticios** (Lorena Vázquez, Patricia
  Mendoza, Cristina Olmedo, Inés Carballo, Daniela Espinosa, Raquel
  Tudela) + dirección (Beatriz Andrade, Mónica Salgado) para evitar
  choques con el equipo real durante la demo.
- **FK de Clínica apunta a `patients`, no `clients`**: ver
  [`docs/modules/pacientes.md`](pacientes.md).

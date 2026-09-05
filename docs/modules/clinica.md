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
| **Endpoints** | `app/api/clinica/**` (39 `route.js`): `sessions/**` (7; el GET filtra por `plantilla` —la clave con la que se escribió el registro— desde el 04/09/2026, que es como la ficha pide las entrevistas iniciales aparte de las 100 últimas sesiones; `sessions/transcribe` ⚡ **Whisper + Claude** (acepta `file` repetido desde el 04/09/2026), `sessions/[id]/completar` ⚡ **Claude** — 01/09/2026: rehace el registro entero desde la transcripción YA guardada, sin audio y sin guardar nada, `sessions/[id]/pdf` el PDF del registro — 29/08/2026), `reports/**` (5; `reports/[id]/pulir` ⚡ **Claude**, `reports/[id]/desde-sesiones` volcado sin IA, `reports/[id]/enviar` genera el PDF y lo publica en `documents`), `coordinations`, `derivaciones` (catálogo, PUT solo admin), `plantillas` (los apartados de informes y registros del centro, PUT solo admin — 29/08/2026), `talleres/**` (4, con `talleres/[id]/sesiones` — 01/09/2026) + `taller-sesiones/[id]` (GET/PUT/DELETE de UNA sesión de taller; el DELETE solo admin, porque se lleva el registro de todo el grupo) + `taller-sesiones/transcribe` ⚡ **Whisper + Claude** (03/09/2026: el audio o las notas del taller → el registro entero del grupo, la nota de cada asistente y las internas; no guarda nada), `audio/transcribir` ⚡ **Whisper** (04/09/2026: uno o varios audios → su texto, en paralelo y SIN Claude; es lo que saca la transcripción de la espera del botón de la IA), `overview`, `estadisticas/**` (2, solo admin) y los de equipo, que exigen `team_avanzado`: `performance/**` (9; `performance/config/ai` ⚡ **Claude** propone áreas por rol; `performance/planes` es la excepción, solo clínica), `productividad/**` (2), `incentive-items/**` (2), `incidencias/**` (2; el GET devuelve además `yoSoy` —qué miembro del equipo está mirando— para que la pantalla se abra en LAS MÍAS, y `mine=1` sin ficha de equipo ya no filtra por un id imposible: enseña todo en vez de una lista vacía. 01/09/2026. **02/09/2026, AV-0018 y AV-0013 de Aumenta: quién ve qué** — dirección ve todas; el resto SOLO las que registró o tiene asignadas, también en la ficha, la edición y los adjuntos (`[id]/documents/**`), y una ajena responde 404; sin ficha de equipo y sin ser dirección no se ve ninguna. El GET devuelve `alcance` (`todas` | `mias`) para que la pantalla esconda los filtros por persona. Borrar: dirección cualquiera; el resto, la que registró **o de la que es responsable** (03/09/2026, AV-0039: las incidencias que abre sola una falta las registra la terapeuta y se le asignan a administración, que es quien las gestiona y quien tiene que poder quitarlas). La regla está escrita una vez en `lib/clinica/alcanceIncidencias.js` y fijada en `scripts/_smoke-alcance-incidencias.mjs`. **04/09/2026, Rodrigo: el «Visto» por responsable** — el PATCH acepta `{ visto: true|false }`, que marca que ESA persona ya hizo su parte sin cerrar la incidencia para las demás (422 a quien no es responsable: no tiene parte que dar por hecha); el GET las aparta del listado y `?vistas=1` las devuelve, y responde `vistasTotales` y, por fila, `visto` y `puedeMarcarVisto`. Cualquier actualización —comentario, edición, reapertura, reasignación— le borra el visto a los DEMÁS y se la devuelve, nunca a quien la provoca. Reglas en `lib/clinica/vistoIncidencia.js`), `bandeja`, `dashboard`. Los cuatro ⚡ pasan por `lib/demo/isDemo.js` (`assertNotDemoPaidCall` / `demoForcesFakeAi`). |
| **Lógica** | `lib/clinica/` (28): `plantillas.js` (desde el 01/09/2026 `DOCUMENTOS` son TRES: al informe y al registro se les suma `acta` —el acta de una reunión de equipo, que no es clínica ni tiene paciente pero se compone exactamente igual, y por eso se edita desde la MISMA tarjeta de Configuración → Módulos → «Plantillas de informes y registros» en vez de duplicar el editor; la lógica del acta vive en `lib/reuniones/acta.js` y su doc, en `citas.md`. **29/08/2026: qué apartados tiene un documento clínico** — la plantilla del centro, la foto que guarda cada documento y el reparto de un registro entre sus columnas de siempre y su JSONB; lo leen el informe, el registro y sus dos formularios) + `entrevistaInicial.js` (**04/09/2026, AV-0042: qué es una entrevista inicial y dónde se archiva** — `esEntrevistaInicial` la reconoce por su plantilla y `repartirRegistros` la saca de «Sesiones» para ponerla con los informes en la ficha del paciente; lo comparten la ficha y `tituloDeRegistro`) + `sessionPdf.js` (el PDF del registro de sesión; desde el 03/09/2026 con la MISMA portada y el mismo cuerpo que el informe, nombrado por lo que es —`tituloDeRegistro`: «Entrevista inicial», «Sesión de taller» o «Registro de sesión»— y con sus apartados numerados por `apartadosDelRegistro`) + `documentoPdf.js` (**03/09/2026: las piezas de dibujo del documento clínico** —portada a sangre, índice, apartado numerado, firma, cierre, pie— sacadas de `reportPdf.js` para que el informe y el registro se compongan con UNA copia), `serialize.js` (fila Sequelize → forma de la UI: `serializePatient/Session/Report/Coordination/Performance/RankingRow`; y el catálogo de tipos de informe —`REPORT_TYPES`, `REPORT_TYPES_NUEVOS`, el chip `REPORT_TYPE_LABEL` y, desde el 04/09/2026, `nombreDelInforme`: cómo se llama el documento cuando el rótulo va SOLO, que se mudó aquí desde `reportPdf.js` porque la portada del PDF y las dos cabeceras de pantalla necesitaban la misma lista y una pantalla no puede importar pdfkit), `whisper.js` (audio → texto, REST de OpenAI con la clave del tenant), `registroCompleto.js` (**01/09/2026: QUÉ es «el registro entero» y cómo se le pide a Claude** — `bloquesDelRegistro` = preparación + los apartados de la plantilla + devolución + notas internas, el prompt construido desde esa lista, el parseo defensivo de la respuesta y la propuesta canned de local; lo comparten los dos endpoints de IA y las dos pantallas) + `structureSession.js` (texto → registro entero, Claude; ya solo llama al modelo), `redactarInforme.js` (borrador desde las sesiones, sin IA) + `pulirInforme.js` (redacción IA que no pisa ni inventa: `verificarSinInventar`, `avisosDePerdida`), `reportPdf.js` (el PDF que recibe la familia; el tipo `beca` imprime la cabecera con los nombres oficiales, sus tres apartados y la firma; desde el 26/08 la portada imprime el PERIODO y las fechas de las sesiones base — solo fechas — y el anexo literal opcional) + `sesionesDelInforme.js` (carga las sesiones base para ese PDF, con candado de paciente), y desde el 28/08/2026 sus cuatro piezas puras: `marcaInforme.js` (la paleta del documento derivada de `settings.brand`), `apartadosInforme.js` (qué apartados se imprimen y con qué número — fuente ÚNICA del índice y del cuerpo; desde el 29/08 la LISTA se la pide a `plantillas.js` y sus siete de siempre son el respaldo), `firmaProfesional.js` (la línea de firma sin separadores huérfanos + `pideAcreditacionProfesional`) y `argumentosDelPdf.js` (lo que necesita el generador, armado una vez para las DOS rutas que lo llaman; desde el 03/09/2026 también para el registro: `includesDeLaSesion` + `argumentosDelPdfDeSesion`, con el nombre del taller si sale de uno), `beca.js` (el informe para la beca NEAE, 26/08/2026: denominaciones oficiales de la convocatoria — logopedia → «Reeducación del lenguaje»; psicología/TO/pedagogía → «Reeducación pedagógica y habilidades sociales» — y sus apartados: motivo de consulta, objetivos, metodología), `tallerSesion.js` (**01/09/2026: cómo una sesión de TALLER se convierte en el registro de cada paciente** — el cuerpo común igual para todos, la nota individual solo en la suya; puro, se prueba sin base de datos) + `propagarTaller.js` (el mismo reparto contra la base: crea, reescribe y borra las `clinic_sessions` de los asistentes, y NO borra la de quien ya tenga el registro enviado a su familia) + `tallerCompleto.js` (**03/09/2026: el registro entero de un TALLER para la IA** — los bloques: comunes de la plantilla, una nota por asistente con nombre y las internas; el prompt que prohíbe nombres en lo del grupo; y `repartirPropuestaDeTaller`, que solo escribe la nota de un niño en la clave de ESE niño; puro, se prueba sin base de datos) + `structureTaller.js` (la llamada a Claude, gemela de `structureSession.js`), `prepFiles.js` (adjuntos de preparación; desde el 02/09/2026 —AV-0027— con su fila en `documents` como `sesion_preparacion`, nunca visible para la familia y borrable solo desde la sesión: `documentoDePrepFile`, `esAdjuntoDePreparacion`), `estadisticas.js` + `estadisticasExport.js` (cifras del centro y su Excel/PDF), `incentives.js` / `incentiveItems.js` / `performanceAreas.js` / `performanceConfig.js` / `performancePresets.js` / `productivity.js` / `productivityQuery.js` / `period.js` (desempeño e incentivos), `incidencias.js` (taxonomía y serializer) —desde el 01/09/2026 **una incidencia puede nacerla el CRM**: marcar una falta en la agenda abre una (Administrativa · Citas) y se la manda a quien diga `settings.citas.incidenciaPorFalta`; quien la crea es `lib/citas/incidenciaPorFalta.js` y está documentado en `citas.md`—, `vistoIncidencia.js` (**04/09/2026: el «Visto» de cada responsable** — `esActualizacion` qué novedad se la devuelve a quien la dio por vista, `CAMPOS_QUE_REABREN` cuáles cuentan y cuáles no, `aQuienSeLeReabre` el `where` que perdona a quien la provoca, y `vistoDe` lo que la pantalla necesita saber; puras, el PATCH tiene cuatro caminos y los cuatro tienen que decir lo mismo) + `incidenciasDe.js` (`whereIncidenciasDe` con `soloPendientes`: «las mías» —quién puede verla— frente a «las que me quedan» —la campana, la Bandeja y Mi trabajo—, que desde el Visto ya no son lo mismo), `derivaciones.js` / `specialties.js` / `trimestres.js` (catálogos), `consents.js` (RGPD con traza), `contractStorage.js` (PDF legado del paciente), `patientClient.js` (de qué pagador es un paciente), `audit.js`. Fuera de la carpeta: `lib/notifications/alerts.js` (`syncClinicaAlerts`: informe vencido, incidencia asignada → campanita). |
| **UI** | Sin `modules/clinica/`. `components/clinica/` (8): `ApartadosEditor.jsx` (título-cuerpo, título-cuerpo: lo comparten el cajón del informe y el formulario del registro — 29/08/2026), `PropuestaIA.jsx` (01/09/2026: lo que ha sacado la IA, apartado por apartado, con LO TUYO al lado de LO PROPUESTO y tres salidas —mantener / añadir al final / sustituir—; lo comparten el formulario de alta y el cajón de la ficha), `InformeDrawer.jsx` (aquí se escribe y se pule el informe), `NuevaCoordinacionModal.jsx` (alta desde el listado y desde la ficha), `InterventionPlanSection.jsx`, `PatientDocumentsSection.jsx`, `PatientExternalContactsSection.jsx`, `SpecialtyPicker.jsx`, `SesionTallerDrawer.jsx` (01/09/2026: donde se escribe el registro de una sesión de taller — el del grupo arriba con `ApartadosEditor`, la nota de cada paciente abajo), `RegistroSesionEditor.jsx` (01/09/2026: **LA pantalla del registro de sesión**, la misma para estrenarlo y para seguir editándolo; la montan `/pacientes/[id]/sesiones/nueva` y `/pacientes/[id]/sesiones/[sesionId]`). En `app/(dashboard)/clinica/_components/` ya solo queda `PreviewBanner.jsx`, que devuelve `null`; el `dummyData.js` de la maqueta se borró el 20/08/2026 (no lo importaba ninguna página — ver «Componentes»). |
| **Modelos** | `ClinicSession` → `clinic_sessions` · `ClinicalReport` → `clinical_reports` · `Coordination` → `coordinations` · `PerformanceMetric` → `performance_metrics` · `Incidencia` → `incidencias` + `IncidenciaAssignee` → `incidencia_assignees` (con `visto_at`, el «Visto» de cada responsable — 04/09/2026; NULL = pendiente para esa persona) · `IncentiveItem` → `incentive_items` · `Taller` → `talleres` + `TallerInscripcion` → `taller_inscripciones` + `TallerSesion` → `taller_sesiones` (01/09/2026: el registro COMÚN de una sesión de taller, que se copia a la `ClinicSession` de cada asistente por `clinic_sessions.taller_sesion_id`) · `InterventionPlan` → `intervention_plans` · `ExternalContact` → `external_contacts`. Las FK clínicas apuntan a `patients` (ver `pacientes.md`) y las tres tablas de registro guardan además `client_id`, foto del pagador al crearse. Desde el 01/09/2026 `clinic_sessions` guarda también `booking_id` (de qué CITA sale el registro, sin FK): es lo que hace que volver a una cita continúe SU sesión en vez de crear otra. |
| **Interruptores y parámetros** | `featureFlags` / `logicOverrides`: ninguno que lea el código. Lo que sí lee es `master.tenants.settings.clinica.*`: `incentiveTiers` (`lib/clinica/incentives.js`), `performanceRoles` (`lib/clinica/performanceConfig.js`), `referralSpecialties` (`lib/clinica/derivaciones.js`), `trimestreConJulio` (`lib/clinica/trimestres.js`) y `plantillas` —`{ informe: [...], registro: [...] }`, los apartados de cada documento (`lib/clinica/plantillas.js`, 29/08/2026)—; los cinco se escriben desde sus endpoints (solo admin) e invalidan la caché del tenant. |
| **Pantallas propias** | ninguna (`modules/overrides/*/` no tiene nada de clínica y ningún `UI_OVERRIDES` la carga). |
| **Scripts** | Activar: `node scripts/enable-module.js <slug> clinica` (avisa si falta `pacientes`; `ensure-tenant-schema.js` corre las 18 del bloque `clinica` de `scripts/_module-migrations.js`: `migrate-clinica-module` —crea `patients` y las cuatro tablas base—, `migrate-external-contacts`, `migrate-contactos-externos-nombre-opcional`, `migrate-talleres`, `migrate-taller-sesiones` —crea `taller_sesiones` y añade `clinic_sessions.taller_sesion_id` (01/09/2026); el MODELO declara esa columna, así que **VA ANTES del despliegue**—, `migrate-taller-sesiones-ia` —`taller_sesiones.ai_transcription` y `audio_duration_sec` (03/09/2026), el texto del que la IA sacó el registro del taller; el modelo las declara: **VA ANTES del despliegue**—, `migrate-coordinaciones-autor-libre`, `migrate-sesion-terapeuta-opcional`, `migrate-clinica-client-link`, `migrate-patients-care-type`, `migrate-patients-specialties`, `migrate-documents-patient-link`, `migrate-incidencias-module`, `migrate-incidencias-verificacion`, `migrate-incidencias-visto` —`incidencia_assignees.visto_at` y su índice (04/09/2026); es CORE y **VA ANTES del despliegue**: el modelo la declara para todos—, `migrate-incentive-items`, `migrate-clinica-performance-roles`, `migrate-informe-beca` —añade 'beca' al enum de tipos de informe; VA ANTES del despliegue—, `migrate-informe-asesoramiento` —añade 'asesoramiento' al mismo enum (04/09/2026); VA ANTES del despliegue por lo mismo—, `migrate-clinica-apartados-sesion` —`clinic_sessions.content_sections` JSONB, 29/08/2026; el MODELO la declara, así que VA ANTES del despliegue o el primer SELECT de la ficha da 42703—, `migrate-clinica-notas-internas` —`clinic_sessions.internal_notes`, 29/08/2026, VA ANTES del despliegue por lo mismo—, `migrate-clinica-registro-enviado` —`delivered_document_id` y `delivered_at` en `clinic_sessions`, 29/08/2026, VA ANTES por lo mismo—, `migrate-clinica-sesion-de-cita` —`clinic_sessions.booking_id` y su índice, 01/09/2026; VA ANTES por lo mismo, y se elige por TABLA (`byTable`) y no por módulo, porque el modelo la declara para todos—; `intervention_plans` y `notifications` llegan por las CORE). Seed: `seed-clinica-demo.js <slug>` (pacientes + clínica; **VACÍA** la historia clínica antes, solo escaparate; lo lanza `crear-demos-por-oficio.js` para `demo_clinica`). Importación de Organízate para Aumenta, ya corrida: `_hechos/import-aumenta-sesiones.js` e `_hechos/import-aumenta-coordinaciones.js` (simulan sin `--confirm`). Backfill de datos: `backfill-patients-client.js` (dry-run; ver `pacientes.md`). `_hechos/migrate-clinica-sprint-1.js` es ONE_OFF de la maqueta (solo `crm_aumenta`, ya ejecutado): no usarlo. |
| **Pruebas** | `scripts/_smoke-pulir-informe.mjs` — entra en `npm test`, sin base de datos: las dos reglas del informe (solo cinco apartados viajan al modelo; se rechaza lo que inventa números o meses). `scripts/_smoke-piezas-ficha.mjs` (`@prueba ligera`) fija que con la forma de Aumenta (clínica + archivo avanzado + citas) la ficha de cliente NO gana los paneles de Laura. `scripts/_smoke-fechas-trimestres-madrid-parseDate.mjs` (`node:test`, 19/08/2026, en `npm test`) en su parte de `lib/clinica/trimestres.js`: T1 septiembre–diciembre, T2 enero–marzo, T3 abril–junio y julio SOLO si `settings.clinica.trimestreConJulio === true` de verdad (Rodrigo, 28/07/2026), agosto no es de nadie, el curso se nombra por el año en que empieza, `trimesterRange` con fin exclusivo; fija también que el fichero entero mira la zona del proceso (a las 00:30 de Madrid del 1 de septiembre es T1 en Madrid y nada en UTC; por eso el contenedor corre en `Europe/Madrid` desde el 19/08/2026) y, como SOSPECHOSO, que `trimesterOf(null)` cae en 1969. `scripts/_smoke-clinica-config-incidencias-export.mjs` (`node:test`, 20/08/2026, en `npm test`): `lib/clinica/performanceConfig.js` —la promesa es la compatibilidad: un tenant sin config de desempeño guardada, o con una corrupta, se comporta EXACTAMENTE como siempre (las 7 áreas históricas, pesos intactos, semáforo 85/70); `normalizeRoles` repara lo reparable (textos, defaults, el único rol sin marcar queda como el por defecto) y devuelve null a lo irreparable, como pesos que no suman 100—; `lib/clinica/incidencias.js` —la taxonomía es fija (10 categorías desde el 29/08/2026, solo Administrativa con subcategorías, y solo «Otros» exige la suya; las claves históricas siguen siendo válidas aunque su etiqueta haya cambiado) y la verificación GOBIERNA el estado con un solo control: resuelta→resolved, parcial y no_resuelta→in_progress, sin verificar→pending, nunca resuelta y pendiente a la vez; la forma exacta de `serializeIncidencia` y los responsables sincronizados (la pivote queda como el formulario y el espejo apunta al primero)—; y `lib/clinica/estadisticasExport.js` —el Excel y el PDF de dirección salen del MISMO objeto que pinta la pantalla, comprobado celda a celda abriendo el buffer que devuelven—. `scripts/_smoke-pdf-factura-informe.mjs` (`node:test`, 21/08/2026, ligera, en `npm test`) cubre en su otra mitad `lib/clinica/reportPdf.js`, el informe que recibe la FAMILIA: genera el PDF de verdad y lo lee por dentro —el nombre del fichero que ve la familia (`reportPdfFilename`: tipo, paciente y fecha, con los caracteres prohibidos borrados y sin guiones sueltos), la cabecera con el nombre del centro, la ficha de datos (las filas sin valor no se imprimen, ni su rótulo), las siete secciones SIEMPRE en el orden de lectura y solo las que tienen contenido, el respaldo al texto bruto de la IA cuando no hay secciones (y que con secciones ese texto NO se cuela además), la frase de «todavía no tiene contenido» en vez de un folio en blanco, el color de marca del cliente en la regla del título, y que un informe largo no pierde el final ni dos informes a la vez se mezclan—. Marca con `// SOSPECHOSO` que la especialidad de derivación sale del catálogo GLOBAL y no del del centro (el generador no recibe el tenant), y que la fecha se lee como instante UTC y no como día de calendario. `scripts/_smoke-informe-beca.mjs` (`node:test`, 26/08/2026, ligera, en `npm test`): el informe para la beca dice lo que la convocatoria pide y nada más — la cabecera con los nombres OFICIALES (y sin inventar nombre a una especialidad no cubierta), solo sus tres apartados aunque el resto esté escrito, el texto bruto de la IA no se cuela, la firma «Fdo.:» también con el informe vacío, y el evolutivo sigue exactamente igual (sin firma, rótulos de siempre). `scripts/_smoke-informe-pdf.mjs` (`node:test`, 28/08/2026, ligera, en `npm test`, 43 casos): el informe REDISEÑADO — que un apartado vacío no gasta número (o el índice y el cuerpo dejan de casar), que la beca imprime sus tres y no cae al texto de la IA, que la firma no deja «Marta Ruiz · ·» cuando falta la titulación, que la edad es la de la FECHA DEL INFORME y no la de hoy, que sin marca ni centro ni colegiada el PDF se genera igual, que con logo lleva la imagen dentro y con una URL remota NO, y que no se cae ni con el informe más roto que se pueda imaginar. `scripts/_smoke-pdf-imagen-local.mjs` (`node:test`, 28/08/2026, ligera): el cerrojo de `lib/pdf/imagenLocal.js` — qué rutas se aceptan y cuáles no (`http://169.254.169.254`, `/../.env`, `//evil.com`, `data:`), y que un SVG o un WebP se rechazan porque pdfkit lanza `Unknown image format.` y eso sería un 500 sin explicación. `scripts/_smoke-informe-ida-y-vuelta.mjs` (`node:test`, 28/08/2026, ligera): que lo que entra en `contentSections` puede salir — el cajón se rellena desde `serializeReport` y guarda ese objeto entero, así que una clave que no vuelva se BORRA al guardar. `scripts/_smoke-plantillas-clinica.mjs` (`node:test`, 29/08/2026, ligera, en `npm test`): los apartados por PLANTILLA, generando los dos PDF de verdad y leyéndolos por dentro — la compatibilidad primero (sin plantillas guardadas salen los siete de siempre en su orden, y una config corrupta se comporta como si no hubiera nada), la plantilla del centro cuando el documento no trae la suya, la FOTO del documento por encima de todo (un informe viejo se imprime con SUS títulos aunque la plantilla haya cambiado después), el apartado suelto que sale en el PDF sin quedarse guardado en ninguna plantilla, que renombrar conserva la clave y por tanto lo ya redactado, que ninguna clave con significado propio (`sourceSessionIds`, `apartados`, `referralSpecialty`…) se puede secuestrar, el PDF del registro con sus apartados y su devolución de la familia —y sin la preparación, las notas internas ni la transcripción—, y que el reparto de un registro deja lo de fábrica en sus columnas de siempre y solo lo nuevo en el JSONB, con ida y vuelta exacta. `scripts/_smoke-taller-completo.mjs` (`node:test`, 03/09/2026, ligera, en `npm test`, 12 casos): el audio y la IA en la sesión de TALLER — los bloques salen de la misma lista para el prompt y el reparto (comunes · una nota por asistente CON nombre · internas al final), el prompt nombra a los asistentes y prohíbe nombres en lo del grupo, una nota para un id que no está entre los asistentes se tira, la clave de la nota individual nunca entra como apartado común, lo interno no cruza a lo común ni a las notas, una respuesta rota da propuesta vacía sin romper, y la propuesta canned de local tiene la forma de los bloques pedidos y no lleva nombres en lo común. `scripts/_smoke-registro-pdf.mjs` (`node:test`, 03/09/2026, ligera, en `npm test`): el registro de sesión CON PORTADA — que la primera página es la portada y el cuerpo empieza en la segunda, que la pastilla dice el día de la sesión y la edad es la de ESE día (no la de hoy), que se nombra por lo que es (entrevista inicial, sesión de taller con el nombre del taller, registro de sesión), que los apartados van numerados por el documento y el título sale sin el número que traiga la plantilla (`sinNumeroDelante`, la misma regla en el informe), que la entrevista con sus 15 apartados NO lleva índice, la firma con y sin acreditación, la hoja de protección de datos, y que la preparación, las notas internas y la transcripción siguen sin salir en ninguno de los tres tipos. `scripts/_smoke-clinica-notas-internas.mjs` (`node:test`, 29/08/2026, ligera, en `npm test`): las NOTAS INTERNAS del registro de sesión cumplen sus dos mitades — que se puedan poner (`serializeSession` las devuelve, vacías si no hay, y no se cuelan en la vista previa de la lista) y que no se suban (`redactarDesdeSesiones` no las lleva a ninguna sección del borrador, tampoco cuando son lo único escrito). La otra salida —el anexo literal del PDF— la cubre `_smoke-informe-beca.mjs`, que mete la nota en la sesión a propósito. `scripts/_smoke-clinica-enviar-registro.mjs` (`node:test`, 29/08/2026, ligera, en `npm test`): enviar UN registro al área privada — la fila de `documents` que se crea (un `application/pdf`, `client_visible` en true, colgado del paciente Y de su pagador, `source='sesion'`, en el archivo compartido y sin carpeta) y **la lista exacta de sus doce campos**, que es la promesa de «simplemente el PDF»: si alguien añade una clave, la prueba lo cuenta antes de que salga del CRM. Y que sin pagador NO se envía, con un motivo que dice dónde se arregla. Lo que el PDF no lleva ya lo fija `_smoke-plantillas-clinica.mjs`: se envía ese mismo buffer. `scripts/_smoke-registro-completo.mjs` (`node:test`, 01/09/2026, ligera, en `npm test`, 14 casos): que el audio rellene el REGISTRO ENTERO y no siete campos — el prompt y el parseo salen de la MISMA lista de bloques (si dejan de casar, Claude contestaría con unas claves y se leerían otras, y la propuesta saldría vacía sin un solo error por ninguna parte), una petición sin apartados cae a los siete de fábrica y no a la nada, un apartado que roba la clave de un envoltorio no lo duplica y gana el envoltorio, el JSON se acepta con vallas de markdown o sin ellas y la basura da propuesta vacía sin romper, las claves que nadie ha pedido se tiran, `aiStructured` conserva su forma histórica con lo nuevo en `extra`, y —lo importante— **las notas internas no acaban en `contentSections` al aplicar la propuesta**, que es por donde saldrían impresas en el registro que recibe la familia. `scripts/_smoke-preparacion-un-solo-sitio.mjs` (`node:test`, 01/09/2026, ligera, en `npm test`): la preparación de `/pacientes/[id]/sesiones/nueva` sale de UN solo estado — lee la pantalla y exige que `prepSolo` no vuelva, que los DOS recuadros (el del registro completo y el de preparar) estén atados a `form.prepText`, y que el alta y el botón de guardar miren ese mismo texto. Nace de que no lo hacían: se escribía la preparación en el registro, se pulsaba «Guárdala solo como preparación» y salía el recuadro VACÍO con el botón apagado, o sea que el borrador no se podía guardar. `scripts/_smoke-taller-sesion.mjs` (`node:test`, 01/09/2026, ligera, en `npm test`): el registro de una sesión de TALLER cumple sus dos promesas opuestas — lo COMÚN llega igual a todos y llega a las COLUMNAS de siempre (de donde comen el informe, el anexo y las estadísticas), y lo INDIVIDUAL no cruza por ningún camino: ni por la lista de apartados, ni por el cuerpo común, ni por una plantilla que meta la clave de la nota; comprueba además que las notas internas del grupo no bajan a ningún paciente, que el apartado privado va el último de la foto con su título, y que cerrar la sesión del taller la cierra en la ficha de cada uno. `scripts/_smoke-sesion-de-la-cita.mjs` (`node:test`, 01/09/2026, ligera, en `npm test`, 12 casos): **en qué nota clínica se va a escribir**. `sesionDeLaCita` continúa la sesión de una cita en vez de crear otra, y su segundo camino —el que adopta las preparadas antes de que existiera `booking_id`— no puede equivocarse: hora EXACTA (ni un minuto), una sola candidata, nunca una que ya sea de otra cita, nunca una de taller, y sin cita no devuelve nada. Los dos fallos posibles no se parecen: no encontrarla duplica una sesión (se ve y se arregla); encontrar la que no es escribe encima del registro de otro día, firmado. `scripts/_smoke-entrevista-en-informes.mjs` (`node:test`, 04/09/2026, ligera, en `npm test`, 17 casos): **dónde se guarda la entrevista inicial y desde dónde se estrena**. Se reconoce por su plantilla y no por nada que se pueda escribir a mano (un `contentSections` que no es un objeto, una clave que no es texto o una plantilla de taller NO cuelan), sale de «Sesiones» y entra en «Informes», no se duplica aunque llegue por las dos peticiones de la ficha, una entrevista antigua que ya no cabe en las 100 últimas sesiones sigue apareciendo, y —lo que ata las dos mitades— el PDF titula «Entrevista inicial» exactamente los mismos registros que la ficha archiva ahí. Lee además la pantalla para exigir que cada pestaña siga pintando su lista y que la cabecera conserve el botón «Nueva entrevista inicial» —con la plantilla compuesta desde `CLAVE_ENTREVISTA` y no escrita a mano, y gateado por lo que ofrece el centro—. `scripts/_smoke-informe-asesoramiento.mjs` (`node:test`, 04/09/2026, ligera, en `npm test`, 10 casos): el informe de ASESORAMIENTO es un tipo más y no una beca — está en `REPORT_TYPES` (lo que aceptan los endpoints) y en `REPORT_TYPES_NUEVOS` (lo que la UI ofrece, que es donde un tipo se queda mudo sin que nadie se entere), se nombra en los DOS registros («Asesoramiento» en el chip, «Informe de asesoramiento» donde el rótulo va solo) y sus apartados los pone el centro: con plantilla guardada imprime la suya, sin nada guardado los siete de fábrica, y el MISMO informe marcado como beca no imprime nada, que es la diferencia entre los dos en una línea. Exige además que ningún tipo del catálogo se quede sin nombre de documento. La portada del PDF de verdad la comprueba `_smoke-pdf-factura-informe.mjs`. `scripts/_smoke-incidencia-visto.mjs` (`node:test`, 04/09/2026, ligera, en `npm test`, 10 casos): el «Visto» por responsable — qué cuenta como actualización (comentario, reasignación y cada uno de los campos que se le enseñan al equipo) y qué NO (`clientId`, que se recalcula solo al cambiar el paciente y avisaría dos veces del mismo cambio; `resolvedAt`, que viaja con la verificación; y marcar visto a secas, que si reabriera se devolvería la incidencia a las demás en el acto), que se le reabre a los DEMÁS y nunca a quien lo provoca —comentar te devolvería tu propio comentario a la bandeja para siempre—, que sin ficha de equipo se reabre para todos, y que solo los RESPONSABLES tienen botón: quien únicamente la registró la ve y no tiene parte que dar por hecha. No hay ninguna con base de datos propia del módulo. |
| **Decisiones** | `../decisions/2026-07-23-conexion-cliente-equipo.md` · `../decisions/2026-07-28-repaso-de-seguridad.md` · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` · `../decisions/2026-08-04-clientes-se-llama-pacientes-en-nutricion.md` |
| **En este doc** | Dónde vive cada pantalla (traslado del 2026-07-27) · Programa de Excelencia (2026-07-24) · Registro de sesión en 3 partes (sprint Aumenta 2026-07, punto 4) · Preparar una sesión antes de darla (26/08/2026) · Una cita, un registro — y se edita a posteriori (01/09/2026) · El audio rellena el registro entero, y ella elige (01/09/2026) · Varios audios, y la transcripción fuera de la espera (04/09/2026) · Plantillas de informes y registros (29/08/2026) · PDF del registro de sesión (29/08/2026) · El registro, con portada como el informe (03/09/2026) · La entrevista inicial: tipo de cita, 15 apartados y su sitio con los informes (02–04/09/2026) · Notas internas (29/08/2026) · El registro de sesión de un TALLER (01/09/2026) · El audio y la IA en el taller (03/09/2026) · Redactar un informe (31/07/2026) · Redactar con IA (14/08/2026) · Enviar UN registro de sesión a la familia (29/08/2026) · «Enviar al paciente» (sprint Aumenta 2026-07, punto 3.2) · Modelos · Frontend |

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

**El audio rellena el REGISTRO ENTERO, y ella elige (01/09/2026, Rodrigo).**
«No tengo ningún botón para, una vez transcrito un audio, hacer todo el registro
completo con esa información, desde preparación a las notas internas.» El botón
existía y se quedaba a medias: el prompt de `structureSession.js` llevaba SIETE
campos clavados —el bloque 2 y solo los de fábrica—, así que quedaban siempre en
blanco la preparación (`prepText`), la devolución de la familia
(`parentFeedback`), las notas internas (`internalNotes`) y **los apartados
propios de la plantilla del centro**, que existen desde el 29/08 y de los que el
prompt no sabía nada. Ahora:

- `lib/clinica/registroCompleto.js` **construye el prompt** desde los bloques
  reales de ese registro (`bloquesDelRegistro`: preparación · los apartados de
  la plantilla · devolución · notas internas). Añadir un apartado a la plantilla
  basta para que Claude lo rellene; no hay una segunda lista que actualizar. Sin
  apartados se cae a los siete de fábrica, nunca a una lista vacía.
- **Nada entra solo.** `components/clinica/PropuestaIA.jsx` enseña, apartado por
  apartado, LO TUYO al lado de LO PROPUESTO con tres salidas —mantener / añadir
  al final / sustituir—; lo vacío viene marcado para entrar y lo escrito a mano
  viene marcado para quedarse. Antes, lo que la IA proponía para un apartado ya
  escrito se tiraba sin que nadie lo llegara a ver.
- **No hace falta audio.** Mismo día, Rodrigo: «también debe poder coger texto
  libre, no solo la transcripción del audio, por si apuntan todo en un bloc de
  notas y lo pasan ahí». Las dos pantallas tienen un recuadro donde pegar lo
  apuntado, y para la IA es lo mismo que la voz: texto. `materialParaLaIA()`
  junta las dos fuentes cuando se dan las dos (con el rótulo
  `SEPARADOR_NOTAS` en medio, para poder distinguirlas después) y `MAX_NOTAS`
  las acota en 20.000 caracteres. **Sin audio no se llama a Whisper ni hace
  falta clave de OpenAI**, y la pantalla no pinta sus pasos.
- **El texto se guarda, venga de donde venga**: `clinic_sessions.ai_transcription`
  pasa a ser «de qué texto salió este registro» —la transcripción de un audio
  que ya no existe, las notas pegadas, o las dos—, y `audio_duration_sec` a
  `null` es lo que distingue las dos vías (el cartel del cajón dice «Transcrito
  del audio» o «a partir de un texto escrito» según eso). En el `PATCH` va con
  **candado de escritura única** (`sessions/[id]`): se escribe si está vacío y
  no se pisa nunca, porque es la prueba de dónde vino una nota clínica.
- **Segunda puerta, sobre una sesión YA GUARDADA**: `POST
  /api/clinica/sessions/[id]/completar` reparte **el texto guardado más las
  notas que se peguen** (body opcional `{ texto }`; Whisper no entra aquí por
  ningún lado) y devuelve la propuesta **sin guardar nada**; lo que se elija va
  por el `PATCH` de siempre. El botón sale en el cajón de **toda sesión
  abierta**, tenga audio o no — que es lo que lo hace útil para las 22.045
  importadas de Aumenta, ninguna con transcripción. Sin texto por ningún lado,
  409 con el motivo.
- Las **notas internas** siguen siendo la frontera: van marcadas `interno`, el
  prompt lo dice con todas las letras y `_smoke-registro-completo.mjs` fija que
  al aplicar la propuesta NO acaban en `contentSections` —que sí viaja al PDF—.
- `aiStructured` conserva su forma histórica (`estructuraHistorica`); lo que no
  cabe en ella viaja en `extra`, sin deformar las sesiones ya guardadas.

**Varios audios, y la transcripción fuera de la espera (04/09/2026, Rodrigo).**
«La transcripción por IA va un poco lenta, y queremos subir más de un audio antes
de ponerlo a transcribir.» Las dos cosas son la misma: transcribir y repartir
iban pegadas en una única petición, con UN audio cada vez.

- **La lista, no el fichero.** `components/clinica/useAudios.js` guarda LOS
  audios de un registro (hasta `MAX_AUDIOS` = 8), cada uno con su estado y su
  transcripción. Se añaden de uno en uno o soltando varios de golpe, se quitan
  por separado —quitar el que sobra ya no se lleva por delante lo transcrito de
  los demás— y su texto se junta EN EL ORDEN EN QUE SE SUBIERON
  (`juntarTranscripciones`), que es como se dictó la sesión. Lo comparten el
  registro de sesión y el cajón del taller, que tenían el mismo estado copiado.
- **Transcribir es un paso aparte y no bloquea**: `POST
  /api/clinica/audio/transcribir` ⚡ **Whisper** recibe uno o varios `file` y
  devuelve el texto de cada uno, sin llamar a Claude. La profesional los manda
  en cuanto los tiene y sigue escribiendo el registro mientras; cuando pulse el
  botón de la IA, la transcripción ya está hecha y solo se espera el reparto.
  Si le da directa a la IA sin transcribir, la pantalla transcribe primero y
  luego reparte —dos peticiones, el mismo botón—.
- **En paralelo** (`transcribirVarios`, `A_LA_VEZ` = 4): cuatro notas de voz
  cuestan lo que la más larga, no lo que las cuatro. Un audio que falla vuelve
  con su error y no tumba a los demás; solo si fallan TODOS hay error de HTTP.
- **Las tandas las manda el proxy, no el gusto**: el nginx del CRM corta los
  cuerpos a 30 MB, así que `repartirEnTandas` agrupa los pendientes en
  peticiones de `MAX_BYTES_POR_TANDA` (20 MB) y `MAX_AUDIOS` como mucho, y se
  mandan una detrás de otra. Los topes y el orden viven en
  `lib/clinica/audios.js`, que es lo que leen la pantalla Y los endpoints, y los
  fija `scripts/_smoke-clinica-audios.mjs`.
- `sessions/transcribe` y `taller-sesiones/transcribe` aceptan `file`
  **repetido** por compatibilidad, pero lo normal es que ya no les llegue
  ninguno: reciben el texto en `transcripcion`, que es la vía que existe desde
  el 01/09/2026 para no pagar dos veces el mismo audio.
- Lo que se guarda no cambia: `ai_transcription` es el material entero y
  `audio_duration_sec`, la SUMA de las duraciones de los audios transcritos
  (`duracionTotal`; `null` sigue queriendo decir «no hubo audio»).
- Y la otra mitad de «va lenta» es Claude: `structureSession` y
  `structureTaller` piden la respuesta **por streaming** (como la IA de
  Proyectos), que es lo que evita que un registro largo se coma los 120 s de
  timeout del proveedor. Cuánto tarda cada mitad se ve ahora en el log del
  contenedor (`[clinica:transcribe] whisper …ms` / `… claude …ms`): antes
  «tarda» no se podía investigar. **El modelo de transcripción sigue siendo
  `whisper-1` a propósito**: los `gpt-4o-*-transcribe` son más rápidos pero
  cortan la salida a 2.000 tokens, y una sesión de cinco minutos ya se acerca a
  ese techo — una transcripción truncada en una nota clínica no se ve venir.

**La segunda puerta: preparar sin audio (26/08/2026).** Esa misma pantalla
acepta `?preparar=1&fecha=<ISO>` y entra directa a un formulario de preparación
—día y hora, texto y adjuntos— que crea la sesión en `draft` por el POST de
siempre, sin tocar ni un campo de IA. Existe porque hasta ese día **una sesión
solo nacía subiendo un audio**, o sea que para preparar una había que haberla
dado ya. La contradicción se ve en producción: 22.045 sesiones en Aumenta y CERO
con `prep_text`. El contrato de la URL y el cuerpo del alta viven en
`lib/clinica/prepararSesion.js` (`_smoke-clinica-preparar.mjs`), porque lo monta
el modal de una cita y lo lee esta pantalla.

⚠️ **La preparación se escribe en UN solo estado, `form.prepText`** (arreglado el
01/09/2026, Rodrigo: «guardar la preparación no funciona, no se guarda nada como
borrador»). Las dos pantallas de `nueva` piden lo mismo —la tarjeta «1 ·
Preparación» del registro completo y el formulario de preparar—, y hasta ese día
la segunda guardaba su texto en un estado propio que nadie rellenaba al llegar
desde la primera: el enlace «Guárdala solo como preparación» abría el recuadro
VACÍO con el botón apagado, sin error. El día y los adjuntos ya se compartían;
el texto era el único que se caía. Lo fija
`scripts/_smoke-preparacion-un-solo-sitio.mjs`, que lee la pantalla. Y como del
registro completo solo viaja `prepText`, esa pantalla avisa en ámbar si hay algo
más escrito en vez de perderlo en silencio.

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
- **Los comentarios avisan (02/09/2026, Rodrigo)**: hasta entonces el
  comentario se guardaba (append atómico en el JSONB) y ahí se quedaba —la
  campana solo conocía `incidencia_pending`, que mira el ESTADO, y un
  comentario no lo cambia—. Ahora el PATCH con `comment` toca la campana de
  quien ya está en la conversación (quien la registró, los responsables por la
  pivote y quien comentó antes; nunca el autor; si no queda nadie, dirección)
  con el tipo `incidencia_comentario`, fuera de `AUTO_TYPES`
  (`lib/clinica/avisoComentarioIncidencia.js`; cruce ficha→usuario por
  `TeamMember.userId`; `notifyAdmins` admite `excepto` para no avisar a quien
  escribe). El aviso enlaza a `/equipo/incidencias?incidencia=<id>` y la
  pantalla abre ESA ficha fresca del servidor; el modal vuelve a pedir la
  incidencia al abrirse (la copia del listado podía llevar un rato), el listado
  se refresca solo al volver a la pestaña y enseña el nº de comentarios, y el
  serializer devuelve `updatedAt`. Prueba:
  `scripts/_smoke-aviso-comentario-incidencia.mjs` (`node:test`, ligera).
- **Taxonomía revisada (29/08/2026, Aumenta por Rodrigo)**: DIEZ categorías, en
  el orden en que las escribió el centro — Terapéutica, Organizativa,
  Documental, Administrativa, Coordinación / apoyo, Tecnológica / material,
  Comunicación oficial, Solicitud laboral, Solicitud de información y Otros.
  Las **claves** de las ocho anteriores no se tocaron (están escritas en
  `incidencias.category`): tres solo cambian de etiqueta —`comunicativa` →
  «Comunicación oficial», `informacion` → «Solicitud de información»,
  `coordinacion` → «Coordinación / apoyo»— y `solicitud_laboral` y `otros` son
  nuevas. Las dos primeras ESTRECHAN el significado; se pudo hacer sin
  reetiquetar nada porque ese día la tabla `incidencias` estaba vacía en los
  ocho tenants de producción, comprobado. `otros` es la única que **exige**
  subcategoría (`exigeSubcategoria`, `CATEGORIA_LIBRE`): el modal no deja
  guardar sin ella, porque «Otros» sin decir cuál no informa de nada. El campo
  de subcategoría ya era de texto libre en toda categoría sin lista propia; solo
  Administrativa sugiere las suyas.
- API `GET/POST /api/clinica/incidencias` + `GET/PATCH/DELETE
  /api/clinica/incidencias/[id]` (crear/comentar/cambiar estado por cualquier
  usuario del módulo; borrar solo admin). UI `/equipo/incidencias` +
  `IncidenciaModal.jsx`. Sin auditoría a master (pueden citar datos clínicos).
  Los responsables se eligen en un **desplegable** multi-selección
  (`ResponsablesDropdown`, 26/08/2026): los chips de antes desbordaban la
  columna con los 15 de Aumenta y el control se veía cortado.
### El «Visto» de cada responsable (04/09/2026)

Rodrigo, por Aumenta: «un botón de Visto para que una terapeuta marque que ha
resuelto su parte de la incidencia, pero que no signifique que está resuelta
para todas y le deje de salir, con la posibilidad de que se la vuelva a tagear
si hay una actualización».

Una incidencia con tres responsables tiene tres respuestas posibles a «¿ya está
lo tuyo?», y `incidencias.status` solo sabe guardar una —la de todas—. Hasta hoy
eso obligaba a elegir entre cerrarla para quien aún no había hecho su parte o
dejarla sonando a quien ya la había hecho. El visto es de la PAREJA
incidencia↔persona y por eso vive en la pivote (`incidencia_assignees.visto_at`).

Tres cosas que conviene no confundir:

1. **Visto ≠ resuelta.** El estado lo sigue gobernando la verificación y es del
   centro; el visto es de cada una.
2. **«Le deje de salir» es la BANDEJA, no la incidencia.** Marcar visto la
   aparta de su Bandeja, su campana y su portada (las tres piden ahora
   `whereIncidenciasDe(..., { soloPendientes: true })`) y del listado de
   Incidencias. **No se la esconde**: el alcance de `alcanceIncidencias.js` NO
   mira esta columna, así que puede abrirla, buscarla y quitarse el visto — si
   lo hiciera invisible, una despachada por error no se podría recuperar. En el
   listado sale un interruptor «Ver las N que ya diste por vistas», y solo si
   tiene alguna.
3. **Cualquier novedad se la devuelve.** Un comentario, una edición de los
   campos que se le enseñan al equipo, reabrirla o reasignarla borran el visto
   de los DEMÁS responsables. De los demás y no de quien la provoca: si Ana
   comenta después de darla por vista, no tiene sentido devolvérsela a Ana.

El botón solo lo ve quien es responsable, que es quien tiene «su parte»; quien
únicamente la registró la ve porque la abrió ella y la cierra cerrándola.

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

### Quién la ha revisado, y borrar es para todas (05/09/2026, vuelta de AV-0039)

Olga volvió sobre el aviso ya cerrado con dos cosas. Una duda —«si borramos
alguna incidencia para que no nos aparezca porque ya la hemos leído, ¿le
desaparece también a otra compañera que sea responsable?»— y una petición: «que
para que la incidencia desaparezca, todas tengan que poner un tick o marcarla
como revisada; así podríamos saber en todo momento en qué estado se encuentra y
quién la ha revisado».

**La duda destapaba el problema de verdad**: estaban usando «eliminar» como «ya
la he leído». Y borrar quita la fila entera, para todas y sin vuelta atrás. El
«Visto» del 04/09 hacía justo lo que buscaban, pero no lo conocían: el
05/09/2026 había en producción 199 responsables asignadas a incidencias y el
visto usado UNA vez. Así que el botón de eliminar ya no lanza un
`window.confirm` de una línea —que Chrome deja silenciar, y silenciado devuelve
`false` siempre, o sea que el botón dejaría de funcionar sin decir nada— sino
un diálogo del CRM con las dos salidas escritas: «marcarla como vista (solo
para mí)» y «eliminarla para todas».

**Y la ficha dice quién la ha revisado.** El dato ya estaba guardado
(`incidencia_assignees.visto_at`), pero la pantalla solo decía si lo habías
marcado TÚ: con tres responsables, dos podían haberla despachado y la tercera
no tenía forma de saberlo. Ahora, bajo los responsables, sale «Revisada por 2
de 3 · Marta (04 sep), Ana (05 sep) · falta Lucía». El orden lo decide
`repasoDelEquipo` (`lib/clinica/vistoIncidencia.js`): **las que faltan
primero**, que es lo que se mira. Los nombres los pone la pantalla, que ya los
trae en `assignees`; el servidor solo manda ids.

**Lo que NO se ha hecho, y espera decisión**: que la incidencia se CIERRE sola
cuando la marquen todas. Chocaría con la regla del 04/09 —el estado lo gobierna
la verificación, que es la respuesta del centro; el visto es de cada persona—,
y son dos diseños defendibles. Está apartado en el Registro con las opciones.


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

## Quién dio la sesión se corrige (01/09/2026)

> «Se ha apuntado un registro a nombre de un terapeuta cuando el registro lo
> había hecho otro terapeuta y no podemos cambiarlo.» (Rodrigo)

Y no se podía desde ninguna pantalla: `RegistroSesionEditor` enseñaba el
terapeuta **principal del paciente** —no el de la sesión— y el alta firmaba con
él, así que una sesión que cubre una compañera nacía mal firmada y ahí se
quedaba. Pasa de dos maneras: cubriendo una baja, y escribiendo el registro
desde la ficha del paciente.

Ahora la cabecera del formulario (las dos: registro y preparación) lleva un
desplegable con el equipo, `FirmaDeLaSesion`. Lo elegido es lo que se guarda, al
estrenar y al corregir. La lista se pide con `status=all` **a propósito**: hay
que poder firmar a nombre de alguien que ya no está en el centro, que es
justamente el caso de las 4.045 sesiones importadas.

Por el lado del servidor, `therapistId` entra en `PATCH_FIELDS` de
`app/api/clinica/sessions/[id]` con dos frenos: tiene que ser un UUID y tiene
que existir en `team_members` **de ese schema** (un id con forma de id firmaría
la nota a nombre de una fila que no existe, o de otro tenant). Queda en el
`AuditLog` con el antes y el después —`therapistId` ya estaba en la lista blanca
de `auditSummary`—, que es lo que hace que cambiar la firma de una nota clínica
no sea un movimiento invisible.

⚠️ **Las sesiones de TALLER no se editan desde ahí** (su cuerpo se propaga al
grupo, ver «Talleres»), así que su firma tampoco: se corrige desde el taller.

## «Próximas sesiones» es la preparación de la siguiente (01/09/2026)

> «Todo lo que sea Próximas sesiones se tiene que registrar automáticamente
> como borrador para la siguiente preparación.» (Rodrigo)

Lo que se escribe en el apartado «Próximas sesiones» (`nextSessionNotes`) no iba
a ninguna parte: se guardaba el martes y el jueves la preparación abría en
blanco. Para recuperarlo había que salir del formulario, abrir la sesión
anterior en la ficha y copiarlo a mano — en Aumenta, con 22.064 sesiones, había
**once** con preparación escrita.

Al abrir un registro cuya preparación está **vacía**, `RegistroSesionEditor`
pide las sesiones del paciente y escribe en el recuadro lo que dejó apuntado la
sesión anterior, con un cartel que dice de dónde sale. La regla vive en
`proximasSesionesPendientes` (`lib/clinica/prepararSesion.js`) y la prueba
`_smoke-proximas-sesiones.mjs`:

- **La anterior, no la última**: la más reciente ESTRICTAMENTE antes de esta.
  Desde que una sesión puede nacer con fecha futura (se prepara la del jueves el
  martes), la última de la lista puede ser posterior.
- **Nunca ella misma** (`excluirId`), o una sesión ya escrita se heredaría sola.
- **Solo si está vacía**: lo escrito a mano no se pisa nunca.
- **No guarda nada ni crea nada.** Es una propuesta en pantalla hasta que
  alguien le da a guardar. Se descartó la otra forma posible —que al cerrar un
  registro el CRM diera de alta el borrador de la siguiente cita— porque
  llenaría la historia clínica de registros que nadie ha abierto.

## Registro de sesión en 3 partes (sprint Aumenta 2026-07, punto 4)

Una sesión ya no es solo el informe de lo que pasó dentro:

1. **Preparación** (opcional) — `prepText` + `prepFiles`: lo que la terapeuta
   prepara ANTES (material, hipótesis, qué observar) y los adjuntos que trae
   (fotos, notas de voz, un PDF). Desde el 02/09/2026 (AV-0027 de Aumenta) cada
   adjunto tiene además su fila en el archivo de Documentos y en la ficha del
   paciente (`source = sesion_preparacion`, etiqueta «Preparación de sesión»),
   para encontrarlo sin abrir la sesión; la familia no lo ve y solo se quita
   desde la sesión.
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

### Una cita, un registro — y se edita a posteriori (01/09/2026, Rodrigo)

Dos quejas del mismo día, con el mismo arreglo debajo.

**1. «Salgo y entro y me crea una sesión nueva.»** Se entraba al modal de la
cita, se le daba a «Preparar sesión», se escribía y se guardaba; al volver a la
misma cita salía un formulario EN BLANCO, y guardarlo dejaba otra sesión más
del mismo día en la historia clínica. La primera se quedaba con la preparación
dentro y había que ir a buscarla por la pestaña de sesiones del paciente.

La causa era que el enlace llevaba paciente y FECHA, y nada que dijera de qué
cita era la sesión. La fecha no servía para casarlas: se corrige a mano en el
propio formulario, y dos citas seguidas del mismo paciente caen el mismo día.

- **`clinic_sessions.booking_id`** (modelo `ClinicSession`, migración
  `migrate-clinica-sesion-de-cita.js`, índice `clinic_sessions_booking_idx`).
  Sin FK a `bookings`, como `taller_sesion_id`: borrar una cita del calendario
  no puede llevarse por delante la nota clínica de la sesión que sí se dio.
- La cola del enlace la monta `colaDePreparacion(scheduledAt, { bookingId })` y
  ahora lleva `cita=<id>`; el alta la manda en `payloadDePreparacion`.
- **Quién decide qué sesión se continúa: `sesionDeLaCita()`**
  (`lib/clinica/prepararSesion.js`, prueba `_smoke-sesion-de-la-cita.mjs`).
  Dos caminos: por `bookingId`, que es el bueno; y por **paciente + hora
  EXACTA**, solo para ADOPTAR las sesiones preparadas antes de que la columna
  existiera —la pantalla les pone el `bookingId` la primera vez, así que las
  que hoy se duplican se arreglan solas—. El segundo camino es estrecho a
  propósito: una sola candidata, nunca una que ya sea de otra cita, nunca una
  de taller. Ante la duda, `null`: **duplicar se ve; escribir encima de la nota
  clínica de otro día, no.**
- `PATCH /api/clinica/sessions/[id]` acepta `bookingId` **con candado**: se
  escribe una vez y no se pisa (igual que `aiTranscription`). Reapuntar una
  sesión a otra cita movería una nota clínica de sitio desde el navegador.
- El modal de la cita pregunta `GET /api/clinica/sessions?bookingId=…&limit=1`
  solo para rotular el botón («Seguir con la sesión» / «Preparar sesión»): la
  regla la aplica la pantalla de destino, así que si esa consulta falla no pasa
  nada.

**2. «Quiero poder editar a posteriori el propio registro de sesión.»** Del
cajón de la ficha solo se podían retocar la preparación, la devolución y las
notas internas: el CUERPO —los apartados del informe de la sesión— no se tocaba
desde ninguna parte una vez guardado.

- El formulario dejó de ser una página y vive en
  **`components/clinica/RegistroSesionEditor.jsx`**, montado por dos rutas
  finísimas: `/pacientes/[id]/sesiones/nueva` (estrenar) y
  **`/pacientes/[id]/sesiones/[sesionId]`** (seguir). Es el MISMO formulario a
  propósito: escribir y editar no pueden ser dos pantallas, o el día que una
  cambie la otra se queda atrás.
- Editando, todo va por PATCH sobre esa sesión: nunca se crea nada. Los
  apartados salen de la **foto** que guardó ella (`apartadosConPlantillas`), no
  de la plantilla de hoy, o cambiar la plantilla del centro borraría texto
  escrito. El `contentSections` que el reparto no toca se conserva.
- El estado **sube y no baja**: un borrador que se escribe pasa a «Registrada»,
  una cerrada sigue cerrada. «Guardar y finalizar» la cierra desde aquí mismo
  (era lo que obligaba a salir a buscarla al cajón). Una cerrada se puede
  corregir, se avisa de que lo está, y queda en auditoría como cualquier otro
  cambio.
- **Las sesiones de TALLER no se editan desde aquí**: su cuerpo lo escribe una
  vez quien da el taller y se copia a los asistentes, así que lo que se
  corrigiera se perdería en la propagación siguiente. El cajón lo dice y no
  ofrece el botón.

**3. «Marqué la falta y me sigue pidiendo que complete la sesión.»**
(02/09/2026, AV-0026 de Aumenta.) La terapeuta prepara la sesión desde la cita
—borrador con `booking_id`—, el paciente no viene, marca la falta… y seguían
el botón «Marcar completada», el enlace «Seguir con la sesión» y, en la ficha
del paciente, el borrador como una sesión de hoy por completar.

- **Al pasar la cita a falta o a cancelada**, `PATCH /api/citas/bookings/[id]`
  llama a `retirarBorradoresDeLaCita()` (`lib/clinica/borradorDeCita.js`): los
  borradores de esa cita que están EN BLANCO se borran; uno con algo escrito
  (preparación, adjuntos, cualquier apartado, la devolución, notas internas,
  lo de la IA) se conserva. Lo decide `borradorVacio()`, fijado en
  `_smoke-borrador-de-cita.mjs`; lo borrado queda en la auditoría de la cita
  (`borradorRetirado`). No hay estado «no dada» a propósito: sería un cuarto
  estado que tendrían que aprender estadísticas, informes y PDF para decir
  algo que la cita ya sabe.
- **El que se conserva no se disfraza de sesión**: `GET /api/clinica/sessions`
  añade `bookingStatus` a cada registro que sale de una cita
  (`estadoDeLasCitas()`, una consulta para toda la lista) y la ficha del
  paciente rotula el borrador «Preparada · el paciente no vino» (o «Preparada ·
  cita cancelada») en vez de «Borrador» (`rotuloDeBorrador()`).
- **El modal de la cita** esconde «Marcar completada» tras una falta, y
  «Preparar sesión / Seguir con la sesión» en una falta o una cancelada
  (`citaNoSeDio()`). Una falta marcada por error se corrige desde la ficha del
  paciente («Cambiar» en sus citas), no desde el modal.

### Borrar un informe en borrador, buscar incidencias y quién coordina (02/09/2026, Aumenta)

Tres peticiones del Buzón del 02/09, con la decisión de Rodrigo el mismo día.

- **Borrar un informe abierto por error (AV-0021).** `DELETE /api/clinica/reports/[id]`,
  solo sobre un BORRADOR y solo para quien lo firma (su terapeuta) o dirección;
  un informe revisado o entregado no se borra nunca, ni dirección. La regla es
  `puedeBorrarInforme()` (`lib/clinica/alcanceInformes.js`, prueba
  `_smoke-borrar-informe.mjs`); el botón «Borrar» del cajón solo se pinta en un
  borrador y pide confirmación; el borrado queda en la auditoría
  (`clinica.report.deleted`).
- **Buscar incidencias por texto (AV-0011).** `GET /api/clinica/incidencias?q=`:
  todas las palabras, cada una en asunto o descripción, o en el nombre del
  paciente (por su tabla), con la misma regla sin tildes de Clientes y
  facturas (`lib/utils/busquedaDb.js`). La pantalla manda la caja con 300 ms
  de calma.
- **Quién coordina (AV-0022).** `settings.clinica.coordinadoras` (Configuración
  → Módulos, tarjeta «Coordinadoras del equipo»; `lib/clinica/coordinadoras.js`,
  prueba `_smoke-coordinadoras.mjs`). En Inicio, «Informes vencidos» cuenta
  solo los de quien mira salvo para dirección y coordinadoras, que ven el
  centro entero; y en `GET /api/clinica/bandeja`, `canSwitch` es verdad
  también para ellas, así que eligen la bandeja de cualquier terapeuta.

### La entrevista inicial: un tipo de cita y su registro de 15 apartados (02/09/2026, Aumenta)

AV-0017 pedía subir el documento de la entrevista inicial y que la IA redactara
el informe. Rodrigo lo reencuadró: la entrevista inicial es un TIPO DE CITA
(el que lleva la marca «valoración inicial», `EventType.isInitialAssessment`)
y su registro de sesión tiene los 15 apartados de la entrevista del centro,
que se rellenan desde el bloc de notas o el audio con IA como cualquier
registro.

- **La plantilla**: `PLANTILLA_ENTREVISTA` (`lib/clinica/plantillas.js`), clave
  `entrevista_inicial`, 15 apartados con su **pista** (los subpuntos de la
  entrevista). Se ofrece en todos los centros con clínica detrás de las suyas
  (`plantillasDe`), y un centro puede guardar la suya con la misma clave desde
  Configuración → Plantillas. La pista es un campo nuevo del apartado que
  `normalizarApartados` conserva (hasta 400 caracteres), el formulario enseña
  bajo el título (`ApartadosEditor`) y `bloquesDelRegistro` lleva al prompt de
  la IA (`lineaDeBloque` ya la sabía leer).
- **De la cita al registro**: el modal de una cita cuyo tipo es valoración
  inicial monta «Preparar sesión» con `plantilla=entrevista_inicial`
  (`colaDePreparacion`); el editor abre con esa plantilla y el borrador nace
  con su foto (`payloadDePreparacion` manda `contentSections`), así que al
  volver, completar con IA o imprimir el PDF salen los 15 apartados.
- Fijado en `scripts/_smoke-plantilla-entrevista.mjs`.
- **Y ya no es un tipo de informe (03/09/2026).** Rodrigo: «los informes con
  IA de Entrevista Inicial los has clasificado como informes, pero tienen que
  tener la estructura de lo de AUDIO y BLOC DE NOTAS CON IA de los registros
  de sesión». El tipo `admission` («Entrevista inicial») seguía ofreciéndose
  en «Nuevo informe» —en `/clinica/informes` y en la ficha del paciente—, y
  era el camino equivocado. `REPORT_TYPES_NUEVOS` (`serialize.js`) son los
  tipos que se pueden crear, sin `admission`; los dos formularios lo usan y
  dicen dónde se escribe la entrevista (la ficha enlaza directamente a
  `/pacientes/[id]/sesiones/nueva?plantilla=entrevista_inicial`); el `POST`
  de informes la rechaza con el motivo (422) en vez de convertirla a evolutivo
  en silencio. `admission` sigue en `REPORT_TYPES`, en el enum y en el PDF
  (`TITULO_DE_PORTADA`) por los informes que ya existen con ese tipo (en
  producción, uno en borrador en Aumenta y los de las demos): se leen, se
  editan y se imprimen igual.
- Su PDF lleva portada, con «Entrevista inicial» de título (ver «El registro,
  con portada como el informe»).
- **Pero se GUARDA con los informes (04/09/2026, AV-0042 de Aumenta).** Laura:
  «al generar las entrevistas iniciales se guardan en la ficha del paciente
  como sesiones en lugar de como informe». Cómo se escribe no cambia —sigue
  siendo un registro de sesión, con sus 15 apartados y su IA—; lo que cambia es
  dónde aparece: en la ficha del paciente la entrevista sale en la pestaña
  **Informes**, encima de los informes, y ya no en **Sesiones**. Entre las
  sesiones semanales no se encontraba (el paciente que más tiene en Aumenta
  suma 241), y es justo el documento al que se vuelve.
  - La regla vive en `lib/clinica/entrevistaInicial.js`: `esEntrevistaInicial`
    (lo dice la plantilla con la que se escribió, `contentSections.plantilla`)
    y `repartirRegistros` (parte la lista de la ficha en `sesiones` y
    `entrevistas`). Lo usan la ficha **y** `tituloDeRegistro` del PDF: la misma
    pregunta con una sola respuesta, o la pestaña diría una cosa y la portada
    otra.
  - La ficha las pide **aparte**: `GET /api/clinica/sessions?patientId=…&
    plantilla=entrevista_inicial`. El listado de sesiones trae las 100 últimas
    y la entrevista es el registro más antiguo del paciente: 50 de los 587
    pacientes con historia en Aumenta pasan de 100 sesiones, así que sin la
    segunda petición desaparecería de la ficha justo cuando hay que buscarla.
    `repartirRegistros` deduplica lo que llega por las dos.
  - La fila abre el MISMO cajón que desde Sesiones (que ahora se titula
    «Entrevista inicial») y su botón PDF es el del registro,
    `/api/clinica/sessions/[id]/pdf`.
  - Por dentro no cambia nada: sigue siendo una `clinic_sessions`, cuenta en
    las estadísticas y en el recuento de sesiones del paciente, y se puede
    elegir como sesión base de un informe evolutivo.
  - Lo fija `scripts/_smoke-entrevista-en-informes.mjs`. **Fuera de la ficha**
    no se ha tocado nada: `/clinica/informes` (el listado del centro) sigue
    siendo solo de `clinical_reports`, con sus estados y sus vencimientos.
- **Y se ESTRENA desde la ficha (04/09/2026, Rodrigo).** «Para las entrevistas
  iniciales también querríamos poder hacerlas desde la ficha de paciente, un
  botón debajo de los de Nuevo registro y Nuevo informe.» Hasta hoy había dos
  caminos y los dos hay que sabérselos: la cita de valoración inicial —que
  elige la plantilla sola— o entrar por «Nuevo registro» y cambiar la plantilla
  a mano. Ahora la cabecera del paciente tiene su botón, **«Nueva entrevista
  inicial»**, tercero debajo de «Nuevo registro» y «Nuevo informe».
  - No es una pantalla nueva: abre el registro de sesión de siempre con la
    plantilla puesta desde la URL
    (`/pacientes/[id]/sesiones/nueva?plantilla=entrevista_inicial`, la misma
    que ya usaba el enlace de la cita). Mismo formulario, misma IA del audio o
    del bloc de notas, y se archiva donde acaba de decir el punto de arriba.
  - Solo sale si el centro OFRECE esa plantilla: la ficha se lo pregunta a
    `GET /api/clinica/plantillas` y, si la borró desde Configuración
    (`plantillasOcultas`), no se pinta — el enlace abriría un registro con OTRA
    plantilla y el botón estaría mintiendo. Arranca visible porque la de
    fábrica se ofrece en todos los centros con clínica, así que en la ficha
    normal no aparece medio segundo tarde.
  - Lo fija `scripts/_smoke-entrevista-en-informes.mjs`, con el resto de la
    entrevista: es la misma clave la que decide con qué plantilla se abre, en
    qué pestaña se archiva y cómo se titula el PDF.

### La pestaña «Faltas» de Incidencias (03/09/2026, AV-0038 de Aumenta)

Al marcar una falta en la agenda se abre sola una incidencia
(`lib/citas/incidenciaPorFalta.js`). Desde hoy nace con `incidencias.falta`
(JSONB, `lib/clinica/faltas.js`: `{ justificada, bookingId, huecosOfrecidos,
respuesta, fechaRecuperacion, nota }`) y eso la manda a la pestaña **Faltas**
de Equipo → Incidencias, aparte de las de siempre: el GET con `?faltas=1`
devuelve solo faltas y sin el parámetro las excluye; `counts.faltas` cuenta
las que siguen sin cerrar. En la ficha, administración apunta los huecos
ofrecidos a la familia, la respuesta (`pendiente` / `aceptada` con fecha de
recuperación / `rechazada`) y una nota; **aceptar o rechazar cierra la
incidencia** (resolved + resuelta) y volver a «sin respuesta» la reabre. El
PATCH acepta `falta` y lo funde con `fundirFalta`; `justificada` y `bookingId`
no se editan desde la pantalla. La tarjeta de Configuración → Agenda lo dice
con esas palabras. Migración `migrate-incidencias-faltas` (CORE, por
existencia de tabla, fotos doradas incluidas; reconoce las automáticas de
antes por su título). Prueba `scripts/_smoke-faltas.mjs`.

### Dictar las ideas clave del Plan (03/09/2026, vuelta de AV-0019)

En Ficha del paciente → Plan → «Redactar objetivos con IA», los botones
**«● Dictar»** (micrófono, `useGrabadora`) y **«Añadir audio»** mandan el audio
a `POST /api/pacientes/[id]/plan/transcribir` ⚡ **Whisper** (clave del tenant,
`vetoAi`, la demo simulada), que devuelve solo el texto: cae en la caja de
ideas clave y proponer los objetivos sigue siendo el botón de siempre. No
guarda nada.

### Y se ve sin abrir el panel de la IA (05/09/2026, AV-0050 de Aumenta)

Silvia Pérez: «aún no nos sale la opción de poder grabar audio en el apartado
de plan». Salía, pero DENTRO del panel: con «Redactar objetivos con IA»
plegado —que es como se abre la pestaña Plan— lo único visible era un enlace
de texto, y ahí nadie busca un micrófono. Ahora la rama plegada de
`ObjetivosConIa` pinta también un **«● Dictar»** que hace las dos cosas en el
mismo clic: abre el panel y arranca la grabadora. Sigue saliendo solo donde el
navegador sabe grabar. Lo fija `scripts/_smoke-dictar-el-plan.mjs`, con regex
sobre el JSX: si alguien vuelve a meter el micrófono dentro del panel, la
prueba lo dice.

### Grabar desde el propio CRM (03/09/2026, AV-0037 de Aumenta)

«Añadir audio» abre un `<input type="file" accept="audio/*">`. Android ofrece la
grabadora en ese selector; Safari en iPhone y iPad no la ofrece nunca (solo
Archivos y Fotos), así que allí había que grabar en Notas de voz, guardar y
volver. Ahora, al lado de «Añadir audio», hay un botón **«● Grabar»** —solo
donde el navegador sabe grabar— que usa `MediaRecorder`
(`components/clinica/useGrabadora.js`): pide el micrófono, graba a 64 kb/s en
el formato que el navegador sepa (`audio/mp4` en Safari, `audio/webm` en
Chrome), enseña el tiempo y con «■ Parar» deja el audio puesto como si se
hubiera elegido un archivo (`ponerAudio`), así que transcribir, la IA y
guardar no cambian. Se corta a los 50 minutos para no pasar del tope de
25 MB del transcriptor. Está en el registro de sesión
(`RegistroSesionEditor`) y en el de taller (`SesionTallerDrawer`). Sin
permiso de micrófono o sin micrófono, avisa y deja «Añadir audio» como
siempre.

### Arrastrar y soltar ficheros (28/08/2026, Lau de Aumenta)

El audio de la sesión le llega por WhatsApp: lo descarga y le queda a la vista
en la barra de descargas del navegador. Pero «Añadir audio» abría el explorador
de Windows y la obligaba a ir a **buscar en Descargas el fichero que ya tenía
delante**. Pidió poder arrastrarlo, y de paso lo mismo en los documentos de la
ficha.

Tres zonas admiten ahora soltar (y siguen admitiendo el clic de siempre):
el **audio** y los **adjuntos de preparación** de `/pacientes/[id]/sesiones/nueva`,
y **Documentos del paciente** (`PatientDocumentsSection`), donde soltar abre el
mismo modal del nombre que el botón. En el audio, además, **Ctrl+V**.

- La pieza es `components/ui/useZonaSoltar.js`, un gancho que se esparce sobre
  el elemento que ya existe (`{...zona.props}`) en vez de envolverlo: estas
  zonas son tarjetas con contenido, no recuadros vacíos como el
  `UploadDropzone` de Documentos.
- **Qué se acepta lo decide `lib/utils/ficherosSoltados.js`**, con prueba
  (`_smoke-ficheros-soltados.mjs`): al pinchar en un input el navegador ya
  filtra por su `accept`, pero **al soltar no filtra nadie**, y sin esto un PDF
  soltado en la zona del audio se guardaría como si fuera la grabación. Se mira
  el nombre además del tipo porque una nota de voz `.ogg` a veces llega con el
  `type` vacío.
- Lo rechazado se **dice** («informe.pdf: aquí solo se puede soltar un audio de
  la sesión»), nunca se traga en silencio; y si en la misma tanda hay cosas
  buenas y malas, se quedan las buenas Y se avisa de las otras.
- `useEvitarSoltarFuera()` impide que fallar la puntería al soltar haga que el
  navegador se vaya a abrir el fichero — en un registro a medio escribir eso
  era perder lo escrito.
- La tarjeta del **contrato estándar NO** es zona de soltar a propósito: es el
  contrato de toda la clínica y un fallo de puntería lo reemplazaría para todos.

### Notas internas (29/08/2026, Aumenta por Rodrigo)

Una cuarta caja en el registro, `internalNotes` (columna `internal_notes`,
`migrate-clinica-notas-internas.js`): lo que el equipo anota **para sí mismo** —
falta de implicación de la familia, cómo están los padres, actitudes—. Se
escribe en «Nuevo registro» (bloque «4 · Notas internas del equipo») y se edita
después en el cajón de la ficha, junto a preparación y devolución, por el mismo
`PATCH /api/clinica/sessions/[id]`.

**No sale del CRM**, y lo sostienen tres cosas, no la buena voluntad:

- Es **columna propia**, no una clave más de `observations` ni de
  `contentSections`. Esos dos viajan enteros al anexo del informe y al PDF del
  registro; una clave nueva ahí acabaría en manos de la familia el día que
  alguien recorra el objeto en vez de sus campos conocidos.
- `sesionesDelInforme.js` pide sus columnas **por nombre** y esta no está en la
  lista; el anexo literal (`anexoRegistros`) imprime una lista fija de
  apartados. Lo fija `_smoke-informe-beca.mjs`, que mete la nota en la sesión a
  propósito y comprueba que no aparece en el PDF, y `_smoke-plantillas-clinica.mjs`
  por el lado del PDF del registro.
- El volcado (`redactarDesdeSesiones`) no la lee, y el portal de la familia no
  tiene ningún endpoint que sirva sesiones. Lo fija
  `_smoke-clinica-notas-internas.mjs`.

Sin backfill: no hay forma de adivinar qué parte de una observación vieja era
interna. Las sesiones que ya existen nacen con la columna vacía.

**Adjuntos de preparación**: `POST /api/clinica/sessions/[id]/prep-files`
(multipart) y `GET/DELETE …/prep-files/[fileId]`. Máximo 10 por sesión, 25 MB
cada uno, solo fotos / audio / PDF (`lib/clinica/prepFiles.js`).

> **No son documentos del archivo**: NO se crea fila en `documents` a propósito.
> Es material de trabajo interno; si fuese un Document aparecería en el buscador
> del CRM y podría acabar colándose en el área privada de la familia. Solo se
> reutilizan las primitivas de disco de `documentStorage` para no montar un
> cuarto almacén. La metadata vive en `clinic_sessions.prep_files` (JSONB) y el
> serializador NO expone `storagePath`.

### «Marcar como cerrada» (29/08/2026)

El botón del cajón de la sesión se llamaba «Marcar como publicada» y el badge
violeta, «Publicada». No publica nada: pone `status='published'` y ahí se acaba.
El portal de la familia **no tiene ningún endpoint que sirva sesiones** —lo único
que la familia ve son documentos—, así que ese estado no sale del equipo. Sus dos
únicos consumidores son el propio badge (`SESSION_STATUS_LABEL`) y el filtro de
sesiones «completadas» del volcado de informes, que acepta `registered` **o**
`published`: o sea que el botón tampoco decide si una sesión entra en un informe.

Es la misma enfermedad que el viejo «Marcar como entregado» (ver «Enviar al
paciente»), un escalón más abajo: un cambio de estado con nombre de acción. El
29/08/2026 Aumenta preguntó «cómo se hace para subir al portal del paciente», y
una terapeuta podía pulsarlo creyendo que compartía la sesión con la familia.

Se renombra **solo la pantalla**: botón «Marcar como cerrada» y rótulo «Cerrada»
(`SESSION_STATUS_LABEL` en `lib/clinica/serialize.js`, que alimenta el badge de
la ficha y el selector de sesiones del volcado). El valor en BD sigue siendo
`published` y el enum del modelo no se toca — son 22.045 sesiones en Aumenta y
ninguna razón para migrarlas por un texto. El botón lleva además un `title` que
dice a dónde ir de verdad: crear un informe y usar «Enviar al paciente».

## Plantillas de informes y registros (29/08/2026, Aumenta por Rodrigo)

Un documento clínico es una lista de apartados: un título y su cuerpo, repetido.
Hasta esta fecha esa lista estaba **escrita en el código** —siete para el
informe (`apartadosInforme.js`), siete para el registro (los campos del
formulario) y tres a mano para la beca en su propio fichero—, iguales para todos
los centros; cada tipo nuevo que pidieran era un fichero más y un despliegue.
Rodrigo, 28/08/2026: «q un informe sean un montón de título-cuerpo seguidos y eso
se transfiera al pdf. Estaría bien que pudieran crear plantillas de informes
ellas con los títulos que quieran». Al día siguiente, lo mismo para los registros
de sesión, que además tenían que poder salir en PDF.

**Las tres piezas** (`lib/clinica/plantillas.js`):

| | Qué es | Dónde vive | Quién la toca |
| --- | --- | --- | --- |
| **Apartado** | `{ key, label, tipo }`; `tipo` es `texto` (párrafo) o `lista` (viñetas) | — | — |
| **Plantilla** | `{ key, name, apartados[] }` | `settings.clinica.plantillas.{informe,registro}` (JSONB en master, sin tabla nueva) | **Admin**, en Configuración → Módulos (`PlantillasClinicaCard`), por `PUT /api/clinica/plantillas` |
| **Foto** | La lista con la que se escribió ESE documento | `content_sections.apartados` del propio informe o sesión | Quien redacta, desde el documento («Ordenar apartados») |

La **clave** de un apartado no se renombra nunca: los documentos guardados
apuntan a ella, igual que con las especialidades de derivación. Cambiar el
título cambia el rótulo, no dónde está escrito el texto (`normalizarApartados`
conserva la clave que llega y, si no llega, la recupera por el título anterior).

**Por qué una sola foto resuelve las dos cosas que se pidieron.** Un apartado
suelto —el que se añade para un caso concreto— es simplemente un apartado que
está en la foto y en ninguna plantilla: se aplica en ese documento y no se
guarda en ningún otro sitio. Y como cada documento lleva la suya, un informe de
hace un año se sigue imprimiendo con SUS títulos aunque el centro haya cambiado
la plantilla entera después. La resolución es, en orden: **foto → plantilla que
dice usar → primera plantilla del centro → la de fábrica** (`apartadosPara`;
`apartadosConPlantillas` es la misma decisión en el navegador, que no tiene el
tenant).

**Compatibilidad, que es lo que hace esto desplegable sobre Aumenta.** El día
del despliegue nadie tiene plantillas guardadas y ningún documento tiene foto:
todo cae a los siete de fábrica, que son exactamente los de antes y con las
mismas claves. Las 22.045 sesiones y los informes que existen se leen, se
imprimen y se vuelcan igual. Lo fija `_smoke-plantillas-clinica.mjs`.

**Dónde vive de verdad el cuerpo de un apartado de sesión.** Los de fábrica
siguen en las columnas de siempre (`objectives`, `activities`, `performance` y
las cuatro claves de `observations`), porque de ellas comen el volcado a
informes, las estadísticas y el anexo; solo los apartados NUEVOS van a
`content_sections`. El reparto en las dos direcciones lo hacen
`valoresDeSesion` y `repartirValoresDeSesion`, y por eso la migración no
necesita backfill. Fuera de la plantilla quedan a propósito la preparación
(parte 1) y la devolución de la familia (parte 3): no son apartados del informe
de la sesión, son el envoltorio del registro.

**El informe de beca no pasa por aquí.** Sus tres apartados los manda la
convocatoria, no el centro (`lib/clinica/beca.js`): su cajón no deja elegir
plantilla ni añadir nada, y `apartadosDelInforme` lo trata aparte.

**Quién puede crear plantillas.** El Registro dejaba la pregunta abierta y la
respuesta es **dirección**: los títulos de un informe clínico salen firmados por
una colegiada, así que la plantilla del centro es del centro y el `PUT` exige
`admin` (más el guard de demo, que escribe en master). Quien redacta no se queda
sin salida: puede añadir apartados a SU documento desde el propio informe o
registro, sin pasar por Configuración y sin guardarlos en ninguna plantilla.

## PDF del registro de sesión (29/08/2026)

`GET /api/clinica/sessions/[id]/pdf` (`lib/clinica/sessionPdf.js`), gemelo del
`reports/[id]/pdf` del 26/08 y por el mismo motivo: con 22.045 sesiones
escritas, no poder sacar una en papel era una carencia rara. Se abre desde «Ver
PDF» en el cajón de la sesión, sale `inline` (con `?descargar=1`, como fichero),
**no escribe nada** —ni fila, ni estado, ni documento en el portal— y por eso no
lleva guard de demo.

Imprime los apartados del registro y la devolución de la familia. **No imprime**
la preparación, sus adjuntos, las notas internas ni la transcripción del audio:
son material interno del equipo y un PDF es justo la forma de que salga del CRM.

Generador propio y no un `if` dentro de `reportPdf.js`, porque lo que es DEL
REGISTRO —cómo se nombra, la fecha y hora de una sola sesión, sin índice— no
es lo que es del informe. Hasta el 03/09/2026 era además una hoja de trabajo
sin portada; ya no (siguiente apartado).

### El registro, con portada como el informe (03/09/2026, Rodrigo)

«Quiero que los registros de sesión de todo tipo —el de talleres, este
especial de Entrevista inicial y los normales— tengan la portada tipo los
informes grandes pero solo de una sesión, y el diseño de dentro también.»

El registro se compone ahora con las MISMAS piezas que el informe, que se
sacaron de `reportPdf.js` a `lib/clinica/documentoPdf.js`: portada a sangre
(logo o nombre del centro, título, servicio, pastilla, paciente con su edad,
profesional responsable), apartados numerados con el número grande al margen,
bloque de firma con hueco para firmar, hoja de protección de datos e isotipo
al cierre, pie con los datos del centro y número de página. Una sola copia del
dibujo: el día que se mueva el logo dos milímetros se mueve en los dos.

Lo que es distinto porque es de UNA sesión:

| | Informe | Registro de sesión |
| --- | --- | --- |
| Título de la portada | «Informe de evolución», «… de alta»… (`TITULO_DE_PORTADA`) | Por lo que es (`tituloDeRegistro`): **«Entrevista inicial»** si se escribió con esa plantilla (`contentSections.plantilla === "entrevista_inicial"`), **«Sesión de taller»** con «Taller · nombre» debajo si tiene `tallerSesionId`, **«Registro de sesión»** el resto. El nombre del fichero va igual. |
| Pastilla | El periodo de las sesiones base | El día y la hora de la sesión |
| Edad del paciente | La de la fecha del informe | La del día de la sesión |
| Índice | Con 3 apartados o más | **Nunca**: son dos o tres hojas, y con los 15 de la entrevista sigue leyéndose del tirón |
| Bajo el titular del cuerpo | «Basado en N sesiones · fechas» | «Sesión del día · hora · 45 minutos · Profesional: X» |
| Último apartado | El último de la plantilla | La devolución de la familia, numerada como uno más |

**Los títulos numerados de la plantilla pierden su número al imprimir**
(`sinNumeroDelante`, en `apartadosInforme.js`, para el informe y el registro).
La entrevista trae «1. Datos de identificación» … «15. Documentación
aportada» porque así la escribió el centro; el documento numera él solo lo
que imprime, y si el 1 está vacío saldría «1 · 2. Motivo de consulta». La
clave, la pantalla y lo guardado no cambian.

Los argumentos del generador los arma `argumentosDelPdfDeSesion`
(`argumentosDelPdf.js`) para las dos rutas —«Ver PDF» y «Enviar al paciente»—,
igual que en el informe: fecha de nacimiento y especialidades del paciente,
acreditación de quien firma (`ATRIBUTOS_TERAPEUTA`) y el nombre del taller si
sale de uno. Lo que NO sale no ha cambiado: preparación, adjuntos, notas
internas y transcripción siguen fuera, y `_smoke-registro-pdf.mjs` lo fija en
los tres tipos.

## La pantalla del informe, y el informe dictado (04/09/2026, Rodrigo)

> «A la hora de crear un informe no se abre una pantalla tipo la de Registrar
> una sesión. Se crea y me lleva directamente a una vista lateral tipo la de
> revisión final, donde por cierto no pone un botón de Editar informe. Debería
> ser la pantalla inicial de creación de un informe tras elegir fecha, paciente
> y tipo, como la del Registro: con su IA, sus notas y sus campos.»

El informe tenía cajón, no pantalla. Crear uno abría `InformeDrawer` —el mismo
por el que se pasa a repasar uno ya escrito— y ahí dentro, en 720 px, había que
redactar el documento entero. El registro de sesión llevaba con su pantalla
completa desde el 01/09; el informe se había quedado atrás.

- **`components/clinica/InformeEditor.jsx`** es ahora LA pantalla del informe,
  gemela de `RegistroSesionEditor`: la monta `/clinica/informes/[id]`, y se
  llega a ella al **crear** (desde `/clinica/informes` y desde la ficha del
  paciente, que ya no se quedan en el listado) y desde el botón **«Editar
  informe»** del cajón.
- La fecha del informe se **elige al crearlo** (antes era siempre hoy y no se
  preguntaba) y se corrige en la cabecera, junto al tipo y la entrega.
- **`components/clinica/MaterialIA.jsx`**: la tarjeta del material —audios,
  grabadora, zona de soltar, bloc de notas y el botón de la IA— sale del
  registro de sesión a un componente compartido. Es marcado, no lógica: el
  estado sigue en cada pantalla, así que el registro hace exactamente lo que
  hacía.
- **El informe se puede DICTAR**: `POST /api/clinica/reports/[id]/desde-material`
  (multipart `transcripcion` / `texto` / `apartados` / `escrito`) reparte lo
  dictado o pegado por los apartados de ESE informe.
  `lib/clinica/informeMaterial.js` monta el prompt sobre las piezas del
  registro (`registroCompleto.js` + `estiloClinico.js`) y añade lo propio del
  informe: que **lo lee la familia**, que no lleva fechas de sesión delante de
  cada frase y que se lee de corrido. `lib/clinica/structureInforme.js` llama al
  modelo. **No guarda nada**: la propuesta se elige apartado por apartado en
  `PropuestaIA`, el mismo panel que usa el registro — y ahí cae también la
  redacción de `/pulir`, que ya no tiene su propio panel dentro del cajón.
  Aquí NO se transcribe: los audios pasan antes por
  `/api/clinica/audio/transcribir`, así que no hace falta clave de OpenAI para
  dictar un informe a partir de notas.
- Las dos ayudas de siempre siguen intactas: volcar las sesiones elegidas
  (`desde-sesiones`) y pulir ese volcado (`pulir`).
- El cajón (`InformeDrawer`) se queda como la **revisión**: se abre desde el
  listado, y su botón «Editar informe» trae a la pantalla.

### La IA puede proponer apartados que no existen (04/09/2026)

> «Que la transcripción de Claude observe los campos existentes y añada nuevos
> automáticamente si así lo decide.»

El prompt decía «una clave por apartado y ninguna más». Es lo que hace que la
propuesta caiga donde debe, pero tenía un coste mudo: lo que la profesional
contaba y no cabía en ningún apartado de su plantilla **se tiraba**, sin
escribirse en ningún sitio y sin avisar. Con plantillas que decide cada centro,
eso pasa a menudo.

- `lib/clinica/apartadosPropuestos.js` añade al prompt la clave `nuevos`:
  hasta `MAX_NUEVOS` (4) apartados con título, tipo y contenido, y con la orden
  expresa de no proponer ninguno si el contenido encaja en uno que ya existe.
  Lo llevan el **registro de sesión**, la **entrevista inicial** (que es un
  registro con su plantilla) y el **informe**. El registro de TALLER no: su
  reparto solo escribe en claves que existen, y una nota individual inventada
  iría a la familia equivocada.
- **Nada entra solo**, como el resto de la IA de la casa: `PropuestaIA` los
  enseña en su propia sección, marcados como nuevos, con el título **editable**
  antes de aceptarlo —es el que se imprime— y con «Añadir apartado» / «No
  añadirlo». Al aceptarlos se añaden al final de ESE documento; la plantilla del
  centro no se toca.
- Los dos cerrojos: una clave nueva **jamás** pisa la de un apartado que ya
  existe (le borraría el texto al guardar) y un apartado propuesto sin contenido
  no entra. Además se respeta `MAX_APARTADOS`: lo que no cabe se dice en el
  aviso en vez de perderse. Lo fija `scripts/_smoke-apartados-propuestos.mjs`.

### Añadir campos y renombrarlos, en los tres documentos

`ApartadosEditor` («Ordenar apartados») está en el **registro de sesión**, en la
**entrevista inicial** y —ahora que el informe tiene pantalla— en el **informe**:
renombrar, cambiar párrafo↔lista, subir, bajar, quitar y añadir. Vale solo para
ESE documento (se guarda en la foto `contentSections.apartados`, ver «Plantillas
de informes y registros»); guardar la plantilla del centro sigue siendo cosa de
Configuración. La única excepción es el informe de **beca**, cuyos tres
apartados los manda la convocatoria.

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
    `published`; en pantalla, «Registrada» o «Cerrada»). Cruzar pacientes sería un
    incidente de datos de salud.
  - Un informe ya **entregado** no se puede volcar: la familia tiene un PDF que
    dejaría de coincidir con el CRM.
  - Devuelve `aporte` (cuántas líneas ha traído cada apartado) para que la
    pantalla pueda decirlo: si no, parece que el botón no ha hecho nada.
- La IA **parte de esto**, no lo sustituye: primero se junta lo que dicen las
  sesiones, luego se pule. Ver el apartado siguiente.
- **El PDF cuenta las fechas, no el contenido de las sesiones** (26/08/2026,
  Rodrigo: «el informe es el resumen que redacta la terapeuta; de las sesiones
  solo debe salir la fecha»). La portada del PDF imprime «Periodo» (de la
  primera a la última sesión base) y «Basado en» (N sesiones con sus fechas),
  cargadas por `lib/clinica/sesionesDelInforme.js` con candado de paciente. El
  cuerpo es lo que la profesional dejó escrito (a mano o aceptando la IA). Y
  hay una casilla en el cajón, apagada por defecto, para **anexar los registros
  literales** en páginas aparte al final — sin la preparación, que es material
  interno. La beca no lleva ni periodo ni anexo. Lo fija
  `scripts/_smoke-informe-beca.mjs`.

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

### De parafrasear a redactar (04/09/2026, Rodrigo)

«La IA de los informes es muy básica, simple y poco técnica: solo reescribe un
poco lo que le envían. Tiene que completar más, diagnosticar y escribir más
párrafos.» Y era así porque así estaba pedido: el prompt decía «tu trabajo es
REDACTARLAS, **no ampliarlas**» y el del registro, «tienes que **repartir** esa
información». Lo mejor que podía salir era el mismo volcado con las comas
puestas.

**`lib/clinica/estiloClinico.js`** (fichero nuevo) parte en dos lo que era una
sola regla —«no inventes»— porque bajo ella escribir *«lo que sugiere una
dificultad de inhibición»* era tan sospechoso como escribir *«tiene 8 años»* sin
saberlo:

- **Los DATOS** siguen saliendo solo del material: cifras, fechas, pruebas,
  diagnósticos ya emitidos, quién dijo qué. `verificarSinInventar` sigue
  comprobándolo y rechazando el borrador.
- **La ELABORACIÓN clínica** pasa a pedirse: nombrar los procesos implicados con
  la terminología del área, explicar qué trabaja cada actividad, relacionar lo
  observado con lo que cuenta la familia, decir qué sugiere y qué convendría
  valorar — con las marcas de siempre («se observa…», «sugiere…», «se plantea
  como hipótesis…») y con extensión de informe, no de telegrama.

Del «diagnosticar» se da lo que se puede dar: perfil funcional, hipótesis
marcadas y qué valoración conviene. **La etiqueta diagnóstica está prohibida en
el prompt, con las palabras y con ejemplos** (TDAH, TEA, dislexia…): la emite una
colegiada tras evaluar, y es el único fallo de este módulo que no tendría arreglo
una vez que el informe sale del centro.

Lo comparten los CUATRO documentos, porque `REGLAS` de `registroCompleto.js` la
leen también el registro de sesión, la entrevista inicial, el taller
(`tallerCompleto.js`) y el informe desde material (`informeMaterial.js`).

**Los apartados de síntesis.** `esApartadoDeSintesis` marca en el prompt
(`[SÍNTESIS]`) los que se elaboran a partir del conjunto y no de una frase
dictada — por clave para los de fábrica (impresión clínica, propuesta de
actuación, próximas sesiones, logros, recomendaciones, continuidad) y por título
para los que se monte el centro. Son justo los que **salían vacíos siempre**: en
la entrevista inicial, cinco de quince; en el informe, los logros, que
`redactarDesdeSesiones` no rellena nunca porque una sesión suelta no dice «esto
es un logro». En el informe solo se proponen si están **vacíos**: lo que ella
haya escrito no se le manda al modelo ni se toca, y el motivo de intervención no
viaja en ningún caso.

**El paciente, sin nombre.** Al prompt van su edad, sus áreas y su nivel
educativo (`lineaDePaciente`, la lista cerrada de `objetivosIa.js`), nunca su
nombre. Sin la edad, el mismo párrafo vale para un niño de 5 años y para uno de
15, y era una de las razones por las que lo que salía sonaba genérico.

**El fallo que apareció al probarlo contra la IA de Aumenta** (04/09/2026, con
un caso inventado y sin tocar su base de datos): en cuanto la IA redacta de
verdad, **cita** — «verbaliza autodescalificaciones ("es tonto")» —, y esas
comillas rectas rompen el JSON entero. Los 18 apartados de la entrevista
llegaban VACÍOS después de 40 segundos de espera; pasó en **3 de cada 4**
pruebas, así que no era un caso raro sino el normal. `escaparComillasDeDentro`
(en `registroCompleto.js`, dentro de `leerRespuesta`) repara esas respuestas
—una comilla cierra la cadena solo si detrás viene `:`, `}`, `]`, una coma
seguida de comilla o el final; lo demás es texto— y recuperó 15 de los 18
apartados de las respuestas que se perdían enteras. Al prompt se le pide además
usar comillas españolas, pero **pedir no basta**, la misma lección que
`verificarSinInventar`. Es un candidato serio a ser la causa del «a veces falla
que lo mande al registro» del 01/09.

**Y tres cosas de fontanería** que se llevaban por delante informes enteros:
`pulir` pasa de 4.000 a 12.000 tokens y por streaming (un informe redactado no
cabía en 4.000 y el JSON llegaba partido), reutiliza el parseo defensivo de
`leerRespuesta` en vez de un `JSON.parse` pelado, y da UN reintento diciendo qué
cifra sobra antes de descartar el borrador. Además, `meses()` buscaba el mes por
`includes`: **«mayor» lleva dentro «mayo»**, así que cualquier redacción con «con
mayor autonomía» se descartaba por una fecha inventada que no existía.

Se fija en `scripts/_smoke-estilo-clinico.mjs` (13 casos: que la prohibición de
diagnosticar sigue ahí, qué apartados son de síntesis y cuáles no, y que el
nombre del paciente no viaja) y en las ampliaciones de
`_smoke-pulir-informe.mjs` y `_smoke-registro-completo.mjs`.

## Enviar UN registro de sesión a la familia (29/08/2026)

Aumenta, por Rodrigo: «queremos poder subir al área privada del paciente los
registros por separado, y siempre que se suba algo se tiene que subir
simplemente el PDF». Hasta ese día un registro solo llegaba a la familia DENTRO
de un informe, en el anexo opcional: para compartir una sesión suelta había que
redactar un informe, y se mandaban todas las del periodo o ninguna.

`POST /api/clinica/sessions/[id]/enviar` — gemela de la del informe y con la
misma mecánica: genera el PDF con `buildSessionPdfBuffer` (**el mismo de «Ver
PDF»**, una sola fuente), lo publica en el archivo central como documento
visible y apunta el id en `clinic_sessions.delivered_document_id`. De ahí sale a
«Mis documentos» del portal. Botón en el cajón de la sesión, que pasa a decir
«Volver a enviar» cuando ya se envió, con la fecha debajo.

- **Se sube el PDF y nada más.** La fila de `documents` la arma
  `lib/clinica/envioRegistro.js` (`documentoDeRegistro`) y no hay otra: un
  `application/pdf` con `client_visible`, `source='sesion'`, colgado del
  paciente y de su pagador. Sus doce campos están fijados en
  `_smoke-clinica-enviar-registro.mjs`, para que añadir uno cueste una prueba
  en rojo y no un dato de más en manos de una familia.
- **Lo interno no viaja**, porque el PDF ya lo deja fuera: preparación, sus
  adjuntos, notas internas y transcripción del audio (`sessionPdf.js`, fijado en
  `_smoke-plantillas-clinica.mjs`).
- **Reenviar es reemplazar**: PDF nuevo, se borra el anterior del archivo y del
  disco. Nadie tiene dos versiones del mismo registro.
- **Sin cliente pagador no se puede** (409 con el motivo, `motivoParaNoEnviar`):
  el portal filtra por cliente y el documento no lo vería nadie.
- El PDF enviado aparece también en la pestaña **Documentos** de la ficha del
  paciente (`source='sesion'` entró en la lista de esa ruta), para ver de un
  vistazo qué se le ha mandado. Se retira desde su sesión, no desde ahí.
- Auditoría `clinica.session.sent`, sin el nombre del paciente.
- **El `status` de la sesión no se toca.** «Cerrada» (`published`) es del equipo;
  «enviado» es de la familia, y una sesión puede estar enviada sin estar cerrada.

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

## El PDF del informe, rediseñado (28/08/2026)

Lo pidió Aumenta y lo dieron por bueno Rodrigo y Jorge. El informe deja de ser
una hoja sencilla y pasa a ser **el documento formal que la familia presenta en
el colegio o adjunta a la beca del Ministerio**.

El motivo no fue estético. En un mes de uso real, en `crm_aumenta` había **cero
informes clínicos** en un schema con 22.045 sesiones y 1.174 pacientes: el PDF
que había no servía para aquello para lo que lo iban a usar. La cabecera vieja
decía, a propósito, «sin membrete ni pie: lo abre una familia en el móvil, no se
archiva en un expediente en papel». Esa decisión se ha dado la vuelta.

**Cómo es ahora.** Portada a sangre que ocupa la primera página entera (fondo
teñido y manchas de color que llegan al borde del papel), índice con puntos guía
en la página 2, apartados numerados con el número grande al margen, bloque de
firma con hueco para firmar a mano, hoja de protección de datos y el **isotipo
del centro cerrando la última página**. Número de página solo con el número y en
la esquina inferior derecha; **sin cintillo** en las páginas de texto (Rodrigo:
citaba los ocho servicios y «es un poco extraño»).

**Todo lo del centro es opcional y hoy no lo tiene nadie.** Cada bloque se salta
si no tiene datos: sin logo se pinta el nombre del centro, sin CIF no hay línea
de CIF, sin colegiación la firma es solo el nombre. Un informe SIEMPRE se
genera; lo único imperdonable sería un 500 con una familia esperando.

| Pieza | Dónde vive | Qué decide |
| --- | --- | --- |
| Paleta | `lib/clinica/marcaInforme.js` | Los ocho tonos salen DERIVADOS de `settings.brand` (peldaño 2 de la escalera). Un centro con marca verde tiene un informe verde sin tocar código; sin marca, pizarra neutra. Acepta un `accentColor` opcional. |
| Apartados | `lib/clinica/apartadosInforme.js` (+ `plantillas.js`, que da la lista) | Cuáles se imprimen y con qué número. **El índice y el cuerpo salen de aquí los dos**: numerarlos por separado dejaría un índice con huecos en cuanto un apartado se quede vacío. Un apartado vacío no gasta número. |
| Firma | `lib/clinica/firmaProfesional.js` | «Nombre · Titulación · Nº Col. X» juntando solo lo que hay, sin separadores huérfanos. Y `pideAcreditacionProfesional`, la puerta que decide dónde se enseñan esos dos campos en Equipo. |
| Datos del centro | `lib/tenant/datosCentro.js` | Lee `settings.centro` (razón social, CIF, teléfonos, sedes con su nº de Registro Sanitario, párrafo de protección de datos). Lo que no está, no se imprime. Se rellena en Configuración → Datos del centro. |
| Imágenes | `lib/pdf/imagenLocal.js` | Logo e isotipo, **solo desde rutas locales de `public/`**. Nunca un `fetch`: `brand.logoUrl` es texto libre sin validar y bajarlo sería un SSRF. Comprueba los primeros bytes (pdfkit solo entiende PNG y JPEG). |
| Argumentos | `lib/clinica/argumentosDelPdf.js` | Lo que necesita el generador, armado UNA vez. Las dos rutas que generan el PDF —«Ver PDF» y «Enviar al paciente»— tenían los ocho argumentos copiados: un dato añadido en una sola hacía que la profesional previsualizara un documento y la familia recibiera otro. |

**La beca no cambia**: sigue con sus tres apartados, sin índice, sin periodo y
sin anexo. Lo que sí gana es la portada, con las denominaciones oficiales de la
convocatoria una por línea (juntas se partían a mitad de palabra).

**Lo que se arregló de camino.** `serializeReport` no devolvía `methodology`,
`anexarRegistros` ni `sourceSessionIds` dentro de `contentSections`, y el cajón
manda ese objeto ENTERO al guardar sobre un JSONB que se reemplaza sin fusionar:
abrir un informe de beca ya escrito y pulsar «Guardar informe» **le borraba la
metodología**. No se lo había comido a nadie porque no hay informes reales
todavía, pero este rediseño es justo lo que va a hacer que empiecen a usarlos.
Prueba: `scripts/_smoke-informe-ida-y-vuelta.mjs`.

**Dos cosas que hacen falta del cliente y no del código**: los ficheros de logo
e isotipo en `public/` (`brand.logoUrl` y `brand.isotipoUrl` guardan la RUTA,
`/aumenta-logo.png`), y que alguien rellene Configuración → Datos del centro.
Hasta entonces el informe sale correcto pero sin membrete.

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

## El registro de sesión de un TALLER (01/09/2026)

> «Los talleres hay que ponerlos y dejarlos claros que ahora salen como bloqueos
> y ya. Ahora hay HHSS (Habilidades Sociales), Grupo de Apoyo y Mente Activa. Hay
> que poner que estos talleres puedan tener registro de sesión y afecta a un
> grupo de pacientes. A todos les saldrá el registro en sus sesiones como parte
> del taller y que se pueda poner un apartado para cada paciente y que solo le
> salga a él. Es decir, el registro general el mismo a todos menos el apartado
> extra privado para cada paciente.» (Rodrigo)

Era literal: los tres talleres de Aumenta se apuntaban en la agenda como un
bloqueo con el nombre escrito a mano. Hora y media, ocho pacientes, y de lo que
se hacía dentro no quedaba ni una línea en la historia de ninguno.

### Las tres piezas

| Dónde | Qué guarda |
| --- | --- |
| `bookings.taller_grupo_id` | La CITA del taller. ⚠️ `team_blocks.taller_id` **quedó obsoleta al día siguiente** — ver «Los talleres son citas», abajo. |
| `taller_sesiones` (`TallerSesion`) | **El registro COMÚN del grupo**, por apartados, con el mismo mecanismo que un registro de sesión normal (`lib/clinica/plantillas.js`). Más quién la dio, cuándo, cuánto duró y las notas internas del grupo. |
| `clinic_sessions.taller_sesion_id` | El registro de CADA asistente, con el cuerpo común ya dentro y **su nota individual** en `content_sections.notaIndividualTaller`. Sin FK dura: borrar la sesión del taller no puede llevarse la historia clínica de ocho pacientes. |

### Por qué el texto se copia a cada paciente

Duplica texto a propósito. La razón es que «le sale en SUS sesiones» tiene que
ser verdad hasta el final: el informe evolutivo, el anexo del PDF, las
estadísticas del centro, el volcado que redacta el borrador y el envío al área
privada leen `clinic_sessions` **por sus columnas de siempre**. Con el texto
solo en `taller_sesiones`, un paciente que va a HHSS todo el curso tendría el
taller en la pantalla y no en su informe, que es justo donde hace falta.

No es una segunda fuente: manda `taller_sesiones`, y la copia se **reescribe
entera** en cada guardado (`propagarSesionDeTaller`, idempotente). El reparto a
columnas lo hace `repartirValoresDeSesion`, el mismo que usa el formulario de
una sesión normal.

### Lo que no cruza, y por qué es lo delicado

Es la única parte del CRM donde ocho familias comparten un documento:

- la **nota individual** se lee de la sesión de ese paciente y se escribe solo
  en la suya. `apartadosComunes()` echa su clave de la lista común y
  `valoresComunes()` la borra del cuerpo del grupo — dos cerrojos separados,
  porque los apartados los elige quien escribe desde una plantilla que también
  se edita;
- las **notas internas del grupo** (`TallerSesion.internalNotes`) no bajan a
  ningún registro: son material del equipo y esos registros se pueden enviar al
  área privada de ocho familias;
- si el formulario **no manda** nota para un paciente, se conserva la que tenía:
  guardar el registro común desde otra pantalla no le borra su nota a nadie.

Lo fija `scripts/_smoke-taller-sesion.mjs` (`node:test`, ligera, en `npm test`),
incluida la comprobación de que la nota de un paciente no aparece **por ningún
campo** en el registro de otro.

### El audio y la IA en el taller (03/09/2026, Rodrigo)

«Añade audio e IA a la sesión de taller.» El formulario del taller
(`SesionTallerDrawer`) estrena la misma tarjeta que el registro de sesión
normal: un audio (arrastrar, Ctrl+V o buscar), o lo apuntado en el bloc de
notas, o los dos; el botón manda el material a
`POST /api/clinica/taller-sesiones/transcribe` y lo que vuelve se elige bloque
a bloque en `PropuestaIA`. Nada se escribe solo, y guardar sigue siendo el
POST/PUT de siempre.

Lo que la hace distinta de la del registro normal es que el registro de un
taller lo comparten ocho familias y en el audio la profesional NOMBRA a los
niños. Por eso (`lib/clinica/tallerCompleto.js`):

- **Los bloques** son los apartados comunes de la plantilla, **una nota por
  asistente que VINO** —con su nombre en el título y en la pista— y las notas
  internas del grupo al final. La lista de asistentes viaja con el material;
  sin nombre no hay bloque (Claude no sabría de quién es), y a quien faltó no
  se le puede escribir nada.
- **El prompt** explica las tres partes y añade sus reglas propias: lo que se
  diga de un niño con nombre va SOLO a su nota; en lo del grupo, plural y sin
  nombres; un nombre que no esté en la lista no gana una nota (si importa, va
  a las internas); un asistente del que no se habla tiene la nota vacía.
- **El reparto** (`repartirPropuestaDeTaller`) es el cerrojo: solo escribe una
  nota en la clave del asistente al que pertenece (`nota:<patientId>`), tira
  una nota para un id que no está en la lista, y la clave de la nota
  individual (`notaIndividualTaller`) nunca entra como apartado común. En la
  pantalla, `aplicarPropuesta` hace lo mismo: cada nota a SU casilla, lo
  interno a las internas, lo común a sus apartados.
- **Un audio se transcribe una vez.** Lo que leyó la IA se guarda con la
  sesión en `taller_sesiones.ai_transcription` (+ `audio_duration_sec`,
  migración `migrate-taller-sesiones-ia`, VA ANTES del despliegue) y, al
  reabrirla, se puede volver a pasar la IA con ese texto y unas notas nuevas
  sin subir nada. Es material del equipo: no se propaga a los pacientes ni
  sale en ningún PDF.
- Mismas puertas que el registro normal: la demo pública se corta
  (`assertNotDemoPaidCall`), `vetoAi`, claves BYOK del centro, y en local sin
  claves la propuesta canned (`propuestaDemoTaller`), con dos notas de ejemplo
  para los dos primeros asistentes y nada en lo común con nombre.

Fijado en `scripts/_smoke-taller-completo.mjs`.

### Quitar a alguien de la lista

Desmarcar a un asistente borra su registro de esa sesión… **salvo que ya se le
haya enviado a su familia**: un documento que alguien ya tiene en su área privada
no puede desaparecer del CRM. Esa sesión se desengancha del taller (para que la
próxima propagación no la reescriba), se queda en la ficha del paciente y la
respuesta la cuenta en `conservadas`. Borrar la sesión de taller entera es
**solo admin**, por lo mismo: se lleva el registro de todo el grupo.

## Los talleres son CITAS, y por grupos (01/09/2026)

> «Los talleres no dejan de ser citas múltiples a las que van varios pacientes a
> la vez y que pueden estar impartidas por varios terapeutas la misma cita. Por
> tanto hay que preparar los talleres de tal forma que en las citas se pueda
> seleccionar los talleres. **No como bloqueos sino como un tipo más de cita.**
> Solo que estos tipos de cita se crean desde la pestaña de talleres, y en la
> propia pestaña se marca quién o quiénes imparten y qué pacientes van. Asimismo
> estos pacientes tendrán que estar relacionados entre sí dentro de una misma
> cuota de talleres.» Y, a media conversación: **«en los talleres hay que poder
> poner varios grupos distintos para la misma actividad».** (Rodrigo)

Corrige el encargo de esa misma mañana, que había dejado el taller como un
bloqueo con nombre. Un bloqueo es una hora tachada: no tiene asistentes, no se
cobra, no se le pasa lista y no llega a la historia de ningún niño.

### La actividad y el grupo

`Habilidades sociales` son **45 niños** en Aumenta, y 45 niños no caben en una
sala. Por eso el modelo se parte en dos alturas:

| Tabla | Qué es | Cada cuánto cambia |
| --- | --- | --- |
| `talleres` (`Taller`) | **La ACTIVIDAD**: qué es y cómo se cobra | una vez al año |
| `taller_grupos` (`TallerGrupo`) | **EL GRUPO**: cuándo, cuánto dura, plazas, su concepto propio | cada curso, y hay varios |
| `taller_grupo_terapeutas` | Quién lleva el grupo. **Varios**, uno de ellos `coordina` (índice único parcial) | |
| `taller_inscripciones.grupo_id` | Un paciente se apunta a un GRUPO, no a la actividad. `taller_id` se queda para preguntar por la actividad entera | |
| `taller_cita_terapeutas` | Quién impartió **una tarde concreta**. Se copia del grupo al crear la cita y luego va por su cuenta: cambiar el grupo en enero no puede reescribir quién dio el taller en octubre | |
| `taller_asistencias` | Quién fue a esa tarde y si faltó. Mismos tres campos que `bookings` (`no_show` + `justified` + motivo) | |

### El grupo es un tipo de cita

Cada grupo tiene su `EventType`, creado y mantenido **desde Talleres**
(`lib/clinica/tipoCitaTaller.js`), con el nombre «Actividad · Grupo», slug
`taller-…`, presencial y **oculto** (`is_hidden`: a un taller se entra
apuntándose, no reservando desde la web). El puntero vive en
`event_types.taller_grupo_id` —y no al revés— porque la pregunta que se hace mil
veces al día es la de ida: «de este tipo de cita, ¿es un taller?».

Con eso, el taller entra por las puertas que ya existen: festivos, vacaciones,
solapes, filtros por tipo, color de la caja e informe de ocupación. **Nada de
eso hubo que enseñárselo.**

### Una caja en la agenda, no ocho

La cita de taller lleva `patient_id` a NULL —los asistentes son varios y viven
en `taller_asistencias`— y `client_name` con el rótulo del grupo. En el
calendario sale como `Habilidades sociales · Grupo A (8)`, y `(6/8)` cuando ya
se ha pasado lista.

Dos consecuencias que hubo que resolver:

- **`bookings.team_member_id` solo admite uno**, y hace falta (color de la caja,
  y el solape se comprueba por profesional). Se pone quien coordina; para que la
  segunda terapeuta lo vea en SU agenda, el calendario amplía el filtro con
  `citasDeTallerQueImparte()` (`lib/clinica/citaDeTaller.js`).
- **No sale correo**: un taller no tiene UNA familia a la que avisar, tiene
  ocho, cada una con su consentimiento. El POST devuelve
  `emailMotivo: "taller"` y la pantalla no enseña el aviso de «no le ha llegado».

### La lista se COPIA al crear la cita

Y es lo importante de todo: al apuntar la cita se copian los inscritos **de ese
momento**. Si se leyera del grupo en vivo, dar de baja a un niño en enero lo
borraría de todas las tardes de octubre a las que sí fue —y con él, su registro
y su falta—. Para meter en una cita ya creada a alguien apuntado después está
«Traer a los nuevos» (`PATCH …/taller` con `sincronizar: true`), que **solo
añade** y lo pide una persona.

### La asistencia manda sobre el registro

El registro común se copia **solo a quien consta como `asistio`**. Marcar una
falta después de haberlo escrito le quita a ese niño su copia, y marcarlo como
presente se la da: no se le puede dejar en la historia clínica una sesión a la
que no fue, ni quitarle una a la que sí. La falta abre incidencia por la misma
puerta que las individuales (`lib/citas/incidenciaPorFalta.js`).

### La cuota del taller

Apuntar a un niño le da de alta a **su familia** una cuota mensual con el
concepto del taller, y darlo de baja la cierra (`endDate` + `active: false`,
nunca se borra). El id vive en `taller_inscripciones.cuota_id`, que es lo que
permite cerrar la de ese taller sin adivinar cuál de las cuotas de la familia
era (`lib/clinica/cuotaDeTaller.js`).

Dos reglas que no son obvias:

- **si la familia ya paga ese concepto, se ENGANCHA a esa cuota** en vez de
  crear otra. El caso real es un niño al que ya se le cobraba el taller por
  fuera —259 de las 274 cuotas de Aumenta vienen del volcado de Organízate—, y
  apuntarlo ahora no puede duplicarle el recibo;
- **si su cuota cubre además otras cosas, la baja NO la cierra**: dejaría a la
  familia sin cobrar la logopedia por haber sacado al niño del taller. Se
  devuelve el motivo y lo decide una persona.

Todo es *best-effort*: sin Facturación o sin concepto de cobro, el niño se
apunta igual y la pantalla lo dice («Sin cuota» en su fila).

### Quién firma el registro

Se elige en el propio formulario, y se puede corregir después —lo mismo que se
hizo el mismo día para los registros individuales
(`app/api/clinica/sessions/[id]` acepta `therapistId` en el PATCH y lo valida
contra el equipo del centro)—. En un taller arranca por quien coordina.

### Lo que se quedó atrás

`team_blocks.taller_id` **existe y ya no la escribe nadie**. La columna se
queda, y el modal de un bloqueo que la tuviera enseña un aviso de dónde han ido
a parar los talleres. En producción no hay ni uno (0 de 10.468 bloqueos), así
que no hubo nada que migrar.

Lo puro lo fija `scripts/_smoke-talleres-grupos.mjs` (`node:test`, ligera).

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
| `therapistId` | UUID **nullable** | FK a `team_members`. Opcional desde el 02/08/2026 (`migrate-sesion-terapeuta-opcional.js`): al importar cuatro años de Aumenta salieron 4.045 sesiones firmadas por gente que ya no está; una nota sin firma es mejor que una atribuida a otra persona. **Se cambia a posteriori desde el 01/09/2026** (ver abajo). |
| `sessionDate` | TIMESTAMPTZ NOT NULL | Fecha y hora de la sesión. |
| `duration` | INTEGER nullable | Minutos. |
| `objectives` | JSONB NOT NULL DEFAULT `[]` | Array de objetivos trabajados (chips). |
| `activities` | TEXT | Actividades realizadas en la sesión. |
| `performance` | TEXT | Desempeño del paciente. |
| `observations` | JSONB NOT NULL DEFAULT `{}` | `{ familyComments, nextSessionNotes, homeworkTasks, incidents }`. |
| `prepText` | TEXT | Preparación previa (parte 1 del registro en 3 partes). |
| `prepFiles` | JSONB NOT NULL DEFAULT `[]` | Adjuntos de preparación `[{ name, path, mimeType, size }]`; NO son `documents` (ver «Registro de sesión en 3 partes»). |
| `parentFeedback` | TEXT | Devolución de la familia (parte 3). |
| `contentSections` | JSONB NOT NULL DEFAULT `{}` | Apartados del registro (29/08/2026): la FOTO de con qué apartados se escribió (`apartados`) y el cuerpo de los que no son columnas. Los de fábrica siguen en sus columnas — ver «Plantillas de informes y registros». |
| `internalNotes` | TEXT | Notas internas del equipo (29/08/2026). **Nunca sale del CRM**: ni al informe, ni a su anexo, ni al portal. Columna propia y no una clave de `observations`, justo por eso — ver «Notas internas». |
| `deliveredDocumentId` | UUID nullable | El PDF de este registro publicado en el área privada de la familia (29/08/2026). Sin FK: borrar el documento del archivo no borra la sesión. |
| `deliveredAt` | TIMESTAMPTZ nullable | Cuándo se envió por primera vez. El `status` NO cambia: «Cerrada» es del equipo y «enviado» es de la familia. |
| `aiTranscription` | TEXT | Transcripción literal (Whisper). |
| `aiStructured` | JSONB | Resultado IA crudo (Claude). |
| `audioDurationSec` | INTEGER nullable | Duración del audio original, en segundos. |
| `aiReviewedAt` | TIMESTAMPTZ nullable | Cuándo terminó la IA de procesar/estructurar. |
| `status` | ENUM | `draft`, `ai_pending`, `registered`, `published`. Default **`registered`** (`migrate-clinica-module.js` añade los dos valores nuevos al enum). `published` se rotula «Cerrada» en pantalla y **no comparte la sesión con la familia** — ver ««Marcar como cerrada»». |
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
| `reportType` | ENUM | `evolution`, `admission`, `discharge`, `referral`, `beca`, `asesoramiento`. Default `evolution`. La lista viva es `REPORT_TYPES` (`lib/clinica/serialize.js`), que es de donde la leen los endpoints y las pantallas. `referral` (Derivación) desde el sprint Aumenta 2026-07-28: la especialidad de destino va en `contentSections.referralSpecialty` (claves de `lib/clinica/derivaciones.js`). `admission` se ETIQUETA «Entrevista inicial» desde ese sprint (el valor en BD no cambia), y desde el 03/09/2026 **no se crean más**: la entrevista inicial es un registro de sesión con su plantilla (`REPORT_TYPES_NUEVOS`); los que existen se siguen leyendo. `beca` (26/08/2026) es el ÚNICO con apartados propios en el código, porque los manda la convocatoria (`lib/clinica/beca.js`). `asesoramiento` (04/09/2026, Aumenta): el informe de las sesiones de asesoramiento que el centro ya cobra como tales; se compone con las plantillas del centro como el evolutivo, y lo único suyo es el nombre —«Asesoramiento» en el chip, «Informe de asesoramiento» en la portada— y su color en la lista. Cada valor nuevo del enum pide su migración ANTES del despliegue (`migrate-informe-beca`, `migrate-informe-asesoramiento`): con el código por delante, crear uno da «invalid input value for enum». |
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
| `/clinica/informes` | Listado de informes con filtros. «Nuevo informe» crea el borrador y **abre su pantalla**. Click en fila abre el **drawer** de revisión (`InformeDrawer.jsx`), con «Editar informe». |
| `/clinica/informes/[id]` | **LA pantalla del informe** (04/09/2026, `InformeEditor.jsx`): cabecera con tipo y fechas, material para dictarlo o pegarlo (`MaterialIA`), volcado desde sesiones, IA (`PropuestaIA`) y sus apartados (`ApartadosEditor`). |
| `/clinica/coordinaciones` | Listado GENERAL de coordinaciones del centro con filtros por tipo y ámbito, y alta (`NuevaCoordinacionModal.jsx`). Hasta el sprint 2026-07 solo se veían paciente a paciente. |
| `/clinica/talleres` | Talleres: actividades de grupo e inscripciones (02/08/2026). Desde el 31/08/2026 el taller puede llevar su concepto de cobro del catálogo (`talleres.concept_id` → `billing_concepts`, FK suave; migración `migrate-talleres-concepto`): el formulario ofrece el selector si el centro tiene catálogo y el detalle dice al apuntar qué se cobrará; el GET del listado y el del detalle cuelgan `concepto` a mano. Desde el 01/09/2026 el taller tiene **sesiones**: la ficha las lista y `SesionTallerDrawer.jsx` registra una (registro del grupo + nota por paciente). |
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

## El taller se abre por su registro, y con su plantilla (03/09/2026)

- **Pulsar un taller en la agenda abre directamente su registro de sesión**
  (`SesionTallerDrawer`, montado desde `modules/default/CitasModule.jsx`
  con `/api/citas/bookings/[id]/taller` para saber grupo y sesión), «como en
  los pacientes». La ficha de la cita (hora, quién lo imparte, pasar lista)
  queda a un clic con «Ver la cita» en la cabecera del registro. Sin grupo
  (taller dado de baja) se cae a la ficha de siempre.
- **Plantilla «Registro de taller»** (`PLANTILLA_TALLER`,
  `lib/clinica/plantillas.js`; en `PLANTILLAS_EXTRA.registro`, así que el
  centro puede sustituirla u ocultarla desde Configuración): objetivos,
  actividades, desempeño, comentarios familiares, preparación previa y
  devolución a la familia. Las cuatro primeras claves son las del registro de
  sesión de siempre para que caigan en las columnas de `clinic_sessions` de
  cada asistente; las dos últimas viven en el JSONB. Una sesión de taller nueva
  arranca con ella; las guardadas conservan su foto de apartados.
- **El apartado privado de cada asistente se llama «Observaciones»**
  (`ETIQUETA_NOTA_POR_DEFECTO`, `lib/clinica/tallerSesion.js`): un comentario
  para ESA familia que las demás no ven. Lo ya escrito conserva su título.

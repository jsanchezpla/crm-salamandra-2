# Backlog

Lo que hay que hacer, para quién y con qué urgencia. Se mira aquí antes de
decidir en qué trabajar.

---

## Cómo se usa esto

**Para Jorge y Rodrigo.** Cada tarea dice de qué cliente es y qué pasa si no se
hace. Si algo no está aquí, no está acordado: se añade y se prioriza.

**Para Claude.** Cuando encuentres algo que merezca arreglarse y no vayas a
hacerlo en el momento, apúntalo aquí en vez de contarlo solo en el chat — un
hallazgo que solo vive en una conversación se pierde.

⚠️ **NADA se añade ni se quita sin comprobarlo antes contra PRODUCCIÓN.** Las dos
direcciones, y por el mismo motivo:

- **Antes de añadir**: que el problema pase de verdad en el VPS, no en local.
  Local y producción divergen mucho —Aumenta tiene 12 módulos en local y 20 en
  producción, 15 citas frente a 12.030—, así que un fallo que se ve aquí puede
  no existir allí, y al revés. Una tarea falsa hace perder una tarde.
- **Antes de quitar**: que el arreglo funcione en el VPS. No basta con que el
  código esté subido ni con que el despliegue haya terminado: hay que ver el
  comportamiento nuevo. Si no se puede comprobar, la tarea se queda con una nota
  de qué se intentó.

Lo que se cierra pasa a `resuelto.md` **en el mismo commit**, con cómo se
comprobó. Así no hay un momento en que algo no esté en ninguno de los dos.

### Cada tarea lleva su sello

La última línea de cada una dice **cuándo se comprobó contra producción y qué
salió**. Sin sello, la tarea no vale: puede llevar meses arreglada.

Ese sello nació de una tarea falsa. En el repaso del 09/08 había escrita una que
decía «el cobro con tarjeta no se ha completado nunca» — y en producción había
**dos pagos hechos**, uno de 130 € de una paciente real. Se había escrito con
datos de la víspera y nadie la volvió a mirar. De la misma pasada salieron otras
cuatro con el cliente equivocado. **Escribir la tarea y comprobarla son el mismo
acto**: una tarea sin comprobar no es un aviso, es ruido que alguien va a creerse.

Cuando lo que se comprueba es que el problema **ya no pasa**, la tarea no se
edita: se mueve a `resuelto.md`.

### Cómo se añade una tarea

Con estos datos y nada más:

- **Qué pasa hoy**, no qué hay que programar. «El aviso de SLA cuenta tickets
  que no se ven» se entiende dentro de seis meses; «arreglar contador» no.
- **De quién es**: el slug del cliente, o «todos» si es del producto. Comprobado
  contra la base de datos, no contra CLAUDE.md — que se desactualiza.
- **Prioridad** (abajo se explican).
- **Cómo se comprueba que está resuelto.** Sin esto no se puede cerrar sin
  fiarse de alguien.
- **Dónde está**, con fichero y línea si se sabe.
- **El sello de comprobación**, con fecha.

### Cómo se quita

Solo cuando **se ha comprobado contra producción**, no cuando el código está
subido. Se borra la tarea entera; el historial vive en git, no aquí. Si al
comprobarlo resulta que sigue pasando, se queda y se actualiza el sello.

### Prioridades

| | Qué significa |
| --- | --- |
| **P0** | Está pasando ahora y cuesta dinero, clientes o datos. Se hace hoy. |
| **P1** | Un cliente se lo va a encontrar esta semana, o bloquea algo suyo. |
| **P2** | Mejora clara, sin fecha. |
| **P3** | Deuda o limpieza. Se hace cuando se toque esa zona. Aquí van también los fallos reales que **hoy nadie puede ver** porque en producción no se da el caso. |

---

## P0 — hoy

### La portada enseñaba a cada profesional las citas de todo el equipo, con el nombre del paciente · `nutri_laura`, todos

**Lo que pasaba.** Rocío, que en nutri_laura es usuaria normal y no admin, vio en
SU portada la cita de supervisión que Laura se había agendado para sí misma. La
cita estaba BIEN asignada —el reparto no tenía nada que ver—: lo que estaba mal
era la portada, que listaba las próximas citas de todo el centro, con el nombre
del paciente, a cualquiera que entrara.

**Por qué se quedó fuera.** El listado de citas y el calendario filtran por
profesional desde el 28/07 (`lib/citas/visibilidad.js`, hecho justo para que un
miembro del equipo no vea los datos personales de la agenda ajena). La portada no,
y su cabecera explicaba el motivo: decía que Booking no tenía clave hacia el
usuario, así que «lo mío» era inviable. Sí la tiene —`bookings.team_member_id`—
y el propio listado ya filtraba por ella: la premisa llevaba semanas caducada y
nadie volvió a mirarla.

**A quién afectaba.** A todo cliente con Citas y Equipo que NO tenga la agenda
compartida encendida. Aumenta la tiene encendida a propósito desde el 01/08, así
que para ellos ver la agenda completa es lo pedido, no un fallo. Donde no lo está
—nutri_laura entre otros— cualquier usuaria veía la agenda entera.

**Ya está arreglado.** La portada usa la misma regla que el listado: admin lo ve
todo, un cliente con agenda compartida también, y el resto solo lo suyo. Y si no
se puede resolver quién mira, la agenda sale VACÍA en vez de abierta — un fallo de
resolución no puede volver a destapar nada. Los ocho casos quedan fijados en
`scripts/_smoke-portada-agenda.mjs`, que corre sin base de datos y entra en
`npm test`.

*Se comprueba*: Rocío entra en su portada y ya no le salen las citas de Laura, y
Laura, que es admin, las sigue viendo todas.
*Dónde*: `lib/home/summary.js` (`buildAgenda` y `buildHomeSummary`); la regla
compartida en `lib/citas/visibilidad.js`; la prueba en
`scripts/_smoke-portada-agenda.mjs`.
*Comprobado en producción*: 19/08/2026 — la cita del 27/08 está asignada a Laura
Barbero, Rocío tiene rol `user` y `agendaCompartida` no está puesta en los
ajustes de nutri_laura, así que no debía verla. **Falta que Rocío lo confirme en su
pantalla**: eso no lo puedo mirar yo sin su sesión.

---

## P1 — esta semana

### El formulario de profesionales funciona, pero ningún enlace publicado lleva a él · `nutri_laura`

**Lo que pasa.** Una profesional que quiere supervisión de casos no tiene por
dónde decir que es profesional, así que entra como paciente — y desde ahí la
supervisión (60 €) le queda invisible para siempre. La web la anuncia: en
`/servicios/` hay un bloque «Supervisión individual para nutricionistas» con un
botón «Reservar sesión de supervisión →» que lleva a `/citas/`, donde ese tipo de
cita **no le aparece a nadie**.

**Por qué, y no es que falte nada por programar.** «Supervisión profesional» está
reservada a quien tenga su ficha marcada como profesional de la salud (se puso el
12/08 a petición de Rodrigo, porque esa sesión entre colegas estaba abierta a
cualquiera). La marca se pone sola al convertir un lead que traiga
`customFields.profesionalSalud`, y **el formulario que lo manda existe y está bien
hecho**: es el shortcode `[nutrilaura_lead_form]` del tema, sale como pestaña
«Profesionales» al lado de «Pacientes», pega a `/api/public/leads` con
`x-tenant: nutri_laura` y calcula la marca con `esPro = datos.tipo ===
'profesional'`, valor que el desplegable «¿Quién eres?» ofrece tal cual.

**Lo que falla es que nadie llega a ese formulario.** Vive SOLO en `/contacto/`,
y ninguno de los enlaces que Laura publica va allí: el de su biografía de
Instagram lleva a `/formularios/`, **donde solo está el de pacientes**, y el botón
«Reservar sesión de supervisión →» de `/servicios/` lleva a `/citas/`, la agenda.
Un profesional que entre por cualquiera de los dos no tiene ni la opción de
decir que lo es: rellena el de pacientes, y desde ese momento su ficha ya no puede
marcarse sola, porque las solicitudes del módulo Formularios ponen «Paciente
Nutrición» y nunca la de profesional.

**Cómo salió.** Una usuaria pidió reservar el acompañamiento de supervisión de
casos y solo le salían los mensuales. Llegó por un enlace social, rellenó
`consulta` (el de pacientes) el 07/08 y se le aceptó la solicitud; su ficha tiene
una sola marca, `nutricion`, puesta automáticamente. Nunca vio la pestaña de
profesionales.

**Y por eso el embudo entero está sin estrenar.** En producción hay **0 leads** en
`crm_nutri_laura.leads` —el formulario de profesionales no lo ha rellenado nadie
nunca, no porque esté roto, sino porque ningún enlace lleva a él—, **0 fichas** con
la marca y **0 reservas** de ese tipo en toda la historia. Ya quedó avisado al
cerrar la tarea de la puerta del formulario, que terminaba con «falta verlo con un
profesional de verdad»: esta es esa primera vez, y ha entrado por la puerta
equivocada.

**Mientras no esté arreglado** se desatasca sin desplegar nada: Laura entra en la
ficha y marca la casilla «Es profesional de la salud», justo debajo de «Paciente
Nutrición» (sí se pinta en su ficha, que es un override). Es una casilla que no ha
usado nunca, así que hay que avisarla cada vez.

**Lo que hay que decidir**, porque son dos arreglos distintos y el barato no es
nuestro: **(1)** en la web, que los enlaces que se publican lleven a donde está el
formulario de profesionales —o ponerlo también en `/formularios/`, que es donde
cae el tráfico de Instagram—, y así el CRM marca la ficha solo, sin tocar una
línea de nuestro código; o **(2)** que aceptar una solicitud del módulo
Formularios pueda poner la marca. La segunda es código y decisión de producto: hoy
esa pantalla no pregunta nada de esto, y hay que elegir si se le añade la pregunta
al formulario de pacientes o una casilla al aceptar.

*Se comprueba*: rellenar el formulario de profesionales eligiendo «Nutricionista o
profesional de la salud», que aparezca el lead con `customFields.profesionalSalud
= true`, y que al convertirlo la ficha quede marcada sola y le salga «Supervisión
profesional» en la agenda. Y por el otro lado, que un profesional que llegue por
el enlace de Instagram tenga forma de decir que lo es.
*Dónde*: `lib/clients/moduleAssignments.js:69` (`marcarProfesionalDesdeLead`) y su
único llamante, `app/api/clients/route.js:331`; el filtro en
`lib/citas/tiposVisibles.js` (`esSoloParaProfesionales`); el ajuste
`settings.citas.tiposSoloProfesionales` de nutri_laura, hoy con un solo valor,
`supervision-profesional`; y la vía que sí usan sus pacientes,
`app/api/formularios/[id]/accept/route.js:117`. El botón, en la página
`/servicios/` de su WordPress, fuera de este repo.
*Comprobado en producción*: 17/08/2026 — 0 leads, 0 fichas con la marca y 0
reservas de ese tipo; de las 81 solicitudes que han entrado, todas son de dos
formularios (`registro-web` y `consulta`) y ninguna del de profesionales. La ficha
de quien avisó tiene solo `nutricion` con `{"auto":true}`. Y en la web, leído del
tema y del HTML servido: el shortcode manda bien la marca, el formulario está solo
en `/contacto/`, `/formularios/` únicamente tiene el de pacientes, y el botón de
`/servicios/` apunta a `/citas/`.

---

## P2 — cuando se pueda

### El correo de entrada de Soporte necesita tres cosas que no están en el código · `aumenta`, `demo`, `somos`

**El CRM ya sabe hacerlo entero** (14/08/2026): un correo firmado que entra por
`/api/webhooks/resend-inbound` abre su ticket, cae en el hilo por el `TK-0042`
del asunto o por el remitente, distingue si escribe el equipo, no duplica los
reintentos y reabre lo que estaba resuelto. Todo eso está fijado en
`scripts/_smoke-correo-entrante.mjs` y pasa. **La otra mitad de Soporte —que el
cliente nos avise a NOSOTROS desde su Ayuda— está comprobada contra producción y
funciona**: el aviso de Aumenta se guarda y el correo sale de verdad.

Lo que falta no se programa, se da de alta, y son tres cosas fuera del
repositorio: **(1)** un dominio de RECEPCIÓN en la cuenta de Resend de Salamandra
(p. ej. `inbound.salamandrasolutions.com`), **(2)** su registro MX en el DNS del
dominio y **(3)** un webhook apuntando a
`https://crm.salamandrasolutions.com/api/webhooks/resend-inbound`, cuyo
`whsec_…` se pega en `.env.production`. Hacen falta el panel de Resend y el DNS;
desde aquí no se puede.

Hoy **no se pierde ni un correo**, y conviene saber por qué: sin las variables no
existe ninguna dirección de captura, así que nadie tiene a dónde escribir. La
pantalla de Soporte esconde el bloque entero y ofrece el portal. Lo que sí era un
riesgo —y se arregló el 14/08— es la media configuración: con solo el dominio
puesto, el CRM le enseñaba a cada cliente su dirección y le pedía que reenviara
ahí TODO su buzón, mientras el webhook contestaba 503 a cada entrega. Ahora
`captureAddress` exige las dos variables, así que faltar una deja la vía
ausente en vez de pintada en la pared.

*Se comprueba*: `docker exec crm-salamandra-app-1 node scripts/check-resend-tenant.mjs`
dice que las dos variables están y que el dominio de captura consta verificado; y
un correo a `soporte-aumenta@{dominio}` abre su ticket en la bandeja de Aumenta.
*Dónde*: `app/api/webhooks/resend-inbound/route.js`, `lib/support/notify.js:26`
(`captureAddress`). Los pasos del alta, comentados en `.env.production.example`.
*Comprobado en producción*: 14/08/2026 — siguen sin estar `RESEND_INBOUND_DOMAIN`
y `RESEND_WEBHOOK_SECRET` (las 26 variables del `.env.production`, ninguna
RESEND), `inbound.salamandrasolutions.com` no existe en el DNS, y las tres claves
de Resend que hay guardadas son de solo envío, así que ni siquiera pueden listar
los dominios de su cuenta. `support` activo en `aumenta`, `demo`, `demo_agencia`
y `somos`; Aumenta sigue con 0 tickets.

---

## P3 — deuda

### Los volcados de Fichaje se auditan sin frase propia: en Actividad saldrán con el traductor genérico · `aumenta`, producto

**Lo que pasa.** Los siete endpoints de `/api/fichaje/*` auditan cinco acciones
(`fichaje.volcado`, `fichaje.corregido`, `fichaje.creado_a_mano`,
`fichaje.dado_de_baja`, `fichaje.volcado_deshecho`), pero ninguna tiene frase
en `lib/actividad/etiquetas.js` ni el prefijo `fichaje` está en su mapa de
módulos. En Equipo → Actividad saldrán con el traductor genérico, que dice la
clave y poco más. El doc del módulo (`docs/modules/fichaje.md`) afirma que las
frases están; no están.

**Cuánto duele.** Hoy nada: Aumenta tiene el módulo encendido y todavía no ha
volcado ningún Excel (0 acciones `fichaje.*` en `master.audit_logs`). El día que
lo haga, el primer volcado del mes saldrá en Actividad como una clave en crudo.

*Se comprueba*: `grep -n fichaje lib/actividad/etiquetas.js` devuelve las cinco
entradas y el prefijo en MODULOS; y tras un volcado en la demo, Equipo →
Actividad lo cuenta con su frase.
*Dónde*: `lib/actividad/etiquetas.js` (mapa de módulos y entradas),
`app/api/fichaje/import/route.js` y hermanos.
*Comprobado en producción*: 19/08/2026 — en el contenedor `etiquetas.js` tiene
cero menciones a fichaje, y en master.audit_logs no hay ninguna acción
`fichaje.*` todavía.

### Activar «pacientes» sin «clinica» correría ALTERs sobre una tabla que no existe · producto

**Lo que pasa.** La tabla `patients` solo la crea `migrate-clinica-module.js`,
que en `scripts/_module-migrations.js` está únicamente en el bloque `clinica`.
El bloque `pacientes` tiene seis migraciones y todas son ALTER sobre `patients`
(`migrate-patients-clients-phase1`, `-multi-per-client`, `-care-type`,
`-specialties`, `migrate-client-module-assignments`,
`migrate-documents-patient-link`). Un `enable-module.js <slug> pacientes` en un
cliente que no tenga `clinica` se las encontraría sin tabla.

**Cuánto duele.** Hoy nada, por el orden de las dependencias: `clinica` exige
`pacientes` y no al revés, y en producción ningún cliente tiene `pacientes` sin
`clinica` (comprobado). Morderá el día que se venda Pacientes suelto — que es
justo el caso 1 de la escalera, el que no debería abrir ningún fichero.

*Se comprueba*: `node scripts/enable-module.js <slug> pacientes --dry-run` en un
tenant sin `clinica` lista la creación de `patients` antes de los ALTER (o el
bloque `pacientes` de `_module-migrations.js` lleva la migración que la crea).
*Dónde*: `scripts/_module-migrations.js:270` (bloque `pacientes`),
`scripts/migrate-clinica-module.js`.
*Comprobado en producción*: 19/08/2026 — en el contenedor el bloque `pacientes`
no incluye `migrate-clinica-module`; en master no hay ningún tenant con
`pacientes` encendido y `clinica` apagado.

### Nueve pruebas no las ve `npm test` por cómo se llaman · producto

**Lo que pasa.** `scripts/pruebas.mjs` recoge solo `_smoke-*.mjs`, `_smoke-*.js`
y `smoke-test-*.mjs`. Fuera quedan las cuatro de Captación
(`_outreach-ai-unit.mjs`, `_outreach-smoke.mjs`, `_outreach-e2e.mjs`,
`_outreach-ui-check.mjs`) y las cinco de Nutrición
(`smoke-nutri-laura-recetario-{c1,c2,c3,c4,e2e}.mjs`). `_outreach-ai-unit.mjs`
es pura (prompt, parseo, el simulado de IA): entraría en `npm test` con solo
renombrarla. Las otras ocho piden servidor y base de datos, y las tres de
Captación con servidor firman el JWT para el tenant `sandbox`, que no existe ni
en local ni en producción: hoy fallarían aunque el runner las viera.

**Cuánto duele.** Es una red con agujeros: Captación y Nutrición pueden romperse
sin que `npm test` se entere, y los docs de los dos módulos ya dicen que sus
pruebas «están». Nadie ha perdido nada todavía.

*Se comprueba*: `node scripts/pruebas.mjs --listar` enseña la unitaria de
Captación entre las ligeras; y las ocho pesadas, o están en `npm run test:todo`
con un tenant que exista, o están borradas con su motivo.
*Dónde*: `scripts/pruebas.mjs:78` (el `startsWith`), `scripts/_outreach-*.mjs`,
`scripts/smoke-nutri-laura-recetario-*.mjs`.
*Comprobado en producción*: 19/08/2026 — en el contenedor, el patrón del runner
y los nueve ficheros están tal cual se describe.

### Los docs de Leads, Formularios y Analíticas describen overrides y endpoints que ya no existen · documentación

**Lo que pasa.** `docs/modules/leads.md` habla de siete overrides y de
quality-energy, abarcaia y Referidos (borrados el 12/08), niega endpoints que
existen (convertir un lead en proyecto, el rate limit del público, la auditoría
de PATCH/DELETE), dice «12 stages» cuando son 15 y «leads o sales», y no
menciona `/leads/estadisticas`. `formularios.md` sigue titulado «Formularios»
(en el menú es Leads Comerciales desde el 01/08), le faltan el DELETE de
descartadas y los endpoints firmados `registro-web`, y describe el canje SSO
dejando solicitudes, que se quitó el 05/08. `analytics.md` manda usar `--force`
en `enable-module.js` sin hacer falta y cita la regla 14 para los secretos (es
la 15). 27 puntos, uno a uno, en `docs/revision-docs-2026-08-19.md`.

**Cuánto duele.** Quien vaya a tocar Leads leyendo el doc programa contra un
módulo que no existe: es justo lo que las cabeceras «Mapa» del 19/08 evitan en
las 30 primeras líneas, pero el resto del doc sigue debajo contradiciéndolas.

*Se comprueba*: las secciones leads.md, formularios.md y analytics.md de
`docs/revision-docs-2026-08-19.md` están borradas porque cada punto se corrigió
en su doc.
*Dónde*: `docs/modules/leads.md`, `docs/modules/formularios.md`,
`docs/modules/analytics.md`.
*Comprobado en producción*: 19/08/2026 — cada punto verificado contra el código
desplegado (commit f1039ea, el mismo que HEAD).

### Los docs de Clínica y Pacientes siguen diciendo «solo Aumenta» y describen la maqueta · documentación

**Lo que pasa.** `clinica.md` lista 6 endpoints cuando hay 35 y «cuatro
modelos» cuando hay 10; sus tablas de modelos van por detrás del código
(`therapistId` ya es opcional, el `status` de sesión tiene cuatro valores, faltan
`clientId`, `prepText`, `scope`, `deliveredDocumentId`…); presenta la migración
ONE_OFF de la maqueta como la viva y cuenta quality_energy y abarcaia entre los
tenants. `pacientes.md` dice que `clients` «no se usa en el flujo clínico» y que
la vinculación está «pendiente» cuando `patients.client_id`, la sección de
pacientes en la ficha y el backfill existen desde julio; su tabla del modelo no
tiene ocho columnas que sí están; habla de «4 tabs» y de la maqueta. Y los dos
dicen «activado solo en aumenta»: lo tienen también demo, demo_clinica y somos.
Detalle en `docs/revision-docs-2026-08-19.md`.

**Cuánto duele.** Es el módulo de la reina: la próxima vez que Aumenta pida algo
clínico, el doc por el que manda empezar CLAUDE.md cuenta la versión de junio.

*Se comprueba*: las secciones clinica.md y pacientes.md de
`docs/revision-docs-2026-08-19.md` están borradas porque cada punto se corrigió
en su doc.
*Dónde*: `docs/modules/clinica.md`, `docs/modules/pacientes.md`.
*Comprobado en producción*: 19/08/2026 — cada punto verificado contra el código
desplegado (f1039ea = HEAD); los tenants, contra master.

### Los docs de Citas, widget, Pagos y Correo describen reglas que cambiaron este mes · documentación

**Lo que pasa.** `pagos.md` dedica una sección entera al reembolso automático
(≥24 h, cancela la profesional) que desde el 07/08 no existe: el CRM no devuelve
dinero nunca, solo suelta retenciones; dice que «pedir otra tarjeta» no está
construido (lo está, con tres pruebas), que `checkout.js` no tiene llamantes
(lo llama `/book`), y no cuenta los plazos, los bonos ni el vigilante de
retenciones. `citas.md` repite tres veces que `Booking` no tiene FK a `Client`
(la tiene, más paciente, profesional y bono), describe un override de Laura y un
`ClientBookingsPanel` en `overrides/` que no existen, y lista una migración de
quince. `citas-embed.md` habla de CSP abierta, del gate `?wpa=1` y de
`/mis-citas`, todo cambiado. `emails.md` conoce 3 plantillas de 16 y no menciona
que la clave de Resend es por cliente (BYOK). Detalle en
`docs/revision-docs-2026-08-19.md`.

**Cuánto duele.** Es donde hay dinero: alguien que lea pagos.md puede prometerle
a una paciente una devolución que el CRM no va a hacer.

*Se comprueba*: las secciones citas.md, citas-embed.md, pagos.md y emails.md de
`docs/revision-docs-2026-08-19.md` están borradas porque cada punto se corrigió
en su doc.
*Dónde*: `docs/modules/{citas,citas-embed,pagos,emails}.md`.
*Comprobado en producción*: 19/08/2026 — cada punto verificado contra el código
desplegado (f1039ea = HEAD).

### Los docs de Facturación e Inventario hablan de FIFO, lotes y pantallas que no están · documentación

**Lo que pasa.** `billing.md` dice que «enviar factura» es informativo (manda
el PDF por Resend), que las líneas disparan un descuento FIFO sobre
`InboundBatch` (modelo que no existe desde el 02/08: hoy solo avisa), que cada
línea se escribe a mano (el editor elige producto de Inventario); lista 10
páginas de 17 y deja fuera presupuestos, exportaciones, morosidad, arqueo y
proveedores; y su backlog sigue pidiendo el PDF y los presupuestos, que existen.
`inventory.md` apunta a `seed-inventario-demo.js` como la siembra de la demo
(ya la hace `seed-sandbox-data.js`) y `lib/provisioning/catalogo.js` describe
el módulo con «lotes, fórmulas». Detalle en `docs/revision-docs-2026-08-19.md`.

**Cuánto duele.** Facturación es el módulo con 14.243 facturas reales de
Aumenta; un doc que describe el flujo anterior es peor que ninguno.

*Se comprueba*: las secciones billing.md e inventory.md de
`docs/revision-docs-2026-08-19.md` están borradas porque cada punto se corrigió
en su doc (y `catalogo.js` ya no habla de fórmulas).
*Dónde*: `docs/modules/billing.md`, `docs/modules/inventory.md`,
`lib/provisioning/catalogo.js:68`.
*Comprobado en producción*: 19/08/2026 — cada punto verificado contra el código
desplegado (f1039ea = HEAD).

### Los docs de Equipo, Proyectos, Soporte y Buzón se quedaron en su primera versión · documentación

**Lo que pasa.** `team.md` dice «una sola página, un solo modelo» (hay 10
páginas bajo /equipo y 3 modelos), que «no hace permisos por módulo» (los hace
desde el 27/07), que Actividad va sin moduleKey (va con `team_avanzado`), y le
faltan cinco campos y cinco endpoints. `projects.md` sigue «pendiente de
deploy» (está en cinco clientes), describe 6 pestañas (son 4) y no menciona la
IA de Proyectos ni el calendario. `support.md` dice que sin módulo sale un
mailto (desde el 13/08 enlaza al Buzón) y usa el tenant `sandbox` de ejemplo,
que no existe. `buzon.md` solo tiene dos omisiones (`quienEscribe.js` y la
herramienta de triaje). Detalle en `docs/revision-docs-2026-08-19.md`.

**Cuánto duele.** Poco cada una; juntas, es la mitad del CRM contada de memoria.

*Se comprueba*: las secciones team.md, projects.md, support.md y buzon.md de
`docs/revision-docs-2026-08-19.md` están borradas porque cada punto se corrigió
en su doc.
*Dónde*: `docs/modules/{team,projects,support,buzon}.md`.
*Comprobado en producción*: 19/08/2026 — cada punto verificado contra el código
desplegado (f1039ea = HEAD).

### Los docs de Clientes, Nutrición, Formación, Documentos, Configuración y Captación listan menos de lo que hay · documentación

**Lo que pasa.** `clients.md` recoge 17 endpoints de 26 y «seis pestañas» de
nueve. `nutricion.md` aún describe OpenFoodFacts, «solo nutri_laura», un
esquema sin las cuatro tablas del recetario y una sección de migraciones que
omite seis vivas y enseña como comando dos históricos. `training.md` cuenta
«siete modelos» (nueve), cita como vivo el override de Aumenta borrado el 18/08,
dice que `/api/cuestionarios` acepta `cuestionarios` y que el módulo no audita
(audita tres acciones). `documents.md` sigue «sin desplegar», con el modelo
viejo, «todos con hasModule(documents)» cuando 7 de 9 exigen el avanzado, y una
cuota por featureFlags que no existe. `configuracion.md` habla de un
`always: true` que no está en el Sidebar, de «dos tarjetas» y «cuatro
interruptores» (son siete tarjetas y diez interruptores), y de 7 endpoints con
`vetoAi` (son 11). `outreach.md` sigue «falta desplegar» (está en cinco
clientes) y dice que sin `RESEND_API_KEY` el envío es dry-run (la clave es por
cliente). Detalle en `docs/revision-docs-2026-08-19.md`.

**Cuánto duele.** Son los docs de las dos reinas (Laura en nutrición, la ficha
de Aumenta en clientes) y el de Configuración, que es por donde entra cada
cliente nuevo.

*Se comprueba*: las secciones clients.md, nutricion.md, training.md,
documents.md, configuracion.md y outreach.md de
`docs/revision-docs-2026-08-19.md` están borradas porque cada punto se corrigió
en su doc.
*Dónde*: `docs/modules/{clients,nutricion,training,documents,configuracion,outreach}.md`.
*Comprobado en producción*: 19/08/2026 — cada punto verificado contra el código
desplegado (f1039ea = HEAD).

---

## Pendiente de una decisión suya

Cosas que no se pueden hacer sin que Jorge o Rodrigo elijan. Van como tareas y
no como una lista suelta a propósito: así aparecen en el tablero. Cuando se
decida, la respuesta se escribe aquí y la tarea baja a su prioridad.

### ¿Qué es «ganado» en el embudo de Aumenta? · `aumenta`, `sandbox`

**Lo que se decidió el 17/08 y lo que no.** Se arregló la mitad que engañaba:
donde el embudo no tiene ninguna etapa de «ganado», la pantalla de estadísticas
ya no enseña «Convertidos», en vez de un 0 con un porcentaje debajo que no podía
subir nunca. Lo que sigue igual es el embudo. Aumenta ofrece Nuevo, Contactado y
Descartado, así que a nadie se le puede marcar como ganado y su embudo no puede
medir si convierten.

**Por qué no se arregló de una vez.** Porque ya no es un fallo, es una pregunta:
qué significa «ganado» en un centro de psicología. Lo más probable, que la
persona entre como paciente. Pero eso cambia la pantalla que su equipo usa todos
los días, y añadir una etapa a un embudo en marcha se decide, no se deduce.
Escribirla es una línea; elegirla es la conversación.

**Un cabo del mismo sitio, que se resuelve con la misma respuesta.** Los
overrides de Aumenta y de sandbox tienen definido el color de la etapa
`qualified`, que sus embudos no ofrecen. Hoy no hay ni un lead ahí, pero el
importador la acepta —está en la lista canónica—, así que el día que entre uno
saldrá con su chip de color y sin fila en la barra de etapas, y los contadores de
la cabecera dejarán de sumar el total. Borrar el estilo sin más lo empeora: ese
lead perdería hasta el color. La salida es ofrecer la etapa o impedir que entre
nadie.

*Se comprueba*: que un lead de Aumenta se pueda marcar como ganado y que
`/leads/estadisticas` vuelva a enseñarle su conversión.
*Dónde*: `modules/overrides/aumenta/LeadsModule.jsx:15` (las etapas) y `:21` (el
estilo), y la declaración espejo de `lib/leads/embudos.js`, que hay que cambiar
en el mismo commit o la prueba de humo casca.
*Comprobado en producción*: 17/08/2026 — Aumenta tiene 2 leads, uno `contacted`
y otro `new`, ninguno en `lost` ni en `qualified`. En la demo, que sí tiene 5
descartados, se confirmó que la tarjeta ya no sale.


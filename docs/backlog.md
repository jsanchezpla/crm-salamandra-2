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

### La tarjeta de Stripe de Configuración pide dar de alta solo una parte de los eventos que el CRM necesita · producto, `nutri_laura`

**Lo que pasa.** La tarjeta «Stripe» de `/configuracion`
(`modules/config/ConfigModule.jsx`, línea ~145) dice al cliente: «Selecciona
estos eventos: checkout.session.completed, checkout.session.expired,
checkout.session.async_payment_succeeded, checkout.session.async_payment_failed
y charge.refunded». El webhook del CRM vive de más que eso:
`scripts/comprobar-stripe.js` lista también
`payment_intent.amount_capturable_updated` («SIN ESTE la cita no entra en la
lista de espera»: es el que avisa de que la retención ha quedado hecha),
`payment_intent.succeeded`, `payment_intent.canceled`,
`payment_intent.payment_failed` y los `invoice.*` del pago a plazos. Un cliente
que configure Stripe siguiendo la pantalla deja fuera el evento que hace
funcionar la reserva con retención.

**Cuánto duele.** Hoy nadie: el único cliente con Stripe es nutri_laura y su
webhook se dio de alta a mano con la lista buena (`comprobar-stripe.js` lo
verifica). Morderá al siguiente que lo haga solo desde la pantalla, que es
justo para lo que la pantalla existe (regla #14: la configuración es
universal).

*Se comprueba*: el texto de la tarjeta lista los mismos eventos que
`scripts/comprobar-stripe.js` (o remite a él), y un tenant nuevo que los siga
pasa `comprobar-stripe.js` sin avisos.
*Dónde*: `modules/config/ConfigModule.jsx:145`; la lista buena en
`scripts/comprobar-stripe.js:36-40` y siguientes.
*Comprobado en producción*: 19/08/2026 — la cadena con la lista corta está en
el bundle desplegado (`.next/static` y `.next/server/chunks/ssr`, `c7f84d2`).

---

## P3 — deuda

### Las tres pruebas de Captación con servidor apuntan a `sandbox`, que no existe · producto

**Lo que pasa.** `scripts/_outreach-smoke.mjs`, `_outreach-e2e.mjs` y
`_outreach-ui-check.mjs` firman el JWT para el tenant `sandbox`, que no existe
ni en local ni en producción. Por eso, cuando el 19/08 se renombraron las
demás pruebas de Captación y Nutrición a `_smoke-*` para que `npm test` las
viera, estas tres se quedaron fuera a propósito: meterlas en el runner solo
habría puesto `npm run test:todo` en rojo.

**Cuánto duele.** La parte con servidor de Captación (buscar nuevos, analizar,
convertir en cliente) sigue sin red automática. Hoy nadie ha perdido nada.

*Se comprueba*: las tres se llaman `_smoke-outreach-*.mjs`, apuntan a `demo`
(que tiene `outreach` con 11 leads sembrados) y pasan con `npm run test:todo`.
*Dónde*: `scripts/_outreach-smoke.mjs`, `_outreach-e2e.mjs`,
`_outreach-ui-check.mjs` (el slug y el JWT de `admin@sandbox.local`).
*Comprobado en producción*: 19/08/2026 — en el contenedor los tres ficheros
siguen con `sandbox`; la unitaria (`_smoke-outreach-ai-unit.mjs`) ya entra en
`npm test`.

### Dos pruebas de cobro esperan una devolución que el CRM ya no hace · `nutri_laura`, producto

**Lo que pasa.** `scripts/_smoke-cancelar-retencion.mjs` (paso 3: «una cita ya
cobrada se sigue devolviendo», espera `refunded`) y
`scripts/_smoke-carreras-cobro.mjs` (caso 2: «cancela mientras se cobra → se le
devuelve») se escribieron con la regla de julio. Desde el 07/08/2026 (Rodrigo)
`lib/citas/politicaReembolso.js` dice que el CRM no devuelve dinero nunca —solo
suelta retenciones—, y lo fija `_smoke-no-se-devuelve.mjs`. Las dos pruebas
viejas fallarían hoy; necesitan servidor y claves `sk_test_`, así que
probablemente nadie las ha lanzado desde entonces.

**Cuánto duele.** Son pruebas, no producción: lo que duele es que la red de
cobros tiene dos hilos que contradicen la regla, y el día que alguien las lance
no sabrá cuál de las dos miente.

*Se comprueba*: las dos pasan con `npm run test:todo` y sus pasos esperan
`released`/sin devolución donde antes esperaban `refunded`.
*Dónde*: `scripts/_smoke-cancelar-retencion.mjs` (paso 3),
`scripts/_smoke-carreras-cobro.mjs` (caso 2); la regla en
`lib/citas/politicaReembolso.js`.
*Comprobado en producción*: 19/08/2026 — en el contenedor los dos ficheros
siguen esperando `refunded` (dos veces cada uno).

### El proveedor de un gasto existe en la base de datos pero no se puede poner desde el CRM · `aumenta`, producto

**Lo que pasa.** `Cost.supplierId` está en el modelo, en la columna
`costs.supplier_id`, en la asociación de Sequelize y lo rellenó la importación
de la contabilidad de Aumenta; `DELETE /api/proveedores/[id]` lo mira para no
borrar un proveedor con gastos. Pero `POST` y `PATCH /api/billing/costs` no lo
aceptan y la pantalla de Gastos (`/facturacion/costes`) no lo pide: un gasto
nuevo nace sin proveedor, y el proveedor «compartido entre Gastos e Inventario»
del doc solo funciona de Inventario para dentro.

**Cuánto duele.** Aumenta tiene los gastos importados con su proveedor y a
partir de ahí los nuevos van sin él: la lista de proveedores deja de cuadrar
con los gastos sin que nadie se entere.

*Se comprueba*: dar de alta un gasto en `/facturacion/costes` permite elegir
proveedor y `GET /api/billing/costs` lo devuelve.
*Dónde*: `app/api/billing/costs/route.js` y `[id]/route.js` (whitelist del
body), `app/(dashboard)/facturacion/costes/page.jsx`; el modelo
`models/tenant/Cost.model.js` ya lo tiene.
*Comprobado en producción*: 19/08/2026 — el bundle desplegado de
`/api/billing/costs` no contiene `supplierId`; `billing` encendido en aumenta
(14.243 facturas) y seis tenants más.

### Restos vistos en la revisión de docs del 19/08: código que nadie importa y comentarios que mienten · producto

**Lo que pasa.** Al verificar los docs contra el código salieron cabos que no
son de doc y no valían una tarea cada uno:
- `components/projects/ClientProjectsSection.jsx`,
  `EmployeeProjectsSection.jsx` y `ConvertLeadToProjectButton.jsx` no los
  importa nadie (sus endpoints sí existen).
- `app/(dashboard)/clinica/_components/dummyData.js` y
  `app/(dashboard)/pacientes/_components/dummyData.js` son restos de la
  maqueta y nadie los importa.
- La cabecera de `lib/buzon/quienEscribe.js` dice que lo usan «los tres
  endpoints del cliente»; lo importan dos.
- `scripts/dev-mint-wpsso.js` lee `WIDGET_SSO_SECRETS` como objeto
  slug → secreto y no contempla la forma lista (rotación del 12/08): con
  lista firmaría con «a,b».
- `docs/modules/citas-portal-wordpress-snippet.php` monta `/mis-citas`, que
  hoy es un redirect a `mi-perfil` (funciona, pero enseña la URL vieja).

**Cuánto duele.** Nada en producción. Es limpieza para cuando se toque cada
zona; si se hace de una vez, que sea un commit por punto.

*Se comprueba*: `grep -rl` de cada componente fuera de su propio fichero
devuelve algo o el fichero ya no está; la cabecera de `quienEscribe.js` dice
«dos»; `dev-mint-wpsso.js` acepta la lista; el snippet monta `mi-perfil`.
*Dónde*: los ficheros de la lista.
*Comprobado en producción*: 19/08/2026 — en el contenedor
`quienEscribe.js` sigue diciendo «tres endpoints» y `dev-mint-wpsso.js` no
tiene `Array.isArray`; los componentes y `dummyData.js` están en el repo
desplegado (`c7f84d2`).

---

## Pendiente de una decisión suya

Cosas que no se pueden hacer sin que Jorge o Rodrigo elijan. Van como tareas y
no como una lista suelta a propósito: así aparecen en el tablero. Cuando se
decida, la respuesta se escribe aquí y la tarea baja a su prioridad.

### Si una cita se cancela mientras se está cobrando, el CRM dice «el importe se ha devuelto» y no devuelve nada · `nutri_laura`, producto

**Lo que pasa.** En `POST /api/citas/bookings/[id]/confirm`, si otra petición
cancela la cita en el instante en que se está capturando el cobro, el endpoint
llama a `reembolsarCitaSiProcede` y responde 409 «La cita dejó de estar
disponible mientras se procesaba el cobro. El importe se ha devuelto». Desde el
07/08/2026 esa función no devuelve nunca (`lib/citas/politicaReembolso.js`),
así que el mensaje miente: el dinero se ha cobrado por una cita que ya no
existe y nadie lo devuelve.

**Por qué es una decisión y no un arreglo.** La regla «no se devuelve nunca» se
pensó para cancelaciones de la paciente; este caso es distinto: hemos cobrado
NOSOTROS por algo que ya estaba cancelado. Caben dos salidas y las dos son de
producto: (a) que este caso sea la única excepción y se devuelva (la función ya
sabe hacerlo), o (b) mantener «nunca» y cambiar el mensaje para que diga la
verdad y alguien lo resuelva a mano desde Stripe. Es una carrera de milisegundos
y con 10 citas en Laura es improbable, pero el mensaje actual es falso.

*Se comprueba*: `_smoke-carreras-cobro.mjs` (caso «cancela mientras se cobra»)
pasa con la regla elegida y el texto del 409 dice lo que pasa de verdad.
*Dónde*: `app/api/citas/bookings/[id]/confirm/route.js` (bloque
`CANCELADA_A_MEDIAS`), `lib/citas/reembolsoCita.js`,
`lib/citas/politicaReembolso.js`.
*Comprobado en producción*: 19/08/2026 — la cadena «importe se ha devuelto»
está en el bundle desplegado (`.next/server/chunks`), y `decidirReembolso`
devuelve siempre `false`.

### El correo de cancelación (y otros cuatro) no miran si la familia ha pedido que no se le escriba · `nutri_laura`, `aumenta`, producto

**Lo que pasa.** `citaPuedeAvisar` (las preferencias de comunicación de la
ficha, `lib/clients/comunicaciones.js`) lo consultan el cambio de hora, el
enlace de videollamada, el recordatorio, los avisos, `/book` y `/confirm`.
No lo consultan `bookingCancelled`, `bookingRejected`, `pedirTarjeta`,
`solicitudAceptada` ni el `bookingReceived` que sale del webhook de Stripe.

**Por qué es una decisión.** Puede ser a propósito: una cancelación o un «no te
hemos podido cobrar» es transaccional, y no avisar puede ser peor que avisar a
quien pidió silencio. Pero la ficha promete «por dónde se le escribe a cada
familia», y hoy esa promesa tiene cinco agujeros. Hay que decir cuáles de esos
cinco son transaccionales (se mandan siempre) y cuáles respetan la preferencia.

*Se comprueba*: cada plantilla de la lista, o pasa por `citaPuedeAvisar`, o
está en una lista de «transaccionales» con su motivo en
`lib/clients/comunicaciones.js`.
*Dónde*: `lib/citas/notificarCancelacion.js`,
`app/api/citas/bookings/[id]/reject/route.js`,
`app/api/citas/bookings/[id]/pedir-tarjeta/route.js`,
`app/api/formularios/[id]/accept/route.js`,
`app/api/webhooks/stripe/[tenantSlug]/route.js`.
*Comprobado en producción*: 19/08/2026 — verificado contra el código
desplegado (`c7f84d2`): ninguno de los cinco pasa por `citaPuedeAvisar`.

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


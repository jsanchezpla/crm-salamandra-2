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

_Ahora mismo no hay ninguna._

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

_Ahora mismo no hay ninguna._

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


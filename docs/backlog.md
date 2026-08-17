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

### Las pacientes aceptadas no reciben el correo para entrar en la web · `nutri_laura`

**Lo que pasa.** Al aceptar una solicitud, el CRM crea la ficha y le pide a la
web de Laura que dé de alta a la paciente. La cuenta se crea bien, pero **el
correo con el enlace para elegir contraseña no llega nunca**. La paciente se
queda sin poder entrar al portal ni reservar, y nadie se entera: el CRM le
enseña a Laura «se le ha enviado un correo».

**Cómo salió.** Una paciente a punto de contratar avisó el 14/08 de que no podía
entrar. Su ficha estaba creada, su cuenta en la web también —usuario dado de
alta, rol Suscriptor— y el correo del CRM «Ya puedes pedir tu cita» le salió por
Resend con acuse. El único que faltaba era el de la contraseña.

**Reproducido dos veces el mismo día** con direcciones nuevas contra la web real.
La segunda, llamando al endpoint directamente, WordPress contestó `201` y
`{"creado":true,"user_id":57,"message":"Usuario creado y correo de acceso
enviado."}` — y no llegó nada. El fallo es mudo por los dos lados.

**Dónde está, y no es en el CRM.** El alta la atiende
`nutrilaura-portal-user.php`, un fichero del TEMA de su WordPress (303 líneas):
crea a la persona con `wp_insert_user` y **no llama al aviso estándar de
WordPress**; se fabrica su propio correo con `get_password_reset_key` y `wp_mail`.
El envío de la web NO está roto —el «Restablecer la contraseña» de WordPress core
sí llega, desde `info@tunutrilaura.com`—, así que lo que falla es ese envío a
mano, que además no mira lo que devuelve `wp_mail`.

**Nuestra mitad, que es la que lo hizo invisible.** `crearUsuarioPortal` compone
«Usuario creado. Se le ha enviado un correo para que elija su contraseña» solo
con ver que la respuesta trae `creado`, sin que WordPress diga nunca si el correo
salió; y esa frase es la que se le enseña a Laura al aceptar. Mientras siga ahí,
esto se seguirá descubriendo por WhatsApp y no por el CRM.

**Mientras no esté arreglado**, a quien se quede fuera se le manda el
restablecimiento desde Usuarios de su WordPress: ese va por el camino de core y
sí llega.

⚠️ Quedan **dos usuarios de prueba** en la web de Laura de reproducir esto:
`infoalta-prueba` y el de `user_id` 57. Hay que borrarlos al cerrar la tarea.

*Se comprueba*: aceptar una solicitud con un correo nuevo —o llamar a
`crm/v1/portal-user` con una dirección que no exista— y que llegue el correo con
el enlace para elegir contraseña.
*Dónde*: el fallo, en `nutrilaura-portal-user.php` del tema de tunutrilaura.com,
FUERA de este repo. Lo nuestro, en `lib/formularios/portalUser.js:198-204` y
`app/api/formularios/[id]/accept/route.js:127`.
*Comprobado en producción*: 14/08/2026 — reproducido dos veces con correos
nuevos; la web responde 201 «correo de acceso enviado» y no llega nada. El correo
de core sí llega, así que el envío de la web no está roto.

---

## P1 — esta semana

_Ahora mismo no hay ninguna._

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

**Ahora mismo no hay ninguna.** Rodrigo contestó las seis que había el
12/08/2026; están en `resuelto.md` con la respuesta y con lo que se hizo después
de cada una. Un bloque vacío no se pinta en el Registro, así que esta sección
desaparece de la pantalla hasta que vuelva a haber algo que decidir.


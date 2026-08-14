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

### El acceso SSH al VPS admite contraseña de root · producto

`sshd -T` en el VPS responde `permitrootlogin yes` y `passwordauthentication
yes`. El `PasswordAuthentication no` que hay escrito en `/etc/ssh/sshd_config`
**está muerto**: el `Include /etc/ssh/sshd_config.d/*.conf` de la línea 12 va
ANTES, y en la configuración de sshd gana el primer valor, así que
`50-cloud-init.conf` —que dice `yes`— lo tapa. Y ese fichero lo reescribe
cloud-init, con lo que arreglarlo a mano en el fichero grande no aguanta.

Es una máquina con datos de salud de 1.083 familias y con root abierto a
contraseña desde internet. Las claves públicas de los cuatro que entramos ya
están puestas, así que cerrarlo no deja a nadie fuera.

*Se comprueba*: `sshd -T | grep -E "passwordauthentication|permitrootlogin"`
devuelve `no` y `prohibit-password`, y los cuatro seguimos entrando.
*Dónde*: `/etc/ssh/sshd_config.d/50-cloud-init.conf` (o uno propio con número
más alto, que es lo que aguanta a cloud-init).
*Comprobado en producción*: 10/08/2026 — `passwordauthentication yes` efectivo.

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

### El Registro no deja escribir la solución de una tarea, ni copiarla de un golpe · `interno`

**Lo que falta.** Cuando ya se sabe cómo se arregla algo, ese conocimiento no
tiene dónde ir hasta que alguien se siente a programarlo: se queda en una
conversación y se pierde. Y para pasarle una tarea a Claude hay que ir
seleccionando a mano el título, el cliente y el cuerpo, que están en tres sitios
distintos de la tarjeta.

**Lo que hace falta.** Dos botones en cada tarea de /admin/tablero. Uno de
Solución, que abre un campo de texto libre y lo GUARDA. Y otro de Copiar, que
deje en el portapapeles de una vez el título, el cliente, la descripción y esa
solución propuesta, listo para pegar.

**La trampa está en dónde se guarda, y no es evidente.** NO puede ir a
docs/backlog.md: ese fichero viaja dentro de la imagen de Docker, así que el
siguiente despliegue borraría lo que la pantalla hubiera escrito, y sin dar
ningún error. Tiene que ir a master.tablero_estado, que es donde ya viven el tick
y el reparto exactamente por este motivo. Esa tabla tiene hoy clave, titulo,
asignado_a, resuelta y tocada_por: hace falta una columna nueva con su migración,
y que el PATCH la acepte igual que acepta las otras dos.

**Para qué es.** Para poder pegarle una tarea entera a Claude de un tirón, que es
como se trabaja ya con las dos skills del Registro.

*Se comprueba*: escribir una solución en una tarea del Registro, desplegar, y que
siga estando ahí. Y que el botón de copiar pegue las cuatro cosas de una vez.
*Dónde*: `app/admin/tablero/page.jsx` (los botones),
`app/api/admin/tablero/route.js:266` (el PATCH que ya guarda tick y reparto),
`models/master/TableroEstado.model.js` (la columna nueva y su migración).
*Comprobado en producción*: 14/08/2026 — en `master.tablero_estado` solo hay id,
clave, titulo, asignado_a, resuelta, tocada_por y las dos fechas: no existe
ninguna columna donde guardar una solución.

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


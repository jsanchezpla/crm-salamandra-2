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

### Los scripts que borran datos de clientes reales no llevan seguro · producto

En el contenedor de producción **no existe `scripts/_guard-datos-reales.js`** y
los scripts peligrosos están sin él: comprobados `clear-aumenta-leads`,
`clear-quality-leads`, `clear-abarcaia-leads`, `seed-aumenta` y `seed-abarcaia`,
los cinco sin seguro. Cualquiera que lance uno dentro del contenedor —creyendo
que está en local, que es como pasa siempre— se lleva por delante datos reales
de Aumenta o de Abarcaia.

Está **hecho en local y sin commitear** (los ficheros sueltos que hay en el
disco: el guard, los doce scripts modificados y `docs/blindaje-datos-2026-08.md`).
Falta commitearlo y desplegarlo. Lo lleva Jorge en otra ventana.

La copia de seguridad automática, en cambio, **sí funciona**: `crm-backup.timer`
corre a las 03:15 y hay copias diarias en `/root/backups`. Eso es la red por
debajo; el seguro es para no tener que usarla.

*Se comprueba*: `docker exec crm-salamandra-app-1 ls scripts/_guard-datos-reales.js`
y que los `clear-*` y `seed-*` lo importen.
*Comprobado en producción*: 10/08/2026 — no está.

### Ocho familias admitidas no pueden pedir cita · `nutri_laura`

La puerta del formulario está encendida y exige, además de la solicitud
aceptada, que exista una ficha con ese correo. **8 de las 13 aceptadas no la
tienen**: Laura ya les dijo que sí y la agenda las rechaza con un 403. No se
entera nadie, ni ellas ni Laura.

Salió del commit `db974a2` (Rodrigo, 06/08). Tres salidas y hay que elegir:
crearles la ficha, aflojar la condición, o que el 403 avise a Laura.

*Se comprueba*: `SELECT count(*) FROM crm_nutri_laura.form_submissions f WHERE
f.status='accepted' AND NOT EXISTS (SELECT 1 FROM crm_nutri_laura.clients c
WHERE lower(c.email)=lower(f.email))` → 0, o que reservar con uno de esos
correos devuelva 201.
*Dónde*: `lib/citas/puertaFormulario.js:98-105`.
*Comprobado en producción*: 09/08/2026 — **siguen siendo 8**.

### «Prueba 1 euro» está a la venta · `nutri_laura`

Tipo de cita activo y visible en la agenda pública, a 3 €, con tráfico entrando
desde Instagram. Cualquiera puede reservarlo.

*Se comprueba*: no aparece en `GET /api/public/c/nutri_laura/event-types`.
*Comprobado en producción*: 09/08/2026 — **sigue activo**.

---

## P1 — esta semana

### «Pedirle otra tarjeta» no lleva a ninguna parte · todos

El aviso recomienda pedir otra tarjeta y el botón se pinta, pero el endpoint
responde 409: `failed` está dentro de `PUEDE_HABER_DINERO`, así que una tarjeta
rechazada cuenta como «ya hay dinero reservado». Si una tarjeta falla, no hay
salida: o reintentar o cancelar.

Ojo al arreglarlo: esa lista está deliberadamente de más —«preguntar a Stripe de
más es barato; darlo por perdido, no»—. La salida no es sacar `failed` de la
lista, es que el botón sepa distinguir.

*Se comprueba*: pulsarlo en una cita `failed` manda el correo en vez de dar 409.
*Dónde*: `app/api/citas/bookings/[id]/pedir-tarjeta/route.js:77-82` y
`lib/citas/cobroCita.js:37`.
*Comprobado en producción*: 09/08/2026 — `failed` sigue en la lista.

### Trece personas de Aumenta no ven módulos que el centro tiene · `aumenta`

Los usuarios normales no tienen acceso a `clients`, `documents`, `formularios`,
`team` ni una decena más. Puede ser deliberado —trabajan en Pacientes y
Clínica— o puede que nadie se lo diera al ampliar módulos entre el 27/07 y el
01/08. **Es una decisión de negocio, no un fallo**: hay que preguntarles.

Dos de las trece (`rosa_aumenta`, `olga_aumenta`) tienen `billing` y `documents`
y las otras once no, lo que sugiere que en algún momento sí se repartió a mano.

*Se comprueba*: preguntar a Aumenta y dejar la respuesta escrita aquí.
*Comprobado en producción*: 09/08/2026 — **son 13, no 11** como decía esta
tarea antes.

---

## P2 — cuando se pueda

### Los contadores del embudo mienten al filtrar · `quality_energy`, `abarcaia`, `aumenta`

Al pulsar una etapa se reconsulta filtrando y el desglose se recalcula sobre lo
que ha llegado, con lo que las demás etapas caen a cero. En Aumenta hasta el
«X en total» de la cabecera se contagia.

*Los clientes de esta tarea estaban mal.* Decía `aumenta`, `nutri_laura` y
`sandbox`: `nutri_laura` no tiene ese código y tiene **0 leads**, y `sandbox`
**no existe en producción**. Quienes lo sufren de verdad son los que tienen
embudo lleno: `quality_energy` (129 leads) y `abarcaia` (84). Aumenta lo tiene
en el código pero con 2 leads no se nota.

La segunda mitad —el corte a 200 filas— hoy no la toca nadie: nadie llega a 200.

*Se comprueba*: filtrar por una etapa en `quality_energy` no pone las otras a cero.
*Dónde*: `modules/overrides/{quality-energy,abarcaia,aumenta}/LeadsModule.jsx`.
*Comprobado en producción*: 09/08/2026 — el patrón está en esos tres overrides
(y en `sandbox`, que no está desplegado).

### Una receta corregida no llega a quien ya tiene la pauta · `nutri_laura`

Al asignarla se congelan nombre e ingredientes, pero los pasos y la foto se leen
en vivo. Corregir una cantidad mal puesta NO le llega a quien ya la tiene —ni
con «Re-aplicar menú origen», que recopia las copias viejas— y reescribir los
pasos sí le cambia pautas de hace meses. Es una decisión de producto: o se
congela todo, o se lee todo en vivo, o hay un botón que propague de verdad.

*Se comprueba*: cambiar una cantidad y ver si llega a un plan ya asignado.
*Dónde*: `lib/nutricion/menuPdf.js:30` lo dice explícito.
*Comprobado en producción*: 09/08/2026 — sigue así, con **3 planes asignados**
que hoy heredarían el cambio a medias.

### Módulo de fichaje · `aumenta`

Lo pidieron por WhatsApp: «que vuelquen el excel de cada mes». No sabemos las
columnas, ni de qué máquina sale, ni si un mes se puede volcar dos veces. Un
fichaje mal importado es una nómina mal pagada. El plan y las preguntas que hay
que hacerles están en `docs/revision-aumenta-2026-08.md`.

*Se comprueba*: existe y Aumenta lo usa.
*Comprobado en producción*: 09/08/2026 — no hay nada de fichaje en el código.

---

## P3 — deuda

### Al borrar una ficha se promete cancelar citas a quien no tiene agenda · `retorika`, `spain_enzymes`

El aviso de borrado dice «se borrarán también sus documentos y las citas que
todavía no han ocurrido». En un cliente sin el módulo Citas esa frase no es
falsa: está **vacía**. Es cosmético.

Se intentó arreglar el 10/08 y **se retiró a propósito**, que es lo que hay que
saber si alguien lo retoma: son 5 ficheros, uno nuevo en `/lib` y una prop nueva
atravesando dos componentes de servidor y dos de cliente, uno de ellos la ficha
que usan todos los clientes menos nutri_laura. Aplicado a medias dejaba
`conCitas` sin declarar dentro de `handleDelete` — y sin TypeScript eso compila,
así que el fallo sale EN CALIENTE: un ReferenceError al pulsar «Eliminar» en
Aumenta, con quince personas trabajando.

**La forma segura**, si se hace: primero el fichero de `/lib` y las props, sin
tocar los textos y con todo funcionando igual, commit y build; y en un SEGUNDO
commit cambiar los avisos. Nunca los dos en el mismo despliegue. Ojo además a
que `app/(dashboard)/clientes/[id]/page.jsx` tiene un `catch` que deja las
banderas a `false`: con el valor por defecto mal elegido, un fallo al leer
`master` haría que Aumenta borrase una ficha SIN que se le avise de que se
cancelan sus citas futuras. El error tiene que caer del lado inocuo.

*Se comprueba*: la frase no sale en un cliente sin `citas`, y sí sale en Aumenta.
*Comprobado en producción*: 10/08/2026 — retorika y spain_enzymes tienen fichas
y no tienen agenda.

### El moduleKey `sales` sigue vivo en trece endpoints · producto

`/comercial/leads` ya se ha borrado, pero la clave `sales` sigue en el patrón
`hasModule("leads") || hasModule("sales")` de trece endpoints —todo
`/api/leads/*`, `/api/referidos/*`, `/api/public/leads`, `/api/public/referidos`
y `/api/analiticas`—, más `lib/home/summary.js`, la etiqueta de
`AccessSection.jsx` y dos seeds. Es la inconsistencia de nomenclatura que
CLAUDE.md tiene apuntada desde hace meses.

**Quitar esos OR es un cambio de AUTORIZACIÓN, no limpieza.** Si algún schema
tiene la fila `sales` activada y `leads` no, ese cliente se queda con 403 en su
módulo comercial entero el mismo día del despliegue. El orden correcto: primero
un script de solo lectura que confirme contra `master.tenant_modules` de
PRODUCCIÓN que ninguna fila `sales` está `enabled`; después quitar los OR.

*Se comprueba*: `sales` no aparece en ningún endpoint y ningún cliente lo tiene.
*Comprobado en producción*: 10/08/2026 — ningún cliente tiene `sales`, pero los
trece OR siguen en el código.

### El secreto global de webhooks tiene 31 caracteres · `retorika`

No es longitud de nada generado al azar: parece escrito a mano. Funciona, pero
conviene cambiarlo por 32 bytes aleatorios. Hay que coordinarlo con el
`wp-config.php` de la web que lo use.

*Esta tarea decía `nutri_laura` y era falso*: Laura ya tiene su propio secreto de
64 caracteres en `CRM_WEBHOOK_SECRETS`. El de 31 es el **global de reserva**
(`CRM_WEBHOOK_SECRET`), y quien cae en él es Retorika, que no tiene entrada
propia.

*Se comprueba*: `CRM_WEBHOOK_SECRETS` tiene entrada para `retorika` con 64
caracteres, y el global deja de usarse.
*Comprobado en producción*: 09/08/2026 — solo `nutri_laura` (64) tiene entrada
propia; el global sigue en 31.

### Aumenta tiene módulos encendidos que no usa · `aumenta`

`inventory`, `orders` y `projects` se activaron en bloque para sembrar datos de
escaparate; los datos se borraron y los módulos se quedaron. Ya no ensucian la
portada —los bloques vacíos no se pintan— pero siguen en su menú. Si no los
usan, apagarlos.

*Se comprueba*: no están en sus módulos activos, o nos dicen que sí los quieren.
*Comprobado en producción*: 09/08/2026 — los tres activos y **con 0 filas cada
uno** (productos, pedidos, proyectos).

### El SSO no admite rotar sin corte · producto

`WIDGET_SSO_SECRETS` guarda un secreto por cliente, así que rotarlo obliga a
coordinar el CRM y WordPress al segundo. Ya costó un corte en el portal de Laura.
Aceptando una lista, se pondría el nuevo al lado del viejo, se cambiaría
WordPress con calma y se quitaría el viejo después.

*Se comprueba*: se puede rotar un secreto sin que nadie pierda el acceso.
*Dónde*: `lib/citas/ssoToken.js:23-48`.
*Comprobado en producción*: 09/08/2026 — sigue siendo un secreto por cliente.

---

## Pendiente de una decisión suya

Cosas que no se pueden hacer sin que Jorge o Rodrigo elijan. Van como tareas y
no como una lista suelta a propósito: así aparecen en el tablero. Cuando se
decida, la respuesta se escribe aquí y la tarea baja a su prioridad.

### ¿La agenda de Aumenta se abre al público? · `aumenta`

Hoy la reserva por internet está cerrada: el portal les deja ver sus citas pero
no pedirlas. Si esperaban poder reservar desde la web, hay que abrirlo.

*Comprobado en producción*: 09/08/2026 — cerrada.

### ¿Una primera visita puede comprar el bono de 360 €? · `nutri_laura`

Hoy sí, y una clienta llegó a la página de pago, vio el importe y se fue. Si
toda primera sesión debe pasar por la valoración inicial, hay un interruptor
para eso.

*Comprobado en producción*: 09/08/2026 — se puede.

### ¿Se apaga la puerta global del formulario? · `nutri_laura`

Con ella encendida, un paciente de siempre que quiere una revisión también pasa
por la bandeja. El bloque 5 ya permite exigirlo solo en la primera visita.

Esta decisión y la de las ocho familias de P0 son la misma conversación: si la
puerta se relaja, el P0 se cae solo.

*Comprobado en producción*: 09/08/2026 — encendida y global.

### ¿Los trece de Aumenta deben ver más módulos? · `aumenta`

Ver la tarea de P1: no sabemos si su acceso reducido es lo que el centro quiere.
Nadie de fuera puede responder esto.

*Comprobado en producción*: 09/08/2026 — 13 usuarios con acceso recortado.

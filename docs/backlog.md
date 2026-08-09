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

### Botones que llevan a un módulo que el cliente no ha comprado · `quality_energy`, `abarcaia`, `healim`, `nutri_laura`

Tres sitios pintan una entrada sin mirar si el cliente tiene el módulo al que
lleva, y la página de destino es un componente de cliente sin `notFound()`, así
que se monta entera y lo único que llega es la banda roja del endpoint. Se ve el
botón, se pulsa, y no lleva a ninguna parte:

- **«Convertir a cliente»** en el panel del lead — lo ven Quality Energy (129
  leads) y Abarcaia (84), que no tienen Clientes. Es el peor de los tres: está
  en mitad de su trabajo diario.
- **«Sin profesional»**, hijo del menú de Citas, sin ningún módulo exigido —
  Healim, que no tiene Equipo.
- **«Incidencias» y «Bandeja de trabajo»**, las dos tarjetas fijas de «Mi
  espacio», que no comprueban nada — cualquier usuario no admin de una consulta
  sin Clínica, hoy nutri_laura.

Es el mismo patrón las tres veces, y el mismo que ya mordió con los módulos: no
basta con esconderlo del menú.

*Se comprueba*: entrar con esos clientes y que la entrada no exista, o que la
página responda 404 en vez de montarse y enseñar el error.
*Dónde*: `modules/overrides/{nutri-laura,spain-enzymes}/LeadsModule.jsx`,
`components/layout/Sidebar.jsx` (hijo «Sin profesional»),
`components/team/MiEquipo.jsx:182-191`.
*Comprobado en producción*: 09/08/2026 — los cuatro clientes tienen el módulo de
origen y no el de destino.

### Laura ve un bloque de Facturación que no ha comprado · `nutri_laura`

Al abrir la ficha de cualquiera de su equipo sale «Facturación» con *Facturado
0,00 € · Coste salarial 0,00 € · Ticket medio 0,00 €*. No tiene el módulo.

La causa es una condición mal puesta: el endpoint corta con
`!hasModule("team") && !hasModule("billing")` —una **Y** donde debería mirar el
módulo de destino—, así que con Equipo encendido pasa de largo y responde 200.
Y responde con datos, no con error, porque el alta de cliente hace `sync()` de
todos los modelos: las tablas de facturas y gastos existen en todos los schemas
y suman cero. El componente solo se esconde si le llega un 403, que nunca llega.

El vecino de al lado está bien hecho y sirve de patrón: `/api/team/[id]/projects`
sí gatea por el módulo de destino.

*Se comprueba*: con Laura, la ficha de un miembro del equipo no enseña
Facturación.
*Dónde*: `app/api/team/[id]/billing-summary/route.js:15`.
*Comprobado en producción*: 09/08/2026 — nutri_laura tiene `team` y no `billing`.

### Dos clientes no ven un módulo que tienen contratado · `retorika`, `spain_enzymes`

No son usuarios normales: son los **administradores** de su propio CRM, que es
quien tiene que verlo todo. A `admin@retorika.es` le falta `leads` y a
`admin@spain-enzymes.salamandra` le falta `clients`, y los dos módulos están
activos y facturados. Es el fallo de las dos puertas otra vez: el cliente lo
tiene contratado en `tenant_modules` y su `module_access` no lo lista.

Se arregla en un comando por cliente. Lo caro es que nadie lo haya visto: son
módulos por los que pagan y que no pueden abrir.

*Se comprueba*: `docker exec crm-salamandra-app-1 node scripts/check-module-access.js`
no marca ningún ADMIN con ✗.
*Comprobado en producción*: 09/08/2026 — **los dos ✗ siguen ahí**.

### El CRM dice que el banco rechazó un cobro que nunca llegó al banco · todos

`paymentStatus: 'failed'` mezcla dos cosas: que el banco rechazara, y que la
persona no completara el pago a tiempo. La pantalla elige siempre la primera y
dice «El banco rechazó el cobro». Pasó con una clienta de Laura: se le pudo
decir que su banco falló siendo falso. El motivo real ya está guardado en
`cancellationReason`.

*Se comprueba*: una cita caducada sin pago no dice «el banco rechazó».
*Dónde*: `modules/default/CitasModule.jsx:118` y `:1310`.
*Comprobado en producción*: 09/08/2026 — el texto está en el código que se
sirve hoy (`.next/server/chunks/ssr/modules_default_CitasModule_*`).

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

### El motivo de cancelación viaja al cliente sin escapar · todos

Lo que escribe la profesional en «motivo» se mete tal cual en el correo. El
resto de campos sí se escapan. Es jerga interna que se le puede colar a una
familia, y HTML que se puede inyectar.

*Se comprueba*: un motivo con `<b>` llega como texto.
*Dónde*: `lib/email/templates/citas/bookingCancelled.js:68` y `bookingRejected.js`.
*Comprobado en producción*: 09/08/2026 — `${ctx.reason.trim()}` sin escapar en
el `lib/` que corre en el contenedor.

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

### La tabla de tenants de CLAUDE.md no se parece a producción · documentación

No es solo lo de Aumenta. De los ocho clientes de producción, **cinco tienen la
lista de módulos mal y dos no aparecen**:

- `aumenta` — dice 13 módulos; tiene **20**.
- `demo` — dice 8 y que `support` es «solo local»; tiene **21**, `support` incluido.
- `nutri_laura` — dice 7; tiene **8** (le falta `documents`).
- `retorika` — dice training y clients; tiene además **`leads`**.
- `spain_enzymes` — dice leads y analytics; tiene además **`clients`**.
- `healim` — no aparece; existe, con `citas`.
- `salamandra_solutions` — no aparece; existe, con 7 módulos.

Correctos: `abarcaia` y `quality_energy`.

Es la base de lo que se le factura a cada uno, y es de donde salieron dos de las
tareas mal escritas de este mismo fichero. La pantalla `/admin/modulos` ya dice
la verdad; CLAUDE.md debería remitir a ella en vez de repetir la lista.

*Se comprueba*: la tabla de CLAUDE.md y `/admin/modulos` dicen lo mismo, o
CLAUDE.md deja de tener tabla.
*Comprobado en producción*: 09/08/2026 — contra `master.tenant_modules`.

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

### `analytics` no se puede vender · producto

Tiene página y endpoint, pero no está en `lib/provisioning/catalogo.js`, así que
no se puede activar desde el alta ni ofrecer como línea. A Aumenta le serviría:
desde el 01/08 tiene formularios y su embudo empieza en una visita que nadie
mide.

*Se comprueba*: `analytics` aparece en el alta de clientes.
*Comprobado en producción*: 09/08/2026 — cero apariciones en el `catalogo.js`
del contenedor.

### Nada comprueba que un módulo activo tenga sus tablas · producto

Los cuatro chequeos que hay —`check-links`, `check-module-access`,
`check-migration-order`, `comprobar-citas`— miran accesos, registros huérfanos y
el orden de las migraciones. Ninguno mira si las tablas que un módulo necesita
existen en ese schema. Es el fallo que ya mordió: un modelo con columnas nuevas
sin migración es un 500 en producción.

*Se comprueba*: existe un chequeo que lo diga y sale en verde.
*Comprobado en producción*: 09/08/2026 — `ls scripts/ | grep check` no tiene
ninguno que mire tablas.

---

## P3 — deuda

### Dos textos prometen cosas que en ese cliente no pueden pasar · `retorika`, `spain_enzymes`, `quality_energy`, `abarcaia`

Salieron del repaso de integraciones y son cosméticos, pero se leen:

- Al borrar una ficha, un cliente **sin agenda** lee «se borrarán también sus
  documentos y las citas que todavía no han ocurrido». No tiene citas. El texto
  está escrito a pelo en los dos sitios de borrado, sin mirar el módulo.
- En Estadísticas de Leads, el KPI **«Con ficha creada — leads que ya son
  cliente»** se pinta siempre y marca 0 para siempre en quien no tiene Clientes,
  porque ahí ningún lead puede llegar a serlo.

*Se comprueba*: ninguno de los dos aparece en un cliente sin el módulo.
*Comprobado en producción*: 09/08/2026 — retorika y spain_enzymes tienen fichas
sin agenda; quality_energy y abarcaia, leads sin fichas.

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

### La cabecera de Equipo siempre dice «0 inactivos» · todos

Cuenta sobre la página ya filtrada, y el filtro por defecto excluye a los
inactivos. El endpoint devuelve el total bueno y la pantalla lo ignora.

**Hoy no lo ve nadie**: en los diez schemas de producción no hay un solo miembro
de equipo que no esté activo, así que el contador acierta por casualidad. Por eso
baja a P3: es un fallo real que muerde el primer día que alguien dé de baja a
alguien — y ese día será justo cuando se mire el número.

*Se comprueba*: con alguien inactivo, la cabecera no dice 0.
*Dónde*: `app/(dashboard)/equipo/page.jsx:132`.
*Comprobado en producción*: 09/08/2026 — código presente, **0 inactivos en los
10 schemas**.

### `/comercial/leads` es código al que no se llega · producto

Ningún enlace apunta ahí, el único enlace a `/comercial` da 404 y el moduleKey
`sales` no lo tiene ningún cliente de producción. Dentro tiene los textos de una
campaña de Retorika escritos a mano. Se borra.

*Se comprueba*: la carpeta no existe.
*Comprobado en producción*: 09/08/2026 — la página está compilada y servida en
`.next/server/app/(dashboard)/comercial/leads/`, y ningún tenant tiene `sales`.

### Las etiquetas de etapa se contradicen · producto

`modules/leads/LeadsModule.jsx` dice «Cualificado / Ganado / Perdido» donde
`lib/leads/stages.js`, que es la fuente única, dice «En seguimiento / Convertido
/ Descartado». Ese módulo base hoy no lo renderiza nadie —los ocho clientes con
leads tienen override propio—, así que es limpieza.

*Se comprueba*: solo queda un juego de etiquetas.
*Comprobado en producción*: 09/08/2026 — «Cualificado» sigue en el bundle.

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

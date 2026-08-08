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

### Cómo se añade una tarea

Con estos cinco datos y nada más:

- **Qué pasa hoy**, no qué hay que programar. «El aviso de SLA cuenta tickets
  que no se ven» se entiende dentro de seis meses; «arreglar contador» no.
- **De quién es**: el slug del cliente, o «todos» si es del producto.
- **Prioridad** (abajo se explican).
- **Cómo se comprueba que está resuelto.** Sin esto no se puede cerrar sin
  fiarse de alguien.
- **Dónde está**, con fichero y línea si se sabe.

### Cómo se quita

Solo cuando **se ha comprobado contra producción**, no cuando el código está
subido. Se borra la tarea entera; el historial vive en git, no aquí. Si al
comprobarlo resulta que sigue pasando, se queda y se anota qué se intentó.

### Prioridades

| | Qué significa |
| --- | --- |
| **P0** | Está pasando ahora y cuesta dinero, clientes o datos. Se hace hoy. |
| **P1** | Un cliente se lo va a encontrar esta semana, o bloquea algo suyo. |
| **P2** | Mejora clara, sin fecha. |
| **P3** | Deuda o limpieza. Se hace cuando se toque esa zona. |

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

### El cobro con tarjeta no se ha completado nunca · `nutri_laura`

En toda la historia de producción hay **un** intento de pago y ninguno
terminado. El código está probado en local y contra Stripe de pruebas, pero
ninguna tarjeta real ha recorrido el flujo entero. La primera vez que pase será
con una paciente delante.

*Se comprueba*: una reserva de verdad, pagada, que llegue a `paid` y aparezca en
Stripe. Sirve «Prueba 1 euro» (3 €) y luego se cancela.

### «Prueba 1 euro» está a la venta · `nutri_laura`

Tipo de cita activo y visible en la agenda pública, a 3 €, con tráfico entrando
desde Instagram. Cualquiera puede reservarlo.

*Se comprueba*: no aparece en `GET /api/public/c/nutri_laura/event-types`.

---

## P1 — esta semana

### El CRM dice que el banco rechazó un cobro que nunca llegó al banco · todos

`paymentStatus: 'failed'` mezcla dos cosas: que el banco rechazara, y que la
persona no completara el pago a tiempo. La pantalla elige siempre la primera y
dice «El banco rechazó el cobro». Pasó con una clienta de Laura: se le pudo
decir que su banco falló siendo falso. El motivo real ya está guardado en
`cancellationReason`.

*Se comprueba*: una cita caducada sin pago no dice «el banco rechazó».
*Dónde*: `modules/default/CitasModule.jsx:118` y `:1310`.

### «Pedirle otra tarjeta» no lleva a ninguna parte · todos

El aviso recomienda pedir otra tarjeta y el botón se pinta, pero el endpoint
responde 409 porque `failed` cuenta como «ya hay dinero». Si una tarjeta falla
siempre, no hay salida: o reintentar o cancelar.

*Se comprueba*: pulsarlo en una cita `failed` manda el correo en vez de dar 409.
*Dónde*: `app/api/citas/bookings/[id]/pedir-tarjeta/route.js:77-82`.

### El motivo de cancelación viaja al cliente sin escapar · todos

Lo que escribe la profesional en «motivo» se mete tal cual en el correo. El
resto de campos sí se escapan. Es jerga interna que se le puede colar a una
familia, y HTML que se puede inyectar.

*Se comprueba*: un motivo con `<b>` llega como texto.
*Dónde*: `lib/email/templates/citas/bookingCancelled.js:68` y `bookingRejected.js`.

### Once personas de Aumenta no ven módulos que el centro tiene · `aumenta`

Los usuarios normales no tienen acceso a `clients`, `documents`, `formularios`
ni `team`, entre otros. Puede ser deliberado —trabajan en Pacientes y Clínica—
o puede que nadie se lo diera al ampliar módulos entre el 27/07 y el 01/08.
**Es una decisión de negocio, no un fallo**: hay que preguntarles.

*Se comprueba*: `docker exec crm-salamandra-app-1 node scripts/check-module-access.js`.

### CLAUDE.md dice que Aumenta tiene 13 módulos · documentación

Tiene 20. La cifra es anterior a partir team, documents y clients en
básico/avanzado y a activar formularios y support. Es la base de lo que se le
factura.

*Se comprueba*: la pantalla `/admin/modulos` y CLAUDE.md dicen lo mismo.

---

## P2 — cuando se pueda

### Los contadores del embudo mienten al filtrar · `aumenta`, `nutri_laura`, `sandbox`

El desglose por etapa se calcula sobre las 200 filas traídas, no sobre el total.
Y al pulsar una etapa se reconsulta filtrando, con lo que las demás caen a cero.
En Aumenta hasta el «X en total» de la cabecera se contagia. Está en los tres
overrides: hay que arreglarlo en los tres o subir el conteo al servidor.

*Se comprueba*: filtrar por una etapa no pone las otras a cero.

### La cabecera de Equipo siempre dice «0 inactivos» · todos

Cuenta sobre la página ya filtrada, y el filtro por defecto excluye a los
inactivos. El endpoint devuelve el total bueno y la pantalla lo ignora.

*Se comprueba*: con alguien inactivo, la cabecera no dice 0.

### Una receta corregida no llega a quien ya tiene la pauta · `nutri_laura`

Al asignarla se congelan nombre e ingredientes, pero los pasos y la foto se leen
en vivo. Corregir una cantidad mal puesta NO le llega a quien ya la tiene —ni
con «Re-aplicar menú origen», que recopia las copias viejas— y reescribir los
pasos sí le cambia pautas de hace meses. Es una decisión de producto: o se
congela todo, o se lee todo en vivo, o hay un botón que propague de verdad.

### Módulo de fichaje · `aumenta`

Lo pidieron por WhatsApp: «que vuelquen el excel de cada mes». No sabemos las
columnas, ni de qué máquina sale, ni si un mes se puede volcar dos veces. Un
fichaje mal importado es una nómina mal pagada. El plan y las preguntas que hay
que hacerles están en `docs/revision-aumenta-2026-08.md`.

### `analytics` no se puede vender · producto

Tiene página y endpoint, pero no está en `lib/provisioning/catalogo.js`, así que
no se puede activar desde el alta ni ofrecer como línea. A Aumenta le serviría:
desde el 01/08 tiene formularios y su embudo empieza en una visita que nadie
mide.

### Nada comprueba que un módulo activo tenga sus tablas · producto

Los cuatro chequeos que hay miran accesos, registros huérfanos y el orden de las
migraciones. Ninguno mira si las tablas que un módulo necesita existen en ese
schema. Es el fallo que ya mordió: un modelo con columnas nuevas sin migración
es un 500 en producción.

---

## P3 — deuda

### `/comercial/leads` es código al que no se llega · producto

Ningún enlace apunta ahí, el único enlace a `/comercial` da 404 y el moduleKey
`sales` solo lo siembra el tenant de pruebas. Dentro tiene los textos de una
campaña de Retorika escritos a mano. Se borra.

### Las etiquetas de etapa se contradicen · producto

`modules/leads/LeadsModule.jsx` dice «Cualificado / Ganado / Perdido» donde
`lib/leads/stages.js`, que es la fuente única, dice «En seguimiento / Convertido
/ Descartado». Ese módulo base hoy no lo renderiza nadie, así que es limpieza.

### El secreto del webhook de formación tiene 31 caracteres · `nutri_laura`

No es longitud de nada generado al azar: parece escrito a mano. Funciona, pero
conviene cambiarlo por 32 bytes aleatorios como los demás. Hay que coordinarlo
con el `wp-config.php` de su web.

### Aumenta tiene módulos encendidos que no usa · `aumenta`

`inventory`, `orders` y `projects` se activaron en bloque para sembrar datos de
escaparate; los datos se borraron y los módulos se quedaron. Ya no ensucian la
portada —los bloques vacíos no se pintan— pero siguen en su menú. Si no los
usan, apagarlos.

### El SSO no admite rotar sin corte · producto

`WIDGET_SSO_SECRETS` guarda un secreto por cliente, así que rotarlo obliga a
coordinar el CRM y WordPress al segundo. Aceptando una lista, se pondría el
nuevo al lado del viejo, se cambiaría WordPress con calma y se quitaría el viejo
después. Es pequeño y evita un corte.

*Dónde*: `lib/citas/ssoToken.js:23-48`.

---

## Pendiente de una decisión suya

Cosas que no se pueden hacer sin que Jorge o Rodrigo elijan.

- **¿La agenda de Aumenta se abre al público?** Hoy la reserva por internet está
  cerrada: el portal les deja ver sus citas pero no pedirlas. Si esperaban poder
  reservar desde la web, hay que abrirlo.
- **¿Una primera visita puede comprar el bono de 360 €?** Hoy sí, y una clienta
  llegó a la página de pago, vio el importe y se fue. Si toda primera sesión debe
  pasar por la valoración inicial, hay un interruptor para eso.
- **¿Se apaga la puerta global del formulario en `nutri_laura`?** Con ella
  encendida, un paciente de siempre que quiere una revisión también pasa por la
  bandeja. El bloque 5 ya permite exigirlo solo en la primera visita.

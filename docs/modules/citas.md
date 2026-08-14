# Módulo Citas

## Resumen

Módulo de agendamiento de citas con calendario, tipos de cita (EventType),
bloques de disponibilidad (Availability) y reservas (Booking). Tiene una
landing pública embebible (`/widget/c/[tenantSlug]`) que crea reservas
sin auth + endpoints admin bajo `/api/citas/*`.

Tenants que lo usan hoy: `nutri_laura` (única con flujo activo en
producción tras Fase 1).

---

## Puerta de identidad: sin cuenta no se reserva (2026-08-05)

La primera de las cuatro puertas, porque es la más básica: antes de preguntar si
esta persona está admitida o si ha firmado, hay que saber **quién es**.

⚠️ **La que había era MENTIRA.** Existía `settings.widget.auth.required` desde
hacía meses: el widget pedía `?wpa=1` en la URL y, sin él, enseñaba un cartel de
«inicia sesión». Pero ese parámetro lo pone quien abre la URL —se saltaba
escribiéndolo a mano— y, sobre todo, **el servidor no lo miraba en ningún
sitio**: un POST a `/book` creaba la cita sin sesión de ninguna clase. La página
`/citas/` de WordPress sí exigía login, pero el widget del CRM es una URL
pública, así que cualquiera que la conociera reservaba.

Ahora `lib/citas/puertaIdentidad.js` decide y `/book` **corta**. Lo único que
cuenta como identificarse es una **sesión de portal verificada**: WordPress firma
un token con el correo de quien ha iniciado sesión (`?wpsso=`, TTL 5 min) y el
CRM lo canjea por su propia sesión. Es lo único que no se puede fabricar desde el
navegador, y el correo va firmado dentro, así que tampoco se puede reservar en
nombre de otra.

| Ajuste | Dónde | Por defecto |
| --- | --- | --- |
| `settings.citas.identidadObligatoria` | Configuración → Citas | `false` |
| `settings.widget.auth.required` (legado) | — | `false` |

Los dos encienden la puerta. El viejo se respeta porque alguien pudo encenderlo
esperando que sirviera de algo; cuando esto se escribió no lo tenía nadie
(comprobado en producción).

⚠️ **La VALORACIÓN INICIAL no se salta esta puerta.** Se salta la de CONTRATOS,
que es otra cosa —a la primera visita se entra sin firmar porque todavía no ha
decidido empezar—, pero cuenta tiene que tener: sin ella la cita nace huérfana,
sin ficha a la que enlazarse, y hay que adivinar de quién es.

⚠️ **Apagada por defecto**, como sus hermanas: un centro que reparta el enlace de
su agenda por WhatsApp sin área privada montada se quedaría sin poder dar una
sola cita.

⚠️ **Antes de encenderla en un cliente**, comprobar que su WordPress pasa el
`wpsso` al iframe de reservas (lo hace `crm_render_iframe` del snippet) y que el
CRM tiene `CITAS_PORTAL_SESSION_SECRET`. Sin cualquiera de las dos, nadie podrá
reservar.

### El día que se encendió bloqueó a las pacientes buenas (05/08/2026)

Se encendió en tunutrilaura y Laura, con su sesión iniciada, se topó con el
cartel de «inicia sesión para reservar». No fallaba la puerta nueva: fallaba que
al encenderla **se activaban DOS filtros a la vez** y el viejo sobraba.

- El del servidor (`/book`) miraba la **sesión de portal**. Correcto.
- El del navegador (`useWidgetAuth`) miraba **solo `?wpa=1`**, el parámetro que
  el WordPress añade al montar el iframe. Ignoraba por completo la sesión — que
  la web sí estaba pasando— y por eso cortaba a quien estaba dentro de su cuenta.

Arreglado: `useWidgetAuth` recibe ahora la sesión del portal y **es esa la que
manda**. Mientras se canjea el token la pantalla espera (`ready:false`) en vez
de enseñar el cartel un instante. `?wpa=1` se conserva solo como apaño de
pantalla para webs que lo pasen sin pasar la sesión, y ya no prueba nada: quien
llegue solo con eso verá el formulario y se llevará el corte en el servidor.

**La lección, que aplica a cualquier puerta nueva:** cuando un filtro vive en
dos capas, las dos tienen que mirar LO MISMO. Si la de pantalla mira una señal
más débil, corta de más; si mira una más fuerte, promete de más.

⚠️ **A vigilar en navegadores estrictos.** La sesión se guarda en
`sessionStorage`, y el widget va en un iframe de otro dominio: Safari y las
versiones de Chrome sin cookies de terceros pueden bloquear ese almacenamiento.
Con la puerta encendida, ahí la paciente no podría reservar. No se ha visto
todavía —el portal se usa a diario—, pero es lo primero que hay que mirar si
alguien dice que no puede reservar «solo en el móvil» o «solo en Safari».

Fijado en `_smoke-puerta-identidad.mjs`.

---

## Puerta de admisión: quién puede reservar (2026-08-03)

La agenda pública no miraba la bandeja de solicitudes: **cualquiera con el
enlace del widget reservaba**, hubiera pasado o no por el formulario de primer
contacto. Con retención de tarjeta de por medio es peor, porque se le bloquea
dinero a alguien a quien la profesional no ha admitido.

`lib/citas/puertaFormulario.js` decide, y lo comparten `/book` (que corta) y
`/info` (que lo anuncia por delante, para que nadie rellene la reserva entera
para nada).

| Ajuste | Dónde | Por defecto |
| --- | --- | --- |
| `settings.citas.formularioObligatorio` | Configuración → Citas | `false` |
| `settings.citas.formularioUrl` | ídem (el formulario vive en la web del cliente) | — |

Reglas, decididas por el usuario: se aplica **a todos** —también a quien ya era
paciente, que está avisado— y **a todos los tipos de cita**. No es una puerta
cerrada: se enseña el aviso con el enlace.

Estados que devuelve `estadoDeAdmision`: `profesional` y `aceptada` (pasan),
`pendiente`, `descartada`, `descartada_final`, `sin_ficha`, `sin_enviar` y
`sin_bandeja`. **Quién pasa se pregunta con `admitido(estado)`**, no comparando
a mano: son dos estados desde el 12/08 y tres copias de esa condición es como se
llega a que el portal diga que sí y `/book` responda 403.

⚠️ **Los profesionales están exentos** (12/08/2026, Rodrigo). «Una persona
registrada como profesional no tiene que hacer el formulario, con haber hecho su
formulario profesional le vale. Un paciente que entra por el formulario
comercial sí que tiene que hacerlo sí o sí.» Son dos formularios distintos y
hasta entonces solo se miraba uno: quien viene marcado como `profesional_salud`
llegó por el formulario de profesionales de la web, que NO cae en la bandeja del
módulo Formularios, así que la puerta le pedía uno que no le toca. La excepción
se cuelga de la MARCA de la ficha —la misma llave que abre los tipos de cita de
profesionales— y vale para las DOS puertas, la global y la de la valoración
inicial. Si la marca no se puede leer, se responde que no y la persona cae en la
puerta normal: un fallo de lectura no abre nunca. Fijado en
`_smoke-puerta-profesional.mjs`.
Detalles que se rompen solos y por eso están fijados en
`_smoke-puerta-formulario.mjs`, `_smoke-paciente-borrado.mjs` y
`_smoke-puerta-descartada.mjs`:

- **Una aceptada manda sobre el resto.** Quien fue admitido y luego manda otra
  solicitud no vuelve a la cola.
- **Pero no sobre un descarte POSTERIOR** (12/08/2026). Tomado al pie de la
  letra, «manda la aceptada» hacía que descartar a alguien no surtiera efecto si
  en su día se le había admitido: la fila descartada se quedaba debajo de una
  aceptada más vieja. Lo enseñó una solicitud real de nutri_laura, admitida el
  03/08 y descartada el 05/08, que la puerta seguía dando por admitida — ahí no
  se notó porque además le faltaba la ficha, pero **con ficha habría podido
  reservar después de que la descartaran**. Manda la decisión MÁS RECIENTE, no
  el mejor resultado. Solo se aplica cuando las dos fechas se pueden comparar:
  es una regla que CIERRA, y sobre una fila vieja sin fechar echaría a un
  paciente de verdad por un dato que no tenemos.
- **Tres reenvíos y se cierra** (`RECHAZOS_ANTES_DE_CERRAR`, 12/08/2026).
  Descartar no es una puerta cerrada —el primer formulario puede estar mal
  rellenado, y las circunstancias cambian— pero a la cuarta, devolverle el mismo
  enlace es mandarle a una noria. Al tercer descarte pasa a `descartada_final`:
  pantalla que corta, con «Has alcanzado el número máximo de formularios», el
  correo del centro y un botón de volver a la web. Sin enlace al formulario.
  ⚠️ **El tope se comprueba también en el POST del formulario público**
  (`/api/public/c/[tenantSlug]/formularios/[formSlug]`), no solo en la pantalla:
  el formulario vive en el WordPress del cliente y se manda sin pasar por el
  portal, así que sin ese corte el contador seguiría subiendo y el «has
  alcanzado el máximo» sería mentira. Una solicitud PENDIENTE manda sobre el
  tope: es justo el reenvío que se le está permitiendo.
- **El correo de contacto sale solo del tenant** (`emailDeContacto`:
  `resendReplyTo` → `resendFromEmail`), sin el respaldo por variable de entorno
  que usa `getTenantResendConfig` — ese respaldo es NUESTRA dirección de
  Outreach, y mandar a una paciente de Laura a escribirnos sería peor que no
  darle ninguna. El botón «Volver a la web» sale del ORIGEN de las direcciones
  ya configuradas en Citas (`urlDeLaWeb`), para no pedir un ajuste nuevo.
- **Pero hace falta FICHA, no solo solicitud** (06/08/2026, Rodrigo: «si elimino
  a un paciente, debería volver al paso cero»). La solicitud aceptada sobrevive
  al borrado de la ficha, así que quien acababa de ser dado de baja seguía
  entrando a su área privada y pidiendo cita. Aceptar SIEMPRE
  crea ficha (lo garantiza `PATCH /api/formularios/[id]`, que prohíbe devolver
  una aceptada a pendiente por ese mismo motivo), así que «aceptada sin ficha»
  solo puede significar que la borraron: se devuelve `sin_ficha`, que enseña el
  mensaje de primera visita con el enlace al formulario. La comprobación solo
  DEGRADA el `aceptada`; si hay una solicitud nueva esperando, manda esa
  (`pendiente`). Al borrar la ficha, `contract_signatures` cae con ella
  (CASCADE), así que si vuelve, vuelve a firmar.
- **La ficha se busca por DOS caminos, no solo por el correo** (12/08/2026).
  Buscarla solo por correo dejaba fuera a gente que sí la tenía: al aceptar no
  siempre se crea una ficha nueva —`buscarClienteExistente` reutiliza la que ya
  haya, y la busca por correo **o por teléfono**—, así que una familia que ya
  estaba en el CRM con otra dirección quedaba enlazada a una solicitud cuyo
  correo no es el de su ficha. Era paciente, tenía ficha, había recibido el «ya
  puedes pedir cita»… y la agenda le respondía 403. El segundo camino es
  `form_submissions.client_id`, el enlace que escribió la propia aceptación.
  ⚠️ Se resuelve con un `findByPk`, no mirando si la columna trae algo: **esa
  columna no tiene FK** (comprobado en el schema: las únicas de la tabla son
  `form_id` y `handled_by_team_id`), así que borrar una ficha no la pone a NULL,
  deja el id colgando. Al buscarla, una ficha borrada devuelve `null` y la
  persona vuelve al paso cero — el punto anterior sigue intacto.
- **Un `sin_ficha` avisa a los admin** (12/08/2026, `lib/citas/avisoAdmisionRota.js`).
  Es una contradicción —la profesional dijo que sí y la agenda dice que no— y
  hasta ahora pasaba en silencio por los dos lados: la persona veía un aviso que
  la mandaba a rellenar el formulario que ya había rellenado, y en el CRM no
  quedaba rastro. Solo `sin_ficha`: los demás estados son la puerta funcionando.
  Salta desde `/book` y desde `/citas-portal/admision` (que es donde antes se
  detecta, porque el portal lo pregunta al entrar). Va **deduplicado contra la
  solicitud**, no contra el intento: se dispara desde una agenda anónima, y sin
  eso cinco reintentos serían cinco avisos.
- **El correo se cruza con `iLike`**: nadie escribe su email dos veces igual.
- **A un anónimo no se le dice si un correo está pendiente o no existe.** Sería
  un buscador de pacientes de la consulta. La diferencia solo se cuenta a quien
  llega con sesión verificada del portal.
- **Tener el módulo no garantiza tener la tabla** (en local `nutri_laura` tenía
  `formularios` sin `form_submissions`). Si no se puede consultar la bandeja se
  cierra, no se abre, y lo canta `scripts/comprobar-citas.js`.
- El enlace viaja en el **cuerpo** de la respuesta, no en `details`, que
  `apiResponse.error()` borra en producción. Para eso está `errorConDatos`.

⚠️ Con la puerta encendida en local, **todas las demás smokes de citas fallan a
la vez**: reservan con correos de prueba que nunca han pasado por el formulario.

---

## Puerta de contratos y valoración inicial (2026-08-04)

Hermana de la de arriba, pero mira otra cosa: aquella pregunta «¿te admito como
paciente?» y esta «¿has firmado lo que hay que firmar?». Nace de que el orden
que quiere la consulta es **firmar → pedir cita → pagar**, y no se comprobaba en
ningún sitio: el contrato tapaba el PORTAL, pero la agenda pública iba por otra
puerta y estaba abierta. Cualquiera con el enlace elegía hora y dejaba la
tarjeta retenida sin haber firmado nada.

`lib/citas/puertaContrato.js` decide; la aplica `/book` antes de mirar huecos.
Apagada por defecto (`settings.citas.contratoObligatorio`), se enciende en
Configuración → Citas.

**La VALORACIÓN INICIAL se la salta.** Es el tipo de cita marcado con
`event_types.is_initial_assessment` (casilla en Citas → Tipos de cita; índice
único parcial en BD para que solo haya una). Sin esa excepción la puerta sería
un muro: para firmar hay que ser ya paciente. El nombre «Valoración inicial»
NO está escrito en el código — cada centro llama a su primera visita como
quiere, y un rótulo que alguien renombre un martes no puede decidir quién se
salta un contrato.

⚠️ **Ante un fallo al comprobar (tabla ausente, BD caída) esta puerta ABRE**, al
revés que la de admisión. Aquella impide que entre gente sin admitir; esta solo
ordena el papeleo de quien ya es paciente, y dejar a la consulta sin poder dar
citas por un fallo técnico es mucho peor que una firma que llega tarde. Quien
firmó **en papel** cuenta como firmado.

⚠️ **El orden de encendido importa**: marcar primero la valoración inicial y
encender la puerta después. Al revés, nadie nuevo puede reservar nada.

Fijado en `_smoke-puerta-contrato.mjs` (interruptor, excepción, quién pasa y el
texto del aviso).

---

## Pago a plazos: lo cobra Stripe, no una financiera (2026-08-05)

Antes, «pagar a plazos» era **Klarna**: adelantaba el dinero, financiaba a la
paciente y se llevaba su comisión. Es justo el intermediario que se quería
quitar. Ahora es una **suscripción de Stripe** de N cargos mensuales que se
cancela sola.

```
/book  →  Checkout (mode: subscription)  →  1ª cuota cobrada + tarjeta guardada
       →  webhook checkout.session.completed  →  nace el bono ENTERO
                                             →  se le pone tope al plan
       →  webhook invoice.paid (×N-1)        →  se apunta cada cuota
```

**El bono nace entero con la primera cuota**: da derecho a sus N sesiones desde
el primer día, no se van liberando. Es una decisión de negocio, no un descuido —
si la paciente deja de pagar, hay una conversación que tener, no unas sesiones
que retirarle automáticamente.

⚠️ **`amount` es lo que se cobra HOY, no el total.** En un fraccionado es la
PRIMERA CUOTA (130 €); el compromiso total (390 €) va en `total` y, en el bono,
en `session_packs.amount`. Con Klarna eran lo mismo y por eso el campo se leía
sin pensar. Confundirlos ahora es cobrarle 390 € de una vez a quien pidió pagar
a plazos. Fijado en `_smoke-fraccionado.mjs`.

⚠️ **El fraccionado va SOLO con tarjeta.** Es lo único domiciliable: ni Bizum ni
las transferencias admiten cargos recurrentes, y ofrecerlos sería prometer una
domiciliación imposible.

### El tope de cuotas, y por qué hay dos cerrojos

`lib/payments/fraccionado.js`. Checkout no sabe de topes: crea una suscripción
que renovaría **para siempre**. El tope se pone al confirmarse el primer pago,
colgándole un `subscription_schedule` con `end_behavior: 'cancel'` y una segunda
fase de N-1 iteraciones (la primera ya se cobró).

⚠️ **No se crea el calendario directamente**, que sería más limpio: la primera
factura de un schedule **no se finaliza al momento** —nace en borrador y Stripe
la cierra ~1 h después—, así que la paciente terminaría de reservar sin que
nadie sepa en una hora si ha pagado, con el hueco ya soltado.

Cobrar de más es el fallo catastrófico aquí, así que hay **dos frenos
independientes**:

| Freno | Dónde vive | Para qué |
| --- | --- | --- |
| El calendario | En Stripe | Aunque el CRM esté caído un mes, deja de cobrar en la cuota N |
| El recuento | `frenarSiYaEstaPagado`, en cada `invoice.paid` | Si el calendario no llegó a crearse (la llamada falló), cuenta las facturas pagadas y cancela al llegar al total |

El segundo existe porque el primero se pone en una llamada de red que puede
fallar. Sin él, un fallo de 200 ms deja a alguien pagando 130 €/mes sin fin.

### ⚠️ Al desplegar: los eventos nuevos hay que darlos de alta en Stripe

El webhook escucha ahora `invoice.paid` e `invoice.payment_failed`. Si el
endpoint del tenant está configurado con una lista explícita de eventos (y no
con «todos»), **esos dos no llegarán** y las cuotas 2ª en adelante se cobrarán
sin que el CRM se entere: el dinero entra, pero no se apunta y el cerrojo de
seguridad nunca corre. Hay que añadirlos en el panel de Stripe del cliente.

Una cuota rechazada **no toca el bono**: Stripe reintenta él solo y quitarle las
sesiones a alguien por una tarjeta caducada sería tratar un problema de banco
como un impago. Queda el rastro en `PaymentSession.metadata` y un aviso en el
log.

---

## Tipos de cita ocultos y asignados a dedo (2026-08-05)

Nace de los cobros que **no pasan por la pasarela**: transferencia desde el
extranjero, Bizum a un móvil, PayPal. Ese trato se cierra por WhatsApp —Bizum va
a un teléfono y la transferencia a una cuenta, mientras que la pasarela ingresa
en Stripe— y la cita entra en el sistema **como gratuita**, porque el dinero ya
está cobrado. Sin nada más, esa persona tenía que pedir hora por WhatsApp cada
vez, para siempre.

Dos piezas, en `lib/citas/tiposVisibles.js`:

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| `event_types.is_hidden` | Citas → Tipos de cita | El tipo no sale en la agenda pública **para nadie** |
| Bono dado a mano | Ficha de la paciente → Bonos | Le abre ese tipo a ELLA, con su contador |

Quien tiene un bono activo de un tipo oculto lo ve en el widget (marcado «tu
programa»), ve su contador («3 de 6») y **reserva sola**. Nadie más lo ve. Se le
puede dar a cien personas si hace falta, pero siempre una a una.

**No se usa `active: false` para esto**: un tipo desactivado no lo reserva nadie,
tampoco la persona a la que sí le corresponde.

⚠️ **El filtro del listado NO es la seguridad.** `GET /event-types` solo quita la
tentación; el `eventTypeId` viaja en el cuerpo de `/book` y cualquiera puede
mandarlo. La comprobación que cierra la puerta es `puedeReservar()` dentro de
`/book`, y es la que hay que tocar si algún día cambia la regla. Los dos motivos
de rechazo dicen lo MISMO a propósito («no está disponible»): distinguir «existe
pero no es para ti» de «no existe» convertiría el endpoint en un buscador.

⚠️ **La lista depende de quién mira, así que el widget espera al SSO.** El
endpoint acepta `Authorization: Bearer` (sesión del portal) de forma OPCIONAL y
solo entonces añade los ocultos con bono; sin cabecera responde lo de siempre.
Un bearer caducado se trata como anónimo en vez de devolver 401 — es la agenda
pública y no puede caerse porque a alguien se le pase la sesión. En el widget,
la carga de tipos espera a que `useCitasPortalSession` termine: pedirlos antes
devolvía la lista de una anónima y la paciente no veía su programa hasta
recargar.

⚠️ **Un bono agotado deja de destapar el tipo.** Quien gastó sus 6 sesiones
vuelve a no ver nada hasta que le den otro bono. Es lo que impide que un acuerdo
de 6 sesiones se convierta en barra libre.

### Dar un bono a mano

`POST /api/citas/packs` (solo admin). Era la pieza que faltaba: hasta hoy un
bono **solo** podía nacer del webhook de Stripe.

⚠️ **La pantalla es de TODOS desde el 13/08/2026** (Rodrigo: «todo el mundo
tiene bonos, solo tienen que ponerlos»). La sección «Bonos de sesiones» vivía
dentro de `modules/overrides/nutri-laura/ClientDetailModule.jsx`, así que la
ficha de Laura era el ÚNICO sitio del CRM donde se podía dar uno: el resto de
centros con `citas` tenían la tabla, el endpoint y el descuento de sesiones, y
ningún botón con el que estrenarlo. Ahora es
`components/clients/ClientBonosSection.jsx`, la comparten las dos fichas y sale
en cualquier cliente con `citas` (en la ficha por defecto, dentro de la pestaña
**Citas**). Dos cosas que decide la propia sección:

- **No se pinta si el centro no tiene Citas** — 403/404 en `event-types`, mismo
  criterio que `ClientCitasSection`.
- **Dar y quitar son de admin**, igual que el endpoint. Quien no lo sea ve los
  bonos y su cuenta —lo que necesita para atender— pero no los botones: enseñar
  uno que siempre responde 403 es peor que no enseñarlo.

Y una diferencia con lo que había: la tarjeta **se pinta aunque no haya ningún
bono**, porque es donde está el botón de darlo. Antes, sin bonos, no salía nada.

Es la única puerta del CRM que abre derecho a citas sin un cobro detrás que
mirar, así que queda marcado `session_packs.origin = 'manual'` con el nombre de
quien lo creó (`created_by`) y se audita (`citas.pack_manual_created`). Un bono
`online` tiene su pago en Stripe; uno `manual` solo tiene la palabra de quien lo
dio.

El importe es opcional y **no** se valida contra el precio del tipo de cita: un
acuerdo cerrado por WhatsApp puede ser otro, y bloquear el alta por un descuadre
obligaría a mentir en el formulario. Se avisa, no se corta, en dos casos: dar
más de una sesión sobre un tipo que no es pack, y dar un bono de un tipo que
está a la vista de todos.

Los bonos no se borran, se anulan (`PATCH /api/citas/packs/[id]`): las citas ya
dadas conservan su número. `agotado` no se puede poner a mano — lo dice el
recuento de las citas, no una persona.

Desde el 13/08/2026 el bono también se lee desde el alta manual de citas
(`GET /api/citas/packs?clientId=…&email=…`, solo los activos con sesiones
libres): al elegir a la paciente, su bono pone el tipo de cita. Ver «Repaso del
13/08/2026» en la sección de UI.

⚠️ **El bono va atado al CORREO, y ese es el fallo mudo de esta pantalla.** Es
como la identifica el portal. Si el correo de la ficha no es el que ella usa
para entrar en la web, el bono queda creado, se ve en su ficha y **ella no ve
nada** — y eso solo se descubre cuando escribe diciendo que no le sale. El CRM
no puede preguntarle a WordPress si ese correo tiene cuenta, así que se avisa
con lo más cerca que se puede estar: si el correo **no aparece en ninguna cita
ni solicitud previa**, el alta lo dice. Es un aviso, no un corte — dar de alta a
alguien que llegó por Instagram y nunca ha reservado es un caso legítimo, y para
ese está el botón «Crear cuenta en la web» de su ficha (ver
`docs/modules/formularios.md`).

### Tercera puerta: `settings.citas.soloConPago`

Con ella encendida, desde la agenda pública solo se reserva lo que pasa por
caja: **o lo cobra la pasarela ahora, o lo pagó un bono antes**. Las citas
gratuitas de verdad solo las crea el centro a mano desde su agenda.

⚠️ **Apagada por defecto, y tiene que seguir así.** Aumenta tiene 62 tipos de
cita en producción y **ninguno tiene precio** —cobran cuotas mensuales fuera del
CRM—. Encenderla para todo el módulo les dejaría la agenda muerta el día que
enciendan su portal. Mismo patrón que las otras dos puertas: interruptor por
cliente en Configuración → Citas.

Fijado en `_smoke-tipos-ocultos.mjs` (el interruptor, quién ve qué, quién puede
reservar y que los dos rechazos no chiven de más).

Migración: `scripts/migrate-citas-tipos-ocultos.js` (aditiva e idempotente).

---

## Preguntas propias del tipo de cita (2026-08-04)

Se contestan al reservar, DESPUÉS de elegir fecha y hora, y quedan guardadas en
`bookings.form_answers`. Se definen en el propio tipo de cita
(`event_types.form_questions`), con el constructor que hay en Citas → Tipos de
cita.

Cuatro clases y a propósito no hay más (`lib/citas/preguntasCita.js`):
`numero`, `escala` (círculos del 1 al N, 5 por defecto), `corto` y `largo`.
Cada clase que se añada hay que pintarla en el widget, validarla en el servidor
y enseñarla en la ficha.

⚠️ **Esto sustituyó a `event_types.form_id`**, que durante unas horas del mismo
día enganchaba un formulario del módulo Formularios. Obligaba a salir de la
pantalla, crear un formulario entero con su página pública y volver a
engancharlo para acabar preguntando dos cosas — y sin ese módulo contratado no
había forma de pedir un dato al reservar. La columna `form_id` se conserva
vacía y sin uso (no había ni un tipo de cita usándola en producción).

**El enunciado se guarda JUNTO a la respuesta**, no solo su id: si la
profesional reescribe la pregunta el mes que viene, lo que se contestó tiene que
seguir leyéndose como se preguntó entonces. Fijado en
`_smoke-preguntas-cita.mjs`.

---

## La campana avisa de lo que hay que atender (2026-08-05)

A `nutri_laura` le llegaba **una sola cosa** a la campana: las cancelaciones.
Lo que más necesita saber no avisaba de ninguna forma dentro del CRM. Añadidos
tres tipos, con `notifyAdmins` (nuevo en `lib/notifications/notifyUsers.js`,
resuelve los admin del tenant en un sitio en vez de repetir la consulta):

| Tipo | Cuándo | Dónde se dispara |
| --- | --- | --- |
| `cita_solicitada` | entra una solicitud en la lista de espera | `/book` (gratis) y **`entityHooks.js`** (con tarjeta) |
| `formulario_recibido` | llega una solicitud de la web | `formularios/[formSlug]/route.js` |
| `contrato_firmado` | una familia completa el contrato | `citas-portal/contract/sign/route.js` |

Tres decisiones que no son obvias:

- **La cita con tarjeta avisa cuando el dinero queda RETENIDO, no al reservar.**
  Antes de eso es un formulario a medias: avisar en `/book` llenaría la campana
  de gente que se echó atrás al ver el importe.
- **El contrato avisa solo cuando queda COMPLETO.** Con dos tutores o varios
  anexos, un aviso por firma es ruido y hace creer que ya está listo.
- Todo con `dedupe`: **Stripe reintenta los webhooks**.
- Sin respuestas ni motivo de consulta: son datos de salud, y para saber que hay
  algo que revisar no hacen falta.

> ⚠️ **Rodrigo**: esto toca **seis líneas de `lib/payments/entityHooks.js`**,
> dentro del `postCommit` de `citaPagada`, justo al lado del correo de
> «solicitud recibida» que ya se enviaba ahí. Es aditivo y best-effort (un fallo
> de campana no puede tumbar un cobro), pero es tu zona y quería que lo supieras
> antes de que te lo encuentres en un merge. Si prefieres moverlo a otro punto
> del ciclo de pago, adelante: lo único que importa es que sea **el momento en
> que la cita se convierte en solicitud de verdad**, no antes.

**Por qué hacía falta**, aunque el formulario ya avisara por correo: ese aviso
va a `forms.settings.notifyEmails` y sale con la clave de Resend del tenant. En
producción faltaban las dos cosas —el envío llevaba semanas en dry-run— y se
acumularon **seis solicitudes sin que nadie supiera que existían**. La campana
no depende de terceros: si la solicitud se guarda, el aviso aparece.

Fijado en `scripts/_smoke-campana.mjs`: llegan a los admin y solo a ellos, el
`dedupe` aguanta un reintento, nacen sin leer, y si la campana falla no se lleva
por delante la operación.

---

## Decirle algo al cliente: las tres vías (2026-08-03)

El CRM sabía avisar de lo que le pasa a **una cita**, y solo de algunas cosas.
Repaso de qué había y qué falta ya no:

| Qué pasa | Correo | En el portal |
| --- | --- | --- |
| Se **cancela** la cita | ✅ ya existía | ✅ el estado pasa a «Cancelada» |
| Se **mueve** de día u hora | ➕ **nuevo** (`bookingRescheduled`) | ✅ la ficha enseña la fecha nueva |
| Cualquier **aviso** («tráete los análisis») | ➕ **nuevo** (`avisoCliente`) | ➕ **nuevo**: sección «Avisos» |

### El cambio de hora no avisaba a nadie

Era el hueco más silencioso: cancelar sí escribía, cambiar la hora no. La cita
aparecía otro día en el portal y el paciente solo se enteraba si entraba a
mirar. **La gente se presenta el día que le dijeron, no el que pone en una
pantalla que no ha abierto.** El correo enseña las DOS fechas, porque decir solo
la nueva obliga a recordar cuál era la anterior. Admite `motivoCambio` opcional.

### Avisos del centro (`client_notices`)

Para todo lo que no es un cambio de la cita. Un aviso hace dos cosas: **sale por
correo Y queda publicado en el portal**. Lo segundo importa más de lo que
parece — el correo se pierde entre otros cincuenta y el portal sigue ahí en
enero.

- **La clave es el EMAIL, no `clientId`.** Es como identifica el portal (sesión
  SSO de WordPress), igual que `citas-portal/bookings`. Colgarlo de la ficha lo
  haría invisible para quien reserva por la web sin tener ficha, y los
  `client_id` son nullable y a menudo están vacíos.
- **Se guarda aunque el correo no salga.** `emailStatus` registra qué pasó
  (`enviado` / `sin_configurar` / `sin_consentimiento` / `error`) y el panel se
  lo dice a quien lo escribió: «publicado en su área privada, pero NO ha salido
  por email». El aviso vale igual, porque el portal lo enseña.
- **El portal solo devuelve lo suyo**: el `where` va siempre atado al email del
  token, nunca a un id que venga del cliente. Marcar el aviso de otro no hace
  nada aunque se sepa su id, y no se re-marca lo ya leído.
- Respeta las preferencias de comunicación de la familia (`citaPuedeAvisar`).
- Auditado con **resumen**, nunca el texto: lo que se le escribe a un paciente
  puede llevar datos de salud y `master.audit_log` lo comparten todos los
  clientes.

---

## «Guardar y enviar» no puede mentir (2026-08-03)

`sendEmail` devuelve `{ok: true, dryRun: true}` cuando no hay clave de Resend:
no lanza excepción **a propósito**, para que en desarrollo no se caiga media
aplicación por una clave que falta. El efecto secundario es que un
`await sendEmail(...)` a secas parece haber funcionado siempre.

Con eso, el panel decía **«✓ Enlace enviado por email al cliente»** con el buzón
del paciente vacío — y como en producción no hay ninguna clave de Resend
configurada, eso es lo que habría pasado el primer día. El mensaje alternativo
además sugería una causa falsa: «revisa que la cita sea online y no esté
cancelada».

`envioRealizado(resultado, etiqueta)` en `lib/email/resendClient.js` interpreta
la respuesta y devuelve `{salio, motivo}` (`ok` | `sin_configurar` | `error`),
además de dejar una línea en el log cuando no sale. Lo usan los seis envíos de
citas; el del enlace de videollamada devuelve además `emailMotivo` al panel,
que ya distingue entre *falta configurar el correo*, *el cliente no quiere
avisos* y *el envío falló*.

**El enlace se guarda siempre**, salga el correo o no: son dos cosas distintas y
la que importa es que quede en la cita.

---

## La sala fija es opcional (2026-08-03)

`validateModalityFields` exigía `meetUrl` para cualquier tipo de cita con
modalidad online. Contradecía al propio módulo: el modo por defecto —y el
recomendado— es el **manual**, en el que el enlace se crea cuando toca y se pega
en esa cita. Pedir por adelantado una sala permanente que casi nadie tiene solo
conseguía que se escribiera cualquier cosa para poder guardar: así aparecieron
en `nutri_laura` dos enlaces de mentira que habrían llegado a pacientes reales
el día que alguien pasara a modo automático.

**Un campo obligatorio que el sistema después ignora no protege de nada:
fabrica datos falsos.** `location` (presencial) y `phoneNumber` (teléfono)
siguen siendo obligatorios, porque ahí no hay un segundo momento para darlos —
quien reserva presencial necesita saber adónde ir desde ya.

---

## ¿Le funcionan las citas a este cliente? (`scripts/comprobar-citas.js`)

Solo lectura. Que las citas funcionen depende de ocho cosas repartidas entre BD,
ajustes y claves de terceros, y **casi todas fallan en silencio**: sin clave de
Resend el CRM no da error, se pone en dry-run; sin `price` no se pide tarjeta;
con el modo de videollamada en automático y un enlace de ejemplo, el paciente
recibe una sala que no existe. El script pregunta por todo a la vez y dice qué
falta y **quién lo pone** (clave del cliente o cosa nuestra).

```bash
docker exec crm-salamandra-app-1 node scripts/comprobar-citas.js nutri_laura
```

Sin slug recorre todos los tenants activos con el módulo. Devuelve código 1 si
algo falta, así que sirve de comprobación tras cada despliegue que toque citas.

---

## Informe de ocupación y ausencias (2026-07-27)

`/equipo/ocupacion` (hijo adminOnly del grupo Equipo, `moduleKey: citas`):
cuántas citas hubo en el mes, cuántas se atendieron, cuántas se cancelaron y a
cuántas NO SE PRESENTÓ NADIE, por profesional, más el reparto por tipo de cita.
El estado `no_show` existía desde el principio pero no se agregaba en ninguna
pantalla: había que contarlo cita a cita.

- API: `GET /api/citas/informe-ocupacion?periodo=YYYY-MM` (solo admin con rol
  fresco de BD; sin periodo usa el mes en curso EN MADRID, no el del servidor).
- **La tasa de ausencias se calcula sobre las citas que llegaron a su hora**
  (atendidas + no presentadas). Las canceladas con aviso NO cuentan: avisar a
  tiempo es justo lo que se quiere fomentar, penalizarlo sería absurdo.
- Semáforo: verde <8%, ámbar 8-15%, rojo ≥15%.

## Avisos por WhatsApp (01/08/2026)

Además del correo, los avisos de cita pueden salir por WhatsApp desde el número
del propio negocio (Meta Cloud API, BYOK: credenciales y gasto del cliente).

- Interruptor por cliente: `settings.citas.avisosWhatsapp`, **apagado por
  defecto**, en Configuración. Sin las credenciales de Meta no manda nada y la
  tarjeta lo dice.
- Enganchado en tres sitios: «Guardar y enviar» del enlace de videollamada,
  confirmación de la cita y recordatorio de la víspera.
- **Manda lo que haya marcado la familia** (01/08): los avisos de cita, por
  correo Y por WhatsApp, solo salen si la familia aceptó ese canal en su área
  privada — ver `docs/modules/clients.md` → «Comunicaciones». Si desmarca los
  dos, no se le escribe por ninguno.
- Lógica en `lib/citas/avisosWhatsapp.js`; el envío HTTP en
  `lib/whatsapp/whatsappConfig.js`. **Tres condiciones**: credenciales +
  interruptor + que la familia no lo haya denegado (`Patient.consents.whatsapp`).
  Si el consentimiento no se puede comprobar, NO se manda: ante la duda, callar
  sale más barato que escribir a quien dijo que no.
- Nunca lanza: el correo sigue siendo el canal principal y un WhatsApp que falla
  no puede tumbar la cita. El PATCH del enlace devuelve `whatsappEnviado` y
  `whatsappMotivo` para poder explicarlo en pantalla.
- ⚠️ Meta cobra por conversación iniciada por el negocio y, fuera de la ventana
  de 24 h, exige **plantilla aprobada**: los textos planos los rechaza. Hasta
  tener plantillas dadas de alta, esto sirve para responder dentro de esa
  ventana.

## Recordatorio de cita (2026-07-27)

Correo automático la víspera. **Apagado por defecto**: se enciende por cliente
en Configuración (`settings.citas.recordatorios`), porque encenderlo empieza a
mandar correos a pacientes reales.

- Lógica: `lib/citas/recordatorios.js`; plantilla
  `lib/email/templates/citas/bookingReminder.js` (lleva SIEMPRE el enlace de
  cancelación: el objetivo es que quien no pueda venir lo diga a tiempo y el
  hueco se libere).
- Ejecutor: `scripts/enviar-recordatorios.js`, lanzado cada hora por el
  temporizador de systemd `scripts/deploy/crm-recordatorios.timer`. Con
  `--simular` no manda nada y dice a cuántos escribiría.
- Ventana ancha (18-30h antes) para que ninguna cita se escape por el borde
  entre pasadas; `bookings.reminder_sent_at` (migración
  `migrate-booking-reminder`) garantiza UNO por persona.
- Solo citas **confirmadas**, futuras y con email. Las pendientes de confirmar
  no reciben recordatorio (todavía no hay nada que recordar).
- La marca se pone DESPUÉS de enviar: si el correo falla, se reintenta en la
  pasada siguiente en vez de dar por avisada a una persona que no lo está.
- URL pública de los enlaces: `APP_PUBLIC_URL` (por defecto el dominio del CRM).

## Modelos

- `EventType` — tipo de servicio reservable (Primera consulta, Seguimiento,
  etc.) con duración, buffers, modalidades, antelación mínima, etc.
- `Availability` — bloque horario recurrente por día de la semana,
  filtrable por EventType.
- `Booking` — reserva concreta con snapshot de duración/meetUrl,
  `cancellationToken` (UUID público para cancelar desde email),
  `status` ENUM `pending|confirmed|completed|cancelled|no_show`.

Asociaciones: `EventType.hasMany(Booking)`. **`Booking` NO tiene FK a
`Client`** — el cruce con la ficha del paciente es por `clientEmail`
(decisión arquitectónica explícita).

## Estados y transiciones

Diagrama lógico de estados:

```
             [creación: público con autoConfirm=false]
                      ↓
                  ┌────────┐
                  │pending │ ──── confirm() ────► confirmed
                  └────────┘                          │
                      │                               │
                      └──── reject(reason) ───┐       │
                                              ▼       ▼
                                          cancelled   │
                                                      │
                                                      ├─→ completed
                                                      ├─→ no_show
                                                      └─→ cancelled
                  ┌────────┐
                  │confirmed│  ←── [creación: público con autoConfirm=true
                  └────────┘                          o admin manual]
```

Tabla de transiciones permitidas:

| Estado origen | Acción | Estado destino | Endpoint |
|---|---|---|---|
| (creación pública) | flag `autoConfirmPublicBookings=true` (default) | `confirmed` | `POST /api/public/c/[slug]/book` |
| (creación pública) | flag `autoConfirmPublicBookings=false` (nutri_laura) | `pending` | `POST /api/public/c/[slug]/book` |
| (creación admin) | siempre | `confirmed` | `POST /api/citas/bookings` |
| `pending` | confirmar | `confirmed` | `PATCH /api/citas/bookings/[id]/confirm` |
| `pending` | rechazar | `cancelled` | `PATCH /api/citas/bookings/[id]/reject` |
| `confirmed` | marcar realizada | `completed` | `PATCH /api/citas/bookings/[id]` |
| `confirmed` | no asistió | `no_show` | `PATCH /api/citas/bookings/[id]` |
| `confirmed` | cancelar | `cancelled` | `PATCH /api/citas/bookings/[id]` o `DELETE` |
| cualquiera | borrar del todo | (la fila deja de existir) | `DELETE /api/citas/bookings/[id]?hard=true` |
| cualquiera → `pending` | **prohibido** | — | 403 desde PATCH base |

### Por qué no se permite regresión a `pending`

Una cita confirmada/completada/cancelada **NO puede volver a `pending`**.
Razones:

1. El paciente ya recibió `bookingConfirmed` (auto-confirm) o un email de
   estado terminal. Volver a pendiente dispararía emails contradictorios.
2. La lista de espera se entiende como buzón de **solicitudes nuevas**,
   no como "papelera de citas reactivables".
3. Una cancelación dudosa o un cambio de fecha se gestionan con los
   estados existentes (cancelar + crear nueva pending si el paciente
   re-solicita).

El `PATCH /api/citas/bookings/[id]` base devuelve **403** con mensaje
`"Una cita no puede volver al estado pendiente una vez confirmada o procesada."`
si se intenta esa transición.

### `/reject` vs cancelación de cita confirmada

Conceptualmente son operaciones distintas:

- **`/reject`**: Laura mira una solicitud en lista de espera y dice "no
  acepto este caso / no tengo hueco / no encaja". El paciente nunca llegó
  a ser confirmado; recibe email `bookingRejected` ("Sobre tu solicitud
  de cita").
- **Cancelar confirmada**: Laura tenía la cita en agenda y se cae —
  enfermedad, viaje, paciente avisa que no puede. Es PATCH base con
  `{ status: "cancelled" }` o `DELETE`. (Hoy NO dispara email
  automático; pendiente backlog si quieres "tu cita ha sido cancelada"
  como template separado.)

Ambas marcan `status="cancelled"` y rellenan `cancelledAt` +
`cancellationReason`, pero el endpoint y el email asociado distinguen
la intención.

### Cancelación pública por el paciente

Existe `cancellationToken` (UUID por booking) usado por el email
`bookingConfirmed`. La URL `/widget/c/[slug]/cancel/{token}` deja al
paciente cancelar él mismo desde el email sin auth. Endpoint admin
equivalente: `PATCH /api/citas/bookings/[id]` con `{ status: "cancelled" }`.

### Cuando el dinero se pierde: las tres salidas (13/08/2026)

Si al confirmar el cobro no cuaja, la solicitud se queda en la lista de espera
con `paymentStatus` en `void` (la retención caducó) o `failed` (el banco dijo
que no). Desde ahí hay **tres** salidas, y las tres tienen que existir:

| Salida | Qué hace con el dinero |
|---|---|
| Reintentar (Confirmar) | Vuelve a capturar la retención que ya hay |
| **Pedirle otra tarjeta** | Crea una retención NUEVA y le manda el enlace por correo |
| Rechazar | Suelta la retención y cierra la solicitud |

⚠️ **`failed` no significa que el dinero se haya soltado.** Que el banco rechace
la captura no mata el PaymentIntent: puede seguir en `requires_capture` con el
importe bloqueado en la tarjeta. Por eso `failed` está dentro de
`PUEDE_HABER_DINERO` y ahí se queda — la lista es ancha a propósito y sus cuatro
consumidores la quieren así.

**Lo que no puede hacer esa lista es guardar la puerta de «pedirle otra
tarjeta».** Lo hizo hasta el 13/08/2026 y borraba la salida del medio: toda cita
`failed` se topaba con «ya tiene dinero reservado, confírmala para cobrarlo», que
en una tarjeta rechazada es un callejón sin salida. El endpoint tenía incluso
escrito el camino de la tarjeta rechazada, con su palabra propia para el correo
(`motivo = "rechazada"`), y era inalcanzable.

Ahora ese botón usa `estorbaParaPedirOtraTarjeta` (`lib/citas/cobroCita.js`),
que en vez de mirar la lista **le pregunta a Stripe** por la retención vieja
(`leerEstadoAutorizacion`, una lectura que no mueve dinero):

- muerta o cancelada, que es lo normal → crea la nueva y manda el correo;
- **viva** (`requires_capture`) → 409 diciendo que el paciente todavía tiene el
  importe retenido, y que lo suelte antes —rechazando, o confirmando sin cobrar—;
- **no se pudo preguntar** → 409 también. «No lo sé» no es vía libre aquí.

⚠️ **Por qué el CRM no la suelta él solo** (decisión de Rodrigo, 13/08/2026): es
dinero de un paciente y aquí no se mueve sin que lo pida una persona — la misma
política por la que en `reembolsoCita.js` se borró el código de devoluciones
automáticas en vez de dejarlo apagado tras un interruptor. Y si se abriera la
puerta sin soltar antes la vieja, al paciente le quedarían **dos retenciones a la
vez** sobre la misma cita y el CRM perdería el rastro de la primera, porque
`paymentSessionId` se pisa con la nueva.

Los casos de la guarda están en `scripts/_smoke-pedir-otra-tarjeta.mjs` (no toca
red ni base de datos).

**La distinción viva/muerta ya está comprobada** (14/08/2026), y sin necesitar
una cuenta de Stripe: `scripts/_smoke-retencion-viva-o-muerta.mjs` falsea la
LIBRERÍA de Stripe (`_fake-stripe.mjs`, enchufada por `_fake-stripe-loader.mjs`)
y deja intacto todo nuestro camino — `getStripe` monta el cliente con la clave
del tenant, `leerEstadoAutorizacion` interpreta el estado y
`estorbaParaPedirOtraTarjeta` decide. Cubre los cinco desenlaces posibles:

| Lo que contesta Stripe | Qué hace el botón |
|---|---|
| `requires_capture` | 409 — hay importe bloqueado, no se crea otra retención |
| `canceled` | adelante — es para lo que existe el botón |
| `succeeded` | adelante — ya se cobró, no hay nada que duplicar |
| no existe (`resource_missing`) | adelante — clave rotada o cuenta cambiada |
| no contesta | 409 — «no lo sé» no es vía libre |

```bash
node --import ./scripts/_fake-stripe-loader.mjs --env-file=.env.local scripts/_smoke-retencion-viva-o-muerta.mjs
```

Lo que ese smoke NO cubre es la capa HTTP de encima (el 409 del endpoint y el
correo de Resend): para eso hace falta un tenant con claves `sk_test_`, y ahí
manda `_smoke-autorizacion.mjs`.

## Feature flag: `autoConfirmPublicBookings`

Vive en `master.tenant_modules.feature_flags` del módulo `citas`.

- **Ausente o `true`** (default): bookings desde el formulario público
  nacen `confirmed`. El paciente recibe `bookingConfirmed` inmediato.
- **`false`**: bookings nacen `pending`. El paciente recibe
  `bookingReceived` ("hemos recibido tu solicitud"). Laura confirma
  desde la lista de espera y entonces se dispara `bookingConfirmed`.

Hoy solo `nutri_laura` tiene el flag en `false` (script
`scripts/migrate-booking-pending.js` lo aplica como parte de la
migración). Otros tenants conservan el comportamiento histórico.

## Endpoints

### Públicos (sin auth, rate-limited)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/public/c/[tenantSlug]/info` | GET | Metadatos del tenant + branding |
| `/api/public/c/[tenantSlug]/event-types` | GET | Tipos de cita activos |
| `/api/public/c/[tenantSlug]/availability` | GET | Slots disponibles |
| `/api/public/c/[tenantSlug]/book` | POST | Crear booking (lee flag autoConfirm) |
| `/api/public/c/[tenantSlug]/booking/[token]` | GET | Detalle desde token |
| `/api/public/c/[tenantSlug]/cancel/[token]` | POST | Cancelar desde token |

### Portal de la familia (sesión SSO, `Authorization: Bearer`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/public/c/[tenantSlug]/citas-portal/session` | POST | Canjea el `wpsso` de WordPress por sesión del portal |
| `/api/public/c/[tenantSlug]/citas-portal/bookings` | GET | Citas de quien ha entrado |
| `/api/public/c/[tenantSlug]/citas-portal/cancel/[id]` | POST | Cancelar su cita |
| `/api/public/c/[tenantSlug]/citas-portal/documents` | GET/POST | «Mis documentos» (cerrado si falta firmar el contrato) |
| `/api/public/c/[tenantSlug]/citas-portal/documents/[id]` | GET | Descarga de un documento suyo |
| `/api/public/c/[tenantSlug]/citas-portal/contract` | GET | Estado del contrato + la plantilla que toca firmar (ver abajo) |
| `/api/public/c/[tenantSlug]/citas-portal/contract/sign` | POST | Firma: `{ signature }` (simple) o `{ templateKey, datos, aceptaciones, signature }` (estructurado) |
| `/api/public/c/[tenantSlug]/citas-portal/contract/documento` | GET | PDF del contrato, para leerlo antes de firmar |

## Contrato del Centro en el portal (sprint Aumenta 2026-07, 2.1 y 2.2)

Al entrar al portal, lo primero es el contrato: si falta la firma de quien
entra, `ContratoGate.jsx` tapa la pantalla entera.

⚠️ **Desde el 04/08/2026 hay algo ANTES**: `BienvenidaGate.jsx` pregunta «¿A qué
entras hoy?» y ofrece ir a la valoración inicial sin firmar nada. Se salta sola
si el centro no ha marcado ninguna valoración o si esta persona ya la tiene
cogida —próxima o pasada—, así que para casi todo el mundo el contrato sigue
siendo lo primero. Y los datos de la ficha se piden DESPUÉS de firmar, no antes
(solo la fecha de nacimiento va delante: decide si hace falta el consentimiento
del tutor). Hay un «Lo firmo más tarde»
que deja pasar a ver las citas, pero **«Mis documentos» sigue cerrado** —ni
consultar ni subir— hasta que firmen todos (decisión de Rodrigo, 31/07). El
aplazamiento dura lo que la pestaña: al volver a entrar, el contrato vuelve a
salir.

- **Sin Contrato del Centro subido —ni plantilla activa— no se pide nada**: si
  el tenant no tiene documento `contract_template` ni ninguna fila activa en
  `contract_templates`, no hay pantalla ni bloqueo. Cualquiera de las dos cosas
  es la señal de que el centro quiere exigir la firma. (Arreglo del 31/07: sin
  esta condición, el cerrojo se activaba con solo tener el portal encendido y a
  los pacientes de nutri_laura —el único tenant con portal— les apareció una
  pantalla pidiendo firmar un documento que no existe.)
- **Quién firma**: los tutores marcados como firmantes en la ficha
  (`Client.guardians`). Si la ficha no tiene tutores, firma el **titular** —
  `effectiveSigners()` en `lib/clients/clientContract.js`—. Sin ese respaldo,
  «no hay firmantes» dejaría a la familia encerrada en una puerta sin llave.
- **Qué firma**: el contrato estándar del centro
  (`documents.source='contract_template'`). Si el equipo ya subió a la ficha el
  contrato firmado en **papel**, cuenta como firmado y no se pide firma web.
- **Padres separados**: hacen falta las DOS firmas. El que ya firmó ve un aviso
  de que falta el otro, y la documentación sigue cerrada para ambos.
- **Qué se guarda** (`ContractSignature`): imagen PNG de la firma
  (`lib/clients/signatureStorage.js`, fuera del archivo de documentos), nombre
  del firmante en ese momento, fecha, IP y navegador. Índice único
  cliente+tutor: firmar dos veces no duplica nada.
- El cerrojo se aplica también en la **descarga individual** de documentos, no
  solo en el listado: si no, un enlace guardado seguiría abriendo el PDF.
- Lógica compartida en `lib/citas/portalContract.js` (los ficheros de rutas de
  Next solo deben exportar manejadores HTTP).

### Contrato ESTRUCTURADO: datos y anexos (sprint tunutrilaura 2026-08-04)

Lo de arriba es el contrato de Aumenta: un PDF y un garabato, **sin pedir ni un
dato**. El contrato de tunutrilaura pide ocho (nombre, DNI/NIE, domicilio,
correo, teléfono, fecha de nacimiento, localidad y fecha de la firma) y sus tres
anexos dicen literalmente que «se firman de forma independiente al documento
principal». Una sola casilla para todo el paquete no acredita ninguno — y el
Anexo I es el que renuncia a la devolución del importe.

- **Dónde vive el clausulado**: tabla `contract_templates`, **por tenant**. En
  el código no puede estar: el módulo lo comparten Aumenta y Laura, y el
  clausulado de TCA le saldría a Aumenta en su portal. Además cambiar una
  cláusula (la colaboradora del Anexo II, un plazo) no puede exigir un
  despliegue. Se carga con `scripts/seed-contrato-tunutrilaura.js`.
- **Forma**: `fields` (qué se pide: `{key,label,type,required,group}`, tipos
  text/dni/email/tel/date/select/textarea) y `blocks` (qué se lee y se acepta:
  `{id,title,body,acceptLabel}`, uno por documento). El texto se enseña
  desplegable en pantalla y se imprime ENTERO en el PDF firmado: quien firma
  tiene derecho a una copia de lo que aceptó, no de un resumen.
- **Dos documentos encadenados**: `paciente` (contrato + Anexos I, II y III) y
  `parental` (consentimiento del tutor). El segundo lleva `only_minors` y solo
  aparece si la **fecha de nacimiento de la ficha** dice que es menor — no una
  casilla, que se desmarca. Al firmar el primero, la pantalla encadena el
  segundo sin soltar al usuario.

### Los datos van a la FICHA, y antes de firmar (04/08/2026)

El contrato nació pidiendo sus ocho datos DENTRO de la pantalla de firma, y eso
tenía dos consecuencias malas: los datos se quedaban enterrados en la firma —la
ficha seguía con los mismos huecos, la nutricionista no veía el DNI— y la fecha
de nacimiento solo se sabía a MITAD de firmar, así que el consentimiento
parental aparecía cuando ya se había empezado.

Ahora el orden es: **completar datos → contrato → (si es menor) consentimiento
parental**.

- **Cada campo declara dónde vive** en su propiedad `ficha`: `cliente.taxId`,
  `cliente.birthDate`, `cliente.customFields.domicilio`, `tutor.dni`… Sin
  `ficha` = pertenece al acto de firmar (la localidad, la fecha) y no a la
  persona. Se declara en la PLANTILLA y no en una tabla del código porque el
  mismo campo `nombre` es la paciente en el contrato y su tutor en el
  consentimiento parental. Lo interpreta `lib/clients/datosFicha.js`.
- **Solo se rellenan huecos** (Rodrigo, 04/08). Lo que la ficha ya tiene ni se
  pregunta ni se sobrescribe: puede ser una corrección que hizo el centro a
  mano. La pantalla «Completa tus datos» (`DatosGate.jsx` +
  `citas-portal/mis-datos`) enseña ÚNICAMENTE lo que falta; quien tenga la ficha
  completa no la ve nunca.
- **Al firmar, la ficha manda**: el endpoint sobrescribe con los valores de la
  ficha lo que llegue en el cuerpo, porque esos campos ya no se preguntan en
  pantalla. El DNI que se imprime es el de la ficha, no el que alguien teclee en
  la petición.
- **El tutor del consentimiento parental entra en `Client.guardians`** con
  `signer: false`. Lo de `false` NO es un descuido: `effectiveSigners()` da
  prioridad a los tutores marcados como firmantes, así que marcarlo cambiaría
  quién debe firmar —de la titular al tutor—, ninguna firma existente casaría y
  el portal le pediría eternamente que firmara lo que acaba de firmar.
- Campos nuevos en la ficha: `clients.birth_date` (migración
  `migrate-client-birthdate.js`), `taxId` —que ya existía sin usarse— y
  `customFields.domicilio`. Los tres entran en el perfil SALUD de
  `camposCliente()`, así que aparecen también en Aumenta y demo.

⚠️ **`lib/citas/portalClient.js` carga la ficha con una lista de columnas fija**
(`ATRIBUTOS`). Sequelize devuelve `undefined` para lo que no esté, sin error: la
pantalla no se rompe, miente. Ya ha mordido tres veces (`contractDocumentId`,
`communicationPrefs` y ahora `taxId`/`birthDate`/`phone`/`customFields`, que
hacían que «Completa tus datos» volviera a pedir lo recién guardado). **Si una
plantilla apunta a una columna nueva del cliente, hay que añadirla ahí.**
- **Índice único ampliado** a `(client_id, guardian_id, template_key)`: el viejo
  era `(client_id, guardian_id)` y el consentimiento parental chocaba con el
  contrato. `template_key` es NOT NULL con default `'simple'` precisamente para
  eso: en Postgres dos NULL no colisionan y el índice dejaría colar duplicados.
- **Qué se guarda además**: `signer_data` (foto de lo declarado — NO se vuelca
  sobre la ficha, que el centro puede corregir), `acceptances` (id, título y
  hora de CADA documento aceptado) y `document_id` (el PDF generado).
- **El PDF firmado** (`lib/documents/contratoFirmadoPdf.js`, pdfkit + Poppins)
  se archiva en la ficha con `source='contrato_firmado'` y `clientVisible`, y la
  paciente lo tiene en «Mis documentos». **No** se archiva como `'contrato'`:
  ese source significa «firmado en papel» y desactivaría la firma web, con lo
  que firmar el contrato cancelaría el consentimiento parental de detrás.
- **La validación del DNI no bloquea a nadie de fuera**: si el valor tiene forma
  de DNI o NIE se comprueba la letra (ahí están las erratas); si no la tiene
  —pasaporte, documento extranjero— se acepta tal cual.
- Qué documento le toca a quién vive en `lib/clients/contratoFirma.js`
  (`situacionDocumentos`), no en `portalContract.js`: no depende de HTTP ni de
  la sesión, y así se prueba sin levantar el servidor
  (`scripts/_smoke-contrato-estructurado.mjs`).
- Migración: `scripts/migrate-contrato-estructurado.js`.

## Bloqueo mensual por impago (sprint Aumenta 2026-07, 2.3)

`settings.citas.portalBloqueoImpago`, **apagado por defecto** (interruptor en
Configuración). Con él encendido, la familia ve los documentos de un mes solo
si consta el cobro de ese mes:

- Mes abierto = existe un `Payment` **completado** con `periodMonth` de ese mes
  para esa familia, **o** el mes está en `Client.portalUnlockedMonths` (abierto
  a mano desde la ficha: becas, acuerdos de pago, cobros que entraron fuera del
  CRM). Regla única en `lib/citas/portalMeses.js`.
- **Nunca** se bloquea lo que subió la propia familia (`uploadedByClient`):
  retenerle sus analíticas por un recibo no es palanca de cobro.
- El portal **dice** qué meses tiene retenidos y cuántos documentos hay en cada
  uno; no los esconde en silencio. Nombres de fichero, no: el título de un
  informe clínico ya es información sensible.
- La misma regla se aplica en la descarga individual (un enlace guardado no
  puede saltarse el cerrojo).
- Se gestiona en la ficha del cliente → «Acceso al portal por meses»
  (`GET/PUT /api/clients/[id]/portal-months`, auditado).

⚠️ Encenderlo en un centro que NO registra los cobros con su mes esconde de
golpe la documentación de todas las familias. Por eso está apagado por defecto
y el interruptor lo avisa.

### Admin (JWT + `hasModule(citas)`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/citas/event-types` | GET/POST | Listar / crear EventType |
| `/api/citas/event-types/[id]` | GET/PATCH | CRUD individual |
| `/api/citas/availability` | GET/POST | Listar / crear bloque |
| `/api/citas/availability/[id]` | GET/PATCH/DELETE | CRUD bloque |
| `/api/citas/availability/bulk` | POST | Operación masiva |
| `/api/citas/bookings` | GET | Listar paginado. Filtros: `from`, `to`, `future`, `status`, `eventTypeId`, `clientEmail`, `search` |
| `/api/citas/bookings` | POST | Crear booking manual (default `confirmed`) |
| `/api/citas/bookings/[id]` | GET/PATCH/DELETE | CRUD. PATCH bloquea regresión a `pending`. DELETE cancela; **`?hard=true` la borra de verdad** (ver «Borrar una cita del todo») |
| `/api/citas/bookings/[id]/confirm` | PATCH | Transición `pending → confirmed`. Idempotente. Valida solapamiento. Dispara `bookingConfirmed` |
| `/api/citas/bookings/[id]/reject` | PATCH | Transición `pending → cancelled`. Acepta `cancellationReason` en body. Dispara `bookingRejected` |
| `/api/citas/bookings/calendar` | GET | JSON FullCalendar para la vista mensual |
| `/api/citas/clientes` | GET | A quién se le puede poner una cita (surte al buscador del alta manual). `?q=`, `?limit=`, `?todos=1` |
| `/api/citas/packs` | GET | Los bonos VIVOS de alguien (`?clientId=` y/o `?email=`): activos y con sesiones libres. Lo pide el alta manual para poner el tipo de cita |
| `/api/citas/packs` | POST | Dar un bono a mano (solo admin) |
| `/api/citas/packs/[id]` | PATCH | Anular un bono (no se borra) |
| `/api/citas/blocked-days` | GET / POST / DELETE | Festivos y cierres del centro. POST y DELETE solo admin |
| `/api/citas/bloqueos` | GET / POST / PATCH / DELETE | Bloqueos: tramos en los que alguien no pasa consulta (`team_blocks`). El GET los devuelve TODOS a todo el equipo; escribir es solo sobre los propios salvo dirección |

> **`/api/citas/clientes` ofrece de más antes que dejar la lista vacía.**
> Acota a quien tenga marcado un módulo asistencial (`nutricion` / `clinica`)
> en su ficha, pero se salta el filtro cuando este no distingue nada: si falta
> la tabla `client_module_assignments` (42P01) **o si no hay ni un cliente
> marcado** (12/08/2026). Aumenta tiene 1.083 familias y CERO con la marca
> —allí el paciente es el hijo, que tiene su propia tabla—, así que el buscador
> del alta manual salía vacío con un cartel que sonaba a que faltaba
> configurar algo. `soloPacientes` en la respuesta dice si la lista viene
> acotada o no; hoy solo viene acotada en `nutri_laura`.

## UI

### Default (vanilla)

`modules/default/CitasModule.jsx` — calendario FullCalendar con modal
"Nueva cita manual" + modal detalle con acciones marcar completada / no
asistió / cancelar. Sin tabs ni lista de espera (los otros tenants no
usan `pending` hoy).

#### Repaso del 12/08/2026 (Rodrigo)

Cinco cosas de la pantalla, todas en el módulo por defecto (o sea, para todos
los tenants con `citas`):

| Qué | Dónde | Por qué |
| --- | --- | --- |
| **Sin scroll de página** | El calendario rellena lo que quede (`flex-1 min-h-0` + `height="100%"`) en vez de restar píxeles a ojo (`calc(100vh - 280px)`) | La resta no contaba la fila de ayuda y la pantalla entera se movía. Se quitó además la frase «Doble clic en un hueco para crear una cita…», que era la que sobraba. |
| **Máximo 4 citas por día en la vista de mes** | `dayMaxEvents={4}` | Un martes con doce citas estiraba su fila y encogía las demás. A partir de la cuarta hay «+N más». |
| **Festivos en un modal del CRM** | `components/citas/ModalFestivos.jsx` | Marcar el 24-dic eran hasta cuatro ventanas del navegador seguidas (fecha a mano en DD-MM-AAAA, motivo, `confirm`, `alert`), y para saber qué días estaban cerrados había que ir mes a mes. Ahora se ve la lista de lo cerrado por delante. **Su lista NO es la del calendario**: el calendario solo carga el mes visible, y con esa lista marcar el 24-dic desde agosto lo haría desaparecer al instante. |
| **Profesional obligatorio en el alta manual** | `submitCreate`, solo si `teamMembers.length > 0` | Se podían apuntar citas sin nadie que las atendiera; 1.827 de las 12.030 que importó Aumenta vinieron así y viven en `/citas/sin-profesional`. Un tenant sin módulo `team` no ve el campo y no puede quedarse bloqueado por él. |
| **Buscador en el tipo de cita** | `searchable` **siempre**, sin umbral | Aumenta tiene 57 tipos. Se probó con el umbral del filtro del calendario (`> 8`) y Rodrigo lo descartó el mismo día: quien apunta citas todo el día escribe siempre las primeras letras, y que la caja aparezca o no según el cliente convierte un gesto automático en algo que hay que mirar antes. |

**Los diálogos del navegador se fueron de todo el módulo**, no solo de festivos:
`components/ui/Dialogo.jsx` (`useDialogo` → `confirmar` / `avisar` /
`pedirTexto` / `elegir`) los sustituye devolviendo promesas, así que cada sitio
de llamada sigue siendo una línea. Dos cambios de comportamiento que van con
ello, y son a mejor:

- **«Cancelar» ahora cancela.** Con `window.prompt`, cancelar el motivo del
  cambio de hora cambiaba la hora igual, y cancelar el motivo de cancelación
  cancelaba la cita igual. En una ventana con un botón que pone «Cancelar» eso
  no lo espera nadie. Para seguir sin explicar nada, se acepta con la caja vacía.
- **La falta ya no se pregunta con un sí/no.** Era un `confirm` con «Aceptar =
  justificada · Cancelar = sin justificar» dentro: dos respuestas distintas
  metidas a la fuerza en un sí/no, donde además cancelar marcaba la falta como
  injustificada. Ahora son dos botones con su frase (`elegir`).

#### Repaso del 13/08/2026 (Rodrigo)

Tres cosas del alta manual y del calendario, otra vez en el módulo por defecto y
por tanto para todos los tenants con `citas`.

**1. El orden del formulario: primero QUIÉN, después QUÉ.** Empezaba por el tipo
de cita, que es el campo que más se falla —Aumenta tiene 57— y el único que la
propia persona puede rellenar sola. Ahora el orden es cliente → paciente → tipo
de cita → fecha y hora → contacto. Con la ficha elegida antes, su bono pone el
tipo y su terapeuta pone el profesional; el email y el teléfono se rellenan
solos desde la ficha, así que bajan al hueco donde solo estorban a quien apunta
a alguien que aún no la tiene.

**2. El bono pone el tipo de cita.** «Si tiene un bono asignado, cuando se pone
el paciente directamente el tipo de cita se pone con el bono, así no hay que ir
a buscarlo a la ficha.» Al elegir la ficha se pregunta a
`GET /api/citas/packs?clientId=…&email=…` por sus bonos vivos y:

| Caso | Qué hace |
| --- | --- |
| Un bono con sesiones libres | Pone su tipo y lo dice: «Tipo puesto por su bono «X»: le quedan 4 de 6» |
| Varios bonos vivos | No adivina: los lista con lo que queda de cada uno y elige la persona |
| Ya había otro tipo elegido | No lo pisa. Avisa de que tiene bono y ofrece «Poner el del bono» |
| La ficha no tiene correo | Pone el del bono, que es el que hace que descuente |
| El correo del bono es OTRO | Avisa en ámbar: la cita se crearía bien y **no descontaría** |

Ese último aviso es el que más vale. El bono va atado al CORREO
(`asignarSesion` lo busca por ahí), así que una cita creada con el correo de
contacto cuando el bono se dio al del portal sale con el tipo correcto y aun así
no gasta sesión. Era el fallo mudo de los bonos y ahora se ve antes de guardar.

Un tenant sin bonos (Aumenta y el resto) no nota nada: el endpoint devuelve la
lista vacía y no se toca ningún campo.

**3. «Eliminar» borra de verdad.** Hacía lo mismo que «Cancelar cita» —la dejaba
en gris en el calendario—, así que una cita apuntada en el día equivocado,
duplicada o de una prueba se quedaba ahí para siempre. Ver la sección de abajo.

#### Borrar una cita del todo (13/08/2026)

`DELETE /api/citas/bookings/[id]?hard=true`. Sin el parámetro sigue cancelando,
que es lo que hacen las otras vías.

Se lleva por delante lo que cuelga de la cita y quedaría apuntando al vacío: su
sesión de cobro (`payment_sessions`), las peticiones de cambio de hora
(`booking_change_requests`, con `booking_id` NOT NULL) y los avisos que nacieron
de ella (`client_notices`). Es el mismo barrido que
`scripts/borrar-citas-por-nombre.js`, y va **sin transacción** a propósito: una
sentencia que falla dentro de una transacción de PostgreSQL la deja abortada, y
aquí hay que tolerar que a un tenant le falte alguna de esas tablas.

Tres decisiones que conviene no deshacer sin pensarlo:

- **Una cita con dinero NO se borra.** Si tiene un cobro `paid`, `authorized`
  (retención viva) o `refunded`, responde 409 y lo dice en pantalla: el registro
  del dinero tiene que quedar. Cancelarla sigue estando disponible.
- **No manda ningún correo.** Cancelar avisa al paciente; borrar es limpieza. El
  diálogo lo advierte cuando la cita todavía no ha pasado, y ofrece cancelar
  antes.
- **Puede borrar quien puede cancelar** (`noPuedeTocarla`), no solo admin. Quien
  apunta las citas del día es quien se equivoca al apuntarlas. Queda auditado
  (`citas.booking_deleted`) con quién, cuándo, de quién era la cita y qué se
  llevó por delante: es el ÚNICO rastro que queda, porque la fila ya no está.

⚠️ **Si la cita era la sesión N de un bono, esa sesión vuelve a quedar libre.**
No es un efecto secundario: las sesiones se cuentan desde las citas
(`lib/citas/packs.js`), así que borrar la cita es decir que no se dio. El
diálogo lo avisa antes de borrar.

#### `/citas/bloqueos` — Bloqueos (12/08/2026)

`PanelVacaciones` vivía desde el 06/08 debajo del catálogo de
`/citas/tipos`, porque Rodrigo lo pidió como «un tipo de cita especial».
No lo es —ni por dentro ni por fuera—, y tener las dos cosas apiladas
obligaba a bajar por el catálogo entero para apuntar unas vacaciones.

Ahora es una pantalla propia, y las tres cabeceras del módulo (calendario,
tipos y disponibilidad) llevan el botón **Bloqueos** al lado de «Tipos de
cita» y «Disponibilidad». Desde el 12/08 está **además en el sidebar**, que
es donde la pidió Jorge: una pantalla, dos caminos.

> **Se llama «Bloqueos» en todas partes** (14/08/2026, Rodrigo). El menú
> decía «Vacaciones y ausencias» y el botón «Bloqueos»; eran dos nombres para
> lo mismo. Manda «Bloqueos», que es lo que dicen la cabecera de la pantalla y
> el tramo que se pinta en el calendario. «Vacaciones» sigue siendo el MOTIVO
> por defecto de un bloqueo nuevo, que es otra cosa.

> **Bloqueo ≠ festivo.** El festivo cierra el centro entero un día y se pone
> desde el calendario (`blocked_days`); el bloqueo es de una persona, con hora
> de inicio y de fin (`team_blocks`).

**Quién ve qué, y quién puede qué** (14/08/2026, Rodrigo):

| | Regla |
| --- | --- |
| **Ver** | Todo el equipo ve los de todo el equipo, más los cierres de centro. Sin excepciones ni interruptor. |
| **Poner / editar / quitar** | Cada cual, SOLO los suyos. Dirección, los de cualquiera y los cierres de centro. Lo imponen el POST, el PATCH y el DELETE; el desplegable «Quién» ni siquiera se le enseña a quien no es admin. |
| **En el calendario** | El tramo se rotula `Motivo · Persona` (y `Motivo · Todo el centro` si no tiene persona), para que se sepa de quién es sin abrirlo. |

⚠️ Ver los bloqueos **no** sigue la regla de `lib/citas/visibilidad.js`, y es a
propósito. La agenda compartida existe porque el listado de citas enseña
nombre, email y teléfono del PACIENTE; un bloqueo no tiene paciente. Además, un
bloqueo es la señal de que esa persona NO está, así que a quien le sirve es
justo a los demás. Entre el 10 y el 14/08 sí siguió esa regla y el resultado en
nutri_laura fue que Laura —dirección, y la única otra profesional— no veía
ninguna de las ocho ausencias de Rocío en el calendario mientras esta pantalla
se las listaba todas.

⚠️ Y esto es SOLO lo que se ve: el cálculo de huecos (`lib/citas/ausencias.js`)
lee `team_blocks` por su cuenta y sin filtrar. Lo que una paciente puede
reservar no depende de nada de esta tabla.

### Override nutri_laura

`modules/overrides/nutri-laura/CitasModule.jsx` — dos tabs:

1. **Lista de espera** (tab default si hay pendings):
   - Cards por solicitud con nombre, contacto, servicio, fecha
     propuesta, modalidad y respuesta al formulario.
   - Acciones "Confirmar" (dialog "¿Confirmar cita con {nombre} el
     {fecha}?") y "Rechazar" (textarea opcional para motivo).
   - Tras la acción, la fila desaparece y los emails salen automáticos.
2. **Calendario**: vista FullCalendar simplificada. Modal de detalle
   solo lectura — la edición pasa por el flujo de lista de espera o
   por el detalle base.

Badge contador de pendientes en el tab.

### Citas desde la ficha del paciente

Como complemento al módulo `/citas`, la **tab Citas del detalle de cliente**
(`/clientes/:id` → tab "Citas" en el override nutri_laura) lista los
bookings de ese paciente concreto y permite confirmar/rechazar
inline cualquier `pending`. Cruce por `clientEmail` (Booking no tiene FK
a Client).

Componente: `modules/overrides/nutri-laura/ClientBookingsPanel.jsx`.
Endpoints usados: idénticos a esta página (`GET /api/citas/bookings?clientEmail=`,
`PATCH .../confirm`, `PATCH .../reject`). Detalle del flujo y permisos en
[`docs/modules/clients.md`](./clients.md#override-nutri_laura).

## Integración Google Calendar / Meet — **Fase 2 (no implementado)**

El campo `Booking.meetUrl` es un snapshot del `EventType.meetUrl`
configurado manualmente (URL Meet estática). Para Fase 2 la integración
generará Meet links reales vía Google Calendar API por cita y los
emails llevarán el link dinámico. Variables env placeholder ya
añadidas a `.env.production.example` (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`,
`GOOGLE_TOKEN_ENCRYPTION_KEY`).

## Migraciones aplicadas (sprint Fase 1)

- `scripts/migrate-booking-pending.js`: añade `'pending'` al enum
  `enum_bookings_status` en todos los tenants con módulo citas
  habilitado. Setea `featureFlags.autoConfirmPublicBookings=false` en
  `nutri_laura.citas`. Idempotente.

## Backlog

- Endpoint atómico server-side para confirm/reject (hoy: PATCH +
  sendEmail no transaccional; si Resend cae, el estado cambia pero el
  email no se envía).
- Reintentos persistentes para emails fallidos (apuntar a `email_send_log`
  o n8n cola).
- Email "tu cita ha sido cancelada" cuando se cancela una confirmada
  (hoy solo el reject manda email).
- FK física `Booking.clientId → clients.id` opcional, con merge por
  email al crear bookings desde formulario público (decisión
  arquitectónica pendiente: hoy hay `clientEmail` libre).
- Integración Google Calendar real (Fase 2).

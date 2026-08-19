# Módulo Formularios

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este
> mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién
> tiene el módulo NO se lista aquí** (una lista a mano se queda vieja):
> `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `formularios` · requiere `leads` (y `clients`, según `lib/provisioning/catalogo.js`). En el menú se llama «Leads Comerciales» desde el 01/08/2026 |
| **Reina** | — (el doc solo dice «primer tenant: `nutri_laura`», y `portalUser.js`/`registroWeb.js` nacieron para su WordPress; el formulario de familias de Aumenta llegó el 08/08/2026) |
| **Pantallas** | La bandeja: `/formularios` → `app/(dashboard)/formularios/page.jsx` (`UI_OVERRIDES` vacío a propósito). El padre del grupo, `/leads/estadisticas` (`app/(dashboard)/leads/estadisticas/page.jsx`), le suma su bloque «Bandeja». Públicas: ninguna página en este repo — el formulario lo pinta la web del cliente (WordPress) leyendo la definición del endpoint público de abajo. |
| **Endpoints** | `app/api/formularios/**` — 3 `route.js`: `route.js` (GET bandeja + recuentos), `[id]/route.js` (GET · PATCH descartar/recuperar/anotar · DELETE, solo descartadas), `[id]/accept/route.js` (GET ¿ya hay ficha? · POST aceptar → ficha, paciente y tutor si hay `pacientes`, alta en WordPress fuera de la transacción, auditoría solo con ids). Público: `app/api/public/c/[tenantSlug]/formularios/[formSlug]/route.js` (GET definición · POST solicitud; límite dentro del handler). Desde WordPress, firmados HMAC: `app/api/public/c/[tenantSlug]/registro-web/route.js` (hoy no-op: responde 200 sin crear nada desde el 05/08/2026) y `registro-web/sync/route.js` (puesta al día en lote, sí crea). Comparte `portalUser.js` con `app/api/clients/[id]/portal-user/route.js` (GET ¿tiene cuenta? · POST darle cuenta). |
| **Lógica** | `lib/formularios/`: `fields.js` (el contrato de las preguntas: `TIPOS`, `DESTINOS_FICHA`, `DESTINOS_FAMILIA`, `validarRespuestas`, `formPublico`, `infoAdicional`), `accept.js` (solicitud → ficha: `aceptarSolicitud`, `clienteDesdeSolicitud`, `pacienteDesdeSolicitud`, `buscarClienteExistente`), `antispam.js` (`puntuarSpam` honeypot+tiempo, `buscarDuplicadoReciente`), `portalUser.js` (alta del usuario en WordPress con HMAC de subclave derivada; `resolverUrlWordpress`, `consultarUsuarioPortal`, `crearUsuarioPortal`), `registroWeb.js` (firma del aviso de WordPress, `asegurarSolicitudDeAlta`), `edadDeclarada.js` (¿cuadra la edad del formulario con la fecha de nacimiento?). Fuera: `lib/citas/puertaFormulario.js` (la agenda pública exige solicitud aceptada) y `lib/leads/estadisticas.js` (el bloque de comerciales). |
| **UI** | `modules/formularios/FormulariosModule.jsx` (bandeja, detalle, aceptar o enlazar con ficha existente; 619 líneas) y `components/clients/ClientCuentaWebSection.jsx` («Acceso a la web» en la ficha: ¿tiene cuenta? / darle cuenta). No hay `components/formularios/`. |
| **Modelos** | `Form` → `forms` (`models/tenant/Form.model.js`; las preguntas en `fields` JSONB) y `FormSubmission` → `form_submissions` (`models/tenant/FormSubmission.model.js`; `answers` JSONB con enunciado, `client_id` como candado, `handled_by_team_id`). Asociaciones en `lib/db/tenantDb.js`: `FormSubmission.belongsTo(Form)` y `FormSubmission.belongsTo(TeamMember)`. |
| **Interruptores y parámetros** | Ninguno propio que lea el código. Al aceptar, `applyAutoAssignments` (`lib/clients/moduleAssignments.js`) lee `nutricion.autoAsignarEnAlta` del módulo Nutrición. Los parámetros del módulo van en la fila del formulario, `forms.settings`: `notifyEmails`, `privacyUrl`, `privacyVersion`, `wordpressUrl` (`retentionDays` solo lo escriben los seeds; nadie lo lee). |
| **Pantallas propias** | Ninguna: el mapa `UI_OVERRIDES` de `app/(dashboard)/formularios/page.jsx` está vacío (el módulo pinta las preguntas que traiga cada formulario). |
| **Scripts** | Activar: `node scripts/enable-module.js <slug> formularios` (crea `forms` y `form_submissions`: `migrate-formularios-module.js` y `migrate-formsubmission-team.js`, registradas en `scripts/_module-migrations.js`) y después `grant-module-access.js <slug> formularios`. Seeds de DATOS (nombran tenant): `seed-formulario-nutri-laura.js [slug]`, `seed-formulario-aumenta.js <slug>`. Herramientas: `mover-leads-a-comerciales.js <slug> <form> [--confirm]` (leads de familias → bandeja, idempotente), `backfill-origen-formulario.js [--confirm]` (`customFields.origen` → `origin` en las fichas nacidas de una solicitud; ya lanzado, repetible). |
| **Pruebas** | En `npm test`: `scripts/_smoke-aceptar-solicitud.mjs` (`accept.js` y `fields.js`, sin base) y `_smoke-menor-firma.mjs` (`edadDeclarada.js`); más las de Citas que leen la bandeja con un `FormSubmission` falso (`_smoke-puerta-descartada`, `_smoke-puerta-profesional`, `_smoke-aviso-admision`, `_smoke-paciente-borrado`). Con base de datos: `_smoke-formulario-cita.mjs` (`fields.js` desde un tipo de cita). Con servidor y base: `_smoke-dni-formulario.mjs` (formulario público → aceptar → `Client.taxId`, por HTTP) y `_smoke-puerta-formulario.mjs` (sin solicitud aceptada no hay cita). |
| **Decisiones** | `../decisions/2026-07-23-conexion-cliente-equipo.md` (`form_submissions.handled_by_team_id`) · `../decisions/2026-08-01-leads-dos-origenes-un-grupo.md` |
| **En este doc** | La decisión de fondo: las preguntas son DATOS · No todo formulario de la web es de este módulo · Tablas · Endpoints · Antispam · Aceptar: qué pasa exactamente · Alta en WordPress (`lib/formularios/portalUser.js`) · Puesta en marcha de un tenant |

**moduleKey:** `formularios` · **Estado:** implementado (2026-07-22) ·
**Primer tenant:** `nutri_laura`

Formularios públicos incrustados en la web del cliente cuyas solicitudes caen
en una bandeja del CRM. Al aceptar una solicitud se crea la ficha de cliente
con lo que la persona escribió, y —si el tenant lo tiene configurado— se le da
de alta en su WordPress para que pueda reservar citas.

---

## La decisión de fondo: las preguntas son DATOS

Un formulario nuevo, o una pregunta más, es **una fila de la tabla `forms`**, no
un despliegue. El formulario público y la bandeja se pintan solos leyendo
`forms.fields`.

Se eligió así después de comparar tres diseños. El motivo decisivo es que este
mismo problema ya se resolvió una vez atándolo al código (el formulario de
Retorika) y hoy cambiar **una** pregunta allí obliga a tocar cinco ficheros y
volver a desplegar. El repo ya había tomado la misma decisión —datos, no
código— en `OutreachBusinessLine` y `OutreachSettings`.

**Límite conocido de la v1:** el cliente final no edita sus preguntas desde el
CRM. Las cambia quien administra, editando `scripts/seed-formulario-*.js` y
volviendo a lanzarlo: sin tocar la web y sin desplegar. Un editor visual de
preguntas es un sprint aparte.

---

## No todo formulario de la web es de este módulo

Una web de cliente suele tener **dos puertas**, y solo una pasa por aquí. Lo
tienen igual tunutrilaura y Aumenta, y confundirlas ya generó una tarea de
backlog equivocada (12/08/2026, cerrada el 13):

| Quién escribe | Va a | Endpoint | Dónde viven sus preguntas |
| --- | --- | --- | --- |
| La familia o la paciente | **Formularios** → bandeja de Comerciales | `POST /api/public/c/{tenant}/formularios/{slug}` | En `forms.fields`, o sea en el CRM |
| Un profesional que deriva o propone | **Leads** → embudo de Profesionales | `POST /api/public/leads` (cabecera `x-tenant`) | En el tema de WordPress |

La regla para decidir: **si lo que llega hay que aceptarlo o descartarlo y de ahí
sale una ficha, es de este módulo. Si hay que trabajarlo por etapas a lo largo de
semanas, es del embudo.** Un colegio que deriva casos no se «acepta» una vez: se
le llama, se le visita y se le vuelve a llamar. Además el embudo marca
`tipo_usuario = 'profesional'` en el lead, que es lo que separa esa cartera de la
de familias, y la bandeja no tiene dónde guardar eso.

⚠️ Lo que se paga por ir por el embudo, y conviene tenerlo presente antes de
mandar un formulario nuevo por ahí: `/api/public/leads` **no valida nada** y
acepta una lista fija de claves —cualquier otra la tira en silencio salvo que
viaje dentro de `customFields`—, no tiene trampa ni control de duplicados
(solo límite de peticiones), no guarda versión del consentimiento ni retención,
y sus preguntas están en el tema, así que cambiarlas es tocar la web.

---

## Tablas

Ambas en el schema del tenant. Nada en `master`.

### `forms` — la definición

| Columna | Para qué |
|---|---|
| `slug` | único por schema; es lo que va en la URL pública |
| `title`, `intro_text`, `submit_label`, `thank_you_message` | textos que ve la persona |
| `fields` (JSONB) | **el corazón**: array ordenado de preguntas |
| `settings` (JSONB) | solo claves que el código lee de verdad |
| `active`, `sort_order` | apagar sin borrar; orden en el selector |

Contrato de cada elemento de `fields`:

```js
{ key, label, type, required, order, placeholder, help,
  options, maxLength, min, max, mapTo, linkUrl, linkLabel }
```

- `type`: `text | textarea | tel | dni | email | number | select | checkbox |
  date | consent`
- `key`: `[a-z0-9_]{1,40}`, único en el formulario. **Nunca se reutiliza para
  otra pregunta**: las respuestas antiguas quedarían mal etiquetadas.
- `mapTo`: a qué parte de la ficha sube la respuesta al aceptar. La lista viva
  está en `lib/formularios/fields.js` y son dos grupos:
  - **`DESTINOS_FICHA`** — `name | email | phone | age | reason | taxId`. Los
    que la ficha de cliente ya pinta, así que aceptar no obliga a tocar ninguna
    UI: `age`→`customFields.edad`, `reason`→`customFields.motivo`,
    `taxId`→el DNI/NIF de la ficha.
  - **`DESTINOS_FAMILIA`** (08/08/2026) — `patientName | patientAge |
    relationship`. Se convierten en el PACIENTE y en el TUTOR al aceptar, y solo
    en clientes con el módulo `pacientes`. Donde no lo hay no se pierde nada: se
    quedan en «lo que nos contó».
  - `null` y todo lo que no tenga destino se concatena en
    `customFields.info_adicional`.

  ⚠️ Un `mapTo` que no esté en esa lista hace que la respuesta se caiga de los
  dos sitios. O está declarado allí, o va a null.

Claves de `settings` que el código lee: `notifyEmails`, `privacyUrl`,
`privacyVersion`, `retentionDays`, `wordpressUrl`.

### `form_submissions` — cada solicitud

Ciclo de vida: `pending` → `accepted` | `rejected`. Nunca se borra al aceptar
ni al rechazar.

`answers` es la fuente de verdad y guarda **el enunciado junto a la respuesta**:

```js
[{ key: "motivo", label: "Motivo breve de consulta", type: "textarea", value: "…" }]
```

Parece redundante, pero es lo que hace que una solicitud de hace un año siga
leyéndose bien aunque la pregunta se haya reformulado después.

**`client_id` es el candado de idempotencia**: si tiene valor, esa solicitud ya
se aceptó y no puede crear una segunda ficha. Protege del doble clic y de tener
la misma solicitud abierta en dos pestañas.

**NO se guarda la IP**, ni en claro ni hasheada: un hash de IPv4 sin sal se
revierte por fuerza bruta en minutos, así que sería un dato personal disfrazado
de anónimo, y no hace falta para nada del flujo.

---

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/public/c/{tenant}/formularios/{slug}` | definición pública, para pintar el formulario |
| POST | `/api/public/c/{tenant}/formularios/{slug}` | recibe una solicitud |
| GET | `/api/formularios` | bandeja: `?status=pending\|accepted\|rejected` + recuentos |
| GET | `/api/formularios/{id}` | detalle |
| PATCH | `/api/formularios/{id}` | descartar, recuperar o anotar |
| GET | `/api/formularios/{id}/accept` | ¿ya existe ficha de esta persona? |
| POST | `/api/formularios/{id}/accept` | aceptar → crear/enlazar ficha |

Transiciones permitidas: `pending → rejected`, `rejected → pending`.
**`accepted` no vuelve atrás**: ya hay una ficha creada a partir de esa
solicitud y devolverla a pendiente abriría la puerta a una segunda ficha de la
misma persona.

---

## Antispam

Cuatro capas, ninguna es un muro y conviene saberlo:

1. **Campo trampa** (honeypot) — invisible para personas.
2. **Trampa de tiempo** — enviado en menos de 3 segundos.
3. **Topes de longitud** por campo.
4. **Duplicados** — mismo teléfono o email en 10 minutos.

Las capas 1 y 2 **no rechazan: puntúan**. A quien puntúa ≥2 se le responde
"gracias" y no se guarda nada, porque un error le diría exactamente qué
corregir para colarse a la siguiente.

El límite de peticiones se aplica **dentro** del handler, no en las opciones de
`withPublicTenant`: allí las opciones se evalúan al cargar el módulo y todavía
no existe el slug, así que un tenant podría gastarle el cupo a otro.

---

## Aceptar: qué pasa exactamente

1. **Transacción** (solo lo indivisible): crear o enlazar la ficha de cliente y
   marcar la solicitud como aceptada.
2. **Fuera de la transacción**, y sin poder tumbarla: alta en el WordPress del
   tenant. Si falla, la ficha YA está creada y se informa del fallo; no se
   deshace nada, porque deshacerlo sería peor.
3. **Auditoría**: solo identificadores. El texto que escribió la persona es
   información de salud y `master.audit_log` es un schema **compartido entre
   tenants** — ahí no entra.

Si existe ya un cliente con el mismo teléfono o email, la bandeja lo avisa y
ofrece **enlazar con esa ficha** en lugar de crear una repetida. Al enlazar se
completa lo que falte pero **nunca se pisa lo que ya hay**.

---

## Alta en WordPress (`lib/formularios/portalUser.js`)

El portal de citas ya funcionaba con usuarios de WordPress: quien inicia sesión
en la web del tenant puede reservar y ver sus citas, porque el tema firma un
token con su email y el CRM lo canjea por una sesión (`lib/citas/ssoToken.js`).
Lo único que faltaba era **crear ese usuario**.

- El CRM llama a `POST {wordpressUrl}/wp-json/crm/v1/portal-user`.
- Se firma el cuerpo con HMAC-SHA256 usando una **subclave derivada** del
  secreto de `WIDGET_SSO_SECRETS`, no el secreto en crudo: así un token de este
  canal jamás puede colar como token del SSO de citas, ni al revés. La etiqueta
  de derivación es `crm-portal-user-v1` y tiene que coincidir en ambos lados.
- WordPress verifica firma (en tiempo constante) y antigüedad (máx. 5 min),
  crea el usuario como `subscriber` y le envía un **enlace caducable para que
  elija contraseña**.

**NUNCA viaja una contraseña por correo.** Una contraseña enviada por email se
queda para siempre en la bandeja de entrada de la paciente: si algún día le
entran en el correo, le entran también en la cuenta. Es además como lo hace
WordPress de serie.

Lado WordPress: `nutrilaura-portal-user.php` en el tema.

### También desde la ficha, a un botón (2026-08-05)

`POST /api/clients/[id]/portal-user` (solo admin) hace ese MISMO paso para una
paciente que ya tiene ficha. Quien llega por el formulario sale con cuenta sin
que nadie haga nada; quien escribe **por Instagram**, o a quien se da de alta a
mano, se quedaba solo con la ficha: sin acceso a su área privada, y por tanto
sin poder ver sus citas ni usar un bono. El botón está en la ficha, en «Acceso
a la web».

No es una segunda implementación: llama a `crearUsuarioPortal`, así que si
cambia la forma de dar de alta cambia para los dos caminos.

⚠️ **De dónde sale la URL de WordPress.** Vivía —y sigue viviendo— en los
ajustes DEL FORMULARIO (`forms.settings.wordpressUrl`), porque hasta ahora solo
hacía falta al aceptar una solicitud. Desde la ficha no hay formulario de por
medio, así que `resolverUrlWordpress()` la busca en tres sitios, del más
explícito al más circunstancial:

1. `tenant.settings.wordpressUrl` — donde debería estar.
2. El origen de `tenant.settings.citas.portalUrl` (Configuración → Área privada).
3. Cualquier formulario que la tenga puesta.

Hoy tunutrilaura solo cumple el tercero, y por eso funciona sin configurar nada.
Si algún día se borra ese formulario, el botón deja de saber a qué web llamar y
lo dice en vez de fallar en silencio.

Un fallo de WordPress **no** devuelve 500: la respuesta es 200 con el motivo en
cristiano («no respondió a tiempo», «ya tenía usuario»), porque no es un error
del CRM y la pantalla tiene que poder contarlo. Se audita el intento salga bien
o mal: es un alta en un sistema de fuera que además dispara un correo a una
paciente.

### El correo tiene que ser el mismo en los dos sitios (2026-08-05)

El bono, las citas y el portal se atan al **correo**. Si el de la ficha no es el
de su cuenta en la web, todo «funciona» y nada sirve: el bono existe pero ella
no lo ve, y sus citas no se enlazan con su ficha. Es el fallo más silencioso del
sistema.

Forzar que coincidan no se puede —son dos sistemas con su propio campo— así que
se ataca por los dos lados:

**1. Comprobarlo y enseñarlo.** `GET /api/clients/[id]/portal-user` le pregunta
a WordPress si existe cuenta con ese correo exacto
(`POST /wp-json/crm/v1/portal-user/existe`, misma firma y antirreplay que el
alta) y la ficha lo pinta: **✓ tiene cuenta** / **sin cuenta**.

⚠️ **Son TRES estados, no dos.** «No la tiene» es accionable; «no se ha podido
preguntar» —la web no responde, o su theme todavía no trae la consulta— no lo
es, y pintarlos igual sería mentir en rojo. El motivo `sin_soporte` (404) es el
caso normal hasta que el cliente suba el theme nuevo.

**2. Cazar a quien entra con otro correo.** En el canje del SSO
(`/citas-portal/session`) el CRM ve el correo real con el que la paciente entra
en la web — y hasta hoy lo tiraba. Ahora, si no hay ficha con ese correo, deja
una solicitud en la bandeja («Entró en su área privada y no hay ficha con este
correo»). Va sin esperarla: entrar en el área privada no puede depender de esto.

La lógica de esa solicitud es `asegurarSolicitudDeAlta`, compartida con
`registro-web`: mismas guardas de idempotencia (ya es cliente / ya hay una
pendiente), así que un portal que se abre veinte veces al día no llena la
bandeja.

⚠️ Al aceptar esa solicitud, **enlazarla con la ficha que ya existe** en vez de
crear una nueva, o quedarán dos fichas de la misma persona. La bandeja ya ofrece
esa opción (`buscarClienteExistente`).

⚠️ **Se descartó sincronizar los correos automáticamente** (que el CRM cambie el
de WordPress al cambiar el de la ficha): le estaría cambiando a alguien el
correo con el que inicia sesión sin que se entere, y un dedazo la dejaría fuera
de su cuenta sin forma de volver a entrar.

Lado WordPress de la consulta: `nutrilaura-portal-user.php`, theme v1.29.0.

---

## Puesta en marcha de un tenant

```bash
node scripts/enable-module.js <slug> formularios          # activa Y migra
node scripts/seed-formulario-nutri-laura.js <slug>        # siembra el formulario
node scripts/grant-module-access.js <slug> formularios    # acceso a los usuarios
```

El segundo acepta el slug como argumento para poder ensayarlo en un tenant de
pruebas antes de tocar el del cliente.

**El tercero no es opcional y es donde se falla.** `enable-module` enciende el
módulo para el TENANT, pero cada usuario tiene además su propia lista
`master.users.module_access`. Si esa lista existe y no incluye la clave, la
persona ve la entrada en el menú y **toda la API le responde 403** — parece un
bug del módulo nuevo y no lo es. Los usuarios con lista vacía o con el comodín
`all` (y los `superadmin`) no necesitan nada: el script los detecta y no los
toca. Admite `--dry-run` y `--revoke`.

---

## Nota sobre la migración

`scripts/migrate-formularios-module.js` hace **dos pasadas**, y es la única
desviación de la letra de la regla "elegir schemas por existencia de tabla":

1. **Crear**, sobre schemas con el módulo activo (`byModule`). Para una tabla
   que aún no existe en ningún sitio, `byTable` devolvería lista vacía y el
   módulo no se instalaría jamás.
2. **Blindar** índices, DEFAULT y CHECK sobre schemas que ya tienen la tabla
   (`byTable`). Esta pasada alcanza también a los schemas donde la tabla la creó
   `db:sync` desde los modelos, que es justo donde faltan los DEFAULT de base de
   datos — el patrón que reventó `projects-sprint-2` y `billing-rework`.

Ni un solo slug escrito a mano: ambas leen `master.tenants` en tiempo de
ejecución.

---

## Pendiente

- Purga automática de las solicitudes **descartadas** pasado
  `settings.retentionDays` (1 año para tunutrilaura). Hoy hay que hacerlo a mano.
- Editor visual de preguntas dentro del CRM.
- Buscar dentro de las respuestas exige recorrer un JSONB sin índice útil.

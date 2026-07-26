# Módulo Formularios

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

- `type`: `text | textarea | tel | email | number | select | checkbox | date | consent`
- `key`: `[a-z0-9_]{1,40}`, único en el formulario. **Nunca se reutiliza para
  otra pregunta**: las respuestas antiguas quedarían mal etiquetadas.
- `mapTo`: `null | name | email | phone | age | reason` — a qué parte de la
  ficha de cliente sube la respuesta al aceptar. Los destinos son fijos a
  propósito: `age`→`customFields.edad`, `reason`→`customFields.motivo`, y todo
  lo que no tiene destino se concatena en `customFields.info_adicional`. Son
  **exactamente** las claves que la ficha de cliente ya pinta, así que aceptar
  no obliga a tocar ninguna UI.

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

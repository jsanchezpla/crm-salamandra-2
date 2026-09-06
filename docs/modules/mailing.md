# Módulo Mailing (`mailing`)

## Mapa

> Verificado contra el código el 06/09/2026 (sprint 1, primer commit del
> módulo). Si algo no cuadra, manda el código: corrige esta tabla. **Quién
> tiene el módulo NO se lista aquí** (una lista a mano se queda vieja):
> `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `mailing` · requiere — (nada obligatorio en `lib/provisioning/catalogo.js`; `dependencias.js` declara dos parciales: sin `clients` solo quedan los correos sueltos, sin `citas` el filtro de última cita se ignora). Aviso del catálogo: necesita una cuenta de Amazon SES del propio cliente y sacarla del sandbox. |
| **Reina** | — · ninguna todavía. Nació del plan «Módulo de Mailing — Sprint 1» (Jorge, 23/08/2026). Se probó en local contra `demo` con `scripts/seed-mailing-demo.js`. |
| **Pantallas** | `app/(dashboard)/mailing/` (5 páginas, todas con `notFound()` en el servidor vía `_pagina.js`): `/mailing` (campañas + contador de cuota), `/mailing/[id]` (editor por bloques, vista previa, prueba, programación, envío con progreso y métricas), `/mailing/lista` (fichas con la casilla + correos sueltos + importar CSV), `/mailing/segmentos`, `/mailing/bajas` (supresión). Entrada «Mailing» en `components/layout/Sidebar.jsx` (área Comercial, después de Correo). |
| **Endpoints** | `app/api/mailing/**` (21 `route.js`, todos con `exigirMailing` = `hasModule("mailing")`): `estado`, `uso`, `audiencia` (GET lista / POST recuento), `contactos` (+`[id]`, `[id]/confirmar` ✉, `importar` ✉ si modo confirmar), `segmentos` (+`[id]`, `previsualizar`), `campanas` (+`[id]`, `[id]/prueba` ✉, `[id]/enviar` ✉, `[id]/avanzar` ✉, `[id]/programar`, `[id]/estado`, `[id]/vista`, `[id]/metricas`, `[id]/duplicar`), `plantillas` (+`[id]`), `supresiones`, `imagenes` (multipart). Los ✉ pasan por `assertNotDemoPaidCall`. **Públicos** (sin login, `withPublicTenant`, todos con `hasModule` y rate limit): `app/api/public/c/[tenantSlug]/mailing/{baja,confirmar,clic,abierto,ver}/[token]` y `imagen/[nombre]`. **Webhook**: `app/api/webhooks/ses/[tenantSlug]` (rebotes y quejas por SNS, firma de Amazon obligatoria). |
| **Lógica** | `lib/mailing/` (17): `ses.js` (cliente SES v2 con credenciales BYOK del tenant: `getTenantSesConfig`, `enviarSes`, `cuentaSes`, `identidadDelRemitente`, `costeEstimado`), `sigv4.js` (firma AWS a mano, sin SDK), `bloques.js` (catálogo de 6 bloques, saneado por lista blanca, `htmlATexto`, `personalizar`), `render.js` (`renderCorreo`: bloques → HTML de tablas + texto; exige enlace de baja), `audiencia.js` (**el único sitio que decide a quién se escribe**: casilla `novedades` + contactos activos − supresión; reglas de segmento), `envio.js` (`prepararCampana`, `avanzarCampana` con `FOR UPDATE SKIP LOCKED`, `enviarPrueba`, `campanaLista`, `centroDe`), `bajaToken.js` (tokens HMAC de baja/confirmación/clic/apertura, sin tabla), `enlaces.js` (URL públicas, `urlBase`), `supresion.js` (`suprimirEmail`: supresión + contacto a baja + casilla de la ficha a no + envíos pendientes), `avisosSes.js` (qué hacer con Bounce/Complaint), `snsFirma.js` (verificar la firma de SNS), `eventos.js` (clics/aperturas, índice → URL), `confirmacion.js` (correo de doble opt-in), `csv.js` (lector sin librerías), `imagenStorage.js` (`uploads/mailing/{slug}/{uuid}.{ext}`, magic bytes, 2 MB), `paginaPublica.js`, `comun.js` (puerta, validación, serializado). |
| **UI** | `modules/mailing/` (9): `MailingModule.jsx`, `CampanaEditor.jsx`, `ListaModule.jsx`, `SegmentosModule.jsx`, `BajasModule.jsx`, `Bloques.jsx` (lista de bloques y el formulario de cada tipo, subida de imagen), `EditorTexto.jsx` (contentEditable con 6 botones), `Cabecera.jsx` (pestañas y avisos: sin SES, demo, sandbox, remitente sin verificar), `api.js`. Configuración: tarjeta «Amazon SES» en `modules/config/tarjetas/Conexiones.jsx` (`AI_PROVIDERS.amazonSes` + `SesCamposField`), colocada en `ConfigModule.jsx` y registrada en `lib/configuracion/pestanas.js` (`amazonSes`, requiere `mailing`). |
| **Modelos** | `models/tenant/`: `MailingContact` (`mailing_contacts`), `MailingSegment` (`mailing_segments`), `MailingCampaign` (`mailing_campaigns`), `MailingSend` (`mailing_sends`, **UNIQUE campaign_id+email**), `MailingSuppression` (`mailing_suppressions`, UNIQUE email, sin DELETE), `MailingTemplate` (`mailing_templates`), `MailingEvent` (`mailing_events`). Registrados para todos los tenants en `lib/db/tenantDb.js`; las tablas las crea `migrate-mailing-sprint-1` (`MODULES.mailing`) solo donde el módulo está activo. |
| **Interruptores y parámetros** | `featureFlags`/`logicOverrides`: ninguno. Por cliente, en `tenant.settings.integrations`: `sesSecretAccessKey` (cifrada), `sesAccessKeyId`, `sesRegion`, `sesFromEmail`, `sesFromName`, `sesConfigurationSet` (`PATCH /api/tenant/settings`). Entorno: `MAILING_TOKEN_SECRET` (cae a `SETTINGS_ENCRYPTION_KEY`), `APP_PUBLIC_URL` (base de los enlaces desde el temporizador). |
| **Pantallas propias** | ninguna. |
| **Scripts** | Migración: `scripts/migrate-mailing-sprint-1.js` (`npm run db:migrate:mailing`; la lanza sola `enable-module.js <slug> mailing`). Temporizador: `scripts/enviar-mailing.js` cada minuto (`scripts/deploy/crm-mailing.{service,timer}`; `--simular` no toca nada). Demo: `scripts/seed-mailing-demo.js <demo>` y después `demo-golden-snapshot.js <demo>`. |
| **Pruebas** | En `npm test` (todas `node:test`, ligeras): `_smoke-mailing-sigv4.mjs` (la firma contra los vectores oficiales de AWS), `_smoke-mailing-bloques-render.mjs` (lista blanca del HTML, render con marca, enlaces medidos con índices, texto plano), `_smoke-mailing-tokens-sns.mjs` (tokens HMAC, firma de SNS con un par RSA propio), `_smoke-mailing-audiencia-csv.mjs` (reglas, casilla, última cita, CSV, clasificación de rebotes). Con base y servidor: ninguna todavía. |
| **Decisiones** | `../decisions/2026-09-06-mailing-por-ses-y-no-por-resend.md` · plan original: `C:\Users\rodri\Desktop\Modulo-Mailing-Sprint-1.pdf` (Jorge, 23/08/2026). |
| **En este doc** | Qué hace · Decisiones de arquitectura · De dónde sale la lista · El envío · Bajas y supresión · Métricas · Modelo de datos · API · Puesta en marcha en un cliente (AWS) · Reglas que no se rompen · Pendiente (sprint 2) |

`moduleKey`: `mailing` · Ruta: `/mailing` · API: `/api/mailing/*`

Email marketing dentro del CRM: campañas y newsletters a quien **ya es cliente
y ha dicho que sí**, más correos sueltos con su consentimiento. Editor por
bloques, segmentos con datos del CRM, envío por lotes reanudable, bajas de un
clic, lista de supresión, contador de cuota y métricas de clic.

**No confundir con:**

- **Correo** (`/correo`): un mensaje escrito a mano a la gente que se elija,
  por Resend. No es un módulo y no lleva consentimiento de publicidad.
- **Captación** (`outreach`): correo en frío, uno a uno, a empresas que no te
  conocen. No comparten plantillas ni lista (plan, decisión 1.4).

---

## Qué hace

| Pieza | Dónde |
| --- | --- |
| Lista: fichas con la casilla «novedades» + correos sueltos + importar CSV | `/mailing/lista` |
| Segmentos por módulo asignado, estado de ficha y última cita | `/mailing/segmentos` |
| Editor por bloques (título, texto, imagen, botón, separador, firma) con vista previa | `/mailing/[id]` |
| Envío por lotes, reanudable, con prueba, programación y progreso | `/mailing/[id]` + temporizador |
| Bajas de un clic y lista de supresión | pie de cada correo, `/mailing/bajas` |
| Contador de cuota (mes, coste, tasa de quejas, estado de la cuenta de AWS) | `/mailing` |
| Métricas: clics (principal), aperturas (orientativas), por enlace, por destinatario | `/mailing/[id]` |

Fuera del sprint 1, a propósito: generación con IA, secuencias automáticas,
A/B de asunto e historial de campañas en la ficha del cliente.

---

## Decisiones de arquitectura

1. **Dos proveedores: SES para marketing, Resend para transaccional.** La
   reputación va pegada a la cuenta; una campaña con quejas hundiría los
   recordatorios de cita. Separar por subdominio no protege de una suspensión
   de cuenta entera. Y SES cuesta 0,10 $ por mil, sin cuota mensual, que es lo
   que exige el pago único de Salamandra. Detalle en la decisión fechada.
2. **BYOK, una cuenta de AWS por cliente.** Igual que Anthropic, Resend o
   Stripe: las credenciales van cifradas en `settings.integrations` y el CRM
   nunca usa una cuenta global. Con la cuenta separada, la tasa de quejas de
   uno no toca a los demás (era la decisión abierta del plan; se cierra por la
   opción que recomendaba).
3. **La lista se cuelga de lo que ya existe.** El canal `novedades` de
   `lib/clients/comunicaciones.js` ES el consentimiento (con `granted, at, ip,
   userAgent, by`). No se crea lista ni campo nuevo en la ficha: si hubiera dos
   verdades, el día que discrepen mandaría la equivocada. Solo los correos que
   no son de ninguna ficha viven en `mailing_contacts`, con su propia prueba.
4. **Editor por bloques, nunca lienzo libre.** El HTML del bloque de texto se
   sanea a una lista blanca de 9 etiquetas al guardar (`sanearHtml`) y el
   render pinta tablas con CSS en línea y VML para el botón. Lo que no se admite
   se VE como texto, no se borra en silencio.
5. **El HTML no se guarda.** Se genera al enviar y al «ver en el navegador»
   con el mismo `renderCorreo`: un arreglo del render llega a los correos
   viejos y no hay dos copias que puedan discrepar.
6. **Sin SDK de AWS.** `lib/mailing/sigv4.js` firma las tres llamadas que
   hacen falta (SendEmail, GetAccount, GetEmailIdentity) con `node:crypto` y
   está fijado con los vectores de prueba oficiales. Meter `@aws-sdk` era un
   despliegue `--full` y 15 MB para ochenta líneas.
7. **Los tokens de los enlaces se derivan, no se guardan** (HMAC del cliente y
   el correo, como `whatsapp/webhookAuth.js`). La baja tiene que funcionar
   dentro de un año aunque se pode la tabla de envíos.

---

## De dónde sale la lista (`lib/mailing/audiencia.js`)

```
clientes   = clients con email y puedeAvisar(client, "novedades")
             (solo el correo PRINCIPAL de la ficha: los tutores del JSONB
              `guardians` no llevan prueba de consentimiento propia)
contactos  = mailing_contacts con estado 'activo'
audiencia  = (clientes ∪ contactos) − mailing_suppressions, sin repetidos
```

Reglas de segmento (JSONB, todas en Y, solo afectan a los clientes):
`fuentes`, `modulos` (`client_module_assignments` activos), `estados`
(`clients.status`; los rótulos «Activo / No vino / Baja» solo en perfil salud,
`lib/clients/estados.js`) y `ultimaCita` (`hace_menos` | `hace_mas` N días |
`nunca`, sobre `bookings.scheduled_at < ahora` y estado ∉ cancelled/no_show).

`POST /api/mailing/audiencia` y `/segmentos/previsualizar` devuelven el
recuento con el MISMO cálculo que el envío: lo que se ve es lo que sale.

### Los correos sueltos y su consentimiento

Un correo suelto entra de tres formas, y las tres dejan escrito de dónde sale
el sí (`consentimiento.origen`):

- **A mano** con el origen (`by: "equipo"`) → `activo`.
- **A mano o por CSV pidiendo confirmación** → `pendiente` + correo de doble
  opt-in (`lib/mailing/confirmacion.js`); al pinchar, `activo` con
  `by: "confirmacion"`, IP y navegador. Un pendiente NO recibe campañas.
- **Por CSV con origen declarado** (`by: "csv"`) → `activo`.

Un correo que sea de una ficha de cliente se rechaza: se le marca la casilla
en la ficha, no se duplica aquí.

---

## El envío (`lib/mailing/envio.js`)

1. `prepararCampana`: resuelve la audiencia AHORA, inserta una fila por
   destinatario en `mailing_sends` (`bulkCreate` con `ignoreDuplicates`; el
   UNIQUE `(campaign_id, email)` es el ancla de la idempotencia) y pone la
   campaña en `enviando`.
2. `avanzarCampana`: reclama un lote con `UPDATE … WHERE id IN (SELECT … FOR
   UPDATE SKIP LOCKED) RETURNING`, vuelve a mirar la supresión, renderiza
   personalizado, manda por SES con `List-Unsubscribe` +
   `List-Unsubscribe-Post` (RFC 8058) y apunta cada fila. Espera entre correo y
   correo lo que diga `MaxSendRate` de la cuenta. Fallos reintentables
   (throttling, red, 5xx) vuelven a `pendiente` hasta 3 intentos; una cuenta
   parada o suspendida PAUSA la campaña. Una fila `procesando` más de 10
   minutos se considera huérfana y se vuelve a coger.
3. Quién llama: el endpoint `enviar` (prepara + primer lote de 10), la
   pantalla en bucle (`avanzar`, lotes de 10, 8 s) y el temporizador
   `scripts/enviar-mailing.js` cada minuto (lotes de 100, 50 s). Pueden
   coincidir sin duplicar.
4. Estados: `borrador → programada → enviando → enviada`, con `pausada`
   (se reanuda sin duplicar) y `cancelada`. Una campaña enviada no se edita:
   se duplica.

El envío de prueba (`/prueba`, hasta 5 direcciones) renderiza igual, marca el
asunto con `[PRUEBA]`, no crea filas y no mide.

---

## Bajas y supresión

- Cada correo lleva en el pie «Darme de baja» (token HMAC) y las cabeceras de
  baja de un clic. `GET` enseña una página con UN botón; `POST` ejecuta (el
  GET no da de baja para que los antivirus que abren enlaces no vacíen la
  lista; el POST lo llama el botón y el buzón por RFC 8058).
- `suprimirEmail` (`lib/mailing/supresion.js`) es la única puerta: inserta en
  `mailing_suppressions` (el primer motivo manda), pasa el contacto suelto a
  `baja`, **desmarca la casilla de novedades de la ficha** con `by: "baja"` y
  marca `suprimido` lo que estuviera pendiente.
- El webhook de SES (`/api/webhooks/ses/[tenantSlug]`) mete en supresión los
  rebotes **permanentes** (`rebote`) y las quejas (`queja`); un rebote
  transitorio solo marca el envío. La firma de SNS se comprueba siempre
  (`snsFirma.js`: certificado solo de `sns.*.amazonaws.com`).
- No hay endpoint que borre supresiones. `/api/mailing/supresiones` solo
  lista y añade a mano (`manual`).

---

## Métricas

Clic = métrica principal; apertura = orientativa (Apple Mail y los filtros
«abren» sin leer). Cada enlace medido pasa por `/clic/[token]` (el token lleva
el envío y el índice del enlace; `eventos.js` vuelve a recorrer el correo para
saber la URL) y el píxel por `/abierto/[token].gif`. `mailing_events` guarda
el detalle; `mailing_sends` los contadores. `/metricas` devuelve el resumen,
lo pinchado por enlace y la lista de destinatarios con su estado.

---

## Modelo de datos

| Tabla | Para qué | Detalle que importa |
| --- | --- | --- |
| `mailing_contacts` | correos sueltos | UNIQUE email; `consentimiento` JSONB; estado pendiente/activo/baja |
| `mailing_segments` | grupos por reglas | `reglas` JSONB normalizadas al guardar |
| `mailing_campaigns` | el correo | `bloques` JSONB; `segment_id` FK SET NULL; contadores resumidos |
| `mailing_sends` | una fila por destinatario | UNIQUE (campaign_id, email); `origen_id` blando; `ses_message_id` para casar rebotes |
| `mailing_suppressions` | de aquí no sale nadie | UNIQUE email; sin FK; sin DELETE |
| `mailing_templates` | firmas y campañas guardadas | mismo formato de bloques |
| `mailing_events` | clics y aperturas | FK CASCADE a sends |

Imágenes: `uploads/mailing/{slug}/{uuid}.{ext}` (volumen de Docker, 2 MB,
tipo por magic bytes), servidas públicamente por `/imagen/[nombre]` con caché
larga.

---

## API (todas bajo `/api/mailing`, `hasModule("mailing")`)

| Ruta | Qué hace |
| --- | --- |
| `GET estado[?comprobar=1]` | SES configurado, cuenta (sandbox, cupo), remitente verificado, demo, vocabulario, filtros de segmento disponibles |
| `GET uso` | correos del mes y coste, totales, tasa de quejas/rebotes, cuenta de AWS |
| `GET audiencia[?q=]` · `POST audiencia {reglas}` | la lista entera / el recuento de unas reglas |
| `GET/POST contactos` · `PATCH/DELETE contactos/[id]` · `POST contactos/[id]/confirmar` · `POST contactos/importar` | correos sueltos |
| `GET/POST segmentos` · `GET/PATCH/DELETE segmentos/[id]` · `POST segmentos/previsualizar` | segmentos |
| `GET/POST campanas` · `GET/PATCH/DELETE campanas/[id]` | campañas (PATCH solo en borrador/programada/pausada/cancelada) |
| `POST campanas/[id]/prueba {emails}` · `enviar` · `avanzar` · `programar {fecha}` / `DELETE programar` · `estado {accion}` · `duplicar` | acciones |
| `GET campanas/[id]/vista[?formato=texto]` · `GET campanas/[id]/metricas[?q=]` | vista previa (HTML aparte, para el iframe) y métricas |
| `GET/POST plantillas` · `PATCH/DELETE plantillas/[id]` | firmas (`tipo=firma`) y campañas guardadas |
| `GET/POST supresiones` | la lista de bajas |
| `POST imagenes` (multipart `fichero`) | sube una imagen y devuelve su URL pública |

---

## Puesta en marcha en un cliente (AWS)

Está paso a paso en la tarjeta de Configuración («Cómo conseguirla») y en
`docs/setup-cuentas-externas.md` § 3. En corto:

1. Cuenta de AWS del cliente, región europea, dominio verificado en SES.
2. Usuario IAM solo para el CRM con `ses:SendEmail` + `ses:GetAccount` (+
   `ses:GetEmailIdentity`), Access Key.
3. Pegar en Configuración → Conexiones → Amazon SES: secreta, Access Key ID,
   región, remitente (y nombre).
4. **Pedir acceso a producción** (SES empieza en sandbox: 200/día y solo a
   direcciones verificadas). `/mailing` lo avisa mientras dure.
5. Recomendado: configuration set con destino SNS (Bounce + Complaint) →
   suscripción HTTPS a `https://crm.salamandrasolutions.com/api/webhooks/ses/<slug>`
   (la confirma solo el webhook) → nombre del set en la tarjeta.
6. `enable-module.js <slug> mailing` (crea las tablas) y, en el VPS,
   instalar el temporizador una vez:
   `cp scripts/deploy/crm-mailing.{service,timer} /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now crm-mailing.timer`.

---

## Reglas de negocio que no se rompen

- **Nadie recibe sin consentimiento**: casilla de novedades o contacto
  `activo`. Un `pendiente` no recibe. Los tutores del JSONB no reciben.
- **La supresión se consulta en todo envío** y no se deshace desde el CRM.
- **Sin enlace de baja no hay correo**: `renderCorreo` lanza sin `enlaces.baja`.
- **La demo no envía nada**: `assertNotDemoPaidCall` en prueba, enviar,
  avanzar, programar, reanudar, confirmar e importar con confirmación; y el
  temporizador salta las demos.
- **Lo que se ve es lo que sale**: la vista previa y el recuento usan el mismo
  render y la misma audiencia que el envío.
- **Una campaña enviada no se edita** (se duplica) y **una que se está
  enviando no se borra** (se pausa o se cancela).

---

## Pendiente (sprint 2, del plan)

- Generación con IA de asunto y bloques (rellena bloques, no escribe HTML).
- Secuencias por eventos del CRM (bienvenida al alta, cumpleaños, «hace seis
  meses de tu última cita»).
- Historial de campañas en la ficha del cliente, junto al hilo de WhatsApp.
- A/B de asunto y envío escalonado.
- Medir el consumo transaccional de Resend por cliente (100/día del plan
  gratis), que no es de este módulo pero el plan pedía mirarlo antes.

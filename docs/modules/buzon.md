# Buzón — que un cliente pueda abrirnos una incidencia

**Estado:** implementado el 13/08/2026. Sin `moduleKey`: lo tienen todos los
clientes y todos sus usuarios.

## Qué resuelve

Hasta el 13/08/2026 no había ningún camino por el que un cliente nos contara que
algo va mal. Lo único que existía era un `mailto:info@salamandrasolutions.com`
en la pantalla de Soporte (`modules/support/SupportModule.jsx`) y encima **solo
lo veían los clientes que NO tenían el módulo `support`**: Aumenta y la demo,
que sí lo tienen, veían su propia bandeja y no tenían ni el correo.

Estaba pedido por Jorge el 10/08 y apuntado en el backlog.

## Las cuatro cosas que suenan parecido

| Qué | De quién a quién | Dónde vive |
| --- | --- | --- |
| `Ticket` (módulo Soporte) | del cliente hacia **sus** clientes | schema del tenant |
| `Incidencia` (módulo Clínica) | dentro del centro, entre su propio equipo | schema del tenant |
| `ClientNotice` («Aviso al cliente») | del centro hacia el paciente | schema del tenant |
| **`BuzonAviso`** | del usuario de cualquier cliente **hacia nosotros** | **`master`** |

Por eso no se llama ni «incidencias» ni «avisos» a secas: los dos nombres
estaban cogidos. El cliente ve **Ayuda**, nosotros vemos **Buzón**.

## Cómo se llega

| Quién | Dónde | Notas |
| --- | --- | --- |
| Cliente | `/ayuda` | Icono de interrogante en el pie del sidebar, el primero. Lo ve **todo el mundo**: no depende de ningún módulo. |
| Nosotros | `/admin/buzon` | Segunda sección del panel, detrás del Registro. Solo desde `ADMIN_HOST`. |

`ContactoSalamandra()` de la pantalla de Soporte ya no es un `mailto:`: explica
que Soporte es otra cosa y enlaza a `/ayuda`.

## Por qué vive en `master`

Fue la decisión que el backlog dejaba abierta a propósito, y tiene tres motivos:

1. **Sobrevive a la baja del cliente.** El 12/08 se dieron de baja tres clientes
   y se purgaron sus schemas; lo que escribieron antes de irse suele ser la
   explicación de por qué se van.
2. **Funciona aunque su base esté rota**, que es exactamente cuando escriben.
   Guardar «mi CRM no va» dentro del CRM que no va es pedirlo.
3. **Nuestra bandeja es una consulta**, no abrir conexión a los schemas de todos.

### Es una excepción a una regla escrita, y va con tres frenos

`lib/utils/auditoria.js` y `docs/base/db-conventions.md` §6.2 prohíben duplicar
en master datos personales del schema de un cliente. Esto se la salta, y se
sostiene porque el texto **no es una copia de ninguna ficha**: lo escribe una
persona, a propósito, y dirigido a nosotros. Pero la excepción va acompañada de
tres cosas, no de una:

- El formulario pide, junto al cuadro de texto, que no se escriban nombres de
  pacientes ni de familias.
- `auditar()` guarda **la referencia y el cliente, nunca el cuerpo**. Si guardara
  el texto, acabaría duplicado en `master.audit_logs`, que es justo la tabla que
  la regla protege.
- `scripts/podar-buzon.js` caduca lo resuelto a los dos años, con suelo de uno.

## Tablas (`master`)

`scripts/migrate-buzon.js`, idempotente, se corre **a mano** (`deploy.sh` no
ejecuta migraciones):

```bash
docker exec crm-salamandra-app-1 node scripts/migrate-buzon.js
```

- **`buzon_avisos`** — el aviso. `numero` lo pone la BD con
  `nextval('master.buzon_numero_seq')`, correlativo **global**, se enseña
  `AV-0042`.
- **`buzon_mensajes`** — el hilo. `interno` marca las notas nuestras.
- **`buzon_adjuntos`** — la ficha del fichero; el binario va a disco.

### Sin claves ajenas, y con fotos de texto

`tenant_id` y `usuario_id` son UUID **sueltos**, y al lado van `tenant_slug`,
`tenant_nombre`, `usuario_email` y `usuario_nombre` como texto. Hay prueba de qué
pasa si no: `master.audit_logs` sí tiene FK con `ON DELETE SET NULL`, y por eso
`scripts/borrar-tenant.js` necesita una sección entera para que el histórico no
se quede sin atribución al dar de baja a alguien.

## Estados

`nuevo ⇄ en_curso` → contestamos ⇒ `esperando` → contesta él ⇒ `en_curso`.
`resuelto` cierra, y **si el cliente vuelve a escribir se reabre**: «sigue
pasando» es lo más importante que nos pueden decir y no puede quedarse enterrado
en un hilo cerrado.

Lo decide `estadoTrasMensaje()` en `lib/buzon/buzon.js` a partir de quién
escribe, nunca el body de la petición: así no hay forma de contestar y dejarlo,
por descuido, como si siguiera esperándonos.

## Quién ve qué

- **El cliente ve los SUYOS**, no los de su empresa. En master no hay schema que
  aísle nada, así que el aislamiento lo pone `usuario_id`. Un aviso puede ser
  perfectamente una queja sobre su propio centro.
- **La prioridad y el reparto son nuestros** y no se le enseñan. Un desplegable
  de urgencia en manos de quien reporta se satura en «alta» en dos semanas. Lo
  que sí decide él es `bloquea`, que no es una opinión.
- **Las notas internas no salen**, ni ellas ni sus adjuntos. El recorte lo hace
  `serializarAviso(fila, { para })` en un solo sitio.

## Endpoints

| Método · Ruta | Guarda |
| --- | --- |
| `GET/POST /api/ayuda` | `withTenant`, **sin `hasModule`**. POST: guard de demo, rate limit por persona |
| `GET /api/ayuda/[id]` | El aviso tiene que ser **suyo** |
| `POST /api/ayuda/[id]/mensajes` | Ídem. Un mensaje suyo nunca puede ser `interno` |
| `GET /api/ayuda/adjuntos/[adjuntoId]` | El adjunto tiene que colgar de un aviso **suyo** |
| `GET /api/admin/buzon` | `candadoBuzon` |
| `GET/PATCH /api/admin/buzon/[id]` | Ídem. PATCH solo estado, prioridad y reparto |
| `POST /api/admin/buzon/[id]/mensajes` | Ídem. `interno: true` = nota nuestra |
| `GET /api/admin/buzon/adjuntos/[adjuntoId]` | Ídem |

### El candado lleva una vuelta más que el resto del panel

`lib/buzon/candadoBackoffice.js` comprueba el host **a mano**, además de los tres
candados de siempre. El matcher del middleware excluye las rutas que **acaban**
en `.png`/`.jpg`/`.svg`, y una ruta así no pasa por él: ni reparto por host, ni
sello `bo`, ni cabecera `x-user-id`. Y sin `x-user-id`, `hasModule()` concede
todos los módulos activos del tenant (rama de «modo infraestructura» en
`tenantResolver.js`). Por eso, además, **las URL de adjunto llevan UUID y nunca
el nombre del fichero**; el nombre viaja en `Content-Disposition`.

## Adjuntos

`lib/buzon/buzonStorage.js`, clon de `lib/support/ticketStorage.js`. Layout:
`buzon/{slug}/{avisoId}/{adjuntoId}.{ext}` bajo `/app/uploads`.

**3 ficheros × 10 MB**, y se puede adjuntar tanto en el aviso inicial como al
responder en el hilo (las del hilo llevan `mensaje_id` y se pintan donde se
mandaron, no amontonadas arriba).

Los 10 MB no son un número redondo cualquiera: el caso que se rompía con 5 es el
más común entre clientes reales — la gente no técnica no hace captura de
pantalla, hace una **foto al monitor con el móvil**, y eso son 3–8 MB. Es además
el mismo tope que usa Soporte para lo mismo. Documentos está en 25 MB porque es
otra cosa (un archivo de contratos, con su cuota de 1 GB por cliente).

El tope vive en `LIMITES` de `lib/buzon/buzon.js` y `buzonStorage.js` lo importa
de ahí: estuvo escrito en los dos ficheros con el número copiado, que es como se
desincronizan.

⚠️ **El tope de verdad lo ponía nginx, y era 1 MB.** El bloque del CRM no tenía
`client_max_body_size`, así que aplicaba el defecto de nginx: cualquier captura
de más de 1 MB —casi todas— se cortaba **antes** de llegar a la app y volvía una
página HTML que el navegador intentaba leer como JSON («Unexpected token '<'»).
Lo encontró Jorge el 13/08/2026 adjuntando un PNG normal. Ese bloque está ahora
en `client_max_body_size 40M`, por encima de lo que puede pedir cualquier módulo,
para que **el tope que manda sea siempre el del código** y el usuario reciba una
frase en cristiano en vez del HTML del proxy.

Ojo si se vuelve a mirar esto: los 30 MB que se leen en `nginx/nginx.conf` **no
son los de producción** — ese fichero es una plantilla legacy que no se usa; la
nginx real es nativa del VPS y no está versionada.

De la misma pasada se descubrió que los adjuntos del módulo **Soporte**
(escritos para 10 MB × 5) llevaban todo este tiempo capados a 1 MB en
producción. Con el cambio ya caben, pero nadie lo había sufrido porque Soporte
aún no tiene ni un ticket.

Y aun así, el navegador nunca puede dar por hecho que la respuesta es JSON:
`leerRespuesta()` en `modules/buzon/AyudaModule.jsx` mira si se puede parsear y,
si no, traduce el 413 a una frase con el tope y el peso real del fichero.

### Vista previa

Las dos pantallas tienen un botón **«Ver»** que abre la captura sin descargarla
(imágenes y PDF). Pide el fichero con `?ver=1`; sin ese parámetro el endpoint lo
sirve como descarga, que sigue siendo lo que hace el nombre del fichero.

⚠️ **`tipoParaVerEnPantalla()` es lista blanca y NUNCA acepta SVG.** Un SVG es un
XML que puede llevar `<script>` dentro: abierto en línea se ejecuta en nuestro
origen, y una de las dos pantallas es `admin.salamandrasolutions.com`. Además el
tipo con el que se sirve lo decide **la extensión que guardamos nosotros**, no el
`mime` de la ficha — ese lo declaró el navegador de quien subió el fichero, o
sea alguien de fuera. `nosniff` va siempre, en línea o descargando.

La función vive en `lib/buzon/buzon.js` y no en `buzonStorage.js` porque la
necesitan a la vez el endpoint y el navegador, y `buzonStorage` arrastra
`node:fs`.

## Correo

`lib/buzon/avisarPorCorreo.js`. Dos correos: uno a nosotros cuando entra un
aviso (con `Reply-To` a quien escribió, para poder resolverlo desde el móvil) y
uno a él cuando le contestamos.

⚠️ **No usan `RESEND_API_KEY` del entorno.** En producción está vacía —el
incidente del 03/08/2026 en `lib/email/resendClient.js`— y con la clave vacía
`sendEmail` entra en modo simulacro, devuelve `{ok:true}` y no manda nada: el
aviso se guardaría, el log diría que todo bien, y no nos enteraríamos. Salen con
las credenciales de Resend del tenant **`salamandra_solutions`**, igual que
`lib/configuracion/avisoCambio.js`. Tampoco con la clave del cliente que
reporta: le gastaríamos su cuota y su reputación de dominio.

Ninguno lleva las capturas ni el hilo completo: el correo es la notificación, la
conversación vive en el CRM.

El correo al cliente **no lleva enlace**, a propósito: el back-office no sabe por
qué dominio entra cada uno (unos por subdominio nuestro, `nutri_laura` por
`tunutrilaura.com`), y un enlace roto en un correo de soporte es peor que no
ponerlo.

## Cuando le contestamos se entera DENTRO de su CRM

Y **no por correo** (Jorge, 13/08/2026). Es gente que entra al CRM todos los
días: un correo por cada respuesta es ruido en una bandeja que ya va llena, y
saca fuera de nuestro sistema algo que ya está donde tiene que estar. Por dos
sitios:

1. **La portada y el punto del menú**, los dos leídos de `master` desde su
   propio host y con su propia sesión: `sinVerDeUsuario()` / `contarSinVer()`,
   que comparan `respondido_at` con `visto_cliente_at` (misma condición,
   `whereSinVer()`, para que no puedan discrepar). No cruzan a ningún schema.
2. **La campana** (`lib/buzon/avisarEnSuCrm.js`).

El único correo que se manda es el que nos llega a **nosotros** cuando entra un
aviso: sin él no nos enteraríamos hasta que alguien abriera el panel.

⚠️ **Ese tercero es el ÚNICO sitio del back-office que abre el schema de un
cliente**, y conviene que siga siéndolo. Hasta el 13/08/2026 ningún endpoint de
`/api/admin` lo hacía, y ese aislamiento es media razón de que exista la
separación por host. Se hizo la excepción porque la campana es donde la gente
mira. Va con tres condiciones que no son negociables y están escritas en el
propio fichero:

- Se comprueba el cliente en `master.tenants` con `status: 'active'` **antes** de
  tocar nada. Con uno de baja el schema ya no se llama igual y el INSERT
  reventaría; con uno **suspendido** es peor, porque funcionaría y escribiríamos
  una campana que nadie podrá leer jamás.
- Best-effort: no puede tumbar la respuesta, que ya está guardada.
- Solo se avisa a **quien escribió**: es el único que ve ese aviso en `/ayuda`.

El clic de la campana lleva a `/ayuda` (`notificationLink`, `case "BuzonAviso"`).

## Lo que NO hace

- No borra desde ninguna pantalla. Lo que caduca se lo lleva `podar-buzon.js`,
  que enseña lo que se va a llevar antes de llevárselo.
- No hay correo entrante: responder por email exige `RESEND_INBOUND_DOMAIN`,
  dominio verificado y webhook. El hilo vive en el CRM.
- No hay SLA, ni categorías, ni plantillas, ni IA. Somos dos.
- No hay portal público: para escribir hay que estar dentro del CRM.
- No se toca «Incidencias» de Clínica ni su taxonomía.

## Pendiente

- **Contrato de encargo de tratamiento.** Al recibir texto libre de usuarios de
  varios clientes en una tabla nuestra, pasamos a tratar datos que hasta ahora
  vivían solo en el schema de cada uno. Merece una línea en el contrato. No es
  un bloqueante; es un «que no se descubra dentro de un año».
- La poda no está en ningún cron: hoy se lanza a mano.

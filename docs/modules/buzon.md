# Buzón — que un cliente pueda abrirnos una incidencia

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es
> este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla.
> **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda
> vieja): `/admin/modulos` en el back-office o
> `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | sin moduleKey: lo tienen todos (`/ayuda` y `/api/ayuda` van con `withTenant` y sin `hasModule`); el lado nuestro se abre por host (`ADMIN_HOST`) con `candadoBuzon` |
| **Reina** | — · no es de ningún cliente: es nuestra bandeja |
| **Pantallas** | cliente: `/ayuda` → `app/(dashboard)/ayuda/page.jsx` (monta `modules/buzon/AyudaModule.jsx`; resuelve `esDemo` en servidor con `esSlugDemo`) · nosotros: `/admin/buzon` → `app/admin/buzon/page.jsx` (la bandeja; `?aviso=<id>` abre ese hilo) y la campana de la barra en `app/admin/layout.jsx` (`components/admin/CampanaBuzon.jsx`) · el punto del menú lo pinta `components/layout/Sidebar.jsx` (`EVENTO_SIN_VER`) y la portada `app/(dashboard)/page.jsx` (`sinVerDeUsuario`) |
| **Endpoints** | cliente: `app/api/ayuda/**` — 4 `route.js` (`route.js` GET/POST, `[id]`, `[id]/mensajes`, `adjuntos/[adjuntoId]`) · nosotros: `app/api/admin/buzon/**` — 6 `route.js` (`route.js`, `pendientes`, `[id]`, `[id]/mensajes`, `[id]/registro` —POST, 02/09/2026: «Enviar al registro», ver «Estados»—, `adjuntos/[adjuntoId]`) · Públicos: ninguno (para escribir hay que estar dentro del CRM) |
| **Lógica** | `lib/buzon/`: `buzon.js` (qué es un aviso válido, estados, `serializarAviso`, `LIMITES`, `tipoParaVerEnPantalla`, los dos eventos) · `buzonStore.js` (el único que toca las tablas; `whereSinVer` / `wherePendienteNuestro`) · `buzonStorage.js` (las capturas en disco) · `alRegistro.js` (la tarea que sale de un aviso; `capturasQueViajan`, 03/09/2026) · `capturasAlRegistro.js` (03/09/2026: copia esas capturas a `tablero_adjuntos`; la única pieza del Buzón que escribe en el almacén del tablero) · `quienEscribe.js` (la foto de quién escribe) · `buscarAvisos.js` (11/09/2026, AV-0118: el buscador de la lista de `/ayuda`; filtra en el navegador con la regla de `lib/utils/busqueda.js`) · `candadoBackoffice.js` (`candadoBuzon`: comprueba el host a mano) · `avisarPorCorreo.js` (el correo a nosotros, con el Resend de `salamandra_solutions`) · `avisarEnSuCrm.js` (la campana en el schema del cliente: el único sitio del back-office que lo abre) · guard de demo: `lib/demo/isDemo.js`; rate limit: `lib/utils/rateLimit.js` |
| **UI** | `modules/buzon/AyudaModule.jsx` (formulario, lista —con buscador y filtro de estado desde el 11/09/2026— e hilo del cliente; `leerRespuesta()` traduce el 413) · `components/admin/CampanaBuzon.jsx` (la campana del panel) · la bandeja vive en la propia página `app/admin/buzon/page.jsx` |
| **Modelos** | en `models/master/`: `BuzonAviso` (`buzon_avisos`; `numero` sale de `master.buzon_numero_seq`), `BuzonMensaje` (`buzon_mensajes`), `BuzonAdjunto` (`buzon_adjuntos`); sin FK a `tenants` ni a `users` (UUID sueltos + foto de texto) · registrados en `lib/db/masterDb.js` |
| **Interruptores y parámetros** | ninguno que lea el código; lo que gatea es el host (`ADMIN_HOST`) + `candadoBuzon`, el guard de la demo y el rate limit por persona; los topes viven en `LIMITES` de `lib/buzon/buzon.js` |
| **Pantallas propias** | ninguna |
| **Scripts** | sin `enable-module.js` (no hay módulo) · `scripts/migrate-buzon.js` (`npm run db:migrate:buzon`; master, idempotente, a mano en cada despliegue que traiga columna nueva; en el VPS `docker exec crm-salamandra-app-1 node scripts/migrate-buzon.js`) · `scripts/migrate-buzon-estados.js` (02/09/2026: los estados viejos `en_curso`/`esperando` al vocabulario de hoy; ensayo por defecto, `--confirm` para escribir) · `scripts/podar-buzon.js` (retención: enviados al Registro hace más de dos años, por `registro_enviado_at` o, en lo viejo, `resuelto_at`; simula sin `--confirm`; sin cron) · `scripts/buzon-triaje.mjs` (la herramienta de las skills del buzón: `listar`, `ver`, `marcar`, `responder` y `escribir`, por tubería dentro del contenedor; **`ver`** —18/09/2026, la puerta de `/incidencia`— trae UN caso entero de una sola consulta: el aviso con su hilo y sus capturas Y su tarea del Registro, casada por `registro_ficha` y, si el aviso es anterior al botón del 02/09, por la cita `AV-####` del texto; con qué se le llama lo decide `lib/incidencias/identificador.js`) |
| **Pruebas** | en `npm test`: `scripts/_smoke-buzon.mjs` (`// @prueba ligera`; estados, recorte de notas internas, las dos parejas de fechas) · `scripts/_smoke-support-serialize-buzon.mjs` (`node:test`, 20/08/2026, en `npm test`) en su mitad del buzón: `lib/buzon/buzon.js` —las referencias `AV-000X` (`referencia`); la tabla ENTERA de `estadoTrasMensaje` (2 estados × 2 autores, más los tres nombres viejos): un mensaje no mueve nada, lo viejo sale traducido; la lista blanca de `tipoParaVerEnPantalla` (el SVG no se enseña en línea: puede llevar script y una de las pantallas es el back-office); `serializarAdjunto` decide el botón «Ver» por la extensión GUARDADA y no expone la ruta del disco; `serializarAviso(..., { para: "cliente" })` le manda al cliente EXACTAMENTE sus campos, ni uno más, fijado con `deepEqual`; y los vocabularios cerrados (tipos, estados con su color, asignables, topes)— · el correo de aviso hacia NOSOTROS (`buzon/avisoNuevo`, incluida la referencia `AV-####` calculada del número cuando la fila no la trae, y los interrogantes en vez de «undefined» cuando no hay número) se prueba en `scripts/_smoke-plantillas-resto-layout.mjs` (`node:test`, 21/08/2026, en `npm test`) · con base de datos: `scripts/_smoke-ayuda-a-salamandra.mjs` (el camino `/ayuda` → master → correo; por defecto no manda nada) · `scripts/_smoke-buzon-al-registro.mjs` (`node:test`, 02/09/2026, en `npm test`): la tarea que sale de un aviso (título con prefijo por tipo, sección «Sin comprobar», cliente = slug, el texto del cliente sin «#» ni fichas que partan la tarea, el bloque entra por `crearTarea` y se vuelve a encontrar por su ficha), qué capturas viajan (por orden de llegada, tope 3, la línea `**Capturas.**` y el resto dicho; 03/09/2026), el freno de «ya está en el Registro» y los dos estados con la lectura de los viejos · `scripts/_smoke-tablero-copiar.mjs` (`node:test`, 03/09/2026, en `npm test`): el texto del botón «Copiar» del Registro, con el indicador de capturas, la orden `registro.mjs capturas <ficha>` y —desde el 18/09/2026— la línea que dice con qué se vuelve a abrir la tarea (`/incidencia AV-0169`, prefiriendo el AV a la ficha porque llega a los dos lados) · `scripts/_smoke-incidencia-identificador.mjs` (`node:test`, 18/09/2026, en `npm test`): qué es cada identificador (`AV-0169`, la ficha `s55hv5`, el UUID) y, sobre todo, que **`av0169` es el aviso 169 y no una ficha** aunque case con las dos formas · `scripts/_smoke-ayuda-buscador.mjs` (`node:test`, 11/09/2026, en `npm test`): el buscador de `/ayuda` —por qué campos se busca y por cuáles no, sin tildes ni mayúsculas, la referencia escrita de cualquier forma, texto y estado combinados sin pisarse, y la lista original sin tocar— |
| **Decisiones** | `../decisions/2026-07-28-repaso-de-seguridad.md` (guard de la demo, auditoría con resumen) · `../decisions/2026-08-12-bajas-abarcaia-quality-healim.md` (por qué vive en `master`: sobrevive a la baja) |
| **En este doc** | Las cuatro cosas que suenan parecido · Por qué vive en `master` · Tablas (`master`) · Estados · Quién ve qué · Endpoints · Adjuntos · Cuando le contestamos se entera DENTRO de su CRM |

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
- `scripts/podar-buzon.js` caduca lo enviado al Registro a los dos años (desde
  que se envió; en lo anterior al botón, desde que se resolvió), con suelo de uno.

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

### Las cuatro fechas que deciden quién tiene que mirar algo

Son dos PAREJAS, y la gracia está en que se comparan cruzadas:

| Quién escribió | Cuándo miró el otro | Enciende |
| --- | --- | --- |
| `respondido_at` (nosotros) | `visto_cliente_at` | el punto de **su** menú y el aviso de su portada |
| `cliente_escribio_at` (él) | `leido_at` (nosotros) | la **campana** de la barra del panel |

Cada pareja está escrita **dos veces**: en JavaScript (`tieneRespuestaSinVer` y
`tienePendienteNuestro`, en `lib/buzon/buzon.js`) para poder marcar una fila que
ya se tiene en la mano, y en SQL (`whereSinVer` y `wherePendienteNuestro`, en
`buzonStore.js`) para poder CONTAR sin traerse las filas. No se pueden unificar
—una corre en el navegador y la otra dentro de Postgres— y si se separan no da
ningún error: sale un número encendido sin nada que enseñar. Lo único que lo
impide es `scripts/_smoke-buzon.mjs`, que las fija caso por caso.

⚠️ **Se comparan FECHAS y no un booleano «leído»** porque a un mismo aviso se le
puede contestar dos veces. Un `leido = true` se quedaría puesto y la segunda
respuesta no avisaría de nada.

⚠️ **`leido_at` es la ÚLTIMA vez que lo abrimos, no la primera.** Nació como «la
primera» y solo se escribía si estaba a `NULL`, y por eso un cliente podía
insistir por tercera vez en un hilo ya abierto sin encender nada: su mensaje se
quedaba esperando a que alguien bajara por la lista. Si algún día vuelve un
`if (!aviso.leidoAt)` a `leerParaSalamandra`, la campana se apaga en silencio.

`cliente_escribio_at` se añadió el 13/08/2026 sobre una tabla que ya tenía
avisos, así que la migración la **crea y la rellena** mirando el último mensaje
del cliente (o el alta). Sin ese relleno los avisos anteriores contarían como
«no ha escrito nunca» y la campana nacería a cero teniendo cosas dentro.

### Sin claves ajenas, y con fotos de texto

`tenant_id` y `usuario_id` son UUID **sueltos**, y al lado van `tenant_slug`,
`tenant_nombre`, `usuario_email` y `usuario_nombre` como texto. Hay prueba de qué
pasa si no: `master.audit_logs` sí tiene FK con `ON DELETE SET NULL`, y por eso
`scripts/borrar-tenant.js` necesita una sección entera para que el histórico no
se quede sin atribución al dar de baja a alguien.

La foto de la persona la hace **`lib/buzon/quienEscribe.js`** en los dos POST
del lado del cliente (`/api/ayuda` y `/api/ayuda/[id]/mensajes`), y está aparte
porque la parte importante —de dónde sale el correo— es justo la que se hace mal
si cada endpoint la resuelve por su cuenta: `ctx.user` **no tiene email**
(`loadUserAccess` solo carga `id`, `role` y `moduleAccess`), así que
`ctx.user.email` compila, no da error y guarda `null` para siempre. La fuente
buena es la cabecera `x-user-email` que inyecta el middleware, y si el token no
la trae, `master.users`. Importa más aquí que en otros sitios: el correo es lo
ÚNICO que nos deja contestar a alguien cuyo cliente ya no exista, que es
precisamente el caso para el que se diseñó el buzón. El nombre es un extra
(sale de su ficha de equipo si la tiene); que un tenant no tenga tabla de equipo
no puede impedir que nos avise.

## Estados

Dos, y el Buzón acaba en el segundo (Rodrigo, 02/09/2026): `nuevo` → **Enviar
al registro** ⇒ `enviado`. Un aviso existe para acabar en el Registro, que es
donde se arregla; una vez allí, el Buzón lo da por cerrado (deja de estar en
«Activos», que son solo los nuevos) y lo que quede se sigue en el tablero.
Esa misma noche se quitó `resuelto`: «no tiene sentido en el buzón», decía dos
veces lo mismo que ya dice la tarea del Registro.

«Enviado» no se pone a mano: lo pone el botón de `/admin/buzon`
(`POST /api/admin/buzon/[id]/registro`), que apunta la tarea de verdad en «Sin
comprobar» del `backlog` —título `Buzón - Fallo|Duda|Mejora: <asunto>`,
cliente = slug, cuerpo con lo que cuenta el cliente, la referencia, la
pantalla y las tres líneas de rigor (`lib/buzon/alRegistro.js`,
`tareaDesdeAviso`)— por la MISMA puerta que el tablero (`crearTarea` +
`prepararPublicacion` + `publicarVersion`: misma versión, mismo historial) y
enlaza el aviso con la tarea por su ficha (`registro_ficha`,
`registro_enviado_at`; se publica primero y se marca después, para que un
fallo al publicar no deje un «enviado» sin tarea). **Las capturas del aviso
viajan con la tarea** (03/09/2026, Rodrigo: «las capturas adjuntadas al buzón
no se envían al registro»): entre publicar y marcar, `lib/buzon/capturasAlRegistro.js`
COPIA a `tablero_adjuntos` —colgadas de la ficha nueva, bajo `tablero/{ficha}/`—
las que elige `capturasQueViajan` (las del alta y las del hilo por orden de
llegada, hasta las 3 que admite una tarea), y el cuerpo lleva una línea
`**Capturas.**` con sus nombres y la orden que las baja
(`registro.mjs capturas <ficha>`, ver `../como-apuntar-en-el-tablero.md` §4.7).
Se copian y no se enlazan porque cada lado tiene su poda con su reloj. Si la
copia falla, la tarea ya está publicada: se marca «enviado» igual y el fallo
vuelve en `avisos`, que la ficha pinta donde los errores («cuélgalas a mano
desde /admin/tablero»). Se niega a apuntar dos
veces: si el aviso ya tiene ficha, o si el `backlog` ya cita su `AV-####`
(las tareas que /mailbox escribió a mano), contesta 409. La chip «Enviado al
registro» de la ficha hace lo mismo que el botón cuando el aviso aún no tiene
tarea; con tarea, solo cambia el estado. La chip «Nuevo» es la vuelta atrás a
mano, si hace falta.

Un mensaje, de quien sea, no mueve el estado (`estadoTrasMensaje()` en
`lib/buzon/buzon.js` solo traduce los nombres viejos y devuelve a «nuevo» un
estado que no exista): en qué tejado está la pelota lo dicen las parejas de
fechas (`tienePendienteNuestro`, `tieneRespuestaSinVer`), y un «sigue
pasando» sobre un aviso enviado enciende la campana del panel igual que
cualquier mensaje. El trabajo sigue en su tarea.

Hasta el 02/09/2026 hubo cuatro estados (`nuevo`, `en_curso`, `esperando`,
`resuelto`). Las filas con los tres viejos se LEEN con el nombre de hoy
(`estadoActual()`: `en_curso` y `resuelto` → enviado, `esperando` → nuevo; el
filtro y el recuento de la bandeja los suman, y `serializarAviso` ya los
traduce, así que las pantallas no los conocen) y
`scripts/migrate-buzon-estados.js` las reescribe (ensayo por defecto,
`--confirm` para escribir; datos, no estructura, por eso no va dentro de
`migrate-buzon.js`). La columna `resuelto_at` se queda, ya sin escribirse:
la poda la usa como fecha de cierre de lo anterior a ese día.

## Quién ve qué

- **El cliente ve los de TODO SU EQUIPO** (desde el 02/09/2026, AV-0015 de
  Aumenta: «si no te vamos a mandar la misma duda varias personas»). Hasta ese
  día cada usuario veía solo los suyos, con el argumento de que un aviso puede
  ser una queja sobre su propio centro; pesó más el trabajo duplicado. En
  master no hay schema que aísle nada, así que el aislamiento lo pone
  `tenant_id` (`listarDelTenant` / `leerDelTenant` en `buzonStore.js`, y el
  endpoint de adjuntos comprueba lo mismo). Lo que sigue siendo de UNO es lo
  que le toca hacer a él: el «Nueva respuesta», el punto del menú y la campana
  solo se los lleva quien escribió el aviso (`esMio` en `serializarAviso(...,
  { para: "cliente", quienMira })`; abrir un aviso ajeno NO apunta
  `visto_cliente_at`). Cada fila dice de quién es.
- **Y desde el 11/09/2026 la lista se busca** (AV-0118 de Aumenta, Olga:
  «dentro de las incidencias que te enviamos podríamos poner un buscador»; con
  más de cien avisos de todo el equipo ya no se encontraba nada bajando por la
  lista). Por asunto, texto, quién lo escribió y referencia (`AV-0123`,
  `av0123` o `123` valen), por palabras y sin tildes ni mayúsculas —la misma
  regla que el resto del CRM, `coincidePorNombre` de `lib/utils/busqueda.js`—,
  combinado con un filtro por estado (Todos / Nuevo / Enviado al registro).
  Filtra EN EL NAVEGADOR sobre la lista que ya llega entera
  (`lib/buzon/buscarAvisos.js`, fijado en `scripts/_smoke-ayuda-buscador.mjs`):
  si pidiera al servidor una lista recortada, el recuento de respuestas sin
  leer que apaga el punto del menú saldría de una lista incompleta. ⚠️ Lo que
  quede fuera del tope de 100 de `listarDelTenant` no sale ni buscando.
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
| `GET /api/admin/buzon/pendientes` | Ídem. Lo que alimenta la campana de la barra |
| `GET/PATCH /api/admin/buzon/[id]` | Ídem. PATCH solo estado, prioridad y reparto. El GET apunta `leido_at` |
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
3. **Su lista de `/ayuda`**, donde la fila lleva un «Nueva respuesta» en verde
   mientras no la abra.

Los tres **se apagan sin recargar la página**. Abrir el hilo ya apunta la visita
en la base (`GET /api/ayuda/[id]` → `marcarVistoPorCliente`), pero el punto lo
pinta el `Sidebar`, que está en el layout y no comparte estado con la pantalla:
se le avisa con un evento del navegador (`EVENTO_SIN_VER`). El número que viaja
en el evento se **cuenta de la lista que el usuario tiene delante**, no de otra
consulta, para que fila y punto no puedan decir cosas distintas. Antes de eso el
punto seguía encendido después de leer la respuesta, así que se volvía a entrar a
buscar qué se había escapado (Jorge, 13/08/2026).

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

## Y nosotros nos enteramos por la campana del panel

`components/admin/CampanaBuzon.jsx`, en la barra superior de **todas** las
pantallas de `/admin` (13/08/2026, lo pidió Jorge). Está siempre visible, tenga
o no avisos: una campana que solo aparece cuando hay algo obliga a acordarse de
que existe, y el hueco vacío también es información.

- **Qué cuenta**: avisos donde el cliente ha escrito después de la última vez que
  lo abrimos —el alta incluida—, o sea lo nuevo y lo que ha vuelto a moverse. NO
  cuenta lo que ya hemos contestado y le espera a él: eso es trabajo hecho.
- **De dónde**: `GET /api/admin/buzon/pendientes`, endpoint aparte y no un campo
  más de `GET /api/admin/buzon`. Aquel devuelve hasta cien avisos con su hilo y
  sus adjuntos, y esto se pregunta desde cualquier pantalla **cada minuto**.
- **Cuándo se repregunta**: cada 60 s, al volver a la pestaña
  (`visibilitychange`), al abrir el desplegable, y cuando la bandeja avisa por
  `EVENTO_PENDIENTES` de que se ha abierto un aviso — que es lo que hace que el
  número baje al instante en vez de al minuto siguiente.
- El desplegable lleva a `/admin/buzon?aviso=<id>`, que abre ese hilo directo. La
  bandeja limpia la query con `replaceState` para que recargar no vuelva a abrir
  el de hace media hora.
- Distingue **«Nuevo»** de **«Ha vuelto a escribir»**: el segundo suele correr
  más prisa, porque significa que ya hablamos y no le sirvió. La fila de la
  bandeja lleva la misma marca, salida de la misma función.

El evento del panel viaja **sin número** (un «vuelve a mirar») y el del CRM **con
él**. No es un descuido: allí la cuenta ya está en la lista que el usuario tiene
delante y no hace falta preguntar nada; aquí la bandeja no la sabe —lo suyo es el
recuento por estado, que es otra cosa— y la campana la pide a su endpoint, que es
una consulta pequeña.

## Triaje desde la terminal (skill `incidencias-buzon`)

Además del panel, hay una vía para que Claude tríe el buzón: la skill
`incidencias-buzon` (`.claude/skills/incidencias-buzon/SKILL.md`), que se lanza
a mano con `/incidencias-buzon` (opcionalmente con una referencia, `AV-0007`).
Solo mira los avisos de tipo «algo no funciona» —nunca dudas ni mejoras—,
comprueba contra producción si el fallo sigue pasando, y si sigue lo apunta en
el backlog del Registro y lo despliega; si ya está arreglado y puede probarlo,
le contesta al cliente.

Su herramienta es **`scripts/buzon-triaje.mjs`**, y conviene saber tres cosas:

- **Se ejecuta por tubería dentro del contenedor**, no con `docker exec node
  scripts/…`: `ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=listar
  crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs`.
  Así corre siempre la versión del repo local sin esperar a desplegar, y los
  parámetros van por variables de entorno (`TRIAJE_ACCION` = `listar` |
  `marcar` | `responder`, `TRIAJE_REF`, `TRIAJE_ESTADO`, `TRIAJE_TEXTO`,
  `TRIAJE_AUTOR`) porque la entrada estándar ya la ocupa el script. En local:
  `node --env-file=.env.local --input-type=module - < scripts/buzon-triaje.mjs`.
- **Es un script y no cuatro órdenes dentro de la skill** porque contestar son
  DOS cosas: guardar el mensaje (`anadirMensaje`) y encenderle la campana en su
  CRM (`avisarEnSuCrm`). El endpoint del panel hace las dos; una skill que
  escribiera en la base por su cuenta se dejaría la segunda el día que nadie se
  acuerde.
- **`marcar` y `responder` no escriben sin `TRIAJE_CONFIRMAR=1`**: enseñan lo
  que harían y salen. `responder` le manda un mensaje a una persona de carne y
  hueso que no se puede desenviar.

## Escribirle nosotros a una persona (15/09/2026)

Rodrigo: «quiero poder escribir a cada empleado de cada tenant desde el buzón
sin necesidad de que me hayan abierto un ticket». En `/admin/buzon`, el botón
**«Escribir a una persona»** abre `components/admin/EscribirAUnaPersona.jsx`:
cliente y persona en dos desplegables con buscador, asunto, mensaje y hasta 3
capturas, igual que el formulario de Ayuda.

- **Es un aviso más**, no otra tabla: `POST /api/admin/buzon/escribir`
  (multipart; el `GET` da los clientes y, con `?tenantId`, sus personas) crea
  la fila con `crearAvisoDeSalamandra` y `usuario_*` = el DESTINATARIO. Se marca
  en `contexto.origen = "salamandra"` (con `contexto.firmante`), no en una
  columna, para no abrir la ventana de `faltaLaTabla` en `/ayuda`;
  `limpiarContexto` no deja que el navegador del cliente escriba `origen`.
  `serializarAviso` lo saca como `deSalamandra` + `firmante`, y las dos
  pantallas firman el primer texto como nuestro.
- **Nace «contestado y sin ver»**: `respondido_at` puesto y `visto_cliente_at`
  vacío, así que le salen el «Nueva respuesta», el punto del menú y la portada;
  `avisarEnSuCrm` le toca la campana con «Salamandra te ha escrito». No sale
  correo. `cliente_escribio_at` vacío: lo nuestro no enciende nuestra campana;
  si contesta, sí.
- **A quién**: `lib/buzon/destinatarios.js` — clientes activos sin demos ni
  `salamandra_solutions`; personas = `master.users` del cliente sin las de solo
  back-office, con el nombre de su ficha de equipo (LECTURA best-effort de su
  schema). El POST comprueba que la persona es de ese cliente.
- **Lo ve su equipo**, como todo lo de Ayuda desde el 02/09/2026 (AV-0015); el
  «Nueva respuesta» y la campana, solo la persona.
- Desde la terminal: `TRIAJE_ACCION=escribir` en `scripts/buzon-triaje.mjs`
  (`TRIAJE_CLIENTE`, `TRIAJE_PARA` = usuario, correo o nombre, `TRIAJE_ASUNTO`,
  `TRIAJE_TEXTO`, `TRIAJE_AUTOR`; ensayo sin `TRIAJE_CONFIRMAR=1`).
- Auditoría `buzon.aviso_escrito`, con la referencia y el cliente, sin texto.

## Pestaña «Mensajes» y «Enviar a Resuelto» (15/09/2026, Rodrigo)

- **Mensajes**: lo que le escribimos nosotros (`contexto.origen = "salamandra"`),
  en `nuevo` y sin `cliente_escribio_at`, NO cuenta como Activo. Vive en su
  pestaña hasta que la persona contesta; entonces pasa a Activos solo. Regla
  en `esperaSuRespuesta` (`lib/buzon/buzon.js`) y su gemela SQL
  `whereMensajeSinRespuesta` (`buzonStore.js`). Al escribir a alguien, la
  bandeja salta a esa pestaña.
- **Estado `cerrado`** («Resuelto»; no `resuelto`, que es un nombre viejo que se
  lee como enviado). Lo pone solo `POST /api/admin/buzon/[id]/resuelto`
  (el PATCH lo rechaza), con `{ nota }` opcional:
  - sin tarea → entrada nueva en el documento `resuelto` bajo la fecha de hoy
    (`apuntarEnResuelto` en `lib/tablero/editor.js`, cuerpo de
    `entradaDeResuelto` en `alRegistro.js`), con ficha y capturas;
  - con tarea en el backlog → la cierra como el tablero (`cerrarTarea`,
    primero Resuelto y después backlog);
  - con ficha que ya no está en el backlog → solo marca el aviso.
  Sin nota, `notaDeCierre` pone una por defecto. Si el cliente vuelve a
  escribir, el aviso vuelve a `nuevo` (ver «El Buzón sigue al Registro»). Auditoría
  `buzon.enviado_a_resuelto`. Prueba: `_smoke-buzon-mensajes-resuelto.mjs`.

## El Buzón sigue al Registro (15/09/2026, Rodrigo)

«El objetivo es que siempre coincidan En el registro (Buzón) con Registro y
Resuelto (Buzón) con Resuelto; las Activas son un punto previo.»

- **Cerrar la tarea mueve el aviso.** `publicarVersion` (`lib/tablero/documentos.js`),
  la única puerta del texto del Registro —tablero, los dos botones del Buzón y
  `registro.mjs`/`tablero-doc.js`—, llama al publicar `backlog` o `resuelto` a
  `sincronizarConRegistro` (`lib/buzon/sincronizarConRegistro.js`; reglas puras
  en `cambiosPorElRegistro`): un aviso «En el registro» cuya tarea ya no está en
  el backlog pasa a `cerrado` (manda la ficha; la cita `AV-####` en el backlog
  solo lo retiene si la ficha no está en ningún documento, porque una tarea de
  seguimiento puede citar un aviso ya cerrado); sin ficha, solo
  si Resuelto cita su referencia. Un `cerrado` cuya ficha vuelve al backlog (y
  no está en Resuelto) vuelve a `enviado`. Lo Activo no se toca. Best-effort
  (no deshace la publicación); auditoría `buzon.sincronizado_con_registro`.
- **Pestañas Nuevo y Activo (15/09/2026 tarde).** La vieja «Activos» se llama
  **Nuevo** (clave `nuevo`: lo que nunca se ha mandado a ningún sitio, sin los
  mensajes nuestros) y ya no suma lo enviado en lo que el cliente escribió.
  **Activo** es un estado propio, `activo`: el cliente ha vuelto a escribir en
  uno que estaba En el registro o en Resuelto (`estadoTrasMensaje`; nuestro
  mensaje no lo mueve). Conserva la ficha, y la sincronización no lo toca. De
  Activo se sale con los dos botones: «Enviar al registro» vuelve a su tarea
  si sigue en el backlog (sin escribir nada) o apunta otra y guarda la vieja
  en `contexto.fichasAnteriores`; «Enviar a Resuelto» cierra su tarea si sigue
  abierta o solo marca el aviso si ya estaba cerrada. `activos` en la query se
  lee como `nuevo`.
- El 15/09/2026 se pasaron a Resuelto los 146 avisos que quedaban «En el
  registro»: ninguno tenía la tarea abierta en el backlog.
- Prueba: `scripts/_smoke-buzon-sincronizar-registro.mjs`.

### Dos avisos con el mismo asunto (19/09/2026, Rodrigo)

«Se buguea el Registro cuando trato de mandar a Resuelto más de una tarea con
el mismo nombre.» Eran tres frenos que se sumaban, y ninguno miraba lo que de
verdad identifica a una tarea desde el 24/08/2026, que es su ficha:

- **El título repetido paraba el envío.** El título de un mensaje del Buzón es
  su asunto, y dos avisos con el mismo asunto son lo normal. Ahora lo que no se
  repite en el día es el AVISO (`apuntarEnResuelto` lo desempata por su
  `AV-####`, y `crearTarea` acepta `permitirRepetido` porque el endpoint ya ha
  mirado la referencia); `comprobar` solo lo trata como error si a alguna de
  las dos le falta la ficha, que es cuando de verdad se pisan. **En Resuelto no
  se avisa siquiera** (misma tarde): la sección es un día, y el panel del Buzón
  pinta los avisos en rojo y en el sitio de los fallos, así que Rodrigo leyó
  que no se había podido mandar un mensaje que había entrado bien. En el
  backlog el aviso se queda: allí dos tareas iguales comparten tick y reparto.
- **El freno del 70 % no dejaba cerrar con el backlog casi vacío**: de dos
  tareas, cerrar una deja el 50 %. El freno pide ahora además que salgan más de
  tres (`SALIDAS_QUE_NO_FRENAN`).
- **El cierre escribía Resuelto antes de saber si el backlog pasaba.** Con eso,
  el rebote dejaba la tarea en los DOS documentos y ya no se podía reintentar
  (su ficha repetida tumbaba Resuelto). `publicarCierre` comprueba los dos y
  solo entonces escribe, en el mismo orden de siempre.

Lo que quedó escrito dos veces aquel día («Guía en PDF», ficha `y7m78h`) se
limpió a mano sacándolo del backlog.

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

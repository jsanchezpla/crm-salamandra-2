# El calendario global: un tercer host para mirar varios clientes a la vez

**Fecha:** 03/09/2026 · **Quién:** Rodrigo · **Toca a:** `calendar`, auth,
middleware, back-office, master

## Qué pidió Rodrigo

> Un subdominio dentro de Salamandra Solutions, llamado Calendar, que me
> permita acceder al calendario de los tenants que yo desee. Controlar todos
> mis calendarios desde un mismo macro calendario; poder verlos y hacer los
> retoques necesarios allí, y cada vez que quiera hacer un cambio que
> implique otro módulo —cambiar la hora o lo de dentro de esa tarea— que me
> lleve directamente al tenant. Y que ese subdominio tuviera la sesión
> iniciada automáticamente de los tenants afectados.

## Lo que había

- Una cuenta de `master.users` es de UN tenant; la sesión (JWT en cookie de
  host único, `sameSite: strict`) también. No existe «un usuario de varios
  tenants».
- Todos los clientes viven en `crm.salamandrasolutions.com`: no hay un
  subdominio por tenant, es la cookie la que dice de quién es la sesión.
- Ya había un segundo host para una sola pantalla: `admin.` (back-office),
  con lista blanca de rutas en `middleware.js`, slug reservado y su
  variable `ADMIN_HOST`.
- El Calendario de cada tenant es `calendar_tasks` en su schema, con
  asistentes, responsables, categorías y espejo en Google Calendar
  (`lib/calendar/googleSync.js`).

## Qué se decidió

1. **Un tercer host, `calendar.salamandrasolutions.com`**, con el mismo
   planteamiento que el back-office: `CALENDAR_HOST` en el entorno, lista
   blanca `SOLO_ESTO_EN_CALENDARIO` en el middleware, slugs `calendar` y
   `calendario` reservados, y sin la variable no existe en ningún sitio. A
   diferencia del back-office, aquí entran las cuentas NORMALES del CRM: no
   hay sello propio en el token.

2. **La autorización es una fila**: `master.calendario_global_vinculos`
   (`usuario_id`, `tenant_id`, `tenant_usuario_id` opcional, `color`,
   `orden`). Sin fila no se lee ni se mueve nada. No se deduce del correo
   ni del rol; la pone alguien de Salamandra por script
   (`scripts/calendario-global-vincular.js`) o desde `/admin/calendario`.
   Sin FK a propósito, como el Buzón: la baja de un cliente no tropieza con
   ella y `vinculosDe` ignora los tenants que ya no están.

3. **Ver y mover aquí; lo de dentro, en el tenant.** Desde el global se
   arrastra, se estira y se marca hecha/pendiente (`PATCH
   /api/calendario-global/eventos/{slug}/{id}`, que solo acepta fechas,
   horas, todo-el-día y estado). Título, notas, responsables, cliente,
   categoría y convocatoria se editan en el CRM del cliente. Es la regla
   literal de Rodrigo, y evita que la ficha del global se convierta en un
   segundo formulario a medias.

4. **Mismo camino que el tenant para escribir.** `moverEvento` construye el
   contexto del tenant por slug (`getTenantContextPorSlug`, nuevo en
   `tenantResolver.js`, en modo infraestructura: sin usuario, porque la
   autorización ya la dio el vínculo) y pasa por `task.update` + espejo de
   Google + `auditar` (con `desde: "calendario_global"`). No hay una segunda
   lógica de guardado.

5. **La sesión «automática» es un pase, no una cookie compartida.** La
   cookie sigue siendo de host único y estricta. El global emite un token
   firmado con secreto propio (`JWT_SECRET + "_salto"`), de UN uso y 60 s,
   ligado a la cuenta de salto del vínculo; el CRM lo canjea en
   `/api/auth/saltar` (pública en el middleware, solo en el host del CRM),
   firma los MISMOS tokens que el login y redirige a
   `/calendario?evento=<id>&fecha=<día>`, que abre la ficha nada más cargar.
   Los `jti` canjeados viven en memoria del proceso: vale con un contenedor;
   con dos habría que llevarlos a master.

6. **Cuenta de salto aparte y opcional.** Ver la agenda de un cliente y
   abrir sesión en su CRM con una cuenta de allí no son la misma decisión.
   Sin `tenant_usuario_id` el calendario se ve y se mueve, y el botón «Abrir
   en …» no aparece. La cuenta tiene que SER de ese tenant y no ser de
   back-office; se comprueba al vincular y otra vez al listar.

## Cómo se aplica

- Producción: registro A `calendar` → 187.124.51.178 (Hostinger), bloque de
  nginx propio (sin `X-Frame-Options`, con `noindex`), certificado de Let's
  Encrypt, `CALENDAR_HOST` y `CRM_PUBLIC_URL` en `.env.production`,
  `migrate-calendario-global.js` ANTES del despliegue.
- Vincular: `docker exec crm-salamandra-app-1 node
  scripts/calendario-global-vincular.js <cuenta> <slug> [--usuario <cuenta
  del tenant>] [--color #RRGGBB]`, o `/admin/calendario`.
- Un tenant sin el módulo `calendar` se lista apagado («sin Calendario») y
  no se consulta. Citas (`bookings`) NO entra en el global: es otro módulo
  y otra tabla; si algún día entra, será en solo lectura y con su propia
  decisión.
- Las acciones de auditoría nuevas (`calendario_global.*`) tienen frase en
  `lib/actividad/etiquetas.js` y cuelgan del módulo «Calendario».

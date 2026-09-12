# El calendario global ve todos los clientes, y también sus proyectos

**Fecha:** 12/09/2026 · **Quién:** Rodrigo · **Toca a:** `calendar`,
`projects`, auth, master

Amplía [el calendario global del 03/09](2026-09-03-el-calendario-global.md).
Sus puntos 2 («la fila es la autorización») y 6 («sin cuenta de salto no hay
botón») dejan de valer para las cuentas admin de Salamandra. Para cualquier
otra cuenta siguen igual.

## Qué pidió Rodrigo

> «No puedo seleccionar los calendarios que quiera ver dentro de la app
> (debería tener acceso a todos los tenants y ver el calendario que quiera), y
> no se ven las tareas traídas de proyectos. Debería tener acceso a los
> proyectos también aparte de los calendarios.»
>
> «La UI es un poco fea, está mal hecha, menos la parte del calendario puro.»

Al preguntarle, decidió dos cosas más. Si no hay cuenta vinculada, el CRM del
cliente se abre **como su admin, y auditado**, y eso solo lo pueden hacer los
admins de Salamandra. Y los proyectos se **ven y se mueven desde el global,
pero se editan en el CRM** del cliente.

## Lo que había

- Rodrigo veía los clientes que alguien le hubiera vinculado, una fila por
  cliente, por script o desde `/admin/calendario`. Un cliente nuevo no salía
  hasta que alguien se acordaba de vincularlo.
- La leyenda ocultaba clientes solo en la pantalla, después de haberlos leído
  todos, y la elección se perdía al recargar.
- Sin cuenta de salto en la fila no había botón «Abrir en…».
- `leerEventos` se saltaba entero un cliente sin el módulo `calendar`, y
  `vinculosDe` no preguntaba por `projects`. Aumenta, que tiene Proyectos y no
  Calendario, no enseñaba nada. Además, `etiquetar` habría pisado el `taskId`
  de las tarjetas de proyecto con `project-task:<uuid>`, y arrastrarlas habría
  acabado en un 500.
- La lógica de mover una tarjeta del Kanban vivía entera dentro de
  `app/api/tasks/[id]/move/route.js`. Esa ruta mira si quien mueve es admin o
  lead en ese tenant, así que a una cuenta de Salamandra le da 403. Además, el
  host `calendar.` no deja pasar `/api/tasks`.
- `/api/auth/saltar` firmaba access y refresh token y actualizaba
  `lastLoginAt`, igual que el login.

## Qué se decidió

1. **Un admin de Salamandra ve todos los clientes, sin filas.** En el global,
   `calendariosDe` (`lib/calendario-global/acceso.js`) sustituye a
   `vinculosDe`. Es admin de Salamandra la cuenta que cumple todo esto a la
   vez (`cumpleAdminSalamandra`):
   - es una cuenta del CRM (no `soloBackoffice`) con rol admin o superadmin;
   - es de `salamandra_solutions` y ese tenant está en marcha;
   - el tenant tiene `provisioning` encendido;
   - la cuenta tiene acceso a él (`moduleAccess` con `all` o `provisioning`, o
     rol superadmin).

   Es el mismo candado que abre el back-office, donde esa cuenta ya da de
   alta, suspende y mira a cualquier cliente: no se confía en nadie nuevo. Se
   lee fresco de master en cada petición, sin caché, como el rol de
   `withTenant`: si se degrada a alguien, pierde los clientes al instante. Ve
   los de `whereClientesVisibles()` (activos y sin demos, `salamandra_solutions`
   incluido). Si además tiene filas, esas le dan el color, el orden y la cuenta
   de salto de su cliente.

   Se descartó darle una fila por cliente: cada alta obligaría a acordarse de
   vincularlo, y la lista se quedaría vieja como cualquier lista a mano.

   **Quién NO:** cualquier otra cuenta sigue con sus filas, exactamente como el
   03/09 (con las demos que alguien le haya vinculado). `vinculosDe` no cambia,
   así que `/admin/calendario` y `calendario-global-vincular.js --listar`
   siguen enseñando los vínculos que existen de verdad y no la lista ampliada.
   Las cuentas de back-office siguen sin poder entrar en `calendar.`.

2. **Qué clientes se ven es una preferencia de la pantalla, no una
   autorización.** La selección se guarda en `localStorage`, con la clave
   `calendario-global:ocultos:<id de la cuenta>`. Se guardan los clientes
   OCULTOS y no los visibles, para que un cliente dado de alta mañana salga
   visible sin tocar nada. No se guarda en master por dos motivos:
   `master.users` no tiene sitio para preferencias, y meterla en
   `calendario_global_vinculos` mezclaría «qué quiero ver» con «qué puedo ver»
   en la tabla que es la autorización. Perderla (otro navegador, modo privado)
   solo cuesta volver a marcar.

   La selección viaja al servidor como `?slugs=`, que solo abre los schemas de
   los clientes elegidos en vez de leerlos todos y filtrar en el navegador. El
   servidor ignora en silencio los slugs que no le tocan a esa cuenta. **Para
   escribir, la autorización no cambia de sitio**: mover un evento, una tarjeta
   o un hito y pedir un salto vuelven a preguntar a `calendarioDe`. Ahí la
   fila, o ser admin de Salamandra, sigue siendo lo que manda. Las dos
   pestañas comparten la misma selección. «Tareas de proyectos», «Color por» y
   «Activos | Todos» también se guardan en el navegador.

3. **Proyectos en el calendario y en una pestaña propia: se ven y se mueven,
   y se editan en el CRM.**
   - **En el calendario** salen las tarjetas con fecha límite y los hitos, con
     la misma función que usa el calendario del tenant (`fetchProjectEvents`),
     en el color del cliente y detrás del interruptor «Tareas de proyectos».
     Se arrastran de día y estirarlas se deshace. `etiquetarProyecto` conserva
     el `taskId` real.
   - **Un cliente sin Calendario pero con Proyectos enseña sus proyectos**
     (Aumenta).
   - **La pestaña «Proyectos»** (`/calendario-global/proyectos`) lista los
     proyectos por cliente con su avance, las tareas vencidas y el próximo
     hito. El avance sale de `lib/projects/faseProgreso.js`, con el mismo
     cálculo que la ficha del proyecto: si el global y el CRM dieran cifras
     distintas, alguien preguntaría cuál miente. El tablero de un proyecto
     (`/calendario-global/proyectos/<slug>/<id>`) reutiliza `BoardColumn` y
     `TaskCard` del tenant, sin «+ Añadir tarea».
   - **Desde fuera se cambian tres cosas y nada más**
     (`lib/calendario-global/proyectos.js`): la columna o posición de una
     tarjeta, su fecha límite y la fecha de un hito pendiente. Todo lo demás se
     hace con «Abrir en el CRM ↗». Un proyecto archivado o cancelado no se
     toca: está fuera del tablero y del calendario del cliente, y cambiarlo
     desde fuera lo cambiaría sin que nadie lo viera. Un hito completado o no
     cumplido tampoco cambia de fecha.
   - Se escribe con el contexto del tenant DEL CLIENTE
     (`getTenantContextPorSlug`) y se audita en SU Actividad con
     `desde: "calendario_global"`: `task.moved`, `task.updated` y
     `project.milestone.updated`. Esta última es nueva: el PATCH de hitos del
     tenant no audita.

4. **Mover una tarjeta tiene una sola lógica: `lib/projects/moverTarjeta.js`.**
   Se extrajo del route del tenant: validar la columna (del mismo proyecto) y
   la posición, y reordenar en una transacción. Copiarla habría dejado dos
   formas de reordenar una columna que acabarían haciendo cosas distintas. La
   función no decide quién puede mover ni audita: eso lo hace cada puerta. El
   route del tenant la llama y conserva su permiso (admin o lead), su
   auditoría `task.moved` y su respuesta, con los mismos mensajes y códigos.
   Se comprobó que las 97 líneas del bloque viejo están, en el mismo orden,
   dentro de la función. **En el tenant no cambia nada.**

5. **Sin cuenta vinculada, se entra como el admin del cliente.** Con qué
   cuenta se salta (`decidirSalto`, por este orden):
   1. La cuenta de salto de la fila, si es de ese tenant y no es de
      back-office → `"cuenta"`, lo de siempre.
   2. Si el cliente es `salamandra_solutions`, la propia cuenta de quien mira.
      Sin este paso, un admin de Salamandra entraría en nuestro CRM como el
      admin más antiguo, que puede ser un compañero.
   3. Si quien mira es admin de Salamandra y el cliente no es demo, la cuenta
      admin más antigua del cliente que no sea de back-office (la del alta) →
      `"admin"`. El criterio es fijo a propósito: la cuenta que queda como
      autora en su CRM no puede cambiar de un clic a otro.
   4. Si no, no hay botón, y `emitirSalto` lo rechaza.

   Al canjear el pase se comprueba todo otra vez: que la cuenta sigue siendo
   admin del cliente, que el cliente no es demo y que quien pidió el pase sigue
   siendo admin de Salamandra. En los 60 s que vive el pase se puede degradar a
   alguien. El destino va en el pase como lista blanca (`destinoDelPase`:
   calendario, ficha del proyecto o tablero, con un UUID) y nunca como ruta
   libre.

6. **La sesión «como admin» es corta y no toca nada del cliente.**
   - **Solo lleva access token, sin refresh token, y se borra la cookie
     `refresh_token`.** `/api/auth/refresh` rota `tokenVersion` POR USUARIO.
     Si nuestra sesión se renovara, invalidaría el refresh token de todas las
     sesiones de esa cuenta, y la dirección del cliente, que entra con ella,
     acabaría en el login.
   - **Dura lo que el access token, 15 minutos en producción, y no se
     renueva.** El canje pone además la cookie `sesion_corta`, con la
     caducidad en milisegundos: no es httpOnly, para que la lea el navegador,
     y no autoriza nada. Con ella vigente, el `SessionKeeper` del CRM no
     intenta renovar ni por el intervalo de 12 minutos ni al volver a la
     pestaña. Antes lo intentaba, el refresh daba 401 sin refresh token y
     mandaba al login a los 10-12 minutos, con el token aún vivo y lo que
     hubiera a medio escribir (revisión del v2, mismo día). El interceptor de
     401 no cambia: cuando el token caduca, la primera petición da 401, el
     refresh falla y va al login. Para seguir, se vuelve a pulsar «Abrir en el
     CRM». Un login, un refresh o un logout normales borran la marca
     (`setAuthCookies` y `clearAuthCookies`, `lib/auth/jwt.js`).
   - **El access token lleva `imp`**, el id de la cuenta de Salamandra que
     entró. El middleware no lo mira. `withTenant` sí: lee la cookie
     `access_token`, verifica la firma (nunca se fía de una cabecera) y, si el
     token trae `imp` y es del usuario de la petición, **revalida en cada
     petición que quien entró sigue siendo admin de Salamandra**
     (`esAdminDeSalamandra`, sin caché). Si ya no lo es, 401. Antes solo se
     comprobaba al emitir y al canjear el pase: quitarle el admin un minuto
     después le dejaba dentro del cliente el resto del cuarto de hora.
   - **No toca `lastLoginAt`.** El back-office y Equipo lo enseñan como la
     última entrada del cliente, y no entró él.
   - **Se audita en el tenant del cliente**, con dos filas cuyo `userId` es la
     cuenta de Salamandra: `auth.login` con motivo
     `calendario_global:como_admin`, y `calendario_global.salto.como_admin`
     con la cuenta usada (`comoUsuario`) y el destino. En nuestro tenant queda
     además `calendario_global.salto.emitido` con `{ slug, destino, como }`.
   - **Toda fila de auditoría de esa sesión guarda quién fue.** Lo que se hace
     dentro sigue saliendo con el `userId` de la cuenta admin del cliente, y la
     Actividad lo enseña a su nombre. Pero la fila lleva
     `after.comoAdminDesde` con el id de la cuenta de Salamandra. Lo pone un
     hook del modelo `AuditLog` (`beforeCreate`) con el `impersonadorId` que
     `withTenant` deja en el contexto de la petición (`lib/ai/usoDeIA.js`).
     Así lo recogen `auditar`, `auditarLogin` y los `AuditLog.create` sueltos
     de las rutas sin tocarlos. Solo se marca un `after` nulo o un objeto
     plano (`marcarAutoria`, `lib/auth/sesionCorta.js`). Fuera de una petición
     (scripts, temporizadores) no hay contexto y la fila se guarda tal cual.
     Lo que queda: la Actividad todavía no enseña `comoAdminDesde`, así que
     para verlo hay que mirar la fila.

   La rama `"cuenta"` sigue exactamente igual que el 03/09.

## Pestañas abiertas del CRM

Cualquier salto, «como admin» o con cuenta, abre sesión en el host `crm.` de
ese navegador y **sustituye la que hubiera**: las cookies son de host, no de
pestaña. Las pestañas del CRM que ya estaban abiertas pasan a hablar con el
cliente nuevo en su siguiente petición, con la cuenta nueva, aunque sigan
enseñando lo que habían cargado del anterior. Por eso el botón «Abrir en el
CRM» lo avisa. El arreglo de fondo, que una pestaña detecte que la sesión ha
cambiado de tenant o de cuenta y se recargue o lo diga, está pendiente.

## Cómo se aplica

- No hay migración ni variables nuevas: todo lee tablas que ya existían, y la
  selección vive en el navegador. Basta con desplegar.
- Endpoints nuevos bajo `/api/calendario-global/proyectos`, que la lista
  blanca del middleware ya dejaba pasar: GET de la lista, GET del tablero,
  PATCH de tareas (`{ dueDate }` o `{ targetBoardColumnId, targetOrder }`, no
  los dos) y PATCH de hitos. Todas las rutas del global devuelven 404 fuera
  del host `calendar.` antes de tocar la base, 403 en una demo, y responden a
  los errores con `handleRouteError`.
- La interfaz se rehízo en `components/calendario-global/` (pestañas, selector
  de clientes, panel lateral, «Abrir en el CRM» que abre la pestaña antes del
  `fetch` para que el navegador no la bloquee). El FullCalendar se conserva
  tal cual.
- Frases nuevas en `lib/actividad/etiquetas.js`:
  `calendario_global.salto.como_admin` y `project.milestone.updated`.
- Pruebas ligeras: `scripts/_smoke-calendario-global.mjs` cubre `etiquetar`,
  `etiquetarProyecto`, `cumpleAdminSalamandra` y `destinoDelPase`, y
  `_smoke-actividad-etiquetas.mjs` comprueba que las acciones nuevas tienen
  frase. `scripts/_smoke-sesion-corta.mjs` cubre la sesión «como admin»:
  cuándo está vigente `sesion_corta`, el orden en que se ponen y se borran las
  cookies, `imp` en el token, `marcarAutoria` y el `impersonadorId` del
  contexto.
- En local, `salamandra_solutions` no tiene schema, así que sale como «no
  responde». Es lo esperado.
- Los comentarios que decían que no existe «entrar como»
  (`lib/team/access.js`, `app/api/admin/clientes/[slug]/admins/route.js`)
  remiten ahora a esta decisión: desde el Equipo y el back-office sigue sin
  existir.

## Lo que queda fuera

- Crear, editar o borrar tarjetas e hitos desde el global (título, asignados,
  fases, hitos nuevos): se hace en el CRM del cliente.
- Citas (`bookings`): siguen fuera del global, como el 03/09.
- Abrir una tarjeta concreta en el CRM: el tablero del tenant no lee
  `?task=`, así que el salto lleva al tablero. Para la lista de proyectos
  tampoco hay destino en el pase, y por eso la flecha va en cada fila, hacia
  su proyecto.
- **Columnas con huecos en `order`, en el Kanban del TENANT.** El global ya no
  lo sufre: `moverTarjetaGlobal` recompacta origen y destino (0, 1, 2…) y mueve
  dentro de UNA transacción, así que la posición soltada es la guardada y un
  rechazo no deja escrituras. El Kanban del cliente sigue mandando el `order` de
  la base y, con huecos, puede recibir «targetOrder fuera de rango»: se arregla
  aparte, llamando a la misma compactación desde su route.
- Pestañas del CRM ya abiertas cuando se salta (ver arriba): arreglo de fondo
  pendiente.

Probado el 12/09/2026 en local sobre `next build` + `next start`, con la base
local: 35 comprobaciones de punta a punta (mover tarjetas y fechas, rechazos,
permisos de una cuenta con vínculos, salto como admin con sus cookies, la
auditoría con `comoAdminDesde` y el 401 al degradar a quien entró) además de
`npm test`.

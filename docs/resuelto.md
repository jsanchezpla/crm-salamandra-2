# Resuelto

Lo que ya está hecho, de quién era, cuándo se cerró y cómo se comprobó.

Existe por dos motivos. Uno, para no volver a arreglar lo mismo: cuando algo
reaparece, aquí está qué se hizo la vez anterior y por qué. Y dos, para poder
mirar atrás y ver qué se ha entregado a cada cliente sin reconstruirlo del
historial de git.

---

## Cómo se usa esto

**Nada entra aquí sin haberse comprobado contra PRODUCCIÓN.** No basta con que
el código esté subido, ni con que el despliegue haya terminado: hay que ver el
comportamiento nuevo funcionando en el VPS. Si no se puede comprobar, no se
cierra — se queda en el backlog con una nota de qué se intentó.

Cada entrada lleva **cómo se comprobó**, no solo que se comprobó. Esa línea es
la que permite repetir la verificación dentro de seis meses.

Cuando una tarea sale de `backlog.md`, entra aquí **en el mismo commit**. Así no
hay un momento en que algo no esté en ninguno de los dos ficheros.

Lo más reciente arriba.

---

## 12/08/2026

### Los trece de Aumenta ven lo que tienen que ver · `aumenta`

Estaba en P1 esperando una respuesta del centro: trece personas sin acceso a
`clients`, `documents`, `formularios`, `team` y una decena más, con dos de ellas
—`rosa_aumenta` y `olga_aumenta`— sí con `billing` y `documents`, lo que parecía
un reparto a medio hacer. **Preguntado a Aumenta, el reparto es el correcto y no
hay nada que tocar** (Rodrigo, 12/08/2026):

- **Once son terapeutas** y trabajan en Pacientes y Clínica. Tienen `calendar`,
  `citas`, `clinica` y `pacientes`, que es su trabajo entero.
- **Olga y Rosa son administración y finanzas**, y por eso ellas dos suman
  `billing` y `documents`. El reparto a mano que se intuía era ese, y a propósito.
- **La dirección son otras dos personas** y entran por la cuenta de admin
  (`admin@aumenta.es`), que tiene `["all"]` y lo ve todo.

Lo que la tarea leía como un olvido era el organigrama del centro. Que once
personas no vean Facturación no es un permiso que falte: es que no facturan.

Queda apuntado, sin ser tarea: esas dos personas de dirección comparten un solo
login, así que en Equipo → Actividad sus dos rastros salen como uno.

*Cómo se comprobó*: contra el VPS el 12/08/2026, `master.users` de `aumenta` sale
partida en exactamente tres grupos, sin mezcla ni caso suelto: once con
["calendar","citas","clinica","pacientes"] (araceli, arantxa, blanca, daniela,
elena, estefanía, isabel, laura, raquelm, raquelt, silvia), dos con esos cuatro
más "billing" y "documents" (olga, rosa) y admin@aumenta.es con ["all"]. Catorce
logins: trece de rol user y uno admin.

### La agenda de Laura ya solo tiene pacientes suyas · `nutri_laura`, `healim`

Estaba en P1: dieciséis citas del equipo mezcladas con las pacientes de Laura,
seis de ellas en días que aún no habían llegado, así que parecían visitas que
tenía que atender. **Borradas el 12/08/2026** a petición de Rodrigo: «elimina de
todos lados las citas de Rodrigo, Jorge, Carlos y Rodrigo Herreros de Tejada».

Lo que se ha ido, con `scripts/borrar-citas-por-nombre.js`:

- **nutri_laura, 16 citas**: Jorge Sánchez Pla (7), Rodrigo (6, contando la que
  estaba a nombre de «Rodrigo Herreros de Tejada») y Carlos Torrents (2), más las
  5 sesiones de cobro que colgaban de ellas. Ninguna petición de cambio de hora
  ni aviso al cliente.
- **healim, 1 cita**: Jorge Sánchez Pla, del 17/06. Nadie la había visto porque
  la tarea solo hablaba de Laura; «de todos lados» era literal.
- **Y «Pruebita»**, la cancelada del 06/08 a nombre de prueba@email.com. No
  estaba en los cuatro nombres que se pidieron, así que se preguntó antes en vez
  de darla por basura: Rodrigo confirmó que también se iba.

La agenda de Laura queda en 6 citas y todas son suyas: Inés (2), Inés Chico
Cornejo, Maider Zabala Gonzalez, Cristina García y Carolina Gil —las dos últimas,
pacientes nuevas que entraron después de escribirse la tarea.

Lo que NO se ha tocado, y sigue ahí: en Pacientes de Laura hay dos fichas de
prueba, «Rodrigo» (info@agenciasalamandra.com) y «Jorge Sánchez Pla». No son
citas y no salen gratis — de esas dos cuelgan 2 contratos firmados, 2 documentos,
3 bonos de sesiones, 2 formularios y 4 formas de contacto—, así que borrarlas es
otra decisión y otra pasada. Rodrigo lo dejó para más adelante el 12/08.

⚠️ **Lo que casi sale mal, y hay que saber antes de volver a lanzar ese script.**
Su lista de fábrica lleva «Rodrigo» a secas, y su regla de coincidencia es el
nombre entero o el patrón seguido de un espacio: caza a cualquiera que se llame
Rodrigo algo. En Aumenta hay un paciente REAL, Rodrigo Sebastián Silva Leiva,
con 42 citas confirmadas de aquí a junio de 2027, y otros cinco que empiezan por
Jorge o Carlos con entre 43 y 87 citas cada uno. Lanzarlo con `--tenant aumenta`
y la lista por defecto se habría llevado 302 citas de seis pacientes de verdad,
todas futuras. Por eso se inventarió PRIMERO nombre a nombre en los once schemas
con tabla `bookings`, y en healim se lanzó con `--nombre "Jorge Sánchez Pla"` en
vez de con la lista por defecto. El peligro de este script no es el SQL: son los
homónimos.

**Hay copia de seguridad.** Las 23 filas (17 citas de nutri_laura, sus 5 cobros y
la de healim) están enteras en el schema `zzz_backup_citas_20260812`, que lleva un
COMMENT con cómo devolverlas: `INSERT INTO crm_<slug>.<tabla> SELECT * FROM
zzz_backup_citas_20260812.<tabla>`. Ese schema se puede tirar cuando Laura
confirme que su agenda está como debe.

*Cómo se comprobó*: la misma consulta de nombres contra los once schemas con
tabla `bookings`, antes y después. Antes salían 13 grupos que contenían
rodrigo/jorge/carlos/torrents/prueba; después solo los seis pacientes reales de
Aumenta, intactos con sus 12.030 citas. nutri_laura pasó de 23 citas a 6 y healim
de 6 a 5. Los bloqueos de agenda y los festivos no se tocaron: viven en
`team_blocks` y `blocked_days` y el script no abre esas tablas.

### Las «ocho familias admitidas que no podían pedir cita» no existían · `nutri_laura`

Estaba en P0: *«8 de las 13 aceptadas no tienen ficha; Laura ya les dijo que sí
y la agenda las rechaza con un 403»*. Comprobado en producción, **no hay ninguna
familia esperando a nadie**. La tarea contaba filas sin mirar quién había detrás.

Lo que hay de verdad, con `scripts/comprobar-admision.js` (solo lectura, escrito
para esto) contra el VPS el 12/08: **16 aceptadas, no 13. Nueve bloqueadas, no
ocho.** Y de esas nueve:

- **cinco son pruebas nuestras** — `prueba@email.com` repetido cuatro veces y
  `rodri@email.com`, con teléfonos correlativos inventados (666666665,
  666666654, 656666666);
- **dos son de Rodrigo**, con su nombre y su correo;
- **una es Carlos Torrents**, novio y coworker de Laura;
- **y la última, Andrea Castellanos**, que no es paciente ni ha comprado nada:
  entró en la puesta al día de usuarios de la web y Laura la descartó el 05/08.

Las que **sí** pueden reservar incluyen a Inés y a Maider, que son justo las dos
pacientes reales que identificaba la tarea de las citas de prueba, cerrada hoy
también y unas entradas más arriba. Las nueve están
bloqueadas porque su ficha ya no está, que es **exactamente lo que `3947dc0`
quería que pasara**. La puerta funciona.

También cae el diagnóstico de la tarea: el fallo no salió de `db974a2` —ése es
el del bono y el aviso amarillo— sino de `3947dc0`. Y el `SELECT ... NOT EXISTS`
que proponía como comprobación no cuenta gente bloqueada: ignora a los tutores
—la puerta resuelve la ficha con `resolvePortalClient`— y mezcla dos casos que
piden arreglos opuestos, «tiene ficha y no la vemos» y «no tiene ficha».

Es el mismo fallo del que avisa la cabecera de `backlog.md` con la tarea de los
dos pagos: una cifra escrita sin mirar quién había detrás. **Escribir la tarea y
comprobarla son el mismo acto.**

De la investigación salieron tres cosas que sí valían, y están hechas: la puerta
resuelve la ficha también por `form_submissions.client_id`, un descarte posterior
deja de quedar tapado por una aceptada vieja, y quien agota tres formularios ve
una pantalla que corta en vez de una noria. Detalle en `docs/modules/citas.md`.

*Cómo se comprobó*: `docker exec crm-salamandra-app-1 node
scripts/comprobar-admision.js nutri_laura` en el VPS el 12/08/2026 →
«Bloqueadas TENIENDO ficha (fallo nuestro): **0**». Los nombres y las fechas de
aceptación se contrastaron uno a uno con Rodrigo, que identificó a Carlos
Torrents y a Andrea Castellanos.

> ⚠️ **Estas seis se escribieron ANTES del despliegue, a petición de Jorge.** La
> regla de la casa es no cerrar nada hasta verlo funcionar en el VPS, y eso no se
> ha podido hacer todavía: el código está en el árbol de trabajo, sin commitear.
>
> Se escriben igual porque los dos ficheros viajan DENTRO de la imagen: el
> Registro no las enseñará como resueltas hasta el despliegue que las hace
> verdad, así que no hay ningún momento en el que el tablero mienta. Lo que sí
> queda pendiente es mirar el comportamiento nuevo en producción, y cada sello
> dice exactamente qué se comprobó y contra qué.

### El filtro de la agenda ya no se come la pantalla · `aumenta`

El filtro pintaba un botón por cada tipo de cita y otro por cada profesional.
En Aumenta eso son **74 botones en 10 filas**, y medido en su producción
ocupaban **379 px** cuando al calendario le quedaban **335 px** en un monitor de
1920×953: el filtro ocupaba más que la agenda. En un portátil de 768 px de alto
el día empezaba haciendo scroll para ver la primera cita. Lo sufría cada mañana
el cliente que más usa el CRM.

Ahora son **dos desplegables con casillas en una sola línea**, unos 42 px.
Desplegables con casillas y no un `<select>` normal a propósito: los dos filtros
son de selección múltiple y eso se usa —ver dos tipos a la vez, o a dos
profesionales—, y un `<select>` se lo habría llevado por delante. El componente
nuevo es `components/ui/MultiSelect.jsx`, calcado de `Select.jsx` para no
inventar un lenguaje visual nuevo, con buscador a partir de 8 opciones porque
encontrar uno entre 57 a ojo era el trabajo de verdad.

**Los dos filtros hacían cosas contrarias, y eso se acabó.** El de profesional
aislaba con el primer clic (Rodrigo, 02/08); el de tipo partía de «todos
puestos» y cada clic ESCONDÍA uno, así que para ver un tipo entre 57 había que
tachar 56. Era el mismo castigo que a los profesionales se les había quitado en
agosto, pero peor. Decisión de Jorge (12/08): **el primer clic aísla en los
dos**. La regla vive ahora en `alternar()`, un solo sitio, para que no puedan
volver a divergir sin que nadie se entere.

Tercera decisión suya del mismo día: **quedarse sin nada marcado vuelve a
«todos»**, también en los dos. Antes el de tipo dejaba el calendario EN BLANCO
sin llegar a preguntar al servidor; con chips hacían falta 57 clics para
provocarlo, pero con casillas está a uno, y un calendario vacío se lee como «han
desaparecido las citas». Con eso, la lista vacía dejó de existir y se pudo
borrar código muerto del `fetchEvents`.

⚠️ Para quien lo toque: `visibleTmIds` no solo filtra citas, también decide qué
ausencias se ven (la regla del 10/08 de que con «Todos» cada cual ve las suyas).
El contrato `null` = todos, lista = solo esos, y `[]` no existe.

*Cómo se comprobó*: primero midiendo el problema en la agenda real de Aumenta en
producción (74 botones, 10 filas, 379 px contra 335 px). Después, con un banco
de pruebas en local cargado con los 57 tipos y las 15 personas reales, clic a
clic: el primer clic aísla, el segundo suma y el botón pone «2 tipos», quitar el
último vuelve a «todos» y no a lista vacía, el buscador filtra («pedagog» → 8
resultados, «zzzz» → «Sin resultados») y el panel de 434 px no corta la etiqueta
más larga que tienen, «INFORME PARA DIAGNOSTICO (PSICO - LOGO - I.S.-SOLO TEA)».
*Falta*: verlo en la agenda de Aumenta después del despliegue.
*Dónde*: `modules/default/CitasModule.jsx` y `components/ui/MultiSelect.jsx`
(nuevo). No hay overrides de `CitasModule`, así que llega a la vez a Aumenta,
nutri_laura, healim y la demo.

### «Reorganizar con IA» ya aplica los cambios que propone · `demo`, `aumenta`, `salamandra_solutions`

El modal proponía los cambios, dejaba desmarcar los que no interesaban y al
pulsar «Aplicar cambios» pedía `POST /api/projects/[id]/ai/apply` — un endpoint
que **no existía en ningún commit**. No es que se rompiera: nunca se escribió.
Donde más dolía era en la demo, que es pública: allí la propuesta se simula sin
clave de IA, así que cualquiera a quien se le estuviera enseñando el CRM llegaba
al último botón y se comía el error.

Este endpoint ya se había escrito el 10/08 (`599e9ed`) y **Jorge lo mandó
revertir** el mismo día (`d5f7abe`), porque se había pedido por error desde otra
conversación. El 12/08 pidió rehacerlo, así que se ha recuperado ese trabajo tal
cual con `git revert -n` en vez de reescribirlo: era código ya revisado. Lo
único que hubo que fusionar a mano fue `lib/actividad/etiquetas.js`, al que la
baja de clientes le había metido tres líneas por medio.

Lo que hace, y por qué así: revalida las operaciones que manda el navegador
contra un snapshot RECIÉN leído —no contra el que generó la propuesta—, porque
el cuerpo lo manda el cliente y sin eso se podrían colar operaciones sobre otro
proyecto; y las aplica en una transacción, con las bajas al final, porque media
reorganización aplicada es peor que ninguna. No llama a la IA, así que no
necesita ni clave ni guard de demo: es justo lo que permite que la demo funcione
de punta a punta.

*Cómo se comprobó*: `npm run build` en verde y el endpoint compilado, `apply` al
lado de `edit` en `.next/server/app/api/projects/[id]/ai/`.
*Falta*: pulsar «Aplicar cambios» en la demo después del despliegue y ver que
aplica en vez de dar 404.
*Dónde*: `app/api/projects/[id]/ai/apply/route.js`.

### El moduleKey `sales` ha desaparecido del código · producto

El área comercial tenía dos claves y el código aceptaba las dos:
`hasModule("leads") || hasModule("sales")`. Eran **dieciséis guardas** en doce
ficheros de ruta, más `lib/home/summary.js`, la etiqueta de `AccessSection.jsx`
y dos semillas. La tarea decía trece y eran dieciséis.

**Quitar esos OR no era limpieza, era un cambio de autorización**, así que
primero se comprobó contra producción que no dejaba a nadie fuera: de las ocho
filas comerciales de `master.tenant_modules`, siete son `leads` y están activas,
y la única `sales` es la de la demo y está **apagada**; ningún usuario tenía
`sales` en su `module_access`. Cero clientes afectados.

De paso salió lo que lo habría roto en local: `scripts/db-sync.js` tenía `sales`
en su lista de módulos y **no tenía `leads`**. Es de donde salió esa fila de la
demo. Una demo recién sembrada se habría quedado sin módulo comercial y sin
saber por qué. Arreglado en el mismo cambio.

*Cómo se comprobó*: con una consulta de solo lectura contra `master` en
producción, listando las filas `leads`/`sales` de todos los clientes y los
usuarios con `sales` en su `module_access`. Salieron 0 filas `sales` activas y 0
usuarios.
*Falta*: que un cliente con `leads` siga viendo su módulo comercial después del
despliegue.
*Dónde*: `/api/leads/*`, `/api/referidos/*`, `/api/public/{leads,referidos}`,
`/api/analiticas`, `lib/home/summary.js`, `components/team/AccessSection.jsx`,
`scripts/{db-sync,seed-sandbox}.js`.

### El secreto del SSO se puede rotar sin cortar el portal · producto

`WIDGET_SSO_SECRETS` guardaba **un** secreto por cliente, así que cambiarlo
obligaba a tocar el CRM y WordPress al mismo segundo: entre un despliegue y el
otro, todo lo que viaja firmado dejaba de valer. Ya costó un corte en el portal
de Laura.

Ahora el valor admite una LISTA, y el reparto es lo que importa: **para
verificar lo que llega de WordPress valen todos; para firmar lo que el CRM le
manda se usa el primero**. Al revés no funcionaría — firmando con el viejo,
quitarlo de la lista volvería a ser un corte. Hay dos sitios que verifican
(`ssoToken.js` y el registro web) y tres que firman (los dos de `portalUser.js`
y el sync de formación).

Rotar pasa a ser: poner el nuevo delante y desplegar, cambiar WordPress con
calma, y quitar el viejo en el siguiente despliegue.

*Cómo se comprobó*: 14 asertos en local firmando tokens con cada secreto. Vale
el nuevo, vale el viejo, se firma con el primero, se rechaza uno que no está en
la lista, se rechaza un token de otro cliente, y una lista vacía da
`SSO_SECRET_MISSING` en vez de colarse. **El importante es el primero: el
formato de siempre —un string suelto— sigue funcionando igual**, así que
`.env.production` no hay que tocarlo el día del despliegue.
*Falta*: que el portal «Mis citas» de nutri_laura, que es el único con secreto
configurado, siga abriendo después del despliegue.
*Dónde*: `lib/citas/ssoToken.js` y `lib/formularios/registroWeb.js`.

### El Registro se puede mirar por cliente · interno

`/admin/tablero` agrupaba solo por prioridad, y la pregunta que se hace al
descolgar el teléfono —«¿cómo vamos con Aumenta?»— se contestaba escribiendo el
slug en el filtro y confiando en que estuviera bien puesto en todas las tareas.

Lo que costó no fue agrupar: fue poder hacerlo sin mentir. El troceador devolvía
el destinatario como una CADENA, así que «demo, aumenta, salamandra_solutions»
formaba un grupo propio de una sola tarea y **Aumenta enseñaba 7 de sus 10**. Un
tablero que miente por poco es peor que uno que no agrupa, porque nadie lo
comprueba. Ahora el endpoint devuelve además `quienes`, ya troceado en nombres
conocidos, y una tarea compartida aparece en todos sus grupos.

Los nombres se buscan SUELTOS dentro de la cola y **no partiendo por comas**: hay
colas escritas a mano como `· nutri_laura (y todos con citas)` que partidas por
comas inventan un cliente que no cae en ningún grupo. Se añadió
`salamandra_solutions` a la lista, que no estaba, y `varios`.

⚠️ Contrastar los grupos con un `grep` del fichero vale para los SLUGS y no para
`todos`, `producto`, `interno` ni `varios`: son palabras corrientes y aparecen
dentro del texto de algún título. Si algún día no cuadran en una de esas cuatro,
el que se equivoca es el grep.

*Cómo se comprobó*: sacando `backlog.md` y `resuelto.md` **de dentro del
contenedor de producción** y pasándoles los dos troceadores, el desplegado y el
nuevo. Sobre el backlog los dos dan 5 secciones y 27 tareas con títulos, cuerpos
y `quien` **idénticos** —o sea, el cambio no toca nada de lo que ya se ve—, y el
nuevo añade 10 grupos, con Aumenta en 10 y cero tareas sin grupo. Sobre
`resuelto.md` aparece una sola diferencia, y es el arreglo: «Cosas menores que se
cerraron de la misma pasada · varios» dejaba de tener cliente y ahora lo tiene.
*Falta*: ver el interruptor «Agrupar por» funcionando. No se pudo abrir la
pantalla: exige el módulo `provisioning` y la sesión de producción no llegó.
*Dónde*: `app/api/admin/tablero/route.js` y `app/admin/tablero/page.jsx`.

### El Registro ya no sale vacío en Windows · interno

El troceador partía los ficheros por `"\n"` y luego buscaba `/^##\s+(.+)$/`. En
JavaScript el `.` no casa con `\r`, así que en una copia de trabajo con finales
de línea de Windows **ninguna cabecera casaba**: cero secciones, cero tareas, y
la pantalla decía «Nada por aquí» — exactamente lo contrario de la verdad.

Solo lo veía quien desarrolla en Windows, y solo en local: `core.autocrlf=true`
deja LF en el repositorio y en el contenedor no hay ni un `\r`. Despistaba el
doble porque `resuelto.md` sí estaba en LF y la pestaña de al lado se veía bien,
con lo que el fallo parecía de los datos y no del código.

El arreglo es partir por `/\r?\n/`, y va en el CORTE y no en aflojar los regex:
así se limpian a la vez las cabeceras y los cuerpos, que también arrastraban un
`\r` por línea porque `join("\n").trim()` solo toca los extremos.

*Cómo se comprobó*: ejecutando el troceador real —el del fichero, no una copia—
sobre el `docs/backlog.md` de la copia de trabajo, con sus 805 caracteres `\r`.
Antes: 0 secciones y 0 tareas. Después: 5 y 27, con todos los clientes resueltos
y ningún `\r` dentro de los cuerpos.
*En producción no se daba y se comprobó también*: los dos ficheros del
contenedor tienen 0 caracteres `\r`, así que allí la salida es idéntica byte a
byte antes y después.
*Dónde*: `app/api/admin/tablero/route.js`, la línea del `split`.

---

## 11/08/2026

### Dar de alta a un cliente ejecutaba migraciones sobre los schemas de todos los demás · producto

`ensure-tenant-schema.js <slug>` prometía poner al día el schema de ESE cliente,
y usaba el slug solo para elegir QUÉ migraciones correr. Luego las lanzaba con
`spawnSync(process.execPath, [file])` —**sin un solo argumento**—, así que cada
migración decidía su propio alcance, y noventa y una de las noventa y dos
decidían «todos los clientes activos». Dar de alta a un cliente nuevo entraba en
el schema de Aumenta, con 12.030 citas y quince personas trabajando dentro.

El código lo sabía y lo daba por bueno: la cabecera del disparador decía que las
migraciones «recorren por dentro todos los tenants, así que ejecutarlas de más
es inofensivo». Lo primero era cierto y lo segundo no.

**Qué se hizo.** Cada hija se lanza ahora con `ONLY_SCHEMAS=crm_<slug>`, que no
es una variable nueva: es la que `_schema-targets.js` ya entendía en modo
exclusivo, reutilizada para que no haya dos formas de decir lo mismo. El
ayudante `scripts/_solo-este-tenant.js` la aplica, y **sin la variable devuelve
la lista intacta**, así que una migración lanzada a mano sigue siendo global,
que es como se escribieron y como tienen que seguir funcionando.

Hubo que barrer tres veces, y las tres hicieron falta:

1. Las 31 que consultan `master.tenants`.
2. Un segundo patrón que se había escapado entero —24 que enumeran schemas desde
   el catálogo de PostgreSQL (`information_schema.schemata LIKE 'crm_%'`)—, y
   ahí estaba justo la que reventaba.
3. Una última, `migrate-stage-to-string.js`, que hardcodeaba cinco slugs. Salió
   al auditar las 92 una por una para poder responder «¿me lo garantizas?». No
   escribía nada porque las nueve columnas `stage` ya eran VARCHAR, pero eso era
   el estado de ese día y no una garantía; y a los cuatro clientes posteriores a
   esa lista no les hacía nada. Ahora lee de `master.tenants` (regla 12).

**Dos fallos vecinos que salieron con él.** Un alta que fallaba a mitad dejaba
el cliente `active` sin schema, y como media docena de migraciones enumeran «los
activos», eso rompía TODAS las altas siguientes: en la prueba en local, seis de
siete. Ahora queda `suspended`. Y el aviso de fallo mentía por exceso —decía «no
se pudieron aplicar las migraciones» cuando había fallado UNA de 55—, así que
ahora dice cuántas, de cuántas y cuáles.

*Cómo se comprobó*: **con un alta real en producción**, el 11/08 a las 16:28.

- Antes, huella de los 10 schemas más `master`: por cada uno, número de tablas,
  de columnas, filas totales, un md5 de toda la estructura (tabla, columna,
  tipo, nullabilidad y default) y otro de los recuentos por tabla.
- Se creó «Prueba de huella» (`zzz_prueba_huella`) desde `/admin/clientes` con
  **20 módulos**, los mismos que Demo, el cliente más cargado que hay. Salió
  bien: 101 tablas, 20 módulos, 1 usuario, y las series `F` y `R` de facturación
  sembradas, que es la señal de que las migraciones corrieron de verdad.
- Después, misma huella: **los 10 schemas con estructura Y filas idénticas**.
  Lo único que se movió fue `master`, +23 filas, que se descomponen exactamente
  en 1 tenant + 1 usuario + 20 módulos + 1 línea de auditoría. Cada fila nueva
  de toda la base de datos era del cliente nuevo.
- Se retiró con `scripts/borrar-tenant.js` y se purgó. Huella final contra la
  del principio: **todo idéntico**, salvo `master` con +2 filas — las dos de
  auditoría, `provisioning.cliente_creado` y `provisioning.cliente_baja`, que
  por regla no se borran nunca.

**Y una cola, que es la parte que más enseña.** Jorge preguntó lo evidente:
«mira también los datos, a ver si no han cambiado». Tenía razón en la pega —
la huella comparaba **recuentos** de filas, y un `UPDATE` no cambia cuántas
hay. Varios de esos scripts son `backfill-*`, que hacen exactamente eso.

Se resolvió hacia atrás con el `xmin` de cada fila —la transacción que la
escribió por última vez, sea INSERT o UPDATE—, tomando como referencia la
propia línea de auditoría del alta (transacción 35133). Barriendo TODAS las
tablas de TODOS los schemas apareció una que no encajaba:
**`master.tenant_modules` de `nutri_laura`/`citas`, reescrita a las 16:28:41**,
trece segundos después de empezar el alta y sin línea de auditoría.

Era la Fase B de `migrate-booking-pending.js`: escribía
`feature_flags.autoConfirmPublicBookings = false` en el módulo `citas` de
Laura **con el slug a mano**, corriera quien corriera. La Fase A sí estaba
acotada (usa `byTable`, que respeta ONLY_SCHEMAS); la B no.

El valor no cambió —la migración fuerza `false` y ya estaba en `false`—, pero
el efecto real es peor que un UPDATE de más: **ese interruptor era imposible de
encender**. Si Laura activaba la autoconfirmación de reservas públicas, la
siguiente alta de cualquier otro cliente se la apagaba, en silencio y sin
rastro. Arreglado: la Fase B se omite si el alcance pedido no la incluye.

Se re-auditaron las 92 con ese criterio nuevo —slug escrito a mano **y**
escritura— y aparecieron otros dos candidatos, los dos falsos:
`migrate-client-module-assignments` compara el slug dentro del bucle ya
acotado, y en `migrate-contrato-estructurado` los slugs solo salen en un
comentario. La lección queda: contar filas no basta, y «0 sin acotar» solo
respondía por las enumeraciones de schemas, no por las escrituras en `master`
con destinatario fijo.

Se reproduce con `scripts/huella-schemas.sql` (en el repo desde este commit):
tomarla, dar de alta, volver a tomarla y comparar la columna del md5 de
estructura. Si se mueve en un schema que no sea el del cliente nuevo, ha vuelto.

*Dónde estaba*: `scripts/ensure-tenant-schema.js` (el spawn sin argumentos),
`scripts/_solo-este-tenant.js` (nuevo) y las 55 migraciones acotadas.
Commits `481178a`, `032b4fe` y `271fa80`.

---

## 10/08/2026

### Dos pacientes con el pago a plazos sin freno, y el programa sin precio · `nutri_laura`

Entró como «una paciente no puede pagar el Acompañamiento mensual» y acabó
siendo otra cosa bastante peor.

**Lo que se veía.** El programa (6 sesiones) se había quedado sin precio: la
auditoría enseña que el 07/08 a las 13:34 se guardó el tipo de cita con los tres
campos en blanco, y de paso lo mismo en «Sesión de seguimiento» y «Prueba 1€».
Un bono sin ningún precio no se puede comprar, así que el widget para al final
del formulario. El mensaje —«Esta forma de pago no está disponible para este
programa»— hablaba de la forma de pago cuando lo que faltaba era el precio, y
por eso la paciente entendió que era culpa de su tarjeta. Tampoco le apareció el
selector de pago: solo se pinta si hay cuota configurada.

**Lo que había detrás.** Las DOS suscripciones a plazos vendidas el 07/08
estaban vivas en el Stripe real de Laura **sin tope de cuotas**: calendario en
`end_behavior: release` y una sola fase. Una es de 130 €/mes de una paciente que
aceptó pagar tres veces.

**La causa real no fue la que parecía.** El primer diagnóstico —un fallo
pasajero de red al poner el tope— era falso, y también lo era culpar a
`sesionDeFactura` (se comprobó contra las dos facturas reales: identifica bien).
La causa salió al ejecutar el arreglo y RELEER de Stripe en vez de dar la
llamada por buena: `ponerTopeDeCuotas` pedía la segunda fase con `iterations`, y
la versión de API que tenemos clavada responde «Received unknown parameter:
phases[iterations]» y rechaza el update entero. Esa llamada **no había
funcionado nunca**. Y la salida temprana «si ya hay calendario, no hagas nada»
lo volvía permanente: ningún reintento lo tocaba.

**Qué se hizo.** La fase se mide ahora con `duration`, tomando el intervalo del
precio de la suscripción y no dando por hecho «mes». El guard comprueba el TOPE
en vez de la existencia del calendario. Comprar un bono deja de usar el reloj de
20 min de la retención y pasa a `HOLD_WINDOW_MS` (45), porque la página de
Stripe acepta el pago 31 y en esa franja el hueco ya estaba libre: quien tardara
pagaba y se quedaba sin cita y sin bono. Y a las dos suscripciones se les puso
el tope / se cancelaron.

*Cómo se comprobó*: 10/08/2026, y por tres caminos.
(1) Objeto crudo de Stripe: `sub_1U1lY0…` con `end_behavior: cancel`, fase 0
(07/08→07/09) + fase 1 (07/09→07/11), o sea tres cuotas y para; la de prueba de
1 €, cancelada.
(2) Compra REAL de 1 € desde el widget (Jorge, cuenta de portal propia): la
suscripción nueva nació con el tope **sola** —fase 0 + fase 1, `cancel`—, el
bono de 3 sesiones se creó, la cita quedó como sesión 1 y se cobró 1,00 € y no
los 3,00 € del total.
(3) `scripts/_smoke-fraccionado-reloj.mjs` con un reloj de prueba de Stripe:
cobra las cuotas 2 y 3, y en la 4ª no cobra nada y la suscripción se cancela
sola.
*Dónde*: `lib/payments/fraccionado.js`,
`app/api/public/c/[tenantSlug]/book/route.js:649`,
`scripts/arreglar-suscripciones-sin-tope.js`. Commits `b760bc7`, `88a6c05`,
`cc7a40e`, `db389a6`.

### «Prueba 1 euro» está a la venta · `nutri_laura`

Venía del backlog (P0). Tipo de cita visible en la agenda pública, a 3 €, con
tráfico entrando desde Instagram — y encima sin precio desde el 07/08, así que
quien lo eligiera se llevaba el mismo error que la paciente del programa.

Se le devolvió su precio (3 € / 1 € × 3) para poder probar el fraccionado con
tres euros en vez de con una paciente, y se OCULTÓ. Oculto significa que solo lo
ve quien tenga un bono activo de ese tipo, que es como Laura asigna cosas a
dedo.

*Cómo se comprobó*: 10/08/2026 —
`GET /api/public/c/nutri_laura/event-types` devuelve Valoración inicial,
Acompañamiento mensual y Supervisión profesional, y nada más.

### Los scripts que borran datos reales ya llevan seguro · producto

Era el P0 del registro y llevaba desde el 07/08 hecho en local y sin desplegar.
En el contenedor de producción no existía `_guard-datos-reales.js`, así que los
`clear-*` y los `seed-*` corrían sin freno: cualquiera que lanzase uno dentro
del contenedor —creyendo estar en local, que es como pasa siempre— se llevaba
por delante los datos de Aumenta o de Abarcaia. `seed-clinica-demo.js` empieza
con un `destroy({where:{}})` sobre pacientes, sesiones e informes, y su propia
cabecera enseñaba a lanzarlo contra `aumenta` con el slug ya escrito.

El guard pregunta por el TENANT y no por el entorno, porque mirar la
`DATABASE_URL` no sirve: dentro del contenedor apunta al host `db` de Docker y
no dice «prod» por ningún lado. Y enumera los tenants DE PRUEBA —cuatro, y no
cambian— en vez de los reales, que crecen cada vez que se firma a alguien. Así
el cliente que demos de alta mañana queda protegido hoy sin tocar nada.

De paso, `.gitignore` deja fuera `backups/`, `*.sql.gz` y `uploads/`: en el VPS
la carpeta de copias cuelga DENTRO del checkout, así que un `git clean -fd`
antes de un despliegue se las llevaba todas y un `git add -A` habría metido en
el historial los datos de salud de 1.083 familias.

*Cómo se comprobó*: 10/08/2026, tras desplegar `d68b4ce` —
`docker exec crm-salamandra-app-1 ls scripts/_guard-datos-reales.js` lo
encuentra, y los seis scripts peligrosos (`clear-aumenta-leads`,
`clear-abarcaia-leads`, `clear-quality-leads`, `seed-aumenta`, `seed-abarcaia`,
`seed-clinica-demo`) lo importan. La app quedó respondiendo 200 y sin errores.

### Abarcaia llevaba desde mayo sin poder registrar un solo lead · `abarcaia`, `quality_energy`, `retorika`

Lo encontró `check-module-tables.js` **a los cinco minutos de desplegarse**, que
es justo para lo que se hizo.

El sprint de Proyectos (05/05/2026) añadió `converted_project_id` y
`converted_to_project_at` al modelo `Lead`, que es único para todos los
clientes. Las columnas las creaba la migración de Proyectos, que filtra a
propósito por quien tiene ese módulo —para no reventar los CREATE TABLE con FK a
`projects.id`—. La decisión era correcta para las tablas de proyectos, pero se
llevó por delante dos columnas que son de LEADS y que Sequelize lee en toda
consulta de leads, tenga o no ese cliente Proyectos.

Abarcaia es un programa de referidos con formulario público que hace
`Lead.create()`. Su último lead es del **20/04**, quince días antes de que el
modelo cambiara: **todo lo que entró por ese formulario en tres meses se perdió**
sin que saltara nada.

Se arregló con un script propio y no con la migración de Proyectos, que en estos
clientes habría creado cinco tablas y hecho DROP+ADD sobre `tasks` para alguien
que no ha comprado el módulo. Dos columnas anulables, sin FK —esa FK es justo lo
que abrió el agujero—, transacción por cliente e idempotente.

*Cómo se comprobó*: antes, `Lead.count()` en los tres moría con «column
converted_project_id does not exist». Después, los tres leen: abarcaia 84 leads,
quality_energy 129, retorika 1. Y `check-module-tables.js` pasa de 3 fallos a 0.
*Commit*: `86801ad`.

### Nada comprobaba que un módulo activo tuviera sus tablas · producto

Era el chequeo que faltaba, y el primero que encontró algo de verdad (la entrada
de arriba). Los cuatro que había miran accesos, registros huérfanos y el orden
de las migraciones; ninguno miraba si las tablas que un módulo NECESITA existen
en el schema de quien lo tiene encendido, que es el fallo que ya había mordido.

`npm run db:check-tables`, solo lectura. Lee los clientes de `master.tenants` y
además se audita a sí mismo: comprueba que su mapa cubre los 101 modelos de
`models/tenant/` y todas las tablas que crean las migraciones.

Separa fallo de aviso: si el código atrapa el 42P01 y sigue —como hace la ficha
de cliente con `interactions`— es aviso, no error. Sin esa distinción,
nutri_laura salía en rojo estando perfecta.

*Cómo se comprobó*: lanzado en producción. Encontró 3 fallos reales en 3
clientes y 10 avisos de pantallas secundarias.
*Commit*: `af0992d`.

### Los correos de citas ya no llevan texto sin escapar · todos

El motivo de cancelación lo teclea la profesional y salía crudo dentro del HTML
que se le manda al paciente. Igual el nombre del servicio, el enlace de
videollamada y la ubicación de la consulta, algunos **dentro de un `href`**,
donde unas comillas se salen del atributo y lo que venga detrás ya es marcado.
Cinco plantillas.

Las versiones de TEXTO PLANO se quedan sin escapar a propósito: ahí no hay HTML
que romper y un `&amp;` se leería con las letras.

*Cómo se comprobó*: `escapeHtml` presente en las cinco plantillas del `lib/` que
corre en el contenedor.
*Commit*: `af0992d`.

### El CRM ya no acusa al banco de un cobro que nunca llegó al banco · todos

`paymentStatus: 'failed'` lo escriben dos caminos que no se parecen en nada: el
banco rechaza de verdad la captura, o el checkout caducó sin pagarse. La
pantalla elegía siempre el primero, y a una clienta de Laura se le pudo decir
que su banco había fallado siendo falso.

Ahora lee el motivo que ya estaba guardado en la cita y compara con los literales
exactos que escribe nuestro propio código. Si no lo reconoce, texto neutro: al
banco no se le culpa por defecto.

*Cómo se comprobó*: los dos literales existen tal cual en
`lib/payments/entityHooks.js:116` y `:137`. Desplegado.
*Commit*: `af0992d`.

### Laura deja de ver un bloque de Facturación que no ha comprado · `nutri_laura`

En la ficha de cualquiera de su equipo salía «Facturación · 0,00 €». El endpoint
cortaba con `!hasModule("team") && !hasModule("billing")` —una **Y** que con
Equipo encendido no cortaba nunca— y respondía 200 con ceros, porque el alta de
un cliente hace `sync()` de todos los modelos y las tablas de facturas existen
vacías en cualquier schema. El componente solo se escondía con un 403 que nunca
llegaba.

Ahora gatea por el módulo de destino, como su vecino `/api/team/[id]/projects`,
que ya estaba bien hecho.

*Cómo se comprobó*: el texto «Módulo billing no activo» está en el código
servido y el AND viejo ya no aparece en ningún chunk.
*Commit*: `af0992d`.

### Dos botones llevaban a un módulo que el cliente no ha comprado · `healim`, `nutri_laura`

«Citas → Sin profesional» no exigía ningún módulo, y Healim —que tiene agenda y
no equipo— llegaba a una pantalla cuyo único uso es asignar la cita a alguien
que no puede existir. Y las dos tarjetas fijas de «Mi espacio» no comprobaban
nada. Cerrados **en el servidor** con `notFound()`, como la lista de espera de
admisión: esconderlos del menú no basta, con la URL guardada se sigue entrando.

*Cómo se comprobó*: desplegado, con la puerta nueva en
`app/(dashboard)/citas/sin-profesional/layout.jsx`.
*Commit*: `af0992d`.

### Dos administradores no veían un módulo que su cliente paga · `retorika`, `spain_enzymes`

`admin@retorika.es` no veía `leads` y `admin@spain-enzymes.salamandra` no veía
`clients`. El fallo de las dos puertas por tercera vez: el cliente lo tiene
contratado y su `module_access` no lo lista. Se arregló con `--skip-schema`, que
era lo mínimo: los módulos ya estaban activos y sus tablas existían.

*Cómo se comprobó*: `check-module-access.js` en producción ya no marca ningún
✗ de admin (los 14 usuarios no admin que quedan son decisión de negocio).

### CLAUDE.md deja de listar los módulos de cada cliente · documentación

La tabla mentía en **5 de los 8 clientes** y le faltaban `healim` y
`salamandra_solutions` enteros. De ahí salieron dos tareas falsas del backlog el
mismo día. No es que nadie la actualizara: una lista copiada a mano de algo que
cambia cada semana siempre acaba mintiendo, y ahí mentía en silencio.

Ahora remite a `/admin/modulos` y se queda solo con lo que la base de datos no
sabe: quién es cada cliente y qué no se le puede tocar.

*Cómo se comprobó*: la tabla ya no tiene columna de módulos.
*Commit*: `af0992d`.

### Cosas menores que se cerraron de la misma pasada · varios

- **`analytics` ya se puede vender**: faltaba en el catálogo de alta, así que
  había que activarlo a mano en la base de datos. Su migración ya estaba
  registrada, comprobado antes de añadirlo: el alta sabrá crearle la tabla.
- **La cabecera de Equipo ya no dice siempre «0 inactivos»**: contaba sobre la
  página ya filtrada y el filtro por defecto los excluye.
- **El KPI «Con ficha creada»** ya no se pinta clavado a 0 en quien no tiene
  Clientes.
- **Borrado `/comercial/leads`**: código al que no llegaba nadie, con textos de
  una campaña de Retorika escritos a mano.
- **`modules/leads/LeadsModule`** deja de inventarse las etiquetas de etapa
  («Cualificado / Ganado / Perdido») y las lee de `lib/leads/stages.js`, que es
  la fuente única.
- **El backlog se llama «Registro»** en el back-office, a petición de Jorge. La
  ruta sigue en `/admin/tablero` para no romper marcadores.

*Commits*: `af0992d`, `86801ad`.

---

## 08/08/2026

### El cobro con tarjeta funciona de verdad · `nutri_laura`

Estaba pendiente desde que se montó: el código llevaba semanas escrito y probado
en local y contra Stripe de pruebas, pero ninguna tarjeta real había recorrido
el flujo entero. Ya lo ha hecho.

*Cómo se comprobó*: en producción, dos pagos completados el 07/08 — la prueba de
1 € de Rodrigo a las 10:19 y, cuarenta minutos después, **130 € cobrados de
verdad a una paciente**. Las dos citas quedaron `confirmed` y `paid`, con su
sesión de pago en `paid` y su fecha de cobro.

### El equipo ya no ve el dinero de las citas · `nutri_laura` (y todos con `citas`)

Laura se quejó de que su empleada veía en la agenda el chip «No se pudo cobrar ·
360,00 €» de una clienta. Se cortó en el SERVIDOR, no en la pantalla: el precio
de los tipos de cita ya se escondía en la interfaz desde el 06/08 y el endpoint
lo seguía devolviendo, así que la tarifa entera estaba a un clic derecho.

Un solo `lib/citas/dinero.js` decide qué es dinero y lo aplican los seis puntos
de salida. Se quitan importes y estado de cobro; Laura lo sigue viendo todo.
Quién puede confirmar una cita no cambia.

*Cómo se comprobó*: llamando a los endpoints en producción con la cuenta real de
la empleada. Antes le llegaban las 9 tarifas y las 15 citas con importe; después,
ninguna. Y en el navegador, con las dos sesiones: ella ve la solicitud entera sin
el chip, Laura la ve con sus botones de cobro.
*Commits*: `89e735e`, `6c1bae0`, `e0bb7af`.

### Pantalla de módulos y personalizaciones · interno

No se podía saber qué tenía contratado cada cliente sin abrir la base de datos:
CLAUDE.md decía que Aumenta tenía 13 módulos, local 12, los docs del sprint ~17
y en realidad eran 20. Nueva pestaña en el back-office, en tabla, con filtro por
módulo y una columna que separa los cuatro tipos de personalización según lo que
cuesta mantener cada uno.

*Cómo se comprobó*: abierta en el navegador con sesión de back-office; sale la
tabla con los 8 clientes y sus personalizaciones. En producción, `/admin/modulos`
responde y el endpoint está en el código desplegado.
*Commit*: `483de53`.

### La portada enseña el trabajo del cliente · todos

Aumenta —centro de psicología, 20 módulos, quince personas— abría el CRM cada
mañana sin atajo a Pacientes ni a Clínica, y con uno a «Inventario · Materia
prima y producto». Y con una tarjeta de «0 pedidos» todos los días.

Los accesos rápidos eran una lista escrita a mano paralela al menú, que se quedó
en los nueve de la primera versión. Ahora están los clínicos, equipo,
solicitudes, documentos y soporte. Y un bloque del resumen sin nada que contar ya
no se pinta: tener un módulo encendido no es usarlo.

*Cómo se comprobó*: en el navegador con el tenant de Aumenta — Citas, Pacientes
y Clínica encabezan los accesos y los bloques vacíos desaparecen. En producción,
el código desplegado tiene el atajo a `pacientes` y ya no tiene `sales`.
*Commit*: `faf77fc`.

### El correo de Aumenta funciona · `aumenta`

Era el bloqueo de todo: sin correo no se puede dar de alta a una familia, porque
el alta se hace mandando un enlace. Cuenta de Resend creada, dominio verificado
con DKIM y SPF (el CNAME de rastreo se dejó fuera a propósito: no se quieren
rastrear clics de pacientes), y clave y remitente puestos en el CRM.

*Cómo se comprobó*: dos correos enviados desde producción con la misma tubería
que usan las citas, a `info@salamandrasolutions.com` (id `060ac459…`) y a
`jsanchezpla@gmail.com` (id `e1b0f53e…`). Los dos salieron.

### El portal de citas de Aumenta, montado · `aumenta`

Secreto SSO generado y cargado, y las URLs del portal y del acceso configuradas
(`/mi-espacio/` y `wp-login.php`). El tema de su WordPress ya estaba bien: firma
un JWT HS256 con los mismos campos que espera el CRM.

*Cómo se comprobó*: firmando en producción un pase exactamente como lo firma
`aumenta-portal.php` y pasándolo por el verificador real — aceptado. Y un pase
firmado con otro secreto, rechazado. Las dos páginas del widget responden.

### Rotado el secreto SSO de Laura · `nutri_laura`

Se expuso en un chat por un error mío al enmascararlo. Se rotó de forma
coordinada con el `wp-config.php` de su web para que el corte durase segundos.

*Cómo se comprobó*: el CRM usa el secreto nuevo y un pase firmado con él se
acepta; el portal de Laura sigue dejando entrar.

### Borrado el rastro de pruebas en el cliente de Laura · `nutri_laura`

Dos filas de una cuenta de pruebas —una solicitud del formulario y un usuario de
formación— en la base de datos de una clienta real. Borradas en una transacción,
con respaldo previo. No se tocó ni la cuenta de acceso ni la auditoría.

*Cómo se comprobó*: volviendo a buscar ese correo en los 20 sitios donde podía
estar. Cero filas.

---

## 06–07/08/2026

### Botones de ayuda «?» en todo el CRM · todos

53 globos en unas 76 pantallas. Explican lo que sorprende de verdad la primera
vez, sacado de leer los endpoints: que el trimestre del IVA es el en curso y no
el que se declara; que «Compartidos» no es lo que sube el equipo sino el archivo
central, y borrar ahí borra también de la ficha; que el aviso de SLA ignora los
filtros; que marcar «Inactivo» borra el usuario del CRM.

Lo que costó fue no escribir de más: Facturación salió con 44 y hubo que quitar
24. Con el criterio dado de entrada, Equipo salió a una por pantalla y a la
primera. El detalle y los ocho bugs que aparecieron de camino están al final de
`runbook-ayudas-crm.md`.

*Cómo se comprobó*: recuento de `<HelpTooltip>` por módulo, lint y build en
verde, y desplegado.

### A la primera visita solo se llega por el formulario · `nutri_laura`

La valoración inicial se había quedado sin ninguna puerta: no firma contrato
(por diseño), no pasa por caja cuando es gratis, y lo único que quedaba era el
«una sola vez por persona», que cruza por un correo que escribe quien manda la
petición. Puerta propia, apagada de fábrica, que solo aplica a la primera visita
para no cerrarle la agenda al paciente de siempre.

*Cómo se comprobó*: 12 comprobaciones automáticas, incluida la que asegura que
un seguimiento sigue reservándose sin formulario. Encendida en producción.

### El DNI se pide una vez y llega a la ficha · `nutri_laura`

Campo en el formulario de primer contacto que aterriza en la ficha, para no
volver a pedirlo al firmar el contrato. Es el DNI de quien firma —el paciente
puede ser menor— y no es obligatorio: la puerta de entrada no es sitio para un
trámite.

*Cómo se comprobó*: 10 comprobaciones de punta a punta contra el endpoint real,
y el campo servido por el formulario público en producción.

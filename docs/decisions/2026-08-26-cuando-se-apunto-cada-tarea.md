# Cuándo se apuntó cada tarea, y por qué hubo que reconstruirlo

**26/08/2026 · Jorge** · Registro (`/admin/tablero`), `lib/tablero/`,
`master.tablero_estado`

---

## Lo que se pidió

> «Quiero que en el backlog (Registro de admin.salamandrasolutions.com) se
> apunte la fecha de cuando se añadió la tarea y que se pueda ordenar por fecha,
> de momento solo está ordenado por prioridad.»

Dos cosas, y la segunda no vale sin la primera.

## Por qué el Registro no sabía la fecha

El texto del Registro es markdown y **no lleva fechas**: una tarea es un `###`
con su cuerpo y su sello, y el sello dice cuándo se COMPROBÓ, no cuándo se
apuntó. Las secciones tampoco: en `backlog` son prioridades, y solo en
`resuelto` son fechas — la del día en que se cerró.

Se descartó **escribir la fecha dentro del texto** (como se hizo con la ficha
`<!--id:…-->` el 24/08). La ficha tenía un motivo que la fecha no tiene: de ella
cuelgan ficheros en disco que se quedarían huérfanos. Una fecha, en cambio,
tendría que escribirla a mano quien apunta desde `registro.mjs` — y se
olvidaría — o inyectarla el propio publicador, que sería reescribir el texto de
alguien a sus espaldas. Va donde ya vive todo lo que no es el texto:
`master.tablero_estado`, en una columna nueva, `apuntada_en`.

⚠️ Esa tabla ya tenía un `created_at` que se parece demasiado y dice otra cosa:
cuándo nació **la fila** —la primera vez que alguien tocó el tick o el reparto de
esa tarea—, que puede ser días después de escribirla, o no pasar nunca.

## Cómo se rellena, y el detalle que la sostiene

Al Registro se escribe por **dos puertas** —el tablero y `scripts/registro.mjs`—
y las dos pasan por `publicarVersion`. Así que el sello se pone ahí, una vez:
`sellarAltas` mira el texto recién publicado y le pone la fecha de hoy a las
tareas que aún no la tengan.

**Y no pisa nunca una fecha que ya esté puesta.** Eso no es prudencia, es lo que
hace que **cerrar una tarea no la rejuvenezca**: cerrar es publicar DOS
documentos —sale del backlog, entra en `resuelto`— y desde el punto de vista de
`resuelto` esa tarea acaba de llegar. Con sobrescritura, toda tarea cerrada
diría que se apuntó el día que se cerró.

De ahí salió el único efecto secundario del cambio, y es de los que no se ven:
al reescribir un título desde el tablero, `publicar` corre ANTES que
`mudarEstado`, así que `sellarAltas` ya le ha creado a la tarea una fila nueva
—con la fecha de hoy— cuando `mudarEstado` va a mudarle la clave a la vieja. Y
`mudarEstado`, hasta ese día, resolvía el choque **tirando la fila vieja**. O
sea: reescribir un título habría borrado el tick, el reparto, la solución escrita
y la fecha de verdad, dejando en su sitio una fila recién nacida. Ahora **funde**
(`fundirEstado`, en `lib/tablero/estado.js`, con sus ocho pruebas): lo que la
nueva no tenga se lo queda de la vieja, y de las dos fechas manda la más antigua.

## Reconstruir las 152 que ya estaban escritas

Sin las viejas, el orden por fecha nace mintiendo: o todas el mismo día, o todas
sin fecha. La respuesta ya estaba escrita — `master.tablero_documentos` es
**append-only** y guarda las últimas 50 versiones de cada documento, así que
basta recorrerlas de la más vieja a la más nueva y ver dónde aparece cada tarea
por primera vez (`scripts/sembrar-fechas-de-alta.js`).

Hicieron falta tres apaños, y los tres nacen de que **una tarea se identifica por
su título**:

**1. Los renombrados.** El 25/08 se reescribieron ONCE títulos de golpe para que
se leyeran en cristiano (v30 del backlog: +11 y −11). Para el recorrido, eso son
once tareas que se van y once que llegan: **diez de las veinte tareas vivas
dirían que se apuntaron el 25/08**, que es el día que se les cambió el nombre. Se
emparejan por tres cosas, en orden — la ficha `<!--id:…-->` (lo único de verdad
estable, pero solo la llevan las tareas tocadas desde el tablero), el **cuerpo
idéntico** (que casó 9 de los 11, porque a dos también se les retocó el texto) y
el **título parecido**, la mitad de las palabras largas en común, que recoge esos
dos. En producción la escalera sigue **14 renombrados** en total —los once de la
v30 y tres sueltos de otras versiones— y los imprime todos antes de escribir
nada, para poder mirarlos.

**2. Lo anterior a la mudanza.** El Registro vivió en `docs/backlog.md` (git) del
08/08 al 19/08/2026, y las versiones de la tabla empiezan ahí: lo que ya estaba
escrito el día de la mudanza sale como «apuntado el 19/08». Son **tres** tareas
del backlog de hoy, y las tres llevan su fecha de verdad escrita a mano en el
script, sacada del commit que las apuntó: dos del **12/08** (`3914e29` y
`297073f`) y una del **17/08** (`ac6f8b2`, la del «ganado» del embudo). Con eso,
**ninguna de las veinte tareas vivas queda fechada el día de la mudanza**, que
era la señal de que el dato seguía sin saberse.

**3. El techo de Resuelto.** Ahí el problema era al revés y era gordo: **104 de
las 132 tareas cerradas** ya lo estaban el día de la mudanza, así que todas
dirían «apuntada el 19/08» estando **cerradas antes**. Como las secciones de
`resuelto` SON fechas, hay un techo escrito en el propio documento: una tarea no
puede haberse apuntado después del día en que se cerró. Cuando la reconstrucción
da algo posterior, manda el techo — y en producción son **105** las que lo
usan, repartidas entre el 07/08 y el 25/08 en vez de amontonadas en un día.

## Lo que se ve en la pantalla

La fecha va en la fila cerrada de cada tarea, **sin recuadro** y en gris: la fila
ya lleva dos (prioridad y cliente) y un tercero la convierte en un formulario.
Sin año mientras sea el de hoy; en cuanto una tarea cumple el año, aparece — y
esa es justo la que interesa ver.

Y el orden es un control **aparte** del de agrupar, no otro valor suyo:
«Ordenar · Prioridad / Recientes / Antiguas» se aplica DENTRO de los bloques que
haya. Son dos preguntas distintas y se combinan: por cliente + antiguas contesta
«¿qué le llevamos debiendo más tiempo a Aumenta?», que agrupando solo no se ve.
`Prioridad` es el orden de siempre —el del documento— y es el que sale por
defecto: una pantalla no cambia de aspecto sola el día que se despliega algo.

Las tareas **sin** fecha van al final en los dos sentidos, y esto es lo único
que no es obvio: «no se sabe cuándo se apuntó» no es «se apuntó hace
muchísimo». Si se colaran arriba, la lista de lo más antiguo empezaría por lo
que no sabe.

## El orden del despliegue

La migración **va antes**. La columna es aditiva y sin valor por defecto, o sea
invisible para el código que ya está desplegado; al revés, en cambio, es feo y
silencioso: Sequelize pide las columnas por nombre, así que sin `apuntada_en` el
`SELECT` de `estadosGuardados` da 42703, y ese fallo está tragado a propósito —
el tablero se vería **sin tick, sin reparto y sin fechas**, sin decir por qué.

Y la siembra va antes del despliegue también, o al menos antes de la primera
publicación que venga después: si se publica algo con el código nuevo y la tabla
todavía vacía, `sellarAltas` fechará las 152 con el día de hoy. Tiene arreglo
(`--rehacer` pisa lo que haya), pero es un rodeo que no hace falta dar.

## Lo que sigue sin saberse

Nada de esto recupera lo que pasó **antes del 08/08/2026**, que es cuando nació
el Registro: no hay dónde mirarlo. Y una tarea reescrita **a mano** en el
markdown —bajando el Registro y editando el fichero— sigue perdiendo su fila,
como pierde el tick y el reparto; con la diferencia de que la fecha no se queda
vacía, se la vuelve a poner la siguiente publicación con la de hoy, y la tarea
parece recién apuntada. La receta para no perderla está en
`docs/como-apuntar-en-el-tablero.md` §1.

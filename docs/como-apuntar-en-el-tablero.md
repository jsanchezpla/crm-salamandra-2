# Cómo se apunta una tarea en el tablero

**Para Rodrigo y Jorge, y sobre todo para su Claude.** Cuando digáis «apunta
esto en el backlog», lo que tiene que pasar es que la tarea aparezca en
<https://admin.salamandrasolutions.com/admin/tablero>. Aquí está cómo, y las
cosas que salen mal **sin dar ningún error**.

Léelo antes de tocar el Registro. El texto no se procesa con una librería de
markdown: se trocea a mano en `lib/tablero/parser.js`, y un encabezado mal
puesto no rompe nada — simplemente parte la tarea en dos, o la deja sin
cliente, o la esconde. Desde el 19/08/2026 hay una red: `subir` pasa el texto
por ese mismo troceador **antes** de guardarlo y se niega si no casa.

---

## 1. Dónde vive el Registro (desde el 19/08/2026)

El TEXTO de cada tarea vive en **`master.tablero_documentos`**, en producción:
dos documentos, `backlog` y `resuelto`, en el mismo markdown de siempre, **una
fila por versión**. El tablero lee la versión más alta de cada uno. No hay
formulario para escribir una tarea desde la pantalla: se escribe en un fichero
local, se sube, y ya está.

| Documento | Sale en la pestaña | Qué es |
| --- | --- | --- |
| `backlog` | **Pendiente** | Lo que falta por hacer. |
| `resuelto` | **Resuelto** | Lo cerrado, con cómo se comprobó. |

Hasta ese día eran `docs/backlog.md` y `docs/resuelto.md`, dentro del repo y
**dentro de la imagen de Docker**, así que apuntar una tarea costaba commit +
build + `deploy.sh`. Jorge quiso reservar los commits para código — «algo que
haya que poder volver atrás» — y no para apuntar en un fichero. Ahora apuntar
son segundos, el apunte sobrevive a cualquier despliegue, y «volver atrás» lo da
el historial de versiones. Lo que se perdió con el cambio, sabido: el `git
blame` (lo sustituye `historial`, con quién y por qué publicó cada versión) y el
diff de git que delataba un `###` mal puesto (lo sustituye la comprobación de
`subir`).

### Lo que SÍ se toca desde la pantalla (12/08/2026)

Tres cosas, y ninguna es el texto: **de quién es cada tarea** (Rodrigo o
Jorge), **un tick** que la manda a Resuelto —quitándolo, vuelve a Pendiente— y
**la solución** escrita a mano. Van a `master.tablero_estado`, aparte, y se
pintan ENCIMA del texto publicado.

Tres cosas que hay que saber antes de fiarse del tick:

- **Marcar aquí NO cierra una tarea.** Cerrarla sigue siendo moverla a Resuelto
  y publicar. Lo marcado a mano cae en su propio bloque, «Marcadas desde el
  Registro», con la etiqueta «sin publicar».
- **Solo se guarda lo que se desvía del texto.** Marcar una tarea que ya está en
  Resuelto no crea ninguna fila. Cuando alguien la cierra de verdad y publica,
  el apaño desaparece solo.
- **La clave es el título normalizado.** Si reescribes el título de una tarea,
  su tick, su reparto y su solución se quedan huérfanos y la tarea vuelve a
  salir donde diga el texto. No da error; simplemente deja de casar.

---

## 2. Bajar, editar, subir

Tres órdenes, desde la raíz del repo, con `node` (en PowerShell o en bash, da
igual: el script pasa los bytes tal cual, que es lo que PowerShell no hace con
una tubería y por lo que existe el envoltorio).

```bash
node scripts/registro.mjs bajar
```

Deja `docs/registro/backlog.md` y `docs/registro/resuelto.md` con lo que hay
publicado en producción, y apunta en `docs/registro/.versiones.json` qué versión
bajó. **La carpeta está en `.gitignore`**: es una copia de trabajo, no la
fuente. Se edita con el editor que sea.

```bash
node scripts/registro.mjs subir backlog --nota "apuntar el buscador de aumenta"
```

Sin `--confirm` es un **ensayo**: comprueba el formato (§4), enseña qué tareas
entran y cuáles salen respecto a la versión publicada, y los avisos. No escribe.

```bash
node scripts/registro.mjs subir backlog --nota "apuntar el buscador de aumenta" --confirm
```

Publica la versión siguiente. La `--nota` es obligatoria con `--confirm`: es lo
que luego se lee en `historial` para saber por qué cambió cada versión. El
tablero lo enseña al instante, sin desplegar nada: en la cabecera sale
«Pendiente · v13 · 19/08 16:40 · jorge · «apuntar el buscador de aumenta»».

Lo demás:

```bash
node scripts/registro.mjs estado                      # qué versión hay publicada de cada uno
node scripts/registro.mjs historial backlog           # las últimas 20, con quién y por qué
node scripts/registro.mjs restaurar backlog 12 --confirm   # la v12 vuelve a ser la actual (como versión nueva)
node scripts/registro.mjs bajar --local               # lo mismo contra la base de local (npm run dev)
```

### Los frenos de `subir`, y cuál se puede levantar

| Freno | Qué es | Se levanta con |
| --- | --- | --- |
| **Errores de formato** (§4) | Sección que no es de las fijas, tarea antes de la primera sección, dos tareas con el mismo título, fecha mal puesta en resuelto… | Nada. Se arreglan. |
| **La base ya no es la publicada** | Bajaste la v12, el socio publicó la v13 mientras editabas. Subir pisaría lo suyo. | Vuelve a bajar y aplica tu cambio encima. `--forzar` publica igual y se dice qué se pierde. |
| **Encogimiento** | Salen más del 30 % de las tareas. Eso no es apuntar ni cerrar una: parece medio fichero pegado. | `--forzar`, si es de verdad. |
| **Sin cambios** | El texto es idéntico a la versión publicada. | No es un freno: no se publica nada y se dice. |

El segundo freno es lo que antes era «si `docs/backlog.md` aparece en el diff
con `origin/master`, PARA Y PREGUNTA»: dos personas escriben en el Registro, y
ahora el cerrojo es la versión, no el fichero.

### En el VPS, a mano

Lo que hace el envoltorio por dentro, por si no hay local:

```bash
docker exec crm-salamandra-app-1 node scripts/tablero-doc.js estado
docker exec crm-salamandra-app-1 node scripts/tablero-doc.js leer backlog > /tmp/backlog.md
docker exec -i crm-salamandra-app-1 node scripts/tablero-doc.js publicar backlog --nota "…" --confirm < /tmp/backlog.md
```

---

## 3. El formato, exacto

Una tarea es un `###` dentro de una sección `##`. Esta es la plantilla completa:

```markdown
### Qué pasa hoy, en una línea · `nutri_laura`

Dos o tres párrafos: qué pasa, a quién le pasa, qué se rompe si no se hace y
qué se sabe ya. Se escribe para que se entienda dentro de seis meses sin
preguntarle a nadie.

*Se comprueba*: la consulta, el clic o el comando que dice si sigue pasando.
*Dónde*: `lib/citas/puertaFormulario.js:98-105`.
*Comprobado en producción*: 10/08/2026 — qué salió al mirarlo.
```

Línea por línea:

- **El título dice qué pasa hoy, no qué hay que programar.** «El aviso de SLA
  cuenta tickets que no se ven» se entiende siempre; «arreglar contador», no.
- **El cliente va detrás de un `·`**, con su slug tal cual está en base de datos
  (con guión bajo). Si son varios, separados por comas. Si es del producto y no
  de un cliente: `· producto`, `· todos` o `· interno`.
- **`*Se comprueba*`** es obligatorio. Sin eso, la tarea no se puede cerrar sin
  fiarse de la palabra de alguien.
- **`*Dónde*`**, con fichero y línea si se sabe.
- **`*Comprobado en producción*`** con fecha, siempre lo último. Sin sello la
  tarea no vale: puede llevar meses arreglada y nadie lo sabe.

`subir` **avisa** (no frena) de una tarea del backlog sin `*Se comprueba*`, sin
sello o sin cliente reconocido.

---

## 4. Las trampas del parser

Ninguna da error en el tablero. Desde el 19/08/2026, `subir` frena las cuatro
primeras y avisa de la quinta.

### 4.1 El cliente se separa por el ÚLTIMO `·`, y solo si es un slug conocido

El troceador coge lo que hay detrás del último punto medio y **solo lo trata
como cliente si reconoce el nombre**. Los que reconoce (`SLUGS` en
`lib/tablero/parser.js`):

```
aumenta · nutri_laura · spain_enzymes · quality_energy
retorika · abarcaia · healim · demo · sandbox
salamandra_solutions · somos · gm_alvar_alonso
demo_clinica · demo_nutricion · demo_agencia
```

...más `todos`, `producto`, `interno`, `documentación` y `varios`.

**Si son varios, se escriben separados por comas** y la tarea sale en el grupo
de cada uno. Los nombres se buscan sueltos dentro de la cola, no partiendo por
comas, para que una cola escrita a mano como `· nutri_laura (y todos con citas)`
siga entendiéndose. Aun así, cuanto más limpia la lista, mejor.

⚠️ **Un nombre que no esté en esa lista no existe para el tablero.** La tarea se
pinta con la cola metida dentro del título y sin etiqueta de cliente, y no cae
en ningún grupo (`subir` lo avisa). Si damos de alta un cliente nuevo, hay que
**añadir su slug a `SLUGS`** en `lib/tablero/parser.js` — no se lee de la base
de datos a propósito, porque el tablero también habla de clientes que ya no
están y de cosas que no son un cliente. Eso sí es un cambio de código, con su
despliegue.

Y al revés: **no uses `·` en el título por otro motivo**. Si el título lleva un
punto medio decorativo y detrás no hay un nombre conocido, no pasa nada; pero si
detrás hay por casualidad uno de esos nombres, te parte el título por ahí.

### 4.2 Nada de `##` ni `###` dentro del cuerpo de una tarea

Un `###` en mitad del texto **abre una tarea nueva** y se lleva el resto del
cuerpo. Un `##` abre una sección nueva. Es la forma más rápida de partir una
tarea en dos mitades sin sentido.

Para dar estructura al cuerpo, se usa negrita al principio del párrafo, que es
lo que hacen todas las entradas de ahora:

```markdown
**Lo que se veía.** El programa se había quedado sin precio…

**Lo que había detrás.** Las dos suscripciones estaban vivas sin tope…
```

Listas con `-` y bloques de código sí se pueden usar sin problema.

### 4.3 Las secciones son fijas — no se inventan

En `backlog` hay estas y solo estas (`subir` frena cualquier otra):

| Sección | Se pinta | Qué significa |
| --- | --- | --- |
| `## P0 — hoy` | rojo, «hoy» | Está pasando ahora y cuesta dinero, clientes o datos. |
| `## P1 — esta semana` | ámbar, «esta semana» | Un cliente se lo va a encontrar ya, o le bloquea algo. |
| `## P2 — cuando se pueda` | gris, «cuando se pueda» | Mejora clara, sin fecha. |
| `## P3 — deuda` | tenue, «deuda» | Deuda o limpieza. También los fallos reales que hoy nadie puede ver. |
| `## Pendiente de una decisión suya` | verde, «lo decidís vosotros» | No se puede hacer sin que Jorge o Rodrigo elijan. |

La sección `## Cómo se usa esto` se descarta a propósito (sus apartados son
`###` y se colaban como tareas falsas, inflando la cuenta). No metas tareas ahí.

### 4.4 El cuerpo se pinta TAL CUAL: los asteriscos se ven

La pantalla imprime el cuerpo con `whitespace-pre-wrap`, sin convertir markdown.
Los `**negrita**` y las comillas invertidas **se ven literalmente** en el
tablero. Se sigue escribiendo con ellos porque el texto también se lee en el
editor, pero **tiene que entenderse sin formato**: nada de tablas markdown en el
cuerpo de una tarea, que en el tablero salen como una fila de barras
verticales.

### 4.5 Dos tareas con el mismo título en la misma sección

React las usa como clave. `subir` frena. Cambia una de las dos.

---

## 5. Dónde va cada cosa en `resuelto`

Las secciones son **fechas**, `## DD/MM/AAAA`, y **lo más reciente va arriba**
(`subir` frena una fecha que no lo sea, una repetida o una fuera de orden). Si
ya existe la sección del día, la entrada va dentro de esa; no se crea otra
igual.

Cada entrada lleva **cómo se comprobó**, no solo que se comprobó. Esa línea es
la que permite repetir la verificación dentro de seis meses.

---

## 6. Las dos reglas que no son de formato

Estas dos son las importantes, y no las impone el código: las impone que el
tablero sirva para algo.

**Antes de AÑADIR, comprueba que el problema pasa en producción.** Local y el
VPS divergen mucho (Aumenta tiene 12 módulos en local y 20 en producción, 15
citas frente a 12.030). Un fallo que se ve aquí puede no existir allí. Una tarea
falsa hace perder una tarde — y ya ha pasado: en el repaso del 09/08 había
escrita una que decía «el cobro con tarjeta no se ha completado nunca» cuando en
producción había dos pagos hechos, uno de 130 € de una paciente real.

**Antes de QUITAR, comprueba que el arreglo funciona en producción.** No basta
con que el código esté subido ni con que el despliegue haya terminado: hay que
ver el comportamiento nuevo. Si no se puede comprobar, la tarea se queda con una
nota de qué se intentó.

**Cerrar una tarea es moverla, no borrarla**: sale de `backlog` y entra en
`resuelto` **en la misma publicación** (se editan los dos ficheros y se suben
uno detrás del otro), para que no haya un momento en que algo no esté en
ninguno de los dos. Cuando el cierre va con un arreglo de código, el código va a
git con su commit y el cierre va al Registro con el hash de ese commit en el
sello — ya no van en el mismo sitio, y por eso el hash importa más que antes.

---

## 7. Checklist para Claude

Cuando Rodrigo o Jorge digan «apunta esto en el backlog»:

1. **Comprobarlo contra producción primero.** Si no se ha podido, no se apunta
   (§6): se dice qué se miró y qué falta.
2. `node scripts/registro.mjs bajar` y abrir `docs/registro/backlog.md`. Elegir
   sección: P0 / P1 / P2 / P3 / decisión.
3. Escribir la tarea con la plantilla del §3, respetando el `· slug` del §4.1.
4. Si lo que se apunta es un **cierre**, quitarla de `backlog.md` y añadirla a
   `resuelto.md` bajo la fecha de hoy; se suben los dos.
5. `node scripts/registro.mjs subir backlog --nota "…"` (ensayo) y leer lo que
   dice: qué entra, qué sale, avisos. Si frena, arreglarlo; si dice que la base
   ya no es la publicada, volver a bajar y aplicar el cambio encima.
6. Lo mismo con `--confirm`. **Sin commit, sin build, sin despliegue**: el
   tablero lo enseña al instante. Las dos skills (`backlog`,
   `incidencias-buzon`) lo hacen así; lanzarlas vale como permiso para publicar.
7. Verificarlo: `node scripts/registro.mjs estado` tiene que decir la versión
   nueva, y el tablero la enseña en la cabecera.

---

## Ficheros que hay detrás, por si hay que tocarlos

| Qué | Dónde |
| --- | --- |
| El texto publicado (la fuente) | `master.tablero_documentos` (`models/master/TableroDocumento.model.js`, `scripts/migrate-tablero-documentos.js`) |
| La copia de trabajo local | `docs/registro/` (gitignored) |
| Bajar / subir desde local | `scripts/registro.mjs` |
| Leer / publicar donde está la base | `scripts/tablero-doc.js` |
| Quien lo trocea y lo comprueba (secciones, tareas, slugs, frenos) | `lib/tablero/parser.js`, `lib/tablero/documentos.js`, prueba `scripts/_smoke-tablero-parser.mjs` |
| El tick, el reparto y la solución | `master.tablero_estado`, `lib/tablero/estado.js` |
| El endpoint y la pantalla | `app/api/admin/tablero/route.js`, `app/admin/tablero/page.jsx` |

⚠️ La carpeta y la ruta siguen llamándose `tablero` aunque el rótulo de la
pantalla sea **«Registro»** (se cambió solo el rótulo el 10/08/2026). Si algún
día se renombra la ruta, hay que mover también `/api/admin/tablero`.

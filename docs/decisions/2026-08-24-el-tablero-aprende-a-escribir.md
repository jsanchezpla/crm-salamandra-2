# El tablero aprende a escribir, y las tareas ganan una ficha

**24/08/2026 · Jorge** · Registro (`/admin/tablero`), `lib/tablero/`

---

## El problema, en números

El tablero se hizo para mirarlo y tocarlo **desde el móvil** —para eso existe
`master.tablero_estado`, que guarda el tick y el reparto—, y esa parte funciona:
de sus 33 filas, 32 están repartidas. Lo que no se podía era escribir.

Las tres tareas del Registro que se cierran con esto decían lo mismo desde tres
sitios:

- **Apuntar** exigía el ordenador con el repo y la llave del VPS. Las 16
  versiones publicadas del backlog llevan como autor el usuario de una máquina
  (`jorge` la primera, `jsanc` las quince siguientes). Lo que se piensa en el
  coche o al colgar con un cliente no entraba: se quedaba en un WhatsApp.
- **Cambiar una prioridad** era lo mismo, porque la prioridad **ES** la sección
  del markdown. Se nota en el historial: la v10 se publicó, entre otras cosas,
  «para bajar a P3 la del embudo de Aumenta» — un cambio de prioridad colado
  dentro de una publicación que iba a otra cosa.
- **Una captura** no cabía por ninguna parte: el cuerpo se pinta como texto
  plano (una imagen en markdown saldría con sus corchetes a la vista) y el
  documento es un texto versionado, donde un fichero no cabe. Medido: **cero
  imágenes y cero enlaces en las 133 tareas publicadas**. No es que se usara
  poco; es que no se podía, y lo que se hacía era describir con palabras lo que
  se entiende en un segundo mirando.

---

## Lo que se decidió

### 1. El texto sigue siendo la verdad — se reescribe, no se esquiva

Había dos caminos para la prioridad. El barato: una columna más en
`tablero_estado`, como el tick. El caro: que el tablero **reescriba el
documento** y publique la versión siguiente.

Se eligió el caro. El barato dejaría el texto diciendo «Media» mientras la
pantalla dice «Alta», y quien bajara el Registro mañana para escribir no vería
el cambio — la misma herida que ya tiene el casado por título normalizado, y no
se hacen dos. El documento son 40 KB: una versión más no cuesta nada.

**La consecuencia práctica**: todo lo que escribe pasa por
`prepararPublicacion` + `publicarVersion`, exactamente la misma puerta que
`scripts/registro.mjs`. No hay camino corto. Se heredan sin escribir ni uno los
errores de formato, el tope de 2 MB, el freno del 70 % («esto no es apuntar una
tarea, es medio fichero») y la UNIQUE `(nombre, version)`, que es el cerrojo real
entre dos personas publicando a la vez.

### 2. Tres colores y dos salas de espera

Eran cuatro prioridades numeradas más «Pendiente de una decisión suya». El
problema no era cuántas: era que **P2 y P3 querían decir lo mismo** a la hora de
elegir qué se hace hoy —«no ahora»— y que P0 y P1 no se distinguían sin leerse
la etiqueta.

Ahora son tres y llevan color, porque de un vistazo es como se mira esta lista:
**Alta en rojo, Media en ámbar, Baja en verde**. P0 y P1 se fusionan en Alta.

Y dos que **no llevan color a propósito**, porque no son prioridades sino salas
de espera —una tarea ahí no espera turno, espera otra cosa—:

- **Pendiente de una decisión suya**, que ya existía.
- **Sin comprobar**, nueva, y es la que hace posible apuntar desde el móvil. La
  regla de siempre —«si no puedes comprobarlo, no lo apuntes»— se escribió
  cuando apuntar costaba bajar el Registro, editarlo y publicarlo. Aplicada a
  una tarea que se apunta en diez segundos, obligaría a no apuntar nada. Aquí
  entra, pero entra **diciendo** que nadie la ha verificado. Salir de esta
  sección es moverla a una prioridad, y ese gesto es exactamente el de haberla
  comprobado; por eso no hay un tick de «comprobada», que sería un estado más
  para decir lo que ya dice la sección.

**Los nombres viejos se siguen leyendo.** Si el troceador dejara de conocer
`P2 — cuando se pueda`, la pantalla se habría quedado en blanco el mismo día del
despliegue y la única salida habría sido republicar a toda prisa: un cambio de
datos en producción metido con calzador para tapar un despliegue. Con el alias,
el documento publicado se pinta ya con los colores nuevos y reescribirlo deja de
correr prisa. Al **escribir** no se aceptan.

### 3. La ficha: `<!--id:k7m2p9-->`

El aviso que traía la tarea de las capturas era este: un adjunto tendría que
colgar de la tarea igual que cuelgan el tick y el reparto —por título
normalizado— y eso arrastra la herida conocida de ese casado. Con un tick
huérfano no pasa nada: no casa con nada y no se pinta. **Con un fichero
huérfano queda un binario en disco que ya no alcanza nadie y que nadie va a
borrar**, y encima puede llevar datos de un paciente dentro.

Así que antes de la primera captura hacía falta algo que no cambie cuando cambia
el título. Es una línea dentro del cuerpo, que el troceador **saca** antes de
devolverlo (el cuerpo se pinta tal cual: un comentario de HTML ahí se leería en
pantalla) y que en el markdown crudo no estorba.

Va **dentro del texto** y no en una tabla aparte porque el texto es la verdad de
este Registro: una tarea movida de sección o cerrada se lleva su ficha puesta,
sin que nadie tenga que acordarse de mover nada al lado.

**No se reescribieron las 137 tareas publicadas para dárselas.** Las nuevas nacen
con ficha; las viejas la ganan la primera vez que se las toca desde el tablero —
reescribirlas, o colgarles una captura, que publica una versión aditiva solo para
añadir esa línea. Así el agujero se cierra para todo lo que venga sin una
publicación masiva que no arregla nada visible.

De paso, reescribir un título **desde la pantalla** ahora sí le muda la clave a
`tablero_estado`, o sea que esa vía tampoco pierde el tick ni el reparto.
Editando el markdown a mano, la herida vieja sigue ahí.

### 4. Las capturas viven lo que viva la tarea

No se recortan (Jorge: «sí puede, sin recortar nada»): **una captura recortada
de la pantalla que falla deja de ser la prueba de lo que falla**. Se acepta que
lleven datos de un paciente dentro, y de ahí salen tres obligaciones:

- no salen nunca del back-office — los tres candados de siempre, que por eso se
  mudaron a `lib/tablero/candado.js`: tres copias de un control de acceso es
  como se llega a que a una le falte el `if` de la demo;
- **mueren con la tarea** — `scripts/podar-tablero-adjuntos.js` borra lo que ya
  no cuelga de ninguna ficha viva, con 30 días de gracia por si la tarea se
  restaura de una versión anterior. Ese script es el sustituto del `ON DELETE
  CASCADE` que aquí no puede existir: la ficha no es la clave de ninguna tabla;
- se sirven con el tipo que decidimos **nosotros** a partir de la extensión que
  guardamos, nunca con el que declaró el navegador, y nunca SVG en línea.

La máquina se **copió** de `lib/buzon/buzonStorage.js` en vez de reutilizarla:
su layout es `buzon/{tenantSlug}/…` y sus rutas las valida un regex que empieza
por `buzon/`. Reutilizarla obligaría a inventar un slug de tenant que no existe
—el Registro es nuestro, no de un cliente— y a aflojar ese regex, que es justo
la pieza que impide que una ruta guardada en base apunte a cualquier sitio del
disco. Lo único que sí se importa es `tipoParaVerEnPantalla`: es una lista blanca
de seguridad, y dos copias de una lista blanca acaban siendo dos listas
distintas.

---

## Lo que hay que saber al tocarlo

**Cirugía, no reconstrucción.** Cada función de `lib/tablero/editor.js` corta y
pega LÍNEAS del texto original; ninguna reconstruye el documento a partir de lo
troceado. El documento tiene un manual al principio, comentarios, separadores y
el formato exacto que escribió una persona: reconstruirlo devolvería un
documento *parecido*, y publicar un documento parecido —con el freno del 70 %
dando el visto bueno porque el número de tareas cuadra— es la forma silenciosa
de perderlo todo.

**Cerrar toca los dos documentos, y el orden importa.** Primero `resuelto`,
después `backlog`. Son dos publicaciones y la segunda puede fallar; escribiendo
primero Resuelto, un fallo deja la tarea en los dos sitios: se ve, molesta y se
arregla. Al revés la deja en ninguno, y nadie echa de menos lo que ya no está
escrito en ninguna parte.

**Editar exige la versión que tenías delante; mover y cerrar no.** Reescribir es
lo único que sustituye texto escrito por una persona, así que ahí se rechaza si
alguien publicó en medio. Mover una tarea a «Alta» es quirúrgico y va por ficha:
exigir la versión obligaría a recargar cada vez que el otro publica, para nada.

**Si copias un bloque de tarea para escribir otra parecida, bórrale la ficha.**
Dos tareas con la misma ficha enseñarían cada una las capturas de la otra.
`comprobar()` lo trata como **error** y no como aviso, precisamente porque
copiar y pegar un bloque es lo que hace todo el mundo.

---

## Lo que quedó sin hacer, y a propósito

**El documento publicado sigue escrito con `P0`…`P3`.** Reescribirlo es una
publicación en producción y va por la regla de siempre: se mide, se enseña y se
espera el sí. El código no lo necesita —lee los nombres viejos— así que no hay
prisa, y cada bloque se irá reescribiendo solo según se toque.

**La pantalla no se ha visto funcionando.** El back-office exige sesión y la
sesión es de Jorge. Lo que sí se ejercitó, contra la base de local y el disco:
el ciclo entero (apuntar → mover → reescribir con otro título → cerrar → borrar)
sobre una copia del documento de producción, comprobando después de cada paso
que el resultado seguía siendo publicable y que el manual quedaba **byte a
byte** idéntico; y las capturas de punta a punta, incluidas las cuatro formas de
ruta manipulada que el almacén rebota.

---

## Ficheros

| | |
| --- | --- |
| Las tres prioridades, las dos salas, el alias y la ficha | `lib/tablero/parser.js` |
| Cortar y pegar tareas en el texto | `lib/tablero/editor.js` (+ `_smoke-tablero-editor.mjs`) |
| Los tres candados, en un solo sitio | `lib/tablero/candado.js` |
| Escribir tareas | `app/api/admin/tablero/tareas/route.js` |
| Las capturas | `lib/tablero/tableroStorage.js`, `models/master/TableroAdjunto.model.js`, `app/api/admin/tablero/adjuntos/` |
| La pantalla | `app/admin/tablero/page.jsx` + `components/admin/TableroEditor.jsx` + `tableroTonos.js` |
| Migración y poda | `scripts/migrate-tablero-adjuntos.js`, `scripts/podar-tablero-adjuntos.js` |
| El manual | `docs/como-apuntar-en-el-tablero.md` |

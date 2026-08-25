---
name: incidencias-buzon
description: Tría las incidencias que los clientes nos mandan desde Ayuda — solo las de tipo «algo no funciona», nunca dudas ni mejoras. Comprueba contra producción si el fallo sigue pasando; si sigue, lo apunta en el backlog del Registro y lo publica con scripts/registro.mjs (sin commit ni despliegue); si ya está arreglado y puede probarlo, le contesta al cliente. Se lanza a mano con /incidencias-buzon, opcionalmente con una referencia (/incidencias-buzon AV-0007).
---

# Triaje de incidencias del buzón

Los clientes nos escriben desde **Ayuda**, dentro de su CRM, y eso cae en
`/admin/buzon`. Esta skill coge lo que han marcado como **«algo no funciona»** y
lo convierte en una de tres cosas: una tarea del Registro, una respuesta al
cliente diciéndole que ya está arreglado, o una pregunta para Jorge o Rodrigo.

**Lo lanza una persona**, siempre. No hay versión automática, y es a propósito:
cada aviso exige decidir si el fallo es real, de quién es y qué prioridad tiene.
La campana del panel ya avisa de cuándo hace falta lanzarla. Apuntar en el
Registro **no commitea ni despliega nada**: desde el 19/08/2026 vive en
`master.tablero_documentos` y se publica con `scripts/registro.mjs`.

## Lo que NO entra

Solo se tría el tipo `error` («Algo no funciona»).

- **Las dudas se contestan, no se apuntan.** Una duda es que la pantalla no se
  entiende; eso se resuelve escribiéndole, y a veces arreglando un rótulo.
- **Las mejoras las prioriza una persona.** Meterlas solas en el backlog lo
  convierte en un buzón de deseos y deja de servir para saber qué falla.

El script las cuenta igual (`sinTriar`) para que no se pierdan de vista. Si hay
alguna, dilo al final en una línea y sigue.

## Paso 1 — Leer

Desde la raíz del repo:

```bash
ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=listar crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
```

Devuelve JSON con los avisos de tipo fallo y su hilo entero. Si te han pasado una
referencia (`/incidencias-buzon AV-0007`), tría solo esa; si no, todas las que
no estén ya triadas (paso 2).

Lo que hay que mirar de cada uno, y por qué:

| Campo | Para qué |
| --- | --- |
| `pantalla` | La ruta desde la que escribió. La mitad de las veces dice por qué fichero empezar. |
| `hilo` | Puede que ya se le contestara algo. No repitas lo que ya está dicho. |
| `capturas` | **No puedes verlas.** Si el aviso no se entiende sin ellas, eso es lo que hay que decir, no adivinar. |
| `leBloquea` | Lo marca él, y no es una opinión: o puede seguir trabajando, o no. Manda en la prioridad. |
| `slug` | De quién es. Un mismo fallo contado por tres clientes es otra cosa que contado por uno. |

⚠️ **Un aviso de `salamandra_solutions` somos NOSOTROS probando.** No se apunta
en el backlog sin preguntar: hoy los que hay son pruebas manuales de Jorge, con
texto de relleno.

## Paso 2 — ¿Está ya apuntado?

Antes de nada, baja el Registro publicado (deja la copia de trabajo en
`docs/registro/`, gitignored) y busca la referencia en los dos documentos:

```bash
node scripts/registro.mjs bajar
```

```bash
grep -n "AV-0007" docs/registro/backlog.md docs/registro/resuelto.md
```

Si aparece, ya está triado: no lo toques y pasa al siguiente. **Toda tarea que
escribas lleva su `AV-000X` dentro** (paso 4), y eso es lo que hace que lanzar la
skill dos veces no duplique nada.

## Paso 3 — ¿Sigue pasando?

Esta es la parte que no se puede automatizar y por la que la skill la lanza una
persona. Hay tres finales, y el tercero es un final legítimo.

**Primero busca si ya se arregló.** Fecha del aviso (`escrito`) contra el
historial de lo que toca esa zona:

```bash
git log --oneline --since="2026-08-01" -- lib/citas/ app/api/citas/
```

**Después compruébalo contra PRODUCCIÓN.** Es obligatorio y está escrito en
`docs/como-apuntar-en-el-tablero.md` §6: local y el VPS divergen mucho (Aumenta
tiene 12 módulos en local y 20 en producción, 15 citas frente a 12.030). Ya pasó
una vez: se apuntó «el cobro con tarjeta no se ha completado nunca» cuando en
producción había dos pagos hechos, uno de 130 € de una paciente real. Una tarea
falsa hace perder una tarde.

Para mirar datos de producción, misma tubería que el paso 1 con tu propio script
de lectura. **Solo lectura**, salvo lo que diga esta skill.

Los tres finales:

- **Sigue pasando** → paso 4 (apuntarlo).
- **Ya está arreglado** → paso 5 (contestarle).
- **No se puede saber** — hace falta la captura, o reproducirlo con su sesión, o
  es un «a veces». → **No inventes ninguna de las otras dos.** Dilo, con qué has
  mirado y qué falta, y deja el aviso como está.

## Paso 4 — Apuntarlo en el Registro

Léete `docs/como-apuntar-en-el-tablero.md` antes de escribir. Se escribe en la
copia de trabajo que dejó `bajar` (`docs/registro/backlog.md`). Resumen de lo
que más se rompe, pero el que manda es ese fichero:

- Una tarea es un `###` dentro de una sección `##`. **Las secciones son fijas**:
  `Alta`, `Media`, `Baja`, `Pendiente de una decisión suya` y `Sin comprobar`
  (24/08/2026; antes eran `P0`…`P3`, que se siguen leyendo pero ya no se
  escriben). Inventar una la frena `subir`. **`Sin comprobar` no la uses**: es
  para lo que se apunta desde el móvil sin mirarlo, y aquí las incidencias vienen
  comprobadas o no vienen.
- **Nada de `##` ni `###` dentro del cuerpo**: parte la tarea en dos. Para dar
  estructura, negrita al principio del párrafo.
- **El cliente va detrás del último `·`**, con el slug de base de datos
  (`nutri_laura`, no «Laura»). Si no está en la lista de `SLUGS` de
  `lib/tablero/parser.js`, la tarea sale sin cliente y sin grupo.
- **El cuerpo se pinta tal cual**: los asteriscos y las comillas invertidas se
  VEN en el tablero. Nada de tablas markdown.
- El título dice **qué pasa hoy**, no qué hay que programar — y **en cristiano**
  (Jorge y Rodrigo, 25/08/2026): es lo único que se lee en la lista y en el
  móvil, así que va con las palabras de quien sufre el problema. Fuera del
  título los nombres de librerías y ficheros, las tablas, las rutas, las líneas
  y la jerga (endpoint, schema, override); dentro, la pantalla por su nombre,
  qué pasa y el número que duele si cabe («102 familias» no es un tecnicismo,
  es la prueba). **El CUERPO se queda técnico**: ahí sí van los ficheros y las
  líneas. El detalle y los ejemplos, en `docs/como-apuntar-en-el-tablero.md` §3.

Qué sección:

| | |
| --- | --- |
| `leBloquea` + cliente real | **P0** — hay alguien parado ahora mismo. |
| Un cliente se lo encuentra ya, sin bloquearle | **P1** |
| Molesta pero se puede vivir con ello | **P2** |
| Fallo real que hoy nadie puede ver | **P3** |
| No se puede hacer sin que Jorge o Rodrigo elijan | **Pendiente de una decisión suya** |

Plantilla, con la línea que añade esta skill:

```markdown
### Al abrir la ficha desde la lista no pasa nada · `aumenta`

**Lo que nos cuentan.** Desde /clientes, al pulsar una familia, la ficha no se
abre. Lo cuenta AV-0007 (Aumenta, 13/08/2026), y dice que le impide trabajar.

**Lo que se ha visto.** En producción pasa con las fichas cuyo `address` está a
`{}`: el objeto llega como hijo de React y tumba la pantalla entera. El servidor
devuelve 200, así que no sale en ningún log.

*Se comprueba*: abrir en producción la ficha de un cliente con `address = '{}'`.
*Dónde*: `modules/default/ClientDetailModule.jsx:214`.
*Comprobado en producción*: 13/08/2026 — reproducido con dos fichas de Aumenta.
```

La referencia `AV-0007` **tiene que estar en el cuerpo**: es lo que evita
apuntarlo dos veces y lo que permite, dentro de seis meses, saber quién lo contó.

Luego marca el aviso, para que en la bandeja se vea que está cogido:

```bash
ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=marcar -e TRIAJE_REF=AV-0007 -e TRIAJE_CONFIRMAR=1 crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
```

Sin `TRIAJE_CONFIRMAR=1` solo dice lo que haría. Deja el mismo rastro de
auditoría que si lo movieras a mano desde el panel.

## Paso 5 — Si ya estaba arreglado, contestarle

**Se manda directamente, sin preguntar** (Jorge, 13/08/2026). Redáctala, mándala
y luego di lo que mandaste.

```bash
ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=responder -e TRIAJE_REF=AV-0007 -e TRIAJE_AUTOR=jorge -e "TRIAJE_TEXTO=..." -e TRIAJE_CONFIRMAR=1 crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
```

El script guarda la respuesta **y** le enciende la campana en su CRM, que son las
dos cosas que hace el panel. (Sin `TRIAJE_CONFIRMAR=1` solo enseña lo que
mandaría; el flag existe para quien use el script a mano, no para pedirte
permiso.)

⚠️ **EL LISTÓN PARA MANDAR, QUE ES LO QUE SUSTITUYE A PREGUNTAR.** Un mensaje a
un cliente no se puede desenviar, y decirle «ya está arreglado» cuando no lo
está es el peor mensaje posible saliendo de un canal de soporte. Así que solo se
contesta cuando se puede señalar **la prueba concreta**, las dos a la vez:

1. **El commit que lo arregla**, identificado — no «parece que se tocó eso».
2. **Que ese commit está desplegado**, comprobado dentro del contenedor y no en
   el repo local, y con fecha posterior al aviso.

Si falta cualquiera de las dos, **no es «ya arreglado»**: es el tercer final del
paso 3 («no se puede saber»), y ahí no se manda nada. Entre callar y prometer
algo que no puedes probar, se calla.

Cómo se escribe la respuesta:

- **Dile qué le pasaba**, en su idioma, no en el nuestro. «La ficha no se abría
  cuando el cliente no tenía dirección puesta», no «un objeto vacío como hijo de
  React».
- **Dile desde cuándo está arreglado** y que ya lo tiene: no hace falta que haga
  nada, como mucho recargar.
- **Dale las gracias y sé breve.** Cuatro líneas.
- **No prometas nada que no esté hecho.**

Si estaba arreglado, el aviso se marca **`resuelto`**, no `en_curso`:
`-e TRIAJE_ESTADO=resuelto`.

## Paso 6 — Publicarlo

**Sin commit, sin build, sin despliegue.** El Registro vive en
`master.tablero_documentos` y el tablero lee la última versión publicada: en
cuanto `subir --confirm` termina, la pantalla lo enseña. Nada de esto toca git.

1. Enseña lo que has escrito antes de subirlo.
2. **Ensayo**:

```bash
node scripts/registro.mjs subir backlog --nota "AV-0007: la ficha no se abre desde la lista (aumenta)"
```

   Lee qué **entra** y qué **sale** (si sale algo que tú no has cerrado, para) y
   los avisos. Si dice **«la versión publicada ya no es la que bajaste»**, el
   socio publicó mientras escribías: vuelve a `bajar`, aplica tu cambio encima y
   repite. Es el equivalente de antes de «si `docs/backlog.md` aparece en el
   diff con origin/master, PARA Y PREGUNTA»; aquí el script no deja pisar nada.
   **No uses `--forzar`** salvo que te lo pidan.
3. **Publicar**: el mismo comando con `--confirm`. La `--nota` lleva la
   referencia `AV-000X`: es lo que se leerá en `historial`.
4. **Verifícalo**: `node scripts/registro.mjs estado` dice la versión nueva con
   tu nota, y el tablero la enseña en la cabecera. Si sigue diciendo la de
   antes, no se publicó.

## Al terminar, di

- Qué has apuntado y en qué sección, con su referencia, y qué versión del
  Registro has publicado.
- A quién le has contestado y qué le has dicho.
- **Qué no has podido decidir y por qué** — esto es lo más importante de las
  tres, y es lo que se pierde si no se dice.
- Cuántas dudas y mejoras hay sin mirar.

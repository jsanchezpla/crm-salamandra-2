# Cómo se apunta una tarea en el tablero

**Para Rodrigo y Jorge, y sobre todo para su Claude.** Cuando digáis «apunta
esto en el backlog», lo que tiene que pasar es que la tarea aparezca en
<https://admin.salamandrasolutions.com/admin/tablero>. Aquí está cómo, y las
cinco cosas que salen mal **sin dar ningún error**.

Léelo antes de tocar `docs/backlog.md`. El fichero no se procesa con una
librería de markdown: se trocea a mano en `app/api/admin/tablero/route.js`, y un
encabezado mal puesto no rompe nada — simplemente parte la tarea en dos, o la
deja sin cliente, o la esconde.

---

## 1. El tablero no es una base de datos

Es **`docs/backlog.md` y `docs/resuelto.md`**, leídos en caliente. No hay tabla,
no hay formulario, no hay «añadir tarea» en la pantalla: la pantalla es de
**leer**. Se escribe en el repositorio, en el mismo commit que el arreglo.

Es deliberado y está explicado en el propio endpoint: un backlog en base de
datos se actualiza «luego», y luego es nunca; uno en el repo se revisa en el
diff, viaja con el código que lo resuelve y deja constancia de quién lo escribió.

| Fichero | Sale en la pestaña | Qué es |
| --- | --- | --- |
| `docs/backlog.md` | **Pendiente** | Lo que falta por hacer. |
| `docs/resuelto.md` | **Resuelto** | Lo cerrado, con cómo se comprobó. |

---

## 2. Lo que más se olvida: **hay que desplegar**

Los dos ficheros **viajan dentro de la imagen de Docker**. Hay una línea en el
`Dockerfile` que los copia:

```dockerfile
COPY --chown=nextjs:nodejs docs/backlog.md docs/resuelto.md ./docs/
```

Consecuencia: **editar y commitear NO cambia el tablero.** Hasta que se ejecute
`deploy.sh` en el VPS, la pantalla sigue enseñando lo de la imagen anterior. Es
la explicación de casi todos los «pues yo lo apunté y no sale».

Para comprobar que ha llegado de verdad, se mira **dentro del contenedor**, no
en el repo:

```bash
docker exec crm-salamandra-app-1 grep -n '^### ' docs/backlog.md
```

Y para una tarea concreta, con un trozo literal de su título:

```bash
docker exec crm-salamandra-app-1 grep -n 'Ocho familias admitidas' docs/backlog.md
```

Si el tablero avisa de «No se han podido leer: backlog.md», es exactamente esto:
el fichero no llegó a la imagen.

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

---

## 4. Las cinco trampas del parser

Ninguna da error. Todas salen mal en silencio.

### 4.1 El cliente se separa por el ÚLTIMO `·`, y solo si es un slug conocido

El troceador coge lo que hay detrás del último punto medio y **solo lo trata
como cliente si reconoce el nombre**. Los que reconoce:

```
aumenta · nutri_laura · spain_enzymes · quality_energy
retorika · abarcaia · healim · demo · sandbox
salamandra_solutions
```

...más `todos`, `producto`, `interno`, `documentación` y `varios`.

**Si son varios, se escriben separados por comas** y la tarea sale en el grupo
de cada uno. Los nombres se buscan sueltos dentro de la cola, no partiendo por
comas, para que una cola escrita a mano como `· nutri_laura (y todos con citas)`
siga entendiéndose. Aun así, cuanto más limpia la lista, mejor.

⚠️ **Un nombre que no esté en esa lista no existe para el tablero.** La tarea se
pinta con la cola metida dentro del título y sin etiqueta de cliente, y no cae
en ningún grupo. Si damos de alta un cliente nuevo, hay que **añadir su slug a
`SLUGS`** en `app/api/admin/tablero/route.js` — no se lee de la base de datos a
propósito, porque el tablero también habla de clientes que ya no están y de
cosas que no son un cliente.

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

En `docs/backlog.md` hay estas y solo estas:

| Sección | Se pinta | Qué significa |
| --- | --- | --- |
| `## P0 — hoy` | rojo, «hoy» | Está pasando ahora y cuesta dinero, clientes o datos. |
| `## P1 — esta semana` | ámbar, «esta semana» | Un cliente se lo va a encontrar ya, o le bloquea algo. |
| `## P2 — cuando se pueda` | gris, «cuando se pueda» | Mejora clara, sin fecha. |
| `## P3 — deuda` | tenue, «deuda» | Deuda o limpieza. También los fallos reales que hoy nadie puede ver. |
| `## Pendiente de una decisión suya` | verde, «lo decidís vosotros» | No se puede hacer sin que Jorge o Rodrigo elijan. |

El color y la etiqueta salen de un `switch` por el título de la sección. Si
inventas una sección nueva, **aparece en gris y sin etiqueta de urgencia**, como
si no corriera prisa.

La sección `## Cómo se usa esto` se descarta a propósito (sus apartados son
`###` y se colaban como tareas falsas, inflando la cuenta). No metas tareas ahí.

### 4.4 El cuerpo se pinta TAL CUAL: los asteriscos se ven

La pantalla imprime el cuerpo con `whitespace-pre-wrap`, sin convertir markdown.
Los `**negrita**` y las comillas invertidas **se ven literalmente** en el
tablero. Se sigue escribiendo con ellos porque el fichero también se lee en el
repositorio, pero **el texto tiene que entenderse sin formato**: nada de tablas
markdown en el cuerpo de una tarea, que en el tablero salen como una fila de
barras verticales.

### 4.5 Dos tareas con el mismo título en la misma sección

React las usa como clave. Cambia una de las dos.

---

## 5. Dónde va cada cosa en `resuelto.md`

Las secciones son **fechas**, `## DD/MM/AAAA`, y **lo más reciente va arriba**.
Si ya existe la sección del día, la entrada va dentro de esa; no se crea otra
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

**Cerrar una tarea es moverla, no borrarla**: sale de `backlog.md` y entra en
`resuelto.md` **en el mismo commit**, para que no haya un momento en que algo no
esté en ninguno de los dos.

---

## 7. Checklist para Claude

Cuando Rodrigo o Jorge digan «apunta esto en el backlog»:

1. **Comprobarlo contra producción primero.** Si no se ha podido, decirlo y
   escribirlo en el sello en vez de inventarse una fecha.
2. Abrir `docs/backlog.md` y elegir sección: P0 / P1 / P2 / P3 / decisión.
3. Escribir la tarea con la plantilla del §3, respetando el `· slug` del §4.1.
4. Si lo que se apunta es un **cierre**, quitarla de `backlog.md` y añadirla a
   `resuelto.md` bajo la fecha de hoy, en el mismo commit.
5. **No commitear por iniciativa propia** (regla #11 de `CLAUDE.md`): dejarlo
   escrito y decir que está listo, salvo que hayan pedido el commit.
6. Si piden commit: Conventional Commits, `npm run build` en verde, push a
   `master`, y **avisar de que hasta que no se despliegue en el VPS el tablero
   no lo enseña** (§2).
7. Después del despliegue, verificarlo **dentro del contenedor** con el `grep`
   del §2 — no en el repositorio local, que ya se sabe que está bien.

---

## Ficheros que hay detrás, por si hay que tocarlos

| Qué | Dónde |
| --- | --- |
| El backlog y lo resuelto | `docs/backlog.md`, `docs/resuelto.md` |
| Quien lo trocea (secciones, tareas, slugs) | `app/api/admin/tablero/route.js` |
| La pantalla (colores, pestañas, filtro) | `app/admin/tablero/page.jsx` |
| La línea que los mete en la imagen | `Dockerfile:33` |

⚠️ La carpeta y la ruta siguen llamándose `tablero` aunque el rótulo de la
pantalla sea **«Registro»** (se cambió solo el rótulo el 10/08/2026). Si algún
día se renombra la ruta, hay que mover también `/api/admin/tablero`.

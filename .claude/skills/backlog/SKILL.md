---
name: backlog
description: Apunta en el Registro las tareas que le dictes. Comprueba una a una si ya están hechas o ya apuntadas, y solo escribe las que sigan pasando —comprobadas contra producción— con el formato del tablero; después lo publica con scripts/registro.mjs (sin commit ni despliegue) para que se vean en admin.salamandrasolutions.com/admin/tablero. Se lanza a mano con /backlog seguido de las tareas.
---

# Apuntar tareas en el Registro

Coge las tareas que te dictan, las comprueba contra producción una a una y
escribe en el Registro **solo las que hagan falta**: ni las que ya están
hechas, ni las que ya están apuntadas, ni las que no se pueden comprobar.

**Lo lanza una persona, siempre**, y eso vale como permiso explícito para
publicar el Registro. No hay versión automática: apuntar algo falso hace perder
una tarde. **No se commitea ni se despliega nada**: desde el 19/08/2026 el
Registro vive en `master.tablero_documentos` y se publica con
`scripts/registro.mjs` (Jorge: «los commits son para código»).

Es la hermana de `incidencias-buzon`. La diferencia es de dónde viene el trabajo:
allí de la bandeja de Ayuda, aquí de lo que te dicta Jorge o Rodrigo. Todo lo
demás —comprobar, escribir, publicar— es igual.

## Si te lanzan `/backlog` a secas

Sin tareas no hay nada que hacer. **No inventes ninguna, no repases el backlog
por tu cuenta y no toques ficheros.** Pide las tareas y explica cómo van mejor:

> Dime qué apunto. Una por línea, en lenguaje normal — ya me encargo yo de
> comprobarlas y de darles el formato del tablero.
>
> Ayuda mucho que digas **de quién es** (el cliente) y **qué pasa hoy**, no qué
> hay que programar. Si sabes dónde está, dilo; si no, lo busco.
>
> Por ejemplo:
>
> - En Aumenta, el buscador de pacientes no encuentra por apellido.
> - Los correos de recordatorio de Laura salen con la hora en UTC.
> - El listado de facturas tarda muchísimo cuando hay más de 500.

Y ahí te paras.

## Paso 1 — Entender qué te han dictado

Parte el mensaje en tareas sueltas. Una frase con dos problemas dentro son dos
tareas: se comprueban por separado y pueden acabar en secciones distintas.

Antes de comprobar nada, si algo no se entiende **pregunta ahora**, no a mitad.
Lo que de verdad hace falta saber de cada una:

| | Por qué importa |
| --- | --- |
| **De quién es** | Un fallo de un cliente y uno del producto no se priorizan igual. Si no lo dicen, dedúcelo al comprobarlo; si sigue sin estar claro, pregunta. |
| **Qué pasa hoy** | El título va en esos términos. «Arreglar el contador» no se entiende dentro de seis meses. |
| **Dónde lo han visto** | Producción o local. Si fue en local, avisa: puede no pasar en el VPS. |

## Paso 2 — ¿Ya está apuntada?

Lo primero, porque es gratis y evita duplicar. Baja lo publicado (deja la copia
de trabajo en `docs/registro/`, que está en `.gitignore`) y mira los títulos de
las dos listas, que caben de sobra:

```bash
node scripts/registro.mjs bajar
```

```bash
grep -n '^### ' docs/registro/backlog.md docs/registro/resuelto.md
```

Compáralo **por significado, no por palabras**: «el buscador no encuentra por
apellido» y «la búsqueda de pacientes ignora el segundo campo» son la misma
tarea escrita por dos personas.

- **Está apuntada y sigue bien** → no la toques y dilo al final. Duplicar una
  tarea es peor que no apuntarla: parten el hilo y se cierra una sola.
- **Está apuntada pero se ha quedado corta o el sello es viejo** → **no la
  reescribas por tu cuenta.** Dilo al final, con qué añadirías, y que lo decidan.
  Reescribir un título deja huérfanos su tick y su reparto en el tablero
  (`master.tablero_estado` casa por título normalizado).
- **Está en `resuelto`** → probablemente ya se arregló. Confírmalo en el
  paso 3 antes de darlo por bueno; puede haber vuelto.

## Paso 3 — ¿Ya está hecha?

Antes de comprobar si el fallo sigue vivo, mira si alguien lo arregló ya:

```bash
git log --oneline --since="2026-07-01" -- lib/citas/ app/api/citas/
```

Si parece que sí, hacen falta **las dos pruebas** antes de tratarla como hecha
(paso 5). Con una sola no basta:

1. **El commit que lo arregla**, identificado — no «se tocó esa zona».
2. **Que está desplegado**, comprobado DENTRO del contenedor y no en el repo.

## Paso 4 — ¿Sigue pasando? (contra PRODUCCIÓN)

Es obligatorio y es lo que da valor a todo lo demás. Está escrito en
`docs/como-apuntar-en-el-tablero.md` §6: local y el VPS divergen mucho —Aumenta
tiene 12 módulos en local y 20 en producción, 15 citas frente a 12.030—, así que
un fallo que se ve aquí puede no existir allí, y al revés.

Ya pasó una vez: se apuntó «el cobro con tarjeta no se ha completado nunca»
cuando en producción había **dos pagos hechos**, uno de 130 € de una paciente
real. La tarea llevaba datos de la víspera y nadie la volvió a mirar.

Para mirar producción, por SSH y **solo lectura**:

```bash
ssh crm-vps "docker exec crm-salamandra-app-1 <lo que sea>"
```

Consultas a la base, sin escribir nada. **El script va por stdin**, en un
fichero `.mjs` del scratchpad: la variante con `node -e "…"` y el SQL dentro
se rompe por las comillas (tres capas: PowerShell, ssh, docker) y se perdieron
15 minutos con ella el 19/08/2026.

```js
// consulta.mjs — solo lectura, sin datos personales
const { getMasterDb } = await import("/app/lib/db/masterDb.js");
const db = getMasterDb();
const [filas] = await db.query("SELECT slug, status FROM master.tenants ORDER BY slug");
console.log(JSON.stringify(filas));
process.exit(0);
```

```bash
ssh crm-vps 'docker exec -i crm-salamandra-app-1 node --input-type=module -' < consulta.mjs
```

(El `-i` es lo que deja pasar el stdin; sin él, el contenedor no recibe nada.
Para un schema de cliente, `db.query("SELECT … FROM crm_<slug>.tabla")` con el
slug leído de `master.tenants`, nunca escrito a mano.)

⚠️ **Nunca saques por pantalla filas con datos personales o de salud.** Cuentas,
nombres de columna y fechas sí; el contenido de una ficha, una sesión clínica o
un correo, no.

Cuatro finales, y dos de ellos no escriben nada:

| Lo que sale | Qué haces |
| --- | --- |
| **Sigue pasando** | Paso 5 → `docs/registro/backlog.md`. |
| **Ya está hecha**, con las dos pruebas del paso 3 | Paso 5 → `docs/registro/resuelto.md`. |
| **Ya estaba apuntada** | Nada. Se dice al final. |
| **No se puede saber** | **NADA.** Ver abajo. |

⚠️ **Si no puedes comprobarlo, NO lo apuntes** (Jorge, 13/08/2026). Hace falta
una sesión de cliente, no se reproduce, es un «a veces», o el dato que haría
falta no se puede mirar sin destapar datos personales: en todos esos casos no se
escribe nada. Dilo al final, con **qué miraste exactamente y qué falta para
poder cerrarlo** — eso es lo que permite retomarlo, y es más útil que una tarea
que nadie sabe si es verdad.

No inventes el tercer camino: entre apuntar algo sin comprobar y no apuntarlo,
no se apunta.

## Paso 5 — Escribirla

Léete `docs/como-apuntar-en-el-tablero.md` antes de tocar nada. Ese fichero
manda; esto es solo lo que más se rompe. Se escribe en la copia de trabajo que
dejó `bajar` (`docs/registro/backlog.md` o `resuelto.md`), nunca en otro sitio:

- Una tarea es un `###` dentro de una sección `##`. **Las secciones son fijas.**
- **Nada de `##` ni `###` dentro del cuerpo**: parte la tarea en dos. Para dar
  estructura, negrita al principio del párrafo.
- **El cliente va detrás del último `·`**, con el slug de base de datos
  (`nutri_laura`, no «Laura»). Si no está en la lista `SLUGS` de
  `lib/tablero/parser.js`, la tarea sale sin cliente y sin grupo — y si es un
  cliente nuevo, hay que añadirlo ahí (eso sí es código: commit y despliegue).
- **El cuerpo se pinta tal cual**: los asteriscos y las comillas invertidas se
  VEN en el tablero. Nada de tablas markdown dentro de una tarea.
- El título dice **qué pasa hoy**, no qué hay que programar.

**La prioridad la decides tú** (Jorge, 13/08/2026), a partir de lo que hayas
comprobado, y la explicas al final:

| | |
| --- | --- |
| Está pasando ahora y cuesta dinero, clientes o datos | **P0 — hoy** |
| Un cliente se lo encuentra esta semana, o le bloquea algo | **P1 — esta semana** |
| Mejora clara, sin fecha | **P2 — cuando se pueda** |
| Deuda, limpieza, o un fallo real que hoy nadie puede ver | **P3 — deuda** |
| No se puede hacer sin que Jorge o Rodrigo elijan | **Pendiente de una decisión suya** |

Plantilla. Las tres últimas líneas no son opcionales:

```markdown
### El buscador de pacientes no encuentra por apellido · `aumenta`

**Lo que pasa.** Escribir un apellido en el buscador de /pacientes no devuelve
nada; con el nombre sí. La consulta solo mira `first_name`, así que quien busca
por como le llama la familia no encuentra la ficha.

**Cuánto duele.** En producción hay 1.083 familias y el 60% de los pacientes
comparten nombre de pila con otro. Es la pantalla por la que se entra a todo lo
demás.

*Se comprueba*: buscar «Fernández» en /pacientes de Aumenta devuelve fichas.
*Dónde*: `app/api/pacientes/route.js:88`.
*Comprobado en producción*: 13/08/2026 — reproducido con tres apellidos reales.
```

**Si la tarea ya estaba hecha**, va a `docs/registro/resuelto.md` en vez de al
backlog (Jorge, 13/08/2026), bajo la sección de **la fecha de hoy** (`## DD/MM/AAAA`, lo
más reciente arriba; si ya existe la de hoy, dentro de esa). Misma plantilla,
pero el cuerpo dice **qué lo arregló** y el sello lleva las dos pruebas:

```markdown
*Comprobado en producción*: 13/08/2026 — lo arregló `88a6c05` (11/08), y en el
contenedor la ruta desplegada ya devuelve las fichas por apellido.
```

Nada de esto entra sin esas dos pruebas. Si solo tienes una, es «no se puede
saber»: no se escribe.

## Paso 6 — Publicarlo

**Sin commit, sin build, sin despliegue.** El Registro vive en
`master.tablero_documentos` y el tablero lee la última versión publicada: en
cuanto `subir --confirm` termina, la pantalla lo enseña. Nada de esto toca git;
si hay cambios en el árbol (`git status --short`), no son de esta skill y se
dejan donde están.

**Una sola vez al final**, con todas las tareas de la tanda dentro. Nada de una
publicación por tarea.

1. **Enseña lo que has escrito** antes de subirlo.
2. **Ensayo**, un documento cada vez (solo los que hayas tocado):

```bash
node scripts/registro.mjs subir backlog --nota "apuntar el buscador de pacientes de aumenta"
```

   Lee lo que dice: qué tareas **entran** y cuáles **salen** (si sale alguna que
   no has cerrado tú, para), y los avisos. Los frenos
   (`docs/como-apuntar-en-el-tablero.md` §2): un error de formato se arregla;
   **«la versión publicada ya no es la que bajaste»** quiere decir que el socio
   publicó mientras escribías — vuelve a `bajar`, aplica tu cambio encima y
   repite. Es el equivalente de antes de «si `docs/backlog.md` aparece en el
   diff con origin/master, PARA Y PREGUNTA»; aquí no hace falta preguntar porque
   el script no deja pisar nada. **No uses `--forzar`** salvo que te lo pidan.
3. **Publicar**, el mismo comando con `--confirm`. La `--nota` es lo que se
   leerá en `historial` dentro de seis meses: una frase que diga qué se apuntó o
   qué se cerró, con la referencia si la hay.
4. Si has tocado los dos (un cierre sale de `backlog` y entra en `resuelto`),
   se suben **los dos seguidos**, `resuelto` primero y `backlog` después, para
   que no haya un momento en que la tarea no esté en ninguno.
5. **Verifícalo**: `node scripts/registro.mjs estado` dice la versión nueva, con
   tu nombre y tu nota; y en el tablero la cabecera la enseña. Si `estado` sigue
   diciendo la versión de antes, no se publicó (mira el código de salida y lo
   que dijo el ensayo).

## Al terminar, di

Una línea por tarea que te dictaron, sin saltarte ninguna:

- **Qué has apuntado**, en qué sección y **por qué esa prioridad**.
- **Qué ya estaba hecha**, con el commit que la arregló.
- **Qué ya estaba apuntada**, y si se ha quedado corta.
- **Qué no has podido comprobar**, qué miraste y qué falta. Es lo más importante
  de las cuatro y lo que se pierde si no se dice.
- Qué versión has publicado de cada documento (lo que dijo `estado`).

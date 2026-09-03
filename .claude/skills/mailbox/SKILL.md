---
name: mailbox
description: Vacía el buzón al Registro. Coge TODO lo que los clientes nos han escrito desde Ayuda —fallos, dudas y mejoras—, comprueba cada uno contra producción, y lo apunta como tarea en el backlog con su prioridad, su referencia AV-000X y una marca de origen en el título (Buzón - Fallo / Duda / Mejora). No le contesta a nadie y no arregla nada: solo deja el trabajo escrito donde se prioriza. Se lanza a mano con /mailbox, opcionalmente con una referencia (/mailbox AV-0007).
---

# Vaciar el buzón al Registro

Los clientes nos escriben desde **Ayuda**, dentro de su CRM, y eso cae en
`/admin/buzon`. Esta skill coge lo que hay allí y lo convierte en tareas del
Registro, para que nada se quede en una bandeja que nadie mira.

**Recoge, no resuelve.** Arreglar es `/resolve`; contestar a un cliente
diciéndole que ya está arreglado es `incidencias-buzon`. Aquí no se manda ni un
mensaje: un aviso mal entendido acaba en una tarea que se puede corregir, pero
un mensaje a un cliente no se puede desenviar.

**Lo lanza una persona**, y eso vale como permiso para publicar en el Registro
(no toca git, ni build, ni despliegue: el Registro vive en
`master.tablero_documentos`).

---

## Paso 1 — Bajar lo que hay

Desde la raíz del repo:

```bash
ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=listar crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
```

Devuelve `fallos` (tipo «algo no funciona») y `otros` (dudas y mejoras, cada una
con su `tipo`), las dos con el hilo entero. Si te han pasado una referencia
(`/mailbox AV-0007`), haz solo esa.

> El script viaja por stdin al contenedor: **lo que se ejecuta es tu copia
> local**, así que un cambio en `scripts/buzon-triaje.mjs` surte efecto sin
> desplegar nada.

Lo que hay que mirar de cada uno:

| Campo | Para qué |
| --- | --- |
| `pantalla` | La ruta desde la que escribió. La mitad de las veces dice por qué fichero empezar. |
| `hilo` | Puede que ya se le contestara. Si el hilo dice que se arregló, no lo apuntes: compruébalo y, si es cierto, ya está cerrado. |
| `capturas` | **Desde aquí no las ves**: el triaje lista nombres, no bytes. Si el aviso no se entiende sin ella, eso es lo que se escribe, no lo que te imaginas. Desde el 03/09/2026 el botón «Enviar al registro» de `/admin/buzon` las copia a la tarea, y ya en el Registro se bajan con `node scripts/registro.mjs capturas <ficha>` (`/resolve` lo hace). Si apuntas la tarea a mano desde aquí, dilo en el cuerpo: «captura en el Buzón, AV-####». |
| `leBloquea` | Lo marca el cliente y no es una opinión: manda en la prioridad. |
| `slug` | De quién es. El mismo fallo contado por tres clientes es otra cosa que contado por uno. |
| `estado` | Un aviso ya `enviado` al Registro tiene (o tuvo) su tarea: no se apunta otra vez salvo que el cliente diga que sigue pasando. Desde el 02/09/2026 no hay «resuelto» en el Buzón: acaba en «enviado». |

⚠️ **Un aviso de `salamandra_solutions` somos NOSOTROS probando.** Hoy los que hay
son pruebas manuales de Jorge con texto de relleno. No se apuntan: dilos al final
en una línea y sigue.

## Paso 2 — ¿Está ya apuntado?

```bash
node scripts/registro.mjs bajar
```

```bash
grep -n "AV-0007" docs/registro/backlog.md docs/registro/resuelto.md
```

Si aparece en cualquiera de los dos, **ya está**: ni lo dupliques ni lo reabras.
Por eso **toda tarea que escribas lleva su `AV-000X` dentro del cuerpo** (paso 4):
es lo único que hace que lanzar esto dos veces no llene el backlog de repetidos.

## Paso 3 — Comprobarlo contra PRODUCCIÓN

**Esto no es opcional y es la razón de que la skill la lance una persona.**
`docs/como-apuntar-en-el-tablero.md` §6: local y el VPS divergen mucho (Aumenta
tiene 12 módulos en local y 20 en producción, 15 citas frente a 12.030). Ya pasó
una vez: se apuntó «el cobro con tarjeta no se ha completado nunca» cuando en
producción había dos pagos hechos, uno de 130 € de una paciente real. **Una tarea
falsa hace perder una tarde.**

Primero mira si ya se arregló —fecha del aviso (`escrito`) contra el historial de
lo que toca esa zona:

```bash
git log --oneline --since="2026-08-01" -- lib/citas/ app/api/citas/
```

Después compruébalo de verdad contra producción, con tu propio script de
**solo lectura** por la misma tubería del paso 1. Nunca imprimas filas con datos
personales o de salud.

Tres finales, y los tres son legítimos:

- **Sigue pasando** → tarea en `Alta` / `Media` / `Baja` (paso 4).
- **Ya está arreglado** → **no se apunta**. Dilo al final, y si merece que el
  cliente se entere, eso es `incidencias-buzon`, no esta skill.
- **No se puede saber** — hace falta la captura, o su sesión, o es un «a veces»
  → la tarea se escribe igual, pero va a **`Pendiente de una decisión suya`**,
  diciendo qué miraste y qué falta. **No la metas en Alta/Media/Baja**: una tarea
  sin comprobar entre las comprobadas contamina las tres. Y **no uses
  `Sin comprobar`**: esa sección es para lo que Jorge o Rodrigo apuntan desde el
  móvil, no para que tú te saltes el paso (§7.1).

## Paso 4 — Escribirla

Lee `docs/como-apuntar-en-el-tablero.md` §3 y §4 antes de teclear. Lo que más se
rompe:

- Una tarea es un `###` dentro de una sección `##`. **Las secciones son fijas**:
  `Alta`, `Media`, `Baja`, `Pendiente de una decisión suya`, `Sin comprobar`.
  Inventar una la frena `subir`.
- **Nada de `##` ni `###` dentro del cuerpo**: parte la tarea en dos.
- **El cliente va detrás del último `·`**, con el slug de base de datos
  (`nutri_laura`, no «Laura»).
- **El cuerpo se pinta tal cual**: los asteriscos y las comillas invertidas se
  VEN. Nada de tablas markdown.
- **El título dice qué pasa hoy y en cristiano**: es lo único que se lee en la
  lista y en el móvil. Fuera del título los ficheros, las rutas y la jerga
  (endpoint, schema, override); dentro, la pantalla por su nombre, qué pasa y el
  número que duele. **El cuerpo sí es técnico.**

Qué sección:

| | |
| --- | --- |
| `leBloquea` + cliente real | **Alta** — hay alguien parado ahora mismo. |
| Un cliente se lo encuentra ya, sin bloquearle | **Media** |
| Molesta pero se puede vivir con ello | **Baja** |
| No se ha podido comprobar, o hace falta que Jorge o Rodrigo elijan | **Pendiente de una decisión suya** |

**Las dudas y las mejoras también entran** (es lo que distingue esta skill de
`incidencias-buzon`), pero **nunca en Alta/Media/Baja**: van a `Pendiente de una
decisión suya`. Una duda necesita que alguien decida qué se le contesta; una
mejora, que alguien decida si se hace. Colarlas entre los fallos convierte el
backlog en un buzón de deseos y deja de servir para saber qué está roto.

### La marca de origen — obligatoria (Rodrigo, 31/08/2026)

**Todo lo que salga del buzón lleva delante de dónde viene y de qué clase es**,
en el título. Sin esto, dentro de un mes nadie sabe si una tarea la pidió un
cliente o nos la inventamos nosotros, ni si es algo roto o un deseo:

    Buzón - Fallo:   algo no funciona
    Buzón - Duda:    no entiende una pantalla
    Buzón - Mejora:  pide algo que hoy no existe

Va **en el título y no en el cuerpo**, porque el título es lo único que se lee en
la lista y en el móvil; en el cuerpo la marca no la vería nadie al priorizar.

    ### Buzón - Duda: Por qué el aviso de SLA cuenta tickets que no se ven · `aumenta`

**Es seguro para el parser** (probado el 31/08/2026): corta por el ÚLTIMO `·` y
solo si detrás hay un slug conocido, así que los dos puntos y el guión del
prefijo no parten nada, y el cliente se sigue detectando aunque sean varios.

Lo que va DESPUÉS del prefijo sigue las reglas de siempre: qué pasa hoy, en
cristiano, sin ficheros ni jerga. El prefijo dice de dónde viene; el resto del
título, qué le pasa a la persona.

Una tarea que NO venga del buzón (las que dicta `/backlog`) **no lleva marca**:
la ausencia también informa.

Plantilla:

```markdown
### Buzón - Fallo: Al abrir la ficha desde la lista no pasa nada · `aumenta`

**Lo que nos cuentan.** Desde /clientes, al pulsar una familia, la ficha no se
abre. Lo cuenta AV-0007 (Aumenta, 13/08/2026), y dice que le impide trabajar.

**Lo que se ha visto.** En producción pasa con las fichas cuyo `address` está a
`{}`: el objeto llega como hijo de React y tumba la pantalla entera. El servidor
devuelve 200, así que no sale en ningún log.

*Se comprueba*: abrir en producción la ficha de un cliente con `address = '{}'`.
*Dónde*: `modules/default/ClientDetailModule.jsx:214`.
*Comprobado en producción*: 13/08/2026 — reproducido con dos fichas de Aumenta.
```

`*Se comprueba*` es obligatorio: sin eso, `/resolve` no puede cerrar la tarea sin
fiarse de la palabra de alguien.

## Paso 5 — Marcar el aviso

Para que en la bandeja se vea que está en el Registro (desde el 02/09/2026 lo
deja en «Enviado al registro», que es lo mismo que hace solo el botón «Enviar
al registro» de `/admin/buzon`; la skill sigue valiendo para lo que se apunta
a mano, con más criterio que el botón):

```bash
ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=marcar -e TRIAJE_REF=AV-0007 -e TRIAJE_CONFIRMAR=1 crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
```

Sin `TRIAJE_CONFIRMAR=1` solo dice lo que haría. Deja el mismo rastro de
auditoría que moverlo a mano desde el panel.

⚠️ **`TRIAJE_ESTADO` solo lo lee la acción `marcar`**, nunca `responder`. Si algún
día contestas y quieres cerrar, son dos llamadas.

## Paso 6 — Publicar

**Sin commit, sin build, sin despliegue.**

1. Enseña lo que has escrito antes de subirlo.
2. Ensayo: `node scripts/registro.mjs subir backlog --nota "AV-0007, AV-0009: del buzón al Registro"`
3. Lee qué **entra** y qué **sale**. Si sale algo que tú no has cerrado, **para**.
   Si dice «la versión publicada ya no es la que bajaste», el socio publicó
   mientras escribías: `bajar` otra vez, aplicar encima y repetir. **No uses
   `--forzar`.**
4. El mismo comando con `--confirm`.
5. Verifica: `node scripts/registro.mjs estado` tiene que decir la versión nueva.

## Al terminar, di

- Qué has apuntado, en qué sección y con qué referencia, y qué versión del
  Registro has publicado.
- Qué avisos **no** has apuntado y por qué (ya estaban, ya arreglados, o son
  nuestros).
- **Qué no has podido comprobar y qué falta para poder hacerlo** — esto es lo más
  importante de las tres y es lo que se pierde si no se dice.
- Si algo merece que el cliente se entere hoy, dilo: eso se hace con
  `incidencias-buzon`, no aquí.

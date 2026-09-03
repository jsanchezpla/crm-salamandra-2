---
name: resolve
description: Baja por el backlog del Registro de arriba a abajo resolviéndolo de verdad — reproduce el fallo en producción, lo arregla, pasa las pruebas, commitea, despliega, lo verifica y mueve la tarea a resuelto. Sigue con la siguiente hasta vaciar el backlog o hasta que la pares. Lo que necesita una decisión vuestra no la detiene: lo aparta a «Pendiente de una decisión suya» con las opciones escritas y continúa. Se lanza a mano con /resolve, opcionalmente con una referencia o una sección (/resolve Alta).
---

# Resolver el backlog, de arriba a abajo

Coge el backlog del Registro y lo vacía: **una tarea entera cada vez**, hasta el
final o hasta que la pares.

**La mayoría son bugs de programación, y esos se arreglan enteros y sin
preguntar**: reproducir, arreglar, probar, commitear, desplegar, verificar en
producción y cerrar. Ese es el camino normal y es el que hay que recorrer, no
buscar excusas para no recorrerlo.

**El bucle NO se para nunca.** Solo hay dos finales por tarea:

1. **Resuelta** — arreglada, desplegada, verificada y movida a `resuelto`.
2. **Apartada** — movida a `Pendiente de una decisión suya` con lo que hay que
   decidir escrito, **y se sigue con la siguiente**.

No existe «me detengo a preguntar». Si Rodrigo o Jorge estuvieran delante ya lo
habrían dicho; que no estén no es motivo para dejar el backlog quieto. Las
decisiones se acumulan apartadas y se contestan todas juntas al final, que
además es más cómodo para ellos que ir interrumpiéndoles de una en una.

**Lo lanza una persona, siempre**, y eso vale como permiso explícito para
commitear, empujar a `master` y desplegar (la regla 11 de `CLAUDE.md` prohíbe
hacerlo por iniciativa propia, no cuando lo piden).

Se para con Esc o Ctrl+C. Como cada tarea se cierra del todo antes de empezar la
siguiente, pararla en cualquier momento deja el trabajo coherente — nunca a
medias.

---

## Qué se arregla sola (casi todo)

Si es código, se arregla. **Que una tarea sea del módulo de facturación no la
convierte en «tocar dinero»**: arreglar cómo se pinta un PDF, cómo busca un
listado, cómo se calcula un total, cómo se gatea una pestaña o por qué una
pantalla se rompe con un campo vacío son **bugs**, y se arreglan enteros.

También es trabajo normal, sin apartar:

- **Migraciones de ESTRUCTURA** (columna nueva, tabla nueva, índice): es lo que
  hace `/deploy` todos los días. Leen los schemas de `master.tenants` en tiempo
  de ejecución, nunca slugs a mano (regla 12).
- **Leer producción** todo lo que haga falta, siempre en solo lectura.
- **Subir accesos o módulos** con `enable-module.js` cuando la tarea lo pide por
  escrito y dice para quién.
- **Aplicar la escalera de la regla 16.** No es un freno, es el método: casi
  siempre acaba en un cambio del base, y eso se hace. Solo si de verdad aterriza
  en el peldaño 5 (pantalla propia de UN cliente) se aparta, porque eso ya es
  decisión de producto.

---

## Qué se aparta (y se sigue)

Cuatro motivos, y solo cuatro. En todos: se reescribe la tarea, se mueve a
`Pendiente de una decisión suya`, y **a por la siguiente**.

**1. Escribe o altera DATOS que ya existen en producción.** Backfill, borrado,
seed sobre un cliente real, reescribir filas, vaciar un campo. Es lo único
verdaderamente irreversible que hay aquí, y por eso no se hace sin un sí. Ojo:
esto es sobre datos que YA existen; crear la estructura para datos nuevos no lo
es.

**2. Ejecuta una operación financiera real.** Emitir facturas de verdad, lanzar
un cobro, mandar algo a Verifactu, mover dinero en Stripe o en el banco. No es
«el código toca facturación» —eso es un bug normal—: es que al ejecutarlo
aparece un apunte en la cuenta de alguien.

**3. Hay que elegir entre opciones y ninguna se deduce.** Si al leerla te
preguntas «¿y esto cómo lo querrían?» y la respuesta no sale de las reinas, de
la escalera ni de cómo está hecho el resto del CRM, es suya. **Antes de apartar,
intenta deducirla**: muchas «decisiones» las contesta `CLAUDE.md` («¿la reina
querría esto también?»). Apartar es para lo que de verdad tiene dos caminos
defendibles.

**4. Cambia la arquitectura multi-tenant** (regla 5 de `CLAUDE.md`: consultar
antes).

Y una cosa que **no se hace nunca, ni apartándola**: escribir a un cliente. Eso
es `incidencias-buzon`, con una persona delante.

### Cómo se aparta bien

Una tarea apartada sin la decisión escrita es una tarea perdida. Se reescribe
así, se mueve entera a `Pendiente de una decisión suya`, y se publica:

- **Qué está hecho ya.** Si arreglaste la mitad de código y lo que falta es el
  permiso, dilo con su commit: al volver, casi todo está.
- **Qué falta exactamente**, en una frase ejecutable («vaciar `partners` de
  `crm_aumenta`: una fila JSONB»).
- **Las opciones, numeradas**, con cuál recomiendas y por qué. Que se pueda
  contestar con «la b» y nada más.
- **Lo que cuesta equivocarse**: qué se rompe, a cuántos afecta, si se deshace.
  Medido, no a ojo — «0 de 14.244 facturas usan socio» decide sola.

Si la mitad de código se puede hacer sin el permiso, **hazla, despliégala y
verifícala**, y aparta solo lo que de verdad espera. Media tarea entregada vale
más que una tarea entera quieta.

---

## Paso 0 — Coger la lista

```bash
node scripts/registro.mjs bajar
```

Orden: **`Alta`, luego `Media`, luego `Baja`**, y dentro de cada una de arriba
abajo, que es como están priorizadas.

**No se tocan**: `Pendiente de una decisión suya` (ya está esperando a alguien),
`Sin comprobar` (nadie ha mirado si es cierto) ni `Cómo se usa esto` (son las
instrucciones del tablero).

Si te han pasado algo (`/resolve Alta`, `/resolve AV-0007`, `/resolve el buscador
de cobros`), limita el trabajo a eso y dilo.

Enseña la lista y el orden antes de empezar. Es la última ocasión barata de que
alguien diga «esa no».

⚠️ **Puede haber otra sesión trabajando en este mismo árbol.** Pasó el
31/08/2026: doce tareas cerradas por otra sesión mientras esta leía el backlog.
Vuelve a `bajar` entre tareas, y al commitear **añade fichero a fichero, nunca
`git add -A`**: el árbol puede tener cambios de otro que no son tuyos.

---

## El bucle — por cada tarea

### 1. Entenderla
El cuerpo entero, y sobre todo `*Se comprueba*` (cómo se sabe si sigue pasando) y
`*Dónde*` (por dónde empezar). Lee el `## Mapa` del doc del módulo que toca
(`docs/modules/`), que es la regla de `CLAUDE.md`.

**Si la tarea lleva capturas, míralas ANTES de decidir nada.** Lo dice el
propio texto: una línea `**Capturas.**` en el cuerpo (las que vinieron del
Buzón) o, si te la han pegado desde el botón «Copiar» del tablero, una cola
«Esta tarea lleva N capturas de pantalla en el Registro». Se bajan por la ficha
—la `<!--id:…-->` del bloque, o la que trae el texto pegado—:

```bash
node scripts/registro.mjs capturas k7m2p9
```

Quedan en `docs/registro/capturas/k7m2p9/`, fuera de git; ábrelas con `Read`
como cualquier imagen. Media captura explica más que el texto entero, y una
tarea resuelta sin mirarla es la forma más rápida de arreglar otra cosa. ⚠️
Pueden llevar datos de un paciente: se miran y se borran, no se pegan en el
chat ni se describen con nombres.

### 2. Reproducirlo EN PRODUCCIÓN
`docs/como-apuntar-en-el-tablero.md` §6: local y el VPS divergen mucho. Ejecuta
lo que diga `*Se comprueba*` contra producción, en **solo lectura**:

```bash
ssh crm-vps 'docker exec -i crm-salamandra-app-1 node --input-type=module -' < consulta.mjs
```

Nunca imprimas filas con datos personales o de salud.

Si **ya no pasa**, salta a «Cerrarla» con el sello explicando cómo lo
comprobaste. Es un final legítimo y de los más rentables. Comprueba en los DOS
sentidos cuando se pueda: que donde debe verse se ve y donde no, no — un «false»
puede ser la regla funcionando o la regla rota, y solo el segundo caso lo
distingue.

### 3. Arreglarlo del todo
Nada de arreglos a medias ni de dejarlo «preparado». Manda `CLAUDE.md`, en
particular la **16 (la escalera)**: primero gana el base, y lo del cliente es lo
más pequeño posible encima. Si hace falta código en `lib/`, va con su prueba en
`npm test` y su línea en `docs/modules/`.

### 4. Probarlo
```bash
npm test
```
```bash
npm run build
```
Los dos en verde, **mirando el código de salida y no el final de la salida** —
un build roto se cuela por el tail (lección del 31/08/2026). Si algo se pone
rojo por tu cambio, arréglalo; si estaba rojo de antes, dilo y no lo tapes.

Una prueba nueva de una función de `lib/` se escribe con `node:test` +
`node:assert/strict` y prueba **lo que devuelve**, no cómo está escrito.

### 5. Commitear
`git add` **fichero a fichero** (ver el aviso del paso 0), sin `.env*` ni
secretos, Conventional Commits y el trailer:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Antes de empujar: `git fetch origin && git diff --name-only HEAD origin/master`.
Si ningún fichero es tuyo, `git pull --ff-only`. **Si alguno coincide, PARA Y
PREGUNTA** — hay dos personas empujando a `master`. Prohibido reescribir
historia.

### 6. Desplegar
Con `/deploy`. **Una tarea, un despliegue**: juntar cinco arreglos en uno hace
imposible saber cuál rompió algo.

### 7. Verificarlo en producción
**No basta con que el despliegue termine: hay que ver el comportamiento nuevo.**
Repite lo del paso 2 y comprueba que ahora sale lo que tiene que salir.

Si no se puede comprobar, la tarea **no se cierra**: se queda con una nota de qué
se intentó.

### 8. Cerrarla
Cerrar es **mover, no borrar**: sale de `backlog.md` y entra en `resuelto.md` en
la misma publicación, para que no haya un instante en que no esté en ninguno.

**La marca de origen viaja con la tarea.** Si el título empezaba por
`Buzón - Fallo:` (lo pone `/mailbox`), la entrada de `resuelto` lo mantiene: seis
meses después, saber que aquello lo sufrió un cliente de verdad y no se nos
ocurrió a nosotros es la mitad del valor del histórico. El resto del título sí
cambia: pasa de describir el problema a describir que ya no está.

En `resuelto.md` las secciones son fechas `## DD/MM/AAAA`, lo más reciente
arriba. Si ya existe la de hoy, la entrada va dentro. Cada una lleva **cómo se
comprobó**, no solo que se comprobó, y **el hash del commit**:

```markdown
## 31/08/2026

### Buzón - Fallo: Al abrir la ficha desde la lista ya se abre · `aumenta`

El objeto vacío de `address` llegaba como hijo de React y tumbaba la pantalla.
Ahora se normaliza antes de pintar (`4a9510f0`).

*Comprobado en producción*: 31/08/2026 — abiertas dos fichas con `address = '{}'`
que antes daban pantalla en blanco; las dos cargan.
```

Publica los dos ficheros, uno detrás del otro:

```bash
node scripts/registro.mjs subir backlog --nota "cierra AV-0007: la ficha ya se abre"
```

Ensayo primero, luego `--confirm`. Si dice «la versión publicada ya no es la que
bajaste», vuelve a `bajar` y aplica tu cambio encima. **Nunca `--forzar`.**

### 9. Una línea de qué ha pasado
Qué tarea, qué se hizo, qué commit, y que está verificada. Así, si alguien para
el bucle aquí, sabe exactamente dónde se quedó.

### 10. La siguiente
**El bucle no pregunta si sigue: sigue.** Solo termina cuando no quedan tareas
trabajables, o cuando lo paran.

---

## Al terminar, di

- **Qué se ha cerrado**, con su commit y la versión del Registro publicada.
- **Qué se ha apartado y qué hay que decidir** — numerado, para que se pueda
  contestar de un tirón. Es lo más importante que dices: son las que necesitan a
  una persona, y si no se dicen se pierden.
- **Qué queda** y qué sería lo siguiente.
- De lo desplegado, que se ha verificado en producción — o que no se ha podido,
  que también se dice.

## Si quieres que además recoja lo nuevo

Esta skill vacía lo que hay cuando la lanzas. Para ir recogiendo lo que entre
después, encadénala con el buzón:

```bash
/loop 30m /mailbox
```

y lanza `/resolve` cuando quieras ponerte. Meter `/mailbox` dentro de este bucle
sería peor: mezclaría «decidir qué es trabajo» con «hacer el trabajo», y son dos
criterios distintos que conviene poder parar por separado.

**No lances dos `/resolve` a la vez.** El Registro se protege por versión, pero
dos bucles arreglando y empujando a `master` en paralelo acaban chocando.

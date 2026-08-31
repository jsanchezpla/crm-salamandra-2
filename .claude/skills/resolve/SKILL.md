---
name: resolve
description: Baja por el backlog del Registro de arriba a abajo resolviendo tareas una a una — comprueba que sigue pasando, la arregla, pasa las pruebas, commitea, despliega, lo verifica en producción y mueve la tarea a resuelto. Sigue con la siguiente hasta vaciar el backlog o hasta que la pares. Para en seco si una tarea toca datos de producción, mueve dinero o necesita una decisión de producto. Se lanza a mano con /resolve, opcionalmente con una referencia o una sección (/resolve Alta).
---

# Resolver el backlog, de arriba a abajo

Coge el backlog del Registro y lo va vaciando: **una tarea entera cada vez**,
hasta el final o hasta que la pares.

**Va en bucle a propósito.** No es «arregla una y pregunta»: es «sigue hasta que
no queden, o hasta que Rodrigo o Jorge digan basta». Se para con Esc o Ctrl+C, y
como cada tarea se cierra del todo antes de empezar la siguiente, pararla en
cualquier momento deja el trabajo en un estado coherente — nunca a medias.

**Lo lanza una persona, siempre**, y eso vale como permiso explícito para
commitear y empujar a `master` (la regla 11 de `CLAUDE.md` prohíbe hacerlo por
iniciativa propia, no cuando lo piden). **Lo que ese permiso NO cubre es tocar
datos**: ver «Los frenos».

---

## Los frenos — léelos antes que nada

Van primero porque son lo único de esta skill que no se puede deshacer. Ante
cualquiera de estos, **para esa tarea, di por qué, y pasa a la siguiente**. No la
resuelvas «con cuidado»: déjala y sigue.

1. **Toca DATOS de producción.** Migración que reescribe filas, backfill, borrado,
   seed, cambio de un valor que ya existe. Se mide primero y se pide permiso,
   como en `/deploy`. Que la tarea lo pida por escrito no es el permiso.
2. **Mueve dinero.** Facturación, cobros, Stripe, Verifactu, banco. Un fallo aquí
   se ve en la cuenta de alguien. Se prepara, se enseña, se espera.
3. **Necesita una decisión de producto.** Si al leerla te preguntas «¿y esto cómo
   lo querrían?», la respuesta no la tienes tú: eso es la sección `Pendiente de
   una decisión suya`, y por eso esta skill no la toca.
4. **Cambia la arquitectura multi-tenant** (regla 5 de `CLAUDE.md`): se consulta
   antes.
5. **Pide un override de cliente.** Antes de abrir `modules/overrides/`, la
   escalera de la regla 16 de `CLAUDE.md`, peldaño a peldaño. Un override es el
   último peldaño, casi nunca el primero.
6. **Ya no pasa en producción.** No arregles lo que no está roto: ciérrala
   diciendo cómo lo comprobaste (abajo).
7. **Escribir a un cliente.** Nunca desde aquí. Eso es `incidencias-buzon`.

Si una tarea se frena, **no se borra del backlog ni se mueve a `resuelto`**: se
queda donde está. Si el motivo es que hace falta una decisión, muévela a
`Pendiente de una decisión suya` explicando qué hay que decidir.

---

## Paso 0 — Coger la lista

```bash
node scripts/registro.mjs bajar
```

Orden de trabajo: **`Alta`, luego `Media`, luego `Baja`**, y dentro de cada
sección de arriba abajo, que es como están priorizadas.

**No se tocan**: `Pendiente de una decisión suya` (por definición no es tuya),
`Sin comprobar` (nadie ha mirado si es cierto) ni `Cómo se usa esto` (son las
instrucciones del tablero, no tareas).

Si te han pasado algo (`/resolve Alta`, `/resolve AV-0007`, `/resolve el buscador
de cobros`), limita el trabajo a eso y dilo.

Antes de empezar, **enseña la lista de lo que vas a hacer y en qué orden**. Es la
última oportunidad barata de que alguien diga «esa no».

---

## El bucle — por cada tarea

### 1. Entenderla
Lee el cuerpo entero, y sobre todo `*Se comprueba*` (cómo se sabe si sigue
pasando) y `*Dónde*` (por dónde empezar). Lee el `## Mapa` del doc del módulo que
toca (`docs/modules/`), que es la regla de `CLAUDE.md`.

### 2. Comprobar que sigue pasando — EN PRODUCCIÓN
`docs/como-apuntar-en-el-tablero.md` §6. Local y el VPS divergen mucho. Ejecuta
lo que diga `*Se comprueba*` contra producción, en **solo lectura**:

```bash
ssh crm-vps 'docker exec -i crm-salamandra-app-1 node --input-type=module -' < consulta.mjs
```

Nunca imprimas filas con datos personales o de salud.

Si **ya no pasa**: salta a «Cerrarla» con el sello explicando que se comprobó y
ya no ocurre. Es un final legítimo y de los más rentables.

### 3. Arreglarlo
Las reglas de `CLAUDE.md` mandan, en particular la **16 (la escalera)**: primero
gana el base, y lo del cliente es lo más pequeño posible encima. Si hace falta
código en `lib/`, va con su prueba en `npm test` y su línea en `docs/modules/`.

### 4. Probarlo
```bash
npm test
```
```bash
npm run build
```
**Los dos en verde antes de seguir.** Si algo se pone rojo por tu cambio,
arréglalo; si estaba rojo de antes, dilo y no lo tapes.

Una prueba nueva de una función de `lib/` se escribe con `node:test` +
`node:assert/strict` y prueba **lo que devuelve**, no cómo está escrito.

### 5. Commitear
`git add` sin `.env*` ni secretos, Conventional Commits, y el trailer:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

**Antes de empujar, sincroniza**: `git fetch origin && git diff --name-only HEAD
origin/master`. Si ningún fichero es tuyo, `git pull --ff-only`. **Si alguno
coincide, PARA Y PREGUNTA** — hay dos personas empujando a `master`. Prohibido
reescribir historia.

### 6. Desplegar
Con `/deploy`, que ya sabe el orden (build en el host, migraciones de estructura,
`deploy.sh` en el VPS, comprobación dentro del contenedor). **Una tarea, un
despliegue**: juntar cinco arreglos en uno hace imposible saber cuál rompió algo.

### 7. Verificarlo en producción
`docs/como-apuntar-en-el-tablero.md` §6: **no basta con que el despliegue
termine, hay que ver el comportamiento nuevo.** Repite lo del paso 2 y comprueba
que ahora sale lo que tiene que salir.

Si no se puede comprobar, la tarea **no se cierra**: se queda con una nota de qué
se intentó.

### 8. Cerrarla
Cerrar es **mover, no borrar**: sale de `backlog.md` y entra en `resuelto.md`
**en la misma publicación**, para que no haya un instante en que no esté en
ninguno de los dos.

**La marca de origen viaja con la tarea.** Si el título empezaba por
`Buzón - Fallo:` (lo pone `/mailbox`), la entrada de `resuelto` lo mantiene: seis
meses después, saber que aquello lo sufrió un cliente de verdad y no se nos
ocurrió a nosotros es la mitad del valor del histórico. Lo que sí se actualiza es
el resto del título, que pasa de describir el problema a describir que ya no está.

En `resuelto.md` las secciones son fechas `## DD/MM/AAAA`, **lo más reciente
arriba**. Si ya existe la de hoy, la entrada va dentro de esa. Cada entrada lleva
**cómo se comprobó**, no solo que se comprobó, y **el hash del commit**:

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

### 9. Decir en una línea qué ha pasado
Antes de la siguiente: qué tarea, qué se hizo, qué commit, y que está verificada.
Así, si alguien para el bucle aquí, sabe exactamente dónde se quedó.

### 10. Volver a empezar
Con la siguiente tarea de la lista. **El bucle no pregunta si sigue**: sigue.
Solo se detiene cuando no quedan tareas, cuando todas las que quedan están
frenadas, o cuando la paran.

Vuelve a `bajar` el Registro entre tareas: alguien puede haber publicado mientras
trabajabas.

---

## Al terminar, di

- **Qué se ha cerrado**, con su commit y la versión del Registro publicada.
- **Qué se ha frenado y por qué**, una línea por tarea. Es lo más importante:
  son las que necesitan a una persona, y si no se dicen, se pierden.
- **Qué queda en el backlog** y qué sería lo siguiente.
- Si algo se ha desplegado, que se ha verificado en producción — o que no se ha
  podido, que también se dice.

## Si quieres que además recoja lo nuevo

Esta skill vacía lo que hay cuando la lanzas. Para que además vaya recogiendo lo
que entre después, encadénala con el buzón:

```bash
/loop 30m /mailbox
```

y lanza `/resolve` cuando quieras ponerte. Meter `/mailbox` dentro de este bucle
sería peor: mezclaría «decidir qué es trabajo» con «hacer el trabajo», y son dos
criterios distintos que conviene poder parar por separado.

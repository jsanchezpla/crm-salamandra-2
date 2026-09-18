---
name: incidencia
description: Abre UNA incidencia por su identificador y la lleva hasta el final. Reúne en una sola consulta el aviso del Buzón (hilo y capturas) y su tarea del Registro, recomienda con qué modelo y esfuerzo conviene hacerla, comprueba contra producción si sigue pasando, la arregla, commitea, despliega, verifica, le contesta al cliente y cierra la tarea. Se lanza a mano con /incidencia AV-0169, /incidencia s55hv5 o /incidencia con el UUID del aviso.
---

# Abrir una incidencia y terminarla

Un caso, de punta a punta. Se le da un identificador y esta skill lo reúne todo
—lo que escribió el cliente, lo que se le contestó, la tarea del Registro, en
qué sección está, sus capturas— y lo lleva hasta que está arreglado, desplegado,
contestado y cerrado.

**Lo lanza una persona, siempre.** No hay versión automática. Lanzarla ES el
permiso para commitear, desplegar y contestarle al cliente de ESTE caso
(Jorge, 18/09/2026). Lo que ese permiso no cubre está abajo, en «Dónde se para».

## Con qué se la llama

```
/incidencia AV-0169     la referencia del Buzón (la que dice el cliente por teléfono)
/incidencia s55hv5      la ficha de la tarea del Registro
/incidencia 3f2504e0-…  el UUID del aviso
```

`/incidencia` a secas **se para y pide una**. No repases el buzón por tu cuenta,
no elijas tú el caso y no toques ningún fichero: para eso están `/mailbox` y
`/resolve`.

Las tres formas valen porque `lib/incidencias/identificador.js` las distingue.
⚠️ Ojo con `av0169`: son seis caracteres `[a-z0-9]`, o sea una ficha válida
además de una referencia sin guion. **Es el aviso 169**, y lo fija
`scripts/_smoke-incidencia-identificador.mjs`. No lo cambies de orden.

---

## Paso 0 — Recomendar modelo y esfuerzo

Lo PRIMERO. Abre el caso (paso 1, que es una sola consulta y barata) y, con eso
delante, di con qué conviene llevarlo a cabo. **No arregles, no compruebes y no
abras un fichero antes de esa frase.**

| Lo que se ve en el caso | Recomendación |
| --- | --- |
| Una duda, un rótulo, un texto, o el hilo ya dice cuál es el fallo | **Haiku 4.5**, esfuerzo bajo |
| Un fallo acotado a uno o dos ficheros, con la pantalla y el error dichos | **Sonnet 5**, esfuerzo medio |
| Toca varios módulos, o hay que reproducirlo en producción para saber qué pasa | **Opus 5**, esfuerzo alto |
| Dinero, datos clínicos, multi-tenant, o el hilo se contradice | **Opus 5**, esfuerzo `xhigh` |

**Sube un escalón** si le bloquea el trabajo (`leBloquea`), si el cliente es una
reina (`aumenta`, `nutri_laura`, `retorika`, `laura_ubeda`), si el hilo lleva más
de dos mensajes o si es la segunda vez que escriben por lo mismo.

Se dice en una línea:

> AV-0169, fallo acotado a Cobros de aumenta y con el hilo claro: **Sonnet 5,
> esfuerzo medio**. ¿Lo cambio o sigo con este?

Y se **ofrece** cambiarlo (`set_session_model` / `set_session_effort`).
⚠️ **No se cambia solo**: el modelo y el gasto los elige Jorge. Si dice que
sigas, sigues con el que haya y no se vuelve a mencionar.

---

## Paso 1 — Abrir el caso

Una sola consulta, de solo lectura, que trae el aviso Y su tarea:

```bash
ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=ver -e TRIAJE_REF=AV-0169 crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
```

Devuelve `aviso` (con `hilo` y `capturas`), `tarea` (documento, sección, ficha,
título, cuerpo), `estado` (tick, reparto, solución) y `capturasDelTablero`.

**No uses `TRIAJE_ACCION=listar` para esto.** Ignora la referencia y vuelca los
~300 avisos enteros: te gastas medio contexto para leer uno.

Lee lo que devuelve, y en concreto:

- **`tarea: null`** → el caso no está apuntado. Dilo; no te lo inventes.
- **`casadaPor: "cita AV"`** → el aviso es anterior al botón del 02/09/2026 y no
  tiene ficha; se ha casado por la cita del texto. Vale, pero mira que la tarea
  sea de verdad la suya antes de cerrarla.
- **`tarea.abierta: false`** → ya está en Resuelto. Igual solo hay que
  contestarle (paso 7).

Si hay capturas, bájalas y **míralas**:

```bash
node scripts/registro.mjs capturas s55hv5
```

Quedan en `docs/registro/capturas/<ficha>/`. Media captura explica más que el
texto entero, y quien escribe desde una clínica no describe pantallas.

## Paso 2 — Resumir

Cinco líneas, en cristiano: quién lo cuenta y de qué centro, qué dice que pasa,
qué tarea es y en qué sección está, qué se le ha contestado ya, y qué ficheros
crees que toca. Sin esto, lo que sigue no se puede revisar.

## Paso 3 — Comprobar contra producción

⚠️ **Antes de arreglar nada, que el fallo pase de verdad en el VPS.** Local y
producción divergen mucho (Aumenta tiene 15 citas en local y 12.030 en
producción): un fallo que se ve aquí puede no existir allí, y al revés.

```bash
ssh crm-vps 'docker exec -i crm-salamandra-app-1 node --input-type=module -' < consulta.mjs
```

Solo lectura. **Nunca imprimas filas con datos personales o de salud**: cuenta,
agrupa, comprueba que existe — no vuelques.

Tres finales, y **el tercero es un final legítimo**:

- **sigue pasando** → al paso 4;
- **ya está arreglado** → salta al 7, contéstale, y al 8 si la tarea sigue
  abierta;
- **no se puede saber** → dilo, escribe en la tarea qué intentaste, y para. No
  arregles a ciegas lo que no has visto romperse.

## Paso 4 — Arreglar

La escalera de la regla 16 de `CLAUDE.md` manda, y se aplica **antes** de abrir
un fichero: rótulo → dato en `lib/` → `featureFlag` → `logicOverride` → y solo al
final pantalla propia. Las dos preguntas de siempre: «si mañana lo pide otro
cliente, ¿tendría que copiar código?» y «si cambio el base, ¿este cliente tiene
que cambiar también?».

Si tocas una función de `lib/`, **lleva su prueba** (`node:test` +
`node:assert/strict`), que pruebe lo que DEVUELVE.

```bash
npm test
```

```bash
npm run build
```

Los dos en verde antes de seguir. Si un rojo no es tuyo —un fichero que no has
tocado, una aserción de reloj—, compruébalo lanzando esa prueba sola antes de
darlo por bueno; y si de verdad no es tuyo, dilo y sigue.

## Paso 5 — Commitear y desplegar

Primero, sincronizar, que Rodrigo también empuja a `master`:

```bash
git fetch origin && git diff --name-only HEAD origin/master
```

Si ningún fichero coincide con los tuyos, `git pull --rebase origin master`.
⚠️ **Si alguno coincide, PARA Y PREGUNTA.**

`git add` **fichero a fichero**, nunca `git add -A`: puede haber otra sesión
trabajando en el mismo árbol y barrerías lo suyo. Conventional Commits, con la
referencia en el asunto —ya es la convención de la casa— y el trailer
`Co-Authored-By`.

Y el despliegue **se delega**: `/deploy`. No lo reimplementes aquí.

## Paso 6 — Verificar en producción

Que el código esté subido no es que funcione. Mira el comportamiento nuevo
dentro del contenedor, y con la pantalla si se puede. Sin esto no se pasa al 7.

## Paso 7 — Contestarle al cliente

⚠️ **Esto lo lee una persona y no se puede desenviar.** El listón, el mismo que
`/incidencias-buzon`: commit identificado **y** desplegado y verificado. Sin las
dos cosas, no se escribe.

Ensayo primero (sin `TRIAJE_CONFIRMAR` enseña lo que mandaría y sale):

```bash
ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=responder -e TRIAJE_REF=AV-0169 -e TRIAJE_AUTOR=jorge -e "TRIAJE_TEXTO=Hola Rosa, ya está arreglado: …" crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
```

Se escribe **para quien lo va a leer**: sin nombres de fichero, sin
«endpoint», sin «commit». Qué pasaba, qué hace ahora y qué tiene que hacer ella.

Y aparte, el estado — ⚠️ **`responder` NO lo cambia** (se aprendió el 18/09/2026
con AV-0189, que se quedó contestado y abierto):

```bash
ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=marcar -e TRIAJE_REF=AV-0169 -e TRIAJE_ESTADO=enviado -e TRIAJE_CONFIRMAR=1 crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
```

## Paso 8 — Cerrar la tarea

Mover el bloque de `docs/registro/backlog.md` a `docs/registro/resuelto.md`,
conservando el prefijo `Buzón - Fallo:` y **su línea `<!--id:…-->`**: la ficha se
va con la tarea, y de ella cuelgan las capturas. En Resuelto, **cómo se
comprobó**, que es lo único que hace que la entrada sirva dentro de seis meses.

`resuelto` **primero**, `backlog` después. Al revés, si la segunda falla, la
tarea desaparece de los dos sitios y nadie echa de menos lo que ya no está
escrito en ninguna parte.

```bash
node scripts/registro.mjs subir resuelto --nota "cierra AV-0169: la E.I. ya deja su pendiente" --confirm
```

```bash
node scripts/registro.mjs subir backlog --nota "cierra AV-0169: la E.I. ya deja su pendiente" --confirm
```

```bash
node scripts/registro.mjs estado
```

Publicar llama solo a `sincronizarConRegistro`, que mueve el aviso de pestaña.
No hace falta tocarlo a mano.

⚠️ Sin `--confirm` es ensayo. **`--forzar` está prohibido**: se salta el freno
del 70 % y el cerrojo de versión, que es lo único que impide que dos personas
publicando a la vez se pisen.

---

## Dónde se para

Lanzar `/incidencia` no autoriza estas cuatro. Aquí se **para y se pregunta**:

- **Escribir o alterar datos que ya existen en producción**, incluido lo
  indirecto: rehacer la foto dorada de una demo, reactivar un cliente, activar
  un módulo, una autolimpieza. La tabla de cuatro filas de `/deploy` manda
  entera.
- **Una operación financiera** real.
- **La arquitectura multi-tenant** (regla 5 de `CLAUDE.md`).
- **Una elección genuina entre opciones.** Eso no se decide aquí: se aparta a
  «Pendiente de una decisión suya» con las opciones numeradas, como hace
  `/resolve`, y se sigue.

Y siguen prohibidos, siempre: `git push --force`, `reset --hard` sobre lo
subido, y reescribir historia. Se arregla con un commit nuevo o con `revert`.

## Lo que esta skill NO es

| Si quieres… | Usa |
| --- | --- |
| Vaciar el buzón entero al Registro | `/mailbox` |
| Triar los fallos del buzón, muchos de una vez | `/incidencias-buzon` |
| Bajar el backlog de arriba a abajo | `/resolve` |
| Apuntar tareas que le dictas | `/backlog` |
| **Un caso concreto, hasta el final** | **esta** |

## Al terminar, di

- **Qué era**: la referencia, el cliente, quién lo escribió y qué pasaba.
- **Qué se ha hecho**: el arreglo en una frase, y el hash del commit.
- **Qué se comprobó en producción**, antes y después.
- **Qué se le ha contestado**, y en qué estado queda el aviso.
- **Dónde está la tarea ahora**: Resuelto, o por qué sigue abierta.
- **Lo que no has podido comprobar**, si lo hay. Esa línea vale más que las
  otras cinco.

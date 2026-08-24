/**
 * lib/tablero/editor.js — escribir en el Registro sin abrir un editor.
 *
 * (Motivo del fichero en /lib, regla #2: lo va a usar el endpoint del tablero,
 * que no puede tener aquí su propia forma de escribir el documento. Todo lo de
 * aquí es texto entra → texto sale, sin base de datos y sin `fetch`, y lo fija
 * `scripts/_smoke-tablero-editor.mjs`.)
 *
 * ── POR QUÉ EXISTE (24/08/2026) ───────────────────────────────────────────
 * Hasta hoy el tablero solo LEÍA. Apuntar una tarea era escribir su bloque a
 * mano en el markdown y publicar una versión entera con `registro.mjs`, o sea:
 * hacía falta el ordenador con el repo y la llave del VPS. Y cambiar una
 * prioridad era lo mismo, porque la prioridad ES la sección del texto. El
 * resultado medido: 16 versiones del backlog publicadas por dos usuarios de
 * máquina, y lo que se piensa en el coche o al colgar con un cliente se quedaba
 * en un WhatsApp.
 *
 * ── LA REGLA QUE ORDENA TODO ESTE FICHERO ─────────────────────────────────
 * El texto sigue siendo LA VERDAD. Aquí no se inventa un sitio nuevo donde
 * guardar la prioridad: se reescribe el documento y se publica la versión
 * siguiente, por la misma puerta por la que pasa `registro.mjs`
 * (`prepararPublicacion`, con sus errores de formato, su freno por versión y su
 * freno del 70 %). Se descartó la alternativa barata —una columna más en
 * `tablero_estado`, como el tick— porque dejaría el texto diciendo una cosa y la
 * pantalla otra, y quien bajara el Registro mañana no vería el cambio. Es la
 * misma herida que ya tiene el casado por título, y no se hacen dos.
 *
 * ── CIRUGÍA, NO RECONSTRUCCIÓN ────────────────────────────────────────────
 * Cada función corta y pega LÍNEAS del texto original; ninguna reconstruye el
 * documento a partir de lo troceado. Es deliberado y es lo único que hace esto
 * seguro: el documento tiene un manual al principio, comentarios, separadores y
 * el formato exacto que escribió una persona. Reconstruirlo desde el troceo
 * devolvería un documento *parecido* —y publicar un documento parecido, con el
 * freno del 70 % dando el visto bueno porque el número de tareas cuadra, es la
 * forma silenciosa de perderlo todo.
 */

import {
  PRIORIDADES,
  SECCIONES_BACKLOG,
  marcaDeFicha,
  seccionDeHoy,
  trocearTodo,
} from "./parser.js";
import { claveDeTarea } from "./estado.js";

/** Tope del título. Da para una frase que dice qué pasa, que es lo que se pide. */
export const MAX_TITULO = 200;

/** Tope del cuerpo. El más largo de los 133 publicados no llega a 3 KB. */
export const MAX_CUERPO = 20_000;

/** Tope de la cola de clientes detrás del «·». */
export const MAX_QUIEN = 200;

/** La sala de espera donde cae lo apuntado desde el móvil, sin comprobar. */
export const SIN_COMPROBAR = "Sin comprobar";

/**
 * Un error que se le puede enseñar a quien está escribiendo. Se distingue de un
 * fallo de verdad para que el endpoint conteste 400 con el motivo en vez de 500
 * con nada.
 */
export class ErrorDeEdicion extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "ErrorDeEdicion";
    this.deUsuario = true;
  }
}

/* ── Fichas ───────────────────────────────────────────────────────────────── */

const ALFABETO = "abcdefghijkmnpqrstuvwxyz23456789"; // sin l, o, 0, 1: se confunden al leerlas

/**
 * Una ficha que no esté ya en el texto.
 *
 * `aleatorio` se puede pasar para poder probar esto: sin ese hueco, la única
 * forma de fijar el comportamiento sería contar colisiones a ojo.
 */
export function nuevaFicha(texto, aleatorio = Math.random) {
  const usadas = new Set(
    trocearTodo(texto ?? "")
      .secciones.flatMap((s) => s.tareas)
      .map((t) => t.id)
      .filter(Boolean)
  );
  for (let intento = 0; intento < 100; intento++) {
    let id = "";
    for (let i = 0; i < 6; i++) id += ALFABETO[Math.floor(aleatorio() * ALFABETO.length)];
    if (!usadas.has(id)) return id;
  }
  // 32^6 son mil millones y en el documento hay 133 tareas: llegar aquí no es
  // mala suerte, es que `aleatorio` devuelve siempre lo mismo.
  throw new Error("No se ha podido sacar una ficha libre en 100 intentos");
}

/* ── Escribir un bloque ───────────────────────────────────────────────────── */

/**
 * Lo que se valida de una tarea antes de dejarla entrar en el documento.
 *
 * Los dos primeros son los que rompen el Registro de verdad:
 *   · un `#` al principio de una línea del cuerpo PARTE la tarea en dos (el
 *     troceador corta por `##` y `###`), y el trozo de abajo se queda sin sello
 *     y sin cliente;
 *   · un salto de línea dentro del título deja media tarea fuera de todo.
 *
 * El manual lo dice desde el principio («nada de `##` ni `###` dentro del
 * cuerpo»), pero hasta hoy lo único que lo impedía era acordarse.
 */
function limpiarTarea({ titulo, quien, cuerpo }) {
  const t = String(titulo ?? "").trim();
  const q = String(quien ?? "").trim();
  const c = String(cuerpo ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!t) throw new ErrorDeEdicion("La tarea necesita un título.");
  if (t.length > MAX_TITULO)
    throw new ErrorDeEdicion(`El título se pasa: ${t.length} de ${MAX_TITULO} caracteres.`);
  if (/[\n\r]/.test(t)) throw new ErrorDeEdicion("El título tiene que caber en una línea.");
  if (/^#/.test(t)) throw new ErrorDeEdicion("El título no empieza por «#»: eso ya lo pone el «###».");

  if (q.length > MAX_QUIEN)
    throw new ErrorDeEdicion(`La cola de clientes se pasa: ${q.length} de ${MAX_QUIEN}.`);
  if (/[\n\r]/.test(q)) throw new ErrorDeEdicion("El cliente tiene que caber en una línea.");

  if (c.length > MAX_CUERPO)
    throw new ErrorDeEdicion(`El cuerpo se pasa: ${c.length} de ${MAX_CUERPO} caracteres.`);
  const partida = c.split("\n").findIndex((l) => /^#{1,6}\s/.test(l));
  if (partida >= 0) {
    throw new ErrorDeEdicion(
      `La línea ${partida + 1} del cuerpo empieza por «#» y eso parte la tarea en dos. Para dar estructura, negrita al principio del párrafo.`
    );
  }
  return { titulo: t, quien: q, cuerpo: c };
}

/**
 * El bloque de markdown de una tarea, con su ficha puesta. Siempre acaba en un
 * salto: quien lo pega no tiene que acordarse de separarlo del siguiente.
 */
export function bloqueDeTarea({ titulo, quien, cuerpo, id }) {
  const limpia = limpiarTarea({ titulo, quien, cuerpo });
  const cabecera = limpia.quien ? `### ${limpia.titulo} · ${limpia.quien}` : `### ${limpia.titulo}`;
  const partes = [cabecera, ""];
  if (id) partes.push(marcaDeFicha(id), "");
  partes.push(limpia.cuerpo, "");
  return partes.join("\n");
}

/* ── Encontrar una tarea ──────────────────────────────────────────────────── */

/**
 * Dónde está una tarea, por ficha o por título normalizado.
 *
 * La ficha manda cuando la hay: es lo único que sobrevive a que alguien
 * reescriba el título. El título es el respaldo para las tareas escritas antes
 * del 24/08/2026, que no llevan ficha; en cuanto se las toca desde el tablero,
 * la ganan.
 *
 * Devuelve la tarea troceada, su sección y el rango de líneas que ocupa
 * (`desde`/`hasta`, ambos incluidos, en numeración de 1).
 */
export function localizar(texto, { id = null, clave = null } = {}) {
  if (!id && !clave) throw new ErrorDeEdicion("No se ha dicho qué tarea.");
  const { secciones } = trocearTodo(texto ?? "");
  for (const seccion of secciones) {
    if (seccion.esManual) continue; // el manual tiene `###` que no son tareas
    for (const tarea of seccion.tareas) {
      const casa = id ? tarea.id === id : claveDeTarea(tarea.titulo) === clave;
      if (casa) return { tarea, seccion, desde: tarea.linea, hasta: tarea.lineaFin };
    }
  }
  return null;
}

/** Igual, pero se planta si no está: es lo que quieren todas las órdenes menos crear. */
function exigir(texto, referencia) {
  const donde = localizar(texto, referencia);
  if (!donde) {
    throw new ErrorDeEdicion(
      "Esa tarea ya no está en el Registro: puede que la hayan cerrado o reescrito mientras tenías la pantalla abierta. Recarga."
    );
  }
  return donde;
}

/* ── Cortar y pegar líneas ────────────────────────────────────────────────── */

const enLineas = (texto) => String(texto ?? "").replace(/\r\n?/g, "\n").split("\n");

/**
 * Quita el rango [desde, hasta] y las líneas en blanco que quedan pegadas
 * detrás, para que no se acumulen huecos cada vez que se mueve una tarea.
 */
function quitarRango(lineas, desde, hasta) {
  const salida = lineas.slice();
  let fin = hasta;
  while (fin < salida.length && !salida[fin]?.trim()) fin++;
  salida.splice(desde - 1, fin - desde + 1);
  return salida;
}

/**
 * Dónde acaba una sección: la línea de la última tarea que tiene, o su propia
 * cabecera si está vacía. Se busca en el texto ACTUAL, no en el original.
 */
function finDeSeccion(texto, titulo) {
  const { secciones } = trocearTodo(texto);
  const suya = secciones.find((s) => !s.esManual && seccionDeHoy(s.titulo) === titulo);
  if (!suya) return null;
  const ultima = suya.tareas[suya.tareas.length - 1];
  return ultima ? ultima.lineaFin : suya.linea;
}

/**
 * Mete una sección que todavía no existe, en el sitio que le toca por el orden
 * de `SECCIONES_BACKLOG`.
 *
 * Hace falta el día que se estrena «Sin comprobar»: la primera tarea apuntada
 * desde el móvil llega a un documento donde esa sección no está escrita. Sin
 * esto, o se cuela al final sin orden o hay que republicar a mano antes de poder
 * usar la pantalla.
 */
function crearSeccion(texto, titulo) {
  const orden = SECCIONES_BACKLOG.indexOf(titulo);
  if (orden < 0) throw new ErrorDeEdicion(`«${titulo}» no es una sección del backlog.`);

  const { secciones } = trocearTodo(texto);
  const reales = secciones.filter((s) => !s.esManual);
  // La primera sección que va DESPUÉS de la nueva; delante de ella se mete.
  const siguiente = reales.find((s) => {
    const i = SECCIONES_BACKLOG.indexOf(seccionDeHoy(s.titulo));
    return i >= 0 && i > orden;
  });

  const lineas = enLineas(texto);
  const bloque = [`## ${titulo}`, ""];
  if (siguiente) {
    lineas.splice(siguiente.linea - 1, 0, ...bloque);
  } else {
    while (lineas.length && !lineas[lineas.length - 1].trim()) lineas.pop();
    lineas.push("", ...bloque);
  }
  return lineas.join("\n");
}

/** Pega un bloque al final de una sección, creándola si hace falta. */
function pegarEnSeccion(texto, seccion, bloque) {
  let t = texto;
  if (finDeSeccion(t, seccion) === null) t = crearSeccion(t, seccion);

  const fin = finDeSeccion(t, seccion);
  const lineas = enLineas(t);
  // Una línea en blanco de separación, y el bloque. Si detrás de `fin` ya había
  // huecos, se respetan: se inserta justo después de la última línea escrita.
  lineas.splice(fin, 0, "", ...bloque.replace(/\n+$/, "").split("\n"));
  return lineas.join("\n");
}

/* ── Las órdenes ──────────────────────────────────────────────────────────── */

/**
 * Apunta una tarea nueva. Devuelve `{ texto, id }`.
 *
 * Nace con ficha SIEMPRE. Es lo que permite colgarle una captura sin que se
 * quede huérfana el día que alguien le cambie el título.
 */
export function crearTarea(texto, { seccion, titulo, quien, cuerpo }, aleatorio = Math.random) {
  if (!SECCIONES_BACKLOG.includes(seccion)) {
    throw new ErrorDeEdicion(
      `«${seccion}» no es una sección del backlog: ${SECCIONES_BACKLOG.join(", ")}.`
    );
  }
  // Validar el título ANTES de buscar el duplicado: con el título vacío,
  // `claveDeTarea` devuelve "" y `localizar` se quejaría de que no se ha dicho
  // qué tarea — un mensaje que no tiene nada que ver con lo que pasa.
  limpiarTarea({ titulo, quien, cuerpo });

  const yaEsta = localizar(texto, { clave: claveDeTarea(titulo) });
  if (yaEsta) {
    throw new ErrorDeEdicion(
      `Ya hay una tarea con ese título, en «${yaEsta.seccion.titulo}». Si es la misma, muévela; si es otra, dilo de otra forma.`
    );
  }
  const id = nuevaFicha(texto, aleatorio);
  return { texto: pegarEnSeccion(texto, seccion, bloqueDeTarea({ titulo, quien, cuerpo, id })), id };
}

/**
 * Cambia una tarea de sección: eso es cambiarle la prioridad, porque la
 * prioridad ES la sección.
 *
 * Se corta el bloque tal cual y se pega al final de la otra, sin reescribirlo:
 * el cuerpo, el sello y la ficha viajan enteros.
 */
export function moverTarea(texto, { id = null, clave = null, aSeccion }) {
  if (!SECCIONES_BACKLOG.includes(aSeccion)) {
    throw new ErrorDeEdicion(
      `«${aSeccion}» no es una sección del backlog: ${SECCIONES_BACKLOG.join(", ")}.`
    );
  }
  const { seccion, desde, hasta } = exigir(texto, { id, clave });
  if (seccionDeHoy(seccion.titulo) === aSeccion) {
    throw new ErrorDeEdicion(`Esa tarea ya está en «${aSeccion}».`);
  }
  const lineas = enLineas(texto);
  const bloque = lineas.slice(desde - 1, hasta).join("\n");
  return pegarEnSeccion(quitarRango(lineas, desde, hasta).join("\n"), aSeccion, `${bloque}\n`);
}

/**
 * Reescribe una tarea en su sitio. Lo que no se manda, no cambia.
 *
 * Si no tenía ficha, la gana aquí: tocarla desde el tablero es la ocasión de
 * dársela sin reescribir el documento entero. Devuelve `{ texto, id }`.
 */
export function editarTarea(
  texto,
  { id = null, clave = null, titulo, quien, cuerpo },
  aleatorio = Math.random
) {
  const { tarea, desde, hasta } = exigir(texto, { id, clave });
  const nuevoTitulo = titulo === undefined ? tarea.titulo : titulo;
  const nuevoQuien = quien === undefined ? (tarea.quien ?? "") : quien;
  const nuevoCuerpo = cuerpo === undefined ? tarea.cuerpo : cuerpo;

  if (claveDeTarea(nuevoTitulo) !== claveDeTarea(tarea.titulo)) {
    const choque = localizar(texto, { clave: claveDeTarea(nuevoTitulo) });
    if (choque) throw new ErrorDeEdicion("Ya hay otra tarea con ese título.");
  }

  const ficha = tarea.id ?? nuevaFicha(texto, aleatorio);
  const bloque = bloqueDeTarea({
    titulo: nuevoTitulo,
    quien: nuevoQuien,
    cuerpo: nuevoCuerpo,
    id: ficha,
  });
  const lineas = enLineas(texto);
  lineas.splice(desde - 1, hasta - desde + 1, ...bloque.replace(/\n+$/, "").split("\n"));
  return { texto: lineas.join("\n"), id: ficha };
}

/**
 * Borra una tarea del documento.
 *
 * ⚠️ Esto NO es cerrarla: cerrar es `cerrarTarea`, que la deja escrita en
 * Resuelto. Borrar es para lo que nunca debió apuntarse —un duplicado, algo mal
 * entendido— y por eso la pantalla lo pregunta aparte y con otras palabras.
 *
 * Lo publicado no se pierde: la tabla es append-only y guarda 50 versiones, así
 * que una tarea borrada por error se rescata de la versión anterior.
 */
export function borrarTarea(texto, { id = null, clave = null }) {
  const { desde, hasta, tarea } = exigir(texto, { id, clave });
  return { texto: quitarRango(enLineas(texto), desde, hasta).join("\n"), tarea };
}

/* ── Cerrar: del backlog a resuelto ───────────────────────────────────────── */

/** `24/08/2026`, como se escriben las secciones de resuelto. */
export function fechaDeSeccion(fecha) {
  const dd = String(fecha.getDate()).padStart(2, "0");
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${fecha.getFullYear()}`;
}

/**
 * Cierra una tarea: sale del backlog y entra en Resuelto, bajo la sección de su
 * fecha (la de hoy arriba del todo, que es como está escrito ese documento).
 *
 * Devuelve `{ backlog, resuelto, tarea }` — los DOS textos, porque cerrar toca
 * los dos documentos.
 *
 * ⚠️ EL ORDEN AL PUBLICARLOS NO ES INDIFERENTE, y lo decide quien llame: primero
 * `resuelto`, después `backlog`. Son dos publicaciones y la segunda puede fallar
 * (alguien publicó en medio, se cayó la red). Si falla habiendo escrito primero
 * Resuelto, la tarea queda en los dos sitios: se ve, molesta y se arregla. Al
 * revés, queda en ninguno.
 */
export function cerrarTarea(backlog, resuelto, { id = null, clave = null, comoSeArreglo, fecha }) {
  const { tarea } = exigir(backlog, { id, clave });
  const nota = String(comoSeArreglo ?? "").trim();
  if (!nota) {
    throw new ErrorDeEdicion(
      "Para cerrar una tarea hay que decir qué la arregló: es lo único que hace que Resuelto sirva de algo dentro de seis meses."
    );
  }

  const { texto: sinElla } = borrarTarea(backlog, { id, clave });

  // El cuerpo que se guarda es el que tenía MÁS cómo se arregló. No se sustituye
  // el original: lo que se apuntó en su día (qué pasaba, cuánto dolía y cómo se
  // comprobó) es justo lo que hace falta para entender el arreglo.
  const cuerpo = `${tarea.cuerpo}\n\n**Cómo se arregló.** ${nota}`;
  const seccion = fechaDeSeccion(fecha);
  const bloque = bloqueDeTarea({
    titulo: tarea.titulo,
    quien: tarea.quien ?? "",
    cuerpo,
    id: tarea.id ?? null,
  });

  return { backlog: sinElla, resuelto: pegarEnResuelto(resuelto, seccion, bloque), tarea };
}

/**
 * Mete un bloque en Resuelto bajo su fecha. Si la sección del día no existe, se
 * crea ARRIBA DEL TODO: ese documento va de lo más reciente a lo más viejo, y
 * `comprobar` lo trata como error si se desordena.
 */
function pegarEnResuelto(texto, seccion, bloque) {
  const { secciones } = trocearTodo(texto);
  const reales = secciones.filter((s) => !s.esManual);
  const suya = reales.find((s) => s.titulo === seccion);
  const lineas = enLineas(texto);
  const trozo = bloque.replace(/\n+$/, "").split("\n");

  if (suya) {
    // Dentro del día, lo último cerrado va al final de su sección.
    const ultima = suya.tareas[suya.tareas.length - 1];
    const fin = ultima ? ultima.lineaFin : suya.linea;
    lineas.splice(fin, 0, "", ...trozo);
    return lineas.join("\n");
  }

  const primera = reales[0];
  const bloqueNuevo = [`## ${seccion}`, "", ...trozo, ""];
  if (primera) {
    lineas.splice(primera.linea - 1, 0, ...bloqueNuevo);
  } else {
    lineas.push("", ...bloqueNuevo);
  }
  return lineas.join("\n");
}

/**
 * Las secciones que la pantalla ofrece para mover, en orden: las tres
 * prioridades y las dos salas de espera. Se exporta desde aquí para que la
 * pantalla no tenga que saber cuál de las dos listas del parser mirar.
 */
export const SECCIONES_QUE_SE_ELIGEN = [...PRIORIDADES, ...SECCIONES_BACKLOG.slice(PRIORIDADES.length)];

/**
 * lib/tablero/estado.js — el tick y el reparto, puestos encima de los ficheros.
 *
 * (Motivo del fichero nuevo en /lib, regla #2: es la ÚNICA parte del Registro
 * que decide algo —en qué pestaña cae cada tarea— y vivía dentro del endpoint,
 * donde no se puede probar sin levantar Next ni tener sesión de back-office.
 * Aquí es lógica pura y la fija `scripts/_smoke-tablero-estado.mjs`.)
 *
 * EL REPARTO, EN UNA FRASE: el texto de cada tarea es la última versión
 * publicada de `master.tablero_documentos` (hasta el 19/08/2026, dos `.md`
 * dentro de la imagen de Docker); lo que se cambia en caliente desde la
 * pantalla —de quién es y si ya está— vive en `master.tablero_estado` y se
 * pinta ENCIMA, casado por título normalizado. Aquí «fichero» quiere decir «el
 * texto publicado»: el nombre se quedó de cuando lo era.
 */

/** A quién se le puede asignar una tarea. Lista cerrada, y a propósito: somos dos. */
export const RESPONSABLES = ["rodrigo", "jorge"];

/** Los dos bloques que se inventan para lo que cambia de lado con el tick. */
export const SECCION_MARCADAS = "Marcadas desde el Registro";
export const SECCION_REABIERTAS = "Reabiertas desde el Registro";

/**
 * Clave estable de una tarea a partir de su título.
 *
 * Sin acentos, en minúsculas y con guiones: «¿Se apaga la puerta global del
 * formulario?» → «se-apaga-la-puerta-global-del-formulario». Es el título SIN la
 * cola del cliente, que es lo que devuelve el troceador, para que cambiar
 * `nutri_laura` por `nutri_laura, healim` no pierda el estado.
 *
 * ⚠️ Reescribir el título en el fichero deja la fila huérfana y la tarea vuelve
 * a salir donde diga el fichero. Es el precio de no meter identificadores dentro
 * del markdown, que lo volvería ilegible y habría que inventarlos a mano al
 * escribir cada tarea. Una fila huérfana no molesta: no casa con nada.
 */
export function claveDeTarea(titulo) {
  return (titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/**
 * La tarea con su clave y su estado pegados, tal como los lee la pantalla.
 *
 * `fuente` es en qué FICHERO está escrita, que no es lo mismo que en qué pestaña
 * se ve. Lo necesita la pantalla para saber si al cambiar el tick hay que
 * guardar un override o basta con borrarlo: una tarea de `resuelto.md` que se
 * reabre y se vuelve a marcar no necesita fila ninguna, porque el fichero ya
 * dice que está hecha. Así lo guardado es solo lo que se DESVÍA del repo, y el
 * día que alguien la cierre de verdad en su commit, el apaño desaparece solo.
 */
export function conEstado(tarea, estados, fuente) {
  const clave = claveDeTarea(tarea.titulo);
  const fila = estados?.get?.(clave) ?? null;
  return {
    ...tarea,
    clave,
    fuente,
    asignadoA: fila?.asignadoA ?? null,
    // `resuelta` es el override: null = manda el fichero.
    marcada: fila?.resuelta ?? null,
    tocadaPor: fila?.tocadaPor ?? null,
    // Cómo se arregla, escrito a mano. No sale del fichero: es una nota entre
    // nosotros dos que acompaña a la tarea hasta que alguien la programe.
    solucion: fila?.solucion ?? null,
  };
}

/**
 * Mueve de lado lo que alguien haya marcado o reabierto desde la pantalla.
 *
 * Las que cambian de lado no pueden quedarse con su sección de origen —una tarea
 * de «P1 — esta semana» no pinta nada en la pestaña de lo resuelto, y las
 * secciones de `resuelto.md` son fechas— así que caen en un bloque propio que
 * dice de dónde vienen. Que se vea que están marcadas a mano y no cerradas en un
 * commit es parte de lo que se quería: el tick no cierra nada, solo pone de
 * acuerdo a los dos que miran esta pantalla.
 *
 * Un `null` de entrada (fichero que no se pudo leer) sale como `null`, para que
 * la pantalla siga pudiendo decir «no se ha podido leer» en vez de enseñar una
 * lista vacía, que se leería como «no hay nada que hacer».
 */
export function repartirPorEstado(pendiente, resuelto, estados) {
  const marcadas = [];
  const reabiertas = [];

  const limpiar = (secciones, fuente, mover, sePasa) =>
    (secciones ?? [])
      .map((s) => {
        const quedan = [];
        // `seccion` es en qué bloque está ESCRITA la tarea, y desde el 24/08/2026
        // eso es su prioridad. La pantalla la necesita para poder enseñar cuál
        // tiene puesta y para no ofrecer moverla a donde ya está; `deSeccion`
        // no vale, que solo lo llevan las que cambian de lado con el tick.
        for (const t of (s.tareas ?? []).map((x) => ({
          ...conEstado(x, estados, fuente),
          seccion: s.titulo,
        }))) {
          if (sePasa(t)) mover.push({ ...t, deSeccion: s.titulo });
          else quedan.push(t);
        }
        return { ...s, tareas: quedan };
      })
      .filter((s) => s.tareas.length > 0);

  const p = limpiar(pendiente, "backlog", marcadas, (t) => t.marcada === true);
  const r = limpiar(resuelto, "resuelto", reabiertas, (t) => t.marcada === false);

  if (marcadas.length) r.unshift({ titulo: SECCION_MARCADAS, tareas: marcadas });
  if (reabiertas.length) p.unshift({ titulo: SECCION_REABIERTAS, tareas: reabiertas });

  return {
    pendiente: pendiente === null ? null : p,
    resuelto: resuelto === null ? null : r,
  };
}

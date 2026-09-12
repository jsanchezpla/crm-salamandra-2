/**
 * Cuentas del tablero de la pestaña Proyectos del calendario global
 * (12/09/2026): a dónde va una tarjeta al soltarla y cómo queda la pantalla
 * mientras se guarda.
 *
 * Fichero puro, sin React ni `window`, para que se pueda probar suelto.
 *
 * ── LA POSICIÓN ES UN ÍNDICE, NO EL `order` DE LA BASE ──────────────────────
 * El Kanban del CRM manda como destino el `order` guardado de la tarjeta sobre
 * la que se suelta. Ese número puede tener huecos y repetidos (cambiar de
 * columna desde la ficha de la tarea no reordena), y el servidor valida contra
 * el NÚMERO de tarjetas de la columna: con huecos contesta «targetOrder fuera
 * de rango» y la tarjeta vuelve atrás sin que se entienda por qué. Aquí se
 * manda la posición en la lista tal como se ve (0 = arriba), que siempre cae
 * dentro del rango que acepta `lib/projects/moverTarjeta.js`:
 *   - en la misma columna, 0..n-1;
 *   - en otra columna, 0..n (n = al final).
 */

/**
 * Qué movimiento es un arrastre.
 *
 * `over` es lo que había debajo al soltar, ya traducido de dnd-kit:
 *   { tipo: "column", columnId }  — el hueco de una columna (vacía o al final)
 *   { tipo: "task", id }          — otra tarjeta
 * `debajo`: si se soltó por debajo de la mitad de esa tarjeta. Solo cuenta al
 * cambiar de columna; en la misma, la lista ya se ha recolocado mientras se
 * arrastraba y la posición es la de la tarjeta de debajo.
 *
 * Devuelve `{ origenId, indiceOrigen, destinoId, indice }`, o `null` si no hay
 * nada que mover (soltada donde estaba, o sobre algo que no es del tablero).
 */
export function destinoDelArrastre(columnas, { activeId, over, debajo = false }) {
  if (!Array.isArray(columnas) || !over) return null;
  const origen = columnas.find((c) => c.tasks.some((t) => t.id === activeId));
  if (!origen) return null;
  const indiceOrigen = origen.tasks.findIndex((t) => t.id === activeId);

  let destino;
  let indice;
  if (over.tipo === "column") {
    destino = columnas.find((c) => c.id === over.columnId);
    if (!destino) return null;
    indice = destino.id === origen.id ? destino.tasks.length - 1 : destino.tasks.length;
  } else if (over.tipo === "task") {
    if (over.id === activeId) return null;
    destino = columnas.find((c) => c.tasks.some((t) => t.id === over.id));
    if (!destino) return null;
    const indiceDeLaOtra = destino.tasks.findIndex((t) => t.id === over.id);
    indice = destino.id === origen.id ? indiceDeLaOtra : indiceDeLaOtra + (debajo ? 1 : 0);
  } else {
    return null;
  }

  if (destino.id === origen.id && indice === indiceOrigen) return null;
  return { origenId: origen.id, indiceOrigen, destinoId: destino.id, indice };
}

/** Pone `order` = posición en las tarjetas que no lo tengan ya. */
function renumerar(tasks) {
  return tasks.map((t, i) => (t.order === i ? t : { ...t, order: i }));
}

/**
 * Copia de las columnas con la tarjeta `taskId` sacada de la suya y puesta en
 * `destinoId`, en la posición `indice`. No toca el original (es estado de
 * React). Si la tarjeta o la columna no existen, devuelve las mismas columnas.
 *
 * Deshacer es la misma operación al revés: mover a `origenId`, `indiceOrigen`.
 * Así, si mientras se guardaba ha cambiado otra cosa de la tarjeta (su fecha),
 * al deshacer el movimiento no se pierde.
 */
export function moverEnColumnas(columnas, taskId, destinoId, indice) {
  if (!Array.isArray(columnas)) return columnas;
  let tarjeta = null;
  let origenId = null;
  for (const c of columnas) {
    const t = c.tasks.find((x) => x.id === taskId);
    if (t) {
      tarjeta = t;
      origenId = c.id;
      break;
    }
  }
  if (!tarjeta || !columnas.some((c) => c.id === destinoId)) return columnas;

  return columnas.map((c) => {
    if (c.id !== origenId && c.id !== destinoId) return c;
    const tasks = c.tasks.filter((t) => t.id !== taskId);
    if (c.id === destinoId) {
      const pos = Math.max(0, Math.min(Number(indice) || 0, tasks.length));
      tasks.splice(pos, 0, { ...tarjeta, boardColumnId: destinoId });
    }
    return { ...c, tasks: renumerar(tasks) };
  });
}

/** Cambia un campo de una tarjeta, esté en la columna que esté. */
export function cambiarTarjeta(columnas, taskId, cambios) {
  if (!Array.isArray(columnas)) return columnas;
  return columnas.map((c) =>
    c.tasks.some((t) => t.id === taskId)
      ? { ...c, tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, ...cambios } : t)) }
      : c
  );
}

/** Hitos por fecha (y nombre), como los devuelve el servidor. */
export function ordenarHitos(hitos) {
  return [...(Array.isArray(hitos) ? hitos : [])].sort((a, b) => {
    const fa = String(a?.dueDate ?? "");
    const fb = String(b?.dueDate ?? "");
    if (fa !== fb) return fa < fb ? -1 : 1;
    return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "es");
  });
}

/**
 * La respuesta de `GET /api/calendario-global/proyectos/<slug>/<id>` con todo
 * lo que la pantalla recorre convertido en lista, por si falta algo.
 */
export function normalizarTablero(datos) {
  const d = datos && typeof datos === "object" ? datos : {};
  return {
    cliente: d.cliente ?? null,
    proyecto: d.proyecto ?? null,
    columnas: (Array.isArray(d.columnas) ? d.columnas : []).map((c) => ({
      ...c,
      tasks: Array.isArray(c?.tasks) ? c.tasks : [],
    })),
    sinColumna: Number(d.sinColumna) || 0,
    fases: Array.isArray(d.fases) ? d.fases : [],
    hitos: ordenarHitos(d.hitos),
  };
}

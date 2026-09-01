/**
 * lib/projects/faseProgreso.js — cómo va cada fase de un proyecto.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten la vista de Fases y la lista
 * de tareas, y «cuánto lleva hecho una fase» tiene que dar el mismo número en
 * las dos. Además es lo único de esta pantalla que se puede probar sin montar
 * React: aquí solo entran datos y salen datos.)
 *
 * ── QUÉ CUENTA COMO HECHO (01/09/2026, Rodrigo) ────────────────────────────
 * Una fase se compone de dos cosas y las dos cuentan:
 *
 *   · TAREAS — las tarjetas del Kanban con `phaseId` de esa fase. Una tarea
 *     está hecha cuando su columna es la de «Hecho» (`isDoneColumn`), que es
 *     el mismo criterio que usan el tablero, la lista y el calendario. NO se
 *     mira el nombre de la columna: cada centro llama a la suya como quiere.
 *   · ENTREGABLES — los hitos (`milestones`) de esa fase. Un entregable está
 *     hecho cuando su estado es `completed`.
 *
 * El PORCENTAJE sale de las dos juntas, ponderadas por unidad: si una fase
 * tiene 8 tareas y 2 entregables, son 10 cosas y cada una vale un 10%.
 * Ponderar los entregables más que las tareas se pensó y se descartó: nadie
 * sabría de dónde sale el número, y un porcentaje que no se puede recalcular a
 * mano deja de ser un dato para convertirse en una opinión.
 *
 * Una fase SIN tareas ni entregables no está al 0% ni al 100%: está a `null`.
 * Un 0% dice «esto está sin empezar» y un 100% dice «esto está hecho»; una
 * fase vacía no dice ninguna de las dos, y pintarla al 0% la mete en la lista
 * de lo urgente sin que nadie haya prometido nada.
 */

/** Fecha civil de Madrid (YYYY-MM-DD). Igual que en lib/home/summary.js. */
export function hoyMadrid(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

const ESTADOS = {
  completada: { clave: "completada", etiqueta: "Completada", tono: "verde" },
  retrasada: { clave: "retrasada", etiqueta: "Con retraso", tono: "rojo" },
  enCurso: { clave: "enCurso", etiqueta: "En curso", tono: "azul" },
  sinEmpezar: { clave: "sinEmpezar", etiqueta: "Sin empezar", tono: "gris" },
  vacia: { clave: "vacia", etiqueta: "Sin contenido", tono: "gris" },
};

export const ESTADOS_FASE = ESTADOS;

/** ¿Esta tarea está en la columna de «Hecho»? */
function tareaHecha(t) {
  return !!t?.boardColumn?.isDoneColumn;
}

/** ¿Esta fecha ya pasó? Compara cadenas YYYY-MM-DD, que ordenan solas. */
function vencida(fecha, hoy) {
  return typeof fecha === "string" && fecha.length >= 10 && fecha.slice(0, 10) < hoy;
}

/**
 * El resumen de UNA fase.
 *
 * @param {object} fase        Fila de `phases` ({ id, name, color, startDate, endDate, completedAt, order }).
 * @param {object} opciones
 * @param {Array}  opciones.tareas       TODAS las tareas del proyecto (se filtran aquí).
 * @param {Array}  opciones.entregables  TODOS los hitos del proyecto (se filtran aquí).
 * @param {string} opciones.hoy          Fecha civil YYYY-MM-DD.
 */
export function resumenDeFase(fase, { tareas = [], entregables = [], hoy = hoyMadrid() } = {}) {
  const mias = tareas.filter((t) => t.phaseId === fase.id);
  const susEntregables = entregables.filter((m) => m.phaseId === fase.id);

  const tareasHechas = mias.filter(tareaHecha).length;
  const entregablesHechos = susEntregables.filter((m) => m.status === "completed").length;

  const unidades = mias.length + susEntregables.length;
  const hechas = tareasHechas + entregablesHechos;
  const porcentaje = unidades === 0 ? null : Math.round((hechas / unidades) * 100);

  // Lo que se está pasando de fecha y sigue sin hacerse. Un entregable en
  // estado `missed` cuenta como vencido aunque no tuviera fecha: alguien ya
  // dijo que no llegó.
  const tareasVencidas = mias.filter((t) => !tareaHecha(t) && vencida(t.dueDate, hoy)).length;
  const entregablesVencidos = susEntregables.filter(
    (m) => m.status !== "completed" && (m.status === "missed" || vencida(m.dueDate, hoy))
  ).length;

  const horasEstimadas = mias.reduce((suma, t) => suma + (Number(t.estimatedHours) || 0), 0);

  // Quién anda metido en la fase, sin repetir.
  const personas = new Map();
  for (const t of mias) {
    for (const a of t.assignees ?? []) {
      const id = a.teamMemberId ?? a.id;
      if (id && !personas.has(id)) personas.set(id, { id, displayName: a.displayName ?? null, avatarColor: a.avatarColor ?? null });
    }
  }

  const completada = porcentaje === 100 || !!fase.completedAt;
  const seRetrasa = !completada && (tareasVencidas + entregablesVencidos > 0 || vencida(fase.endDate, hoy));

  let estado = ESTADOS.sinEmpezar;
  if (unidades === 0) estado = ESTADOS.vacia;
  else if (completada) estado = ESTADOS.completada;
  else if (seRetrasa) estado = ESTADOS.retrasada;
  else if (hechas > 0) estado = ESTADOS.enCurso;

  return {
    fase,
    id: fase.id,
    nombre: fase.name,
    color: fase.color ?? null,
    orden: fase.order ?? 0,
    startDate: fase.startDate ?? null,
    endDate: fase.endDate ?? null,
    tareas: mias,
    entregables: susEntregables,
    totales: {
      tareas: mias.length,
      tareasHechas,
      entregables: susEntregables.length,
      entregablesHechos,
      unidades,
      hechas,
      tareasVencidas,
      entregablesVencidos,
      vencidas: tareasVencidas + entregablesVencidos,
      horasEstimadas: Math.round(horasEstimadas * 100) / 100,
    },
    personas: [...personas.values()],
    porcentaje,
    completada,
    estado,
  };
}

/**
 * Lo que NO cuelga de ninguna fase. Se devuelve aparte y con `id: null`: es
 * trabajo real que existe y que no se puede esconder solo porque nadie lo haya
 * colocado — de hecho es justo lo que hay que colocar.
 */
export function resumenSinFase({ tareas = [], entregables = [], hoy = hoyMadrid() } = {}) {
  const huerfanas = { id: null, name: "Sin fase", color: null, order: Number.MAX_SAFE_INTEGER, completedAt: null, startDate: null, endDate: null };
  const resumen = resumenDeFase(huerfanas, {
    tareas: tareas.filter((t) => !t.phaseId),
    entregables: entregables.filter((m) => !m.phaseId),
    hoy,
  });
  // `resumenDeFase` filtra por `phaseId === fase.id`, y aquí el id es null:
  // las listas ya vienen filtradas, así que se reponen tal cual.
  resumen.tareas = tareas.filter((t) => !t.phaseId);
  resumen.entregables = entregables.filter((m) => !m.phaseId);
  return resumen;
}

/** Los criterios de orden que ofrece la vista de Fases. */
export const ORDENES_FASE = [
  { clave: "plan", etiqueta: "Orden del plan" },
  { clave: "avance", etiqueta: "Menos avanzada primero" },
  { clave: "avanceDesc", etiqueta: "Más avanzada primero" },
  { clave: "fecha", etiqueta: "Por fecha de fin" },
  { clave: "retraso", etiqueta: "Más retraso primero" },
];

/**
 * Ordena los resúmenes. Una fase SIN porcentaje (vacía) va siempre al final de
 * los órdenes por avance: no tiene avance que comparar, y colarla en el 0%
 * la pondría la primera de la lista de urgentes sin motivo.
 */
export function ordenarFases(resumenes, clave = "plan") {
  const lista = [...resumenes];
  const sinDato = (r) => r.porcentaje === null;

  const porPlan = (a, b) => (a.orden ?? 0) - (b.orden ?? 0);

  const comparadores = {
    plan: porPlan,
    avance: (a, b) => {
      if (sinDato(a) || sinDato(b)) return sinDato(a) && sinDato(b) ? porPlan(a, b) : sinDato(a) ? 1 : -1;
      return a.porcentaje - b.porcentaje || porPlan(a, b);
    },
    avanceDesc: (a, b) => {
      if (sinDato(a) || sinDato(b)) return sinDato(a) && sinDato(b) ? porPlan(a, b) : sinDato(a) ? 1 : -1;
      return b.porcentaje - a.porcentaje || porPlan(a, b);
    },
    fecha: (a, b) => {
      const fa = a.endDate ?? null;
      const fb = b.endDate ?? null;
      if (!fa || !fb) return !fa && !fb ? porPlan(a, b) : !fa ? 1 : -1; // sin fecha, al final
      return fa < fb ? -1 : fa > fb ? 1 : porPlan(a, b);
    },
    retraso: (a, b) => b.totales.vencidas - a.totales.vencidas || porPlan(a, b),
  };

  return lista.sort(comparadores[clave] ?? porPlan);
}

/** El avance del proyecto entero, con el mismo criterio que el de cada fase. */
export function avanceGlobal(resumenes) {
  const unidades = resumenes.reduce((s, r) => s + r.totales.unidades, 0);
  const hechas = resumenes.reduce((s, r) => s + r.totales.hechas, 0);
  return {
    unidades,
    hechas,
    porcentaje: unidades === 0 ? null : Math.round((hechas / unidades) * 100),
    vencidas: resumenes.reduce((s, r) => s + r.totales.vencidas, 0),
    fasesCompletadas: resumenes.filter((r) => r.completada).length,
  };
}

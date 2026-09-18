/**
 * recurrencia — las fechas de una cita que se repite (31/08/2026).
 *
 * Sin concepto de «serie» a propósito (la tarea lo fija): al crear la cita se
 * materializan N citas INDEPENDIENTES — cada una se edita o se cancela sola,
 * como hacen hoy a mano. Esta regla solo calcula QUÉ fechas; crearlas (y
 * chocar con festivos, bloqueos y solapes) es cosa del POST de siempre.
 *
 * Aritmética de PARED, no de instantes: la cita semanal de las 16:00 sigue
 * siendo a las 16:00 aunque en medio caiga el cambio de hora — por eso se
 * suma con Date local (setDate/constructor por partes), nunca con +7×24h
 * sobre el instante UTC. Corre en el navegador, con la misma hora local con
 * la que se pinta el calendario.
 *
 * Mensual = mismo día del mes; un mes que no tiene ese día (el 31 en
 * febrero) SE SALTA y se cuenta en `sinDia` — mejor sin sesión ese mes que
 * una sesión que baila de día sin que nadie la haya pedido.
 */
export const CADENCIAS = [
  { value: "semana", label: "Cada semana" },
  { value: "quincena", label: "Cada dos semanas" },
  { value: "mes", label: "Cada mes (mismo día)" },
];

// Freno de mano: nadie repite una cita 60 veces a propósito; un «hasta» con
// el año equivocado, sí.
export const TOPE_REPETICIONES = 60;

/**
 * ── HASTA DÓNDE LLEGA UNA SERIE, POR DEFECTO (18/09/2026, AV-0209) ─────────
 *
 * Olga: «algunos horarios no se han pasado bien… ¿puedes programar algo para
 * que se rellenen los huecos que faltan? A partir de enero hay bastantes
 * huecos sin rellenar». Medido en producción, la agenda de enero a junio NO
 * está vacía (esa terapeuta tiene entre 72 y 84 citas al mes), pero SÍ hay
 * tandas creadas a mano en septiembre que se paran en noviembre y en
 * diciembre: la casilla «Hasta el día» nace en blanco y quien programa escribe
 * una fecha corta sin querer.
 *
 * El centro trabaja por CURSO —septiembre a junio, igual que sus cuotas—, así
 * que eso es lo que se propone. Sigue siendo una propuesta: se cambia antes de
 * guardar, y la cuenta de cuántas citas salen está a la vista.
 *
 * @param {string} fecha "YYYY-MM-DD" de la primera cita
 * @returns {string} "AAAA-06-30" del curso al que pertenece esa fecha
 */
export function finDelCurso(fecha) {
  const f = String(fecha ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return "";
  const [anio, mes] = f.split("-").map(Number);
  // De septiembre en adelante el curso acaba en junio del año siguiente. Julio
  // y agosto (el centro cierra) van con el curso que EMPIEZA, para no proponer
  // nunca un «hasta» anterior a la propia cita.
  return `${mes >= 7 ? anio + 1 : anio}-06-30`;
}

/**
 * @param inicio "YYYY-MM-DDTHH:mm" (hora de pared local) o Date — la PRIMERA
 *               cita, que ya se crea aparte y no entra en el resultado
 * @param cada   "semana" | "quincena" | "mes"
 * @param hasta  "YYYY-MM-DD", inclusive
 * @returns { fechas: Date[], sinDia: number }
 */
export function fechasDeRepeticion(inicio, cada, hasta) {
  const base = inicio instanceof Date ? new Date(inicio.getTime()) : new Date(String(inicio ?? ""));
  if (Number.isNaN(base.getTime())) return { fechas: [], sinDia: 0 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(hasta ?? ""))) return { fechas: [], sinDia: 0 };
  const [ha, hm, hd] = String(hasta).split("-").map(Number);
  const tope = new Date(ha, hm - 1, hd, 23, 59, 59, 999);
  if (Number.isNaN(tope.getTime())) return { fechas: [], sinDia: 0 };

  const fechas = [];
  let sinDia = 0;

  if (cada === "semana" || cada === "quincena") {
    const paso = cada === "semana" ? 7 : 14;
    const d = new Date(base.getTime());
    while (fechas.length < TOPE_REPETICIONES) {
      d.setDate(d.getDate() + paso);
      if (d > tope) break;
      fechas.push(new Date(d.getTime()));
    }
  } else if (cada === "mes") {
    const dia = base.getDate();
    for (let m = 1; fechas.length < TOPE_REPETICIONES; m++) {
      const primero = new Date(base.getFullYear(), base.getMonth() + m, 1);
      if (primero > tope) break;
      const d = new Date(base.getFullYear(), base.getMonth() + m, dia, base.getHours(), base.getMinutes(), 0, 0);
      if (d.getDate() !== dia) { sinDia += 1; continue; }
      if (d > tope) break;
      fechas.push(d);
    }
  }

  return { fechas, sinDia };
}

/** Una fecha a "YYYY-MM-DD" con el día de PARED, no el del instante UTC. */
export function comoDia(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Días de calendario entre dos "YYYY-MM-DD". Se cuentan a MEDIODÍA para que el
 * cambio de hora no convierta un día en 23 horas y reste uno de menos.
 */
export function diasEntre(desde, hasta) {
  const a = String(desde ?? "").split("-").map(Number);
  const b = String(hasta ?? "").split("-").map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return 0;
  const ma = new Date(a[0], a[1] - 1, a[2], 12, 0, 0, 0);
  const mb = new Date(b[0], b[1] - 1, b[2], 12, 0, 0, 0);
  if (Number.isNaN(ma.getTime()) || Number.isNaN(mb.getTime())) return 0;
  return Math.round((mb - ma) / 86400000);
}

/**
 * Las repeticiones de un BLOQUEO (09/09/2026, AV-0090 de Aumenta: «al intentar
 * programar para el resto de semanas, no me sale opción para poder hacerlo»).
 *
 * Hasta hoy el formulario del bloqueo solo tenía «Termina», que es el FIN DEL
 * TRAMO, y quien quería repetir metía ahí una fecha lejana: el 08/09/2026 dos
 * personas cerraron su agenda entera hasta el 30/06/2027 así (de ahí el aviso
 * de bloqueo largo del servidor). Durar y repetirse son dos cosas distintas.
 *
 * Aquí y no en la pantalla porque es aritmética de fechas con un caso que se
 * escapa a ojo —el tramo que cruza la medianoche— y porque el modal de editar
 * un bloqueo va a querer lo mismo.
 *
 * Devuelve los tramos SIN la primera, igual que `fechasDeRepeticion`: esa ya se
 * crea aparte. El fin se desplaza los MISMOS días que el inicio, así que un
 * bloqueo de dos días sigue durando dos días en cada repetición.
 *
 * @returns {{ tramos: {startDate: string, endDate: string}[], sinDia: number }}
 */
export function repeticionDeBloqueo({ date, time, endDate, repetir, repetirHasta }) {
  const { fechas, sinDia } = fechasDeRepeticion(`${date}T${time}`, repetir, repetirHasta);
  const dura = diasEntre(date, endDate || date);
  const tramos = fechas.map((f) => {
    const fin = new Date(f.getTime());
    fin.setDate(fin.getDate() + dura);
    return { startDate: comoDia(f), endDate: comoDia(fin) };
  });
  return { tramos, sinDia };
}

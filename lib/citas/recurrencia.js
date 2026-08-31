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

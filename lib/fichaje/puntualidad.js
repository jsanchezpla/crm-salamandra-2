/**
 * lib/fichaje/puntualidad.js — ¿llegó tarde o se fue pronto? (31/08/2026)
 *
 * La vara no es el horario teórico (que nadie mantiene) sino la AGENDA: si tu
 * primera cita o bloqueo del día era a las 09:00 y el reloj dice que entraste
 * a las 09:25, llegaste tarde — eso es lo que Rodrigo quiere ver sin comparar
 * dos pantallas. El gemelo con la última cita y la salida.
 *
 * PURA como el resto de lib/fichaje: recibe los tramos del mes y la agenda ya
 * aplanada (el endpoint convierte los instantes UTC de la base a hora de
 * Madrid antes de llamar — aquí solo se comparan minutos de pared). Con
 * tolerancia: nadie quiere un aviso por 3 minutos.
 */

export const TOLERANCIA_MIN = 10;

/** "08:30" | "08:30:00" → minutos desde medianoche, o null. */
function minutosDe(hora) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? ""));
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : null;
}

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * @param {Array} fichajes filas del periodo ({teamMemberId, fecha, entradaAt,
 *   salidaAt, tipo, deletedAt}) — se miran solo los tramos de trabajo/extra
 *   vivos y CON hora de reloj (un día que solo trae el total no puede decir
 *   nada de puntualidad)
 * @param {Array} agenda citas y bloqueos del mes, aplanados y EN HORA DE
 *   MADRID: { teamMemberId, fecha: 'YYYY-MM-DD', inicio: 'HH:mm', fin: 'HH:mm' }
 * @param {object} opts { toleranciaMin, nombres: Map(id → nombre) }
 * @returns avisos con la misma forma que los de avisosDelMes (gravedad 'revisar')
 */
export function avisosDePuntualidad(fichajes, agenda, { toleranciaMin = TOLERANCIA_MIN, nombres = new Map() } = {}) {
  // persona|fecha → primera entrada y última salida del reloj
  const reloj = new Map();
  for (const f of Array.isArray(fichajes) ? fichajes : []) {
    if (!f || f.deletedAt) continue;
    if (f.tipo !== "trabajo" && f.tipo !== "extra") continue;
    const clave = `${f.teamMemberId}|${String(f.fecha)}`;
    const r = reloj.get(clave) ?? { entrada: null, salida: null };
    const e = minutosDe(f.entradaAt);
    const s = minutosDe(f.salidaAt);
    if (e != null && (r.entrada == null || e < r.entrada)) r.entrada = e;
    if (s != null && (r.salida == null || s > r.salida)) r.salida = s;
    reloj.set(clave, r);
  }

  // persona|fecha → primera y última hora con agenda
  const dia = new Map();
  for (const a of Array.isArray(agenda) ? agenda : []) {
    if (!a?.teamMemberId) continue;
    const clave = `${a.teamMemberId}|${String(a.fecha)}`;
    const d = dia.get(clave) ?? { primera: null, ultima: null };
    const i = minutosDe(a.inicio);
    const f = minutosDe(a.fin);
    if (i != null && (d.primera == null || i < d.primera)) d.primera = i;
    if (f != null && (d.ultima == null || f > d.ultima)) d.ultima = f;
    dia.set(clave, d);
  }

  const avisos = [];
  for (const [clave, r] of reloj) {
    const d = dia.get(clave);
    if (!d) continue; // día sin agenda: nada con qué comparar
    const [teamMemberId, fecha] = clave.split("|");
    const base = {
      teamMemberId,
      nombre: nombres.get(teamMemberId) || "(fuera del equipo)",
      fecha,
      fichajeId: null,
    };
    if (r.entrada != null && d.primera != null && r.entrada > d.primera + toleranciaMin) {
      avisos.push({
        ...base,
        gravedad: "revisar",
        tipo: "llego_tarde",
        texto: `Llegó a las ${hhmm(r.entrada)} con la primera cita a las ${hhmm(d.primera)}`,
      });
    }
    if (r.salida != null && d.ultima != null && r.salida < d.ultima - toleranciaMin) {
      avisos.push({
        ...base,
        gravedad: "revisar",
        tipo: "salio_pronto",
        texto: `Salió a las ${hhmm(r.salida)} con la última cita hasta las ${hhmm(d.ultima)}`,
      });
    }
  }
  return avisos;
}

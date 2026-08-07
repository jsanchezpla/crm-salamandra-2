/**
 * _smoke-horario-profesional.mjs — el cruce entre el horario del centro y el
 * de la profesional asignada (06/08/2026). Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-horario-profesional.mjs
 *
 * Lo que vigila, que son los dos errores que aquí duelen:
 *   · recortar de MÁS y dejar a una paciente sin poder pedir cita;
 *   · no recortar nada y seguir ofreciéndole la agenda de otra.
 */

import { recortarAlHorario, profesionalDe } from "../lib/citas/horarioProfesional.js";

const L = 1; // lunes

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}
const tramos = (r) => r.map((x) => `${x.startTime}-${x.endTime}`);

const centro = [{ dayOfWeek: L, startTime: "09:00", endTime: "18:00", eventTypeId: "x" }];

process.stdout.write("\n▶ Sin horario propio NO hay huecos (07/08/2026: antes era al revés)\n");
check("sin filas suyas → nada", recortarAlHorario(centro, [], L).length, 0);
check("solo trabaja OTRO día → ese lunes, nada", recortarAlHorario(centro, [{ dayOfWeek: 3, startTime: "09:00", endTime: "12:00" }], L).length, 0);
check("el día que SÍ trabaja sí sale",
  tramos(recortarAlHorario([{ dayOfWeek: 3, startTime: "09:00", endTime: "18:00" }], [{ dayOfWeek: 3, startTime: "09:00", endTime: "12:00" }], 3)), ["09:00-12:00"]);


process.stdout.write("\n▶ Con horario propio, la intersección\n");
check("ella de 10 a 14 → 10:00-14:00",
  tramos(recortarAlHorario(centro, [{ dayOfWeek: L, startTime: "10:00", endTime: "14:00" }], L)), ["10:00-14:00"]);
check("ella más amplia que el centro → manda el centro",
  tramos(recortarAlHorario(centro, [{ dayOfWeek: L, startTime: "07:00", endTime: "23:00" }], L)), ["09:00-18:00"]);
check("dos turnos → DOS huecos, no uno con agujero",
  tramos(recortarAlHorario(centro, [
    { dayOfWeek: L, startTime: "09:00", endTime: "14:00" },
    { dayOfWeek: L, startTime: "16:00", endTime: "18:00" },
  ], L)), ["09:00-14:00", "16:00-18:00"]);
check("salen ordenados por hora aunque lleguen al revés",
  tramos(recortarAlHorario(centro, [
    { dayOfWeek: L, startTime: "16:00", endTime: "18:00" },
    { dayOfWeek: L, startTime: "09:00", endTime: "11:00" },
  ], L)), ["09:00-11:00", "16:00-18:00"]);

process.stdout.write("\n▶ Sin solapamiento no se inventa un hueco\n");
check("ella de tarde, el centro de mañana",
  recortarAlHorario([{ dayOfWeek: L, startTime: "09:00", endTime: "13:00" }],
    [{ dayOfWeek: L, startTime: "16:00", endTime: "20:00" }], L).length, 0);
check("se tocan justo en el borde (13:00) → no es un hueco",
  recortarAlHorario([{ dayOfWeek: L, startTime: "09:00", endTime: "13:00" }],
    [{ dayOfWeek: L, startTime: "13:00", endTime: "20:00" }], L).length, 0);

process.stdout.write("\n▶ Datos malos no tumban la agenda\n");
check("hora ilegible en el centro", recortarAlHorario([{ dayOfWeek: L, startTime: "nueve", endTime: "18:00" }],
  [{ dayOfWeek: L, startTime: "10:00", endTime: "14:00" }], L).length, 0);
check("fin antes que inicio", recortarAlHorario(centro,
  [{ dayOfWeek: L, startTime: "18:00", endTime: "09:00" }], L).length, 0);
check("sin disponibilidades", recortarAlHorario(null, [{ dayOfWeek: L, startTime: "10:00", endTime: "14:00" }], L).length, 0);

process.stdout.write("\n▶ Quién es su profesional\n");
check("ficha con profesional", profesionalDe({ assignedTeamMemberId: "abc" }), "abc");
check("en formato de base de datos", profesionalDe({ assigned_team_member_id: "abc" }), "abc");
check("sin asignar", profesionalDe({ assignedTeamMemberId: null }), null);
check("ficha vieja sin el campo", profesionalDe({}), null);
check("sin ficha", profesionalDe(null), null);

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);

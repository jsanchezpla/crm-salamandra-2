/**
 * _smoke-ausencias.mjs — la resta de «Vacaciones» a la agenda (06/08/2026).
 * Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-ausencias.mjs
 *
 * Lo que vigila, que son los dos errores que aquí duelen:
 *   · restar de MENOS y dar cita a alguien que está de vacaciones;
 *   · restar de MÁS y dejar el día entero sin huecos por una ausencia de una hora.
 */

import { restarAusencias, minutosOcupados } from "../lib/citas/ausencias.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}
const tramos = (r) => r.map((x) => `${x.startTime}-${x.endTime}`);

// Agosto: Madrid va en CEST (UTC+2), así que 08:00Z son las 10:00 de aquí.
const dia = { year: 2026, month: 8, day: 10 };
const centro = [{ startTime: "09:00", endTime: "18:00", eventTypeId: "x" }];
const bloqueo = (desde, hasta) => ({ startAt: desde, endAt: hasta });

process.stdout.write("\n▶ Sin bloqueos no se toca nada\n");
check("lista vacía", tramos(restarAusencias(centro, [], dia)), ["09:00-18:00"]);
check("null", tramos(restarAusencias(centro, null, dia)), ["09:00-18:00"]);
check("bloqueo de otro día", tramos(restarAusencias(centro, [bloqueo("2026-08-12T08:00:00Z", "2026-08-12T16:00:00Z")], dia)), ["09:00-18:00"]);

process.stdout.write("\n▶ Un rato en medio PARTE el tramo en dos\n");
// 10:00Z-11:00Z = 12:00-13:00 en Madrid
check("ausente de 12 a 13", tramos(restarAusencias(centro, [bloqueo("2026-08-10T10:00:00Z", "2026-08-10T11:00:00Z")], dia)),
  ["09:00-12:00", "13:00-18:00"]);

process.stdout.write("\n▶ Recortes por los bordes\n");
// hasta 12:00 Madrid
check("se incorpora a las 12", tramos(restarAusencias(centro, [bloqueo("2026-08-10T00:00:00Z", "2026-08-10T10:00:00Z")], dia)), ["12:00-18:00"]);
// desde 14:00 Madrid hasta el final del día
check("se va a las 14", tramos(restarAusencias(centro, [bloqueo("2026-08-10T12:00:00Z", "2026-08-11T00:00:00Z")], dia)), ["09:00-14:00"]);

process.stdout.write("\n▶ Días enteros de un bloqueo largo\n");
const dosSemanas = bloqueo("2026-08-07T12:00:00Z", "2026-08-21T08:00:00Z");
check("día de en medio: no queda nada", restarAusencias(centro, [dosSemanas], dia).length, 0);
check("último día, vuelve a las 10", tramos(restarAusencias(centro, [dosSemanas], { year: 2026, month: 8, day: 21 })), ["10:00-18:00"]);
check("el día de después ya está libre", tramos(restarAusencias(centro, [dosSemanas], { year: 2026, month: 8, day: 22 })), ["09:00-18:00"]);

process.stdout.write("\n▶ Varios bloqueos a la vez\n");
check("dos ratos sueltos → tres huecos", tramos(restarAusencias(centro, [
  bloqueo("2026-08-10T08:00:00Z", "2026-08-10T08:30:00Z"), // 10:00-10:30
  bloqueo("2026-08-10T12:00:00Z", "2026-08-10T13:00:00Z"), // 14:00-15:00
], dia)), ["09:00-10:00", "10:30-14:00", "15:00-18:00"]);
check("dos bloqueos solapados no duplican trozos", tramos(restarAusencias(centro, [
  bloqueo("2026-08-10T08:00:00Z", "2026-08-10T11:00:00Z"), // 10:00-13:00
  bloqueo("2026-08-10T10:00:00Z", "2026-08-10T12:00:00Z"), // 12:00-14:00
], dia)), ["09:00-10:00", "14:00-18:00"]);

process.stdout.write("\n▶ Dos turnos del centro\n");
const dosTurnos = [
  { startTime: "09:00", endTime: "14:00", eventTypeId: "x" },
  { startTime: "16:00", endTime: "20:00", eventTypeId: "x" },
];
check("la ausencia solo pisa la mañana", tramos(restarAusencias(dosTurnos, [bloqueo("2026-08-10T07:00:00Z", "2026-08-10T09:00:00Z")], dia)),
  ["11:00-14:00", "16:00-20:00"]);

process.stdout.write("\n▶ Datos malos no tumban la agenda\n");
check("fin antes que inicio", tramos(restarAusencias(centro, [bloqueo("2026-08-10T12:00:00Z", "2026-08-10T08:00:00Z")], dia)), ["09:00-18:00"]);
check("fechas ilegibles", tramos(restarAusencias(centro, [bloqueo("ayer", "mañana")], dia)), ["09:00-18:00"]);
check("bloqueo de duración cero", tramos(restarAusencias(centro, [bloqueo("2026-08-10T10:00:00Z", "2026-08-10T10:00:00Z")], dia)), ["09:00-18:00"]);
check("sin disponibilidades", restarAusencias([], [bloqueo("2026-08-10T10:00:00Z", "2026-08-10T11:00:00Z")], dia).length, 0);

process.stdout.write("\n▶ minutosOcupados por su cuenta\n");
check("no toca ese día", minutosOcupados(bloqueo("2026-08-12T08:00:00Z", "2026-08-12T10:00:00Z"), dia), null);
check("12:00 a 13:00 en minutos", minutosOcupados(bloqueo("2026-08-10T10:00:00Z", "2026-08-10T11:00:00Z"), dia), { inicio: 720, fin: 780 });

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);

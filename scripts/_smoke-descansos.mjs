/**
 * _smoke-descansos.mjs — el tiempo previo y posterior se RESTA de la cita
 * (07/08/2026, Rodrigo). Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-descansos.mjs
 *
 * Los ejemplos que dio él, tal cual:
 *   «Se pone que la cita dure 60 minutos. Si en el tiempo de descanso previo se
 *   ponen 10 minutos, entonces todas las citas empezarán a las 5:10. Irán los
 *   huecos: 5:10, 6:10, 7:10… Si es en el tiempo posterior, pues durarán hasta
 *   y 50.»
 *
 * Lo que vigila:
 *   · que los huecos sigan cayendo cada `duration` — sumar el descanso por
 *     fuera alargaría el bloque y descuadraría la agenda entera;
 *   · que la cita OCUPE solo su tiempo de consulta, o los solapes mentirían.
 */

import {
  generateSlotsForDay,
  desfaseDeInicio,
  duracionDeContacto,
} from "../lib/citas/slots.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

// Un día lejano para que la antelación mínima no recorte nada.
const DIA = { year: 2030, month: 6, day: 10 };
const AHORA = new Date(Date.UTC(2030, 0, 1));
const centro = [{ startTime: "17:00", endTime: "21:00" }];

const horas = (tipo, disp = centro, citas = []) =>
  generateSlotsForDay({ eventType: tipo, availabilities: disp, date: DIA, existingBookings: citas, now: AHORA })
    .map((s) => s.time);

const tipo = (extra) => ({ duration: 60, bufferBefore: 0, bufferAfter: 0, minNoticeHours: 0, ...extra });

process.stdout.write("\n▶ Sin descansos, como siempre\n");
check("de 17 a 21 salen 4 huecos en punto", horas(tipo()), ["17:00", "18:00", "19:00", "20:00"]);

process.stdout.write("\n▶ El ejemplo de Rodrigo: 10 minutos ANTES\n");
check("empiezan a y 10", horas(tipo({ bufferBefore: 10 })), ["17:10", "18:10", "19:10", "20:10"]);
check("y la cita dura 50", duracionDeContacto(tipo({ bufferBefore: 10 })), 50);
check("el desfase es de 10", desfaseDeInicio(tipo({ bufferBefore: 10 })), 10);

process.stdout.write("\n▶ 10 minutos DESPUÉS: empiezan en punto y acaban a y 50\n");
check("siguen empezando en punto", horas(tipo({ bufferAfter: 10 })), ["17:00", "18:00", "19:00", "20:00"]);
check("y duran 50", duracionDeContacto(tipo({ bufferAfter: 10 })), 50);

process.stdout.write("\n▶ Los dos a la vez\n");
const ambos = tipo({ bufferBefore: 10, bufferAfter: 10 });
check("empiezan a y 10", horas(ambos), ["17:10", "18:10", "19:10", "20:10"]);
check("y duran 40", duracionDeContacto(ambos), 40);

process.stdout.write("\n▶ El BLOQUE sigue siendo de 60: no se sale del horario\n");
// De 17:00 a 18:00 solo cabe UN bloque de 60, aunque la cita dure 50.
check("una hora de centro = un solo hueco",
  horas(tipo({ bufferBefore: 10 }), [{ startTime: "17:00", endTime: "18:00" }]), ["17:10"]);
check("55 minutos de centro no dan para nada",
  horas(tipo({ bufferBefore: 10 }), [{ startTime: "17:00", endTime: "17:55" }]).length, 0);

process.stdout.write("\n▶ Una cita puesta tapa su hueco, y solo el suyo\n");
// La cita de las 17:10 dura 50 → 17:10-18:00. No debe tapar la de las 18:10.
check("ocupado el primero, queda el resto",
  horas(tipo({ bufferBefore: 10 }), centro, [{ scheduledAt: "2030-06-10T15:10:00.000Z", duration: 50 }]),
  ["18:10", "19:10", "20:10"]);

process.stdout.write("\n▶ Datos mal metidos no vacían la agenda\n");
const absurdo = tipo({ bufferBefore: 40, bufferAfter: 40 }); // 80 > 60
check("descansos mayores que la cita → se ignoran", desfaseDeInicio(absurdo), 0);
check("y la cita conserva su duración", duracionDeContacto(absurdo), 60);
check("los huecos salen como si no hubiera descansos", horas(absurdo), ["17:00", "18:00", "19:00", "20:00"]);
check("descanso exactamente igual a la duración → se ignora", desfaseDeInicio(tipo({ bufferBefore: 60 })), 0);
check("negativos se tratan como cero", desfaseDeInicio(tipo({ bufferBefore: -10 })), 0);
check("sin los campos (tipos viejos) no pasa nada", duracionDeContacto({ duration: 45 }), 45);

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);

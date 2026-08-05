/**
 * _smoke-tipos-ocultos.mjs — quién ve y quién puede reservar cada tipo de cita
 * (05/08/2026). Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-tipos-ocultos.mjs
 *
 * Existe porque los dos errores posibles cuestan dinero y se ven tarde:
 *   · si ENSEÑA de más, un tipo pensado para quien ya pagó por transferencia
 *     queda a la vista y alguien se cuela — y como esas citas figuran como
 *     gratuitas, no salta ninguna alarma hasta la quinta sesión regalada;
 *   · si CIERRA de más, la paciente que sí pagó no puede reservar y vuelve a
 *     pedir hora por WhatsApp, que es justo lo que veníamos a quitar.
 */

import {
  exigePasarela,
  filtrarTiposPara,
  puedeReservar,
} from "../lib/citas/tiposVisibles.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const PUBLICO = { id: "t-publico", isHidden: false };
const OCULTO = { id: "t-oculto", isHidden: true };
const nombres = (tipos) => tipos.map((t) => t.id);

process.stdout.write("\n▶ El interruptor de caja está APAGADO por defecto\n");
check("tenant recién creado", exigePasarela({}), false);
check("sin settings", exigePasarela(null), false);
check("citas configuradas pero sin la puerta", exigePasarela({ settings: { citas: {} } }), false);
check("encendida", exigePasarela({ settings: { citas: { soloConPago: true } } }), true);

process.stdout.write("\n▶ Qué tipos ve cada uno\n");
check(
  "una anónima solo ve los públicos",
  nombres(filtrarTiposPara([PUBLICO, OCULTO], new Set())),
  ["t-publico"]
);
check(
  "quien tiene bono del oculto, lo ve",
  nombres(filtrarTiposPara([PUBLICO, OCULTO], new Set(["t-oculto"]))),
  ["t-publico", "t-oculto"]
);
check(
  "tener bono de OTRO tipo no destapa el oculto",
  nombres(filtrarTiposPara([PUBLICO, OCULTO], new Set(["t-publico"]))),
  ["t-publico"]
);
check("sin lista de permitidos (undefined) no se destapa nada", nombres(filtrarTiposPara([OCULTO])), []);
check("lista vacía de tipos no revienta", filtrarTiposPara(null, new Set()), []);
check(
  "un tipo antiguo, sin la columna, se trata como público",
  nombres(filtrarTiposPara([{ id: "viejo" }], new Set())),
  ["viejo"]
);

process.stdout.write("\n▶ La puerta de verdad: quién puede reservar (la que aplica /book)\n");
check(
  "público y de pago → pasa",
  puedeReservar(PUBLICO, { seCobra: true }).ok,
  true
);
check(
  "OCULTO sin bono → NO pasa, aunque mande el id a mano",
  puedeReservar(OCULTO, { tieneBono: false, seCobra: true }).ok,
  false
);
check(
  "oculto CON bono → pasa (y no se le cobra: ya lo pagó)",
  puedeReservar(OCULTO, { tieneBono: true, seCobra: false }).ok,
  true
);

process.stdout.write("\n▶ Con la puerta de caja encendida\n");
check(
  "cita gratuita sin bono → NO pasa",
  puedeReservar(PUBLICO, { seCobra: false, exigePago: true }).ok,
  false
);
check(
  "cita de pago → pasa",
  puedeReservar(PUBLICO, { seCobra: true, exigePago: true }).ok,
  true
);
check(
  "cita cubierta por un bono ya pagado → pasa",
  puedeReservar(PUBLICO, { seCobra: false, tieneBono: true, exigePago: true }).ok,
  true
);

process.stdout.write("\n▶ La VALORACIÓN INICIAL se salta la puerta de caja\n");
const VALORACION = { id: "t-valoracion", isHidden: false, isInitialAssessment: true };
check(
  "es gratuita y aun así se puede reservar: es la puerta de entrada de todo",
  puedeReservar(VALORACION, { seCobra: false, exigePago: true }).ok,
  true
);
check(
  "pero si además está OCULTA, sigue haciendo falta bono",
  puedeReservar({ ...VALORACION, isHidden: true }, { seCobra: false, exigePago: true }).ok,
  false
);

process.stdout.write("\n▶ Con la puerta APAGADA no cambia nada de lo de siempre\n");
check(
  "cita gratuita de un centro que cobra por fuera (Aumenta) → pasa",
  puedeReservar(PUBLICO, { seCobra: false, exigePago: false }).ok,
  true
);

process.stdout.write("\n▶ El motivo no chiva si el tipo existe o no\n");
const motivoOculto = puedeReservar(OCULTO, {}).motivo;
const motivoImpago = puedeReservar(PUBLICO, { exigePago: true }).motivo;
check("los dos rechazos dicen lo mismo", motivoOculto === motivoImpago, true);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobación(es) fallida(s)\n\n`
);
process.exit(fallos === 0 ? 0 : 1);

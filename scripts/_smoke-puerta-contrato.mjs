/**
 * _smoke-puerta-contrato.mjs — la tabla de decisión de la puerta de contratos
 * (04/08/2026). Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-puerta-contrato.mjs
 *
 * Existe porque los dos errores posibles son graves y silenciosos: si abre de
 * más, la puerta no sirve para nada; si cierra de más, la consulta se queda sin
 * poder dar citas y nadie lo sabe hasta que una paciente llama por teléfono.
 */

import {
  exigeContratoFirmado,
  esCitaDeValoracion,
  dejaReservar,
  mensajeDeContrato,
} from "../lib/citas/puertaContrato.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

process.stdout.write("\n▶ El interruptor está APAGADO por defecto\n");
check("tenant recién creado", exigeContratoFirmado({}), false);
check("sin settings", exigeContratoFirmado(null), false);
check("citas configuradas pero sin la puerta", exigeContratoFirmado({ settings: { citas: {} } }), false);
check("encendida", exigeContratoFirmado({ settings: { citas: { contratoObligatorio: true } } }), true);

process.stdout.write("\n▶ La valoración inicial se salta la puerta\n");
check("cita marcada como valoración", esCitaDeValoracion({ isInitialAssessment: true }), true);
check("cita normal", esCitaDeValoracion({ isInitialAssessment: false }), false);
check("tipo de cita antiguo (sin la columna)", esCitaDeValoracion({}), false);

process.stdout.write("\n▶ Quién pasa y quién no\n");
check("ya lo firmó todo → pasa", dejaReservar("firmado"), true);
check("le falta firmar → NO pasa", dejaReservar("pendiente"), false);
check("no tiene ficha → NO pasa", dejaReservar("sin_ficha"), false);
check("el centro no tiene contrato → pasa (no hay nada que firmar)", dejaReservar("sin_contrato"), true);
check("no se pudo mirar → pasa (no se deja al centro sin citas)", dejaReservar("sin_datos"), true);

process.stdout.write("\n▶ El aviso ofrece siempre una salida\n");
const anon = mensajeDeContrato("sin_ficha", { nombre: "Tunutrilaura", valoracion: "Valoración inicial" });
check("a quien no conocemos no se le confirma si tiene ficha", anon.codigo, "CONTRATO_REQUERIDO");
check("y se le ofrece la valoración", anon.texto.includes("valoración inicial"), true);
const conSesion = mensajeDeContrato("pendiente", { identificado: true, valoracion: "Valoración inicial" });
check("con sesión sí se le dice que le falta firmar", conSesion.codigo, "CONTRATO_PENDIENTE");
check("y se le manda al área privada", conSesion.irAlPortal, true);
const sinValoracion = mensajeDeContrato("pendiente", { identificado: true });
check("sin valoración configurada, no se inventa una", sinValoracion.texto.includes("sin firmar nada"), false);

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);

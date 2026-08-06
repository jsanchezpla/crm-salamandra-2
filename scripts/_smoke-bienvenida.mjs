/**
 * _smoke-bienvenida.mjs — «¿A qué entras hoy?» se pregunta UNA vez
 * (06/08/2026, Rodrigo).
 *
 * Lógica pura, sin base de datos:
 *   node scripts/_smoke-bienvenida.mjs
 *
 * La decisión —valoración inicial O entrar al perfil a firmar— se toma una sola
 * vez, y a partir de ahí la pantalla no vuelve a salir. Lo que se fija:
 *   · sin nada hecho, se pregunta;
 *   · con CUALQUIER cita reservada, no (eligió al reservarla);
 *   · con los documentos firmados, tampoco: firmar ES elegir el perfil, y era
 *     justo lo que no se detectaba —a quien acababa de firmarlo todo se le
 *     devolvía a la casilla de salida—;
 *   · sin valoración inicial configurada, la pregunta no existe;
 *   · y la valoración deja de ofrecerse en cuanto hay cualquier cita.
 */

import { debePreguntarBienvenida, haFirmadoTodo, ofreceValoracionInicial } from "../lib/citas/bienvenida.js";

const VALORACION = { id: "et-1", slug: "valoracion-inicial", name: "Valoración inicial" };

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

// Estados del contrato tal y como los devuelve `citas-portal/contract`.
const SIN_FICHA = { requiereFirma: false, bloqueado: false, motivo: "sin-ficha" };
const SIN_FIRMAR = { requiereFirma: true, estructurado: true, documentosPendientes: 2, yaFirme: false };
const A_MEDIAS = { requiereFirma: true, estructurado: true, documentosPendientes: 1, yaFirme: true };
const FIRMADO = { requiereFirma: false, estructurado: true, documentosPendientes: 0, yaFirme: true };
const FIRMADO_SIMPLE = { requiereFirma: false, estructurado: false, yaFirme: true };

process.stdout.write("\n▶ ¿Ha terminado de firmar?\n");
check("sin ficha, no", haFirmadoTodo(SIN_FICHA), false);
check("sin empezar, no", haFirmadoTodo(SIN_FIRMAR), false);
check("a medias (falta un documento), no", haFirmadoTodo(A_MEDIAS), false);
check("todo firmado, sí", haFirmadoTodo(FIRMADO), true);
check("contrato simple firmado, sí", haFirmadoTodo(FIRMADO_SIMPLE), true);
check("sin contrato que mirar, no", haFirmadoTodo(null), false);

process.stdout.write("\n▶ ¿Se le pregunta «¿a qué entras hoy?»?\n");
const preguntar = (citas, contrato, valoracion = VALORACION) =>
  debePreguntarBienvenida({ valoracion, citas, contrato });

check("recién llegada: sí", preguntar([], SIN_FICHA), true);
check("con ficha y sin firmar: sí", preguntar([], SIN_FIRMAR), true);
check("a mitad de firmar: sí", preguntar([], A_MEDIAS), true);
check("ya lo firmó todo: NO", preguntar([], FIRMADO), false);
check("tiene una valoración: NO", preguntar([{ esValoracionInicial: true }], SIN_FIRMAR), false);
check("tiene otra cita cualquiera: NO", preguntar([{ esValoracionInicial: false }], SIN_FIRMAR), false);
check("el centro no tiene valoración: NO", preguntar([], SIN_FIRMAR, null), false);

process.stdout.write("\n▶ ¿Se le sigue ofreciendo la valoración inicial?\n");
check("sin citas, sí", ofreceValoracionInicial([]), true);
check("con una valoración, no", ofreceValoracionInicial([{ esValoracionInicial: true }]), false);
check("con un acompañamiento, tampoco", ofreceValoracionInicial([{ esValoracionInicial: false }]), false);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobacion(es) fallidas\n\n`
);
process.exit(fallos === 0 ? 0 : 1);

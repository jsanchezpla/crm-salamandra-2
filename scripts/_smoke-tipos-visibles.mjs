/**
 * _smoke-tipos-visibles.mjs — qué tipos de cita ve cada una (06/08/2026).
 * Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-tipos-visibles.mjs
 *
 * Vigila las dos formas de equivocarse, que van en direcciones opuestas:
 *   · enseñar de MÁS — destapar el tipo oculto de otra, o llenarle el catálogo
 *     a quien ya tiene su programa pagado;
 *   · enseñar de MENOS — dejar a alguien sin nada que reservar, que es peor:
 *     no puede pedir cita ni comprar la renovación.
 */

import { filtrarTiposPara, soloSuPrograma, puedeReservar } from "../lib/citas/tiposVisibles.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}
const nombres = (r) => r.map((t) => t.id);

const CATALOGO = [
  { id: "valoracion", isInitialAssessment: true },
  { id: "consulta" },
  { id: "seguimiento" },
  { id: "programa6", isHidden: true },
  { id: "programa12", isHidden: true },
];

process.stdout.write("\n▶ Sin bono: el catálogo público y ningún oculto\n");
check("anónima", nombres(filtrarTiposPara(CATALOGO, new Set())), ["valoracion", "consulta", "seguimiento"]);
check("no se estrecha nada", nombres(soloSuPrograma(filtrarTiposPara(CATALOGO, new Set()), new Set())),
  ["valoracion", "consulta", "seguimiento"]);

process.stdout.write("\n▶ Con bono de un tipo OCULTO: solo ese\n");
const conP6 = new Set(["programa6"]);
check("se le destapa el suyo", nombres(filtrarTiposPara(CATALOGO, conP6)),
  ["valoracion", "consulta", "seguimiento", "programa6"]);
check("y se le esconde el resto", nombres(soloSuPrograma(filtrarTiposPara(CATALOGO, conP6), conP6)), ["programa6"]);
check("el oculto de OTRA sigue oculto", soloSuPrograma(filtrarTiposPara(CATALOGO, conP6), conP6).some((t) => t.id === "programa12"), false);

process.stdout.write("\n▶ Con bono de un tipo PÚBLICO: también se estrecha\n");
const conConsulta = new Set(["consulta"]);
check("solo su consulta", nombres(soloSuPrograma(filtrarTiposPara(CATALOGO, conConsulta), conConsulta)), ["consulta"]);

process.stdout.write("\n▶ Dos bonos a la vez: los dos, y nada más\n");
const dos = new Set(["programa6", "consulta"]);
check("los dos suyos", nombres(soloSuPrograma(filtrarTiposPara(CATALOGO, dos), dos)), ["consulta", "programa6"]);

process.stdout.write("\n▶ Nunca se queda sin NADA que reservar\n");
// Su tipo se desactivó y ya no está en la lista, pero el bono sigue vivo.
const fantasma = new Set(["tipo-que-ya-no-existe"]);
check("bono de un tipo que ya no está → catálogo entero",
  nombres(soloSuPrograma(filtrarTiposPara(CATALOGO, fantasma), fantasma)), ["valoracion", "consulta", "seguimiento"]);
check("lista vacía no revienta", soloSuPrograma([], conP6), []);
check("idsPermitidos que no es un Set se ignora", nombres(soloSuPrograma(CATALOGO, null)),
  ["valoracion", "consulta", "seguimiento", "programa6", "programa12"]);

process.stdout.write("\n▶ La puerta de verdad (`/book`) no se ha movido\n");
check("oculto sin bono: no", puedeReservar({ isHidden: true }, { tieneBono: false }).ok, false);
check("oculto con bono: sí", puedeReservar({ isHidden: true }, { tieneBono: true }).ok, true);
check("público con bono de OTRO tipo: sigue pudiendo",
  puedeReservar({ id: "consulta" }, { tieneBono: false, exigePago: false }).ok, true);
check("solo-con-pago: gratuito sin bono, no", puedeReservar({}, { exigePago: true, seCobra: false }).ok, false);
check("solo-con-pago: la valoración pasa igual",
  puedeReservar({ isInitialAssessment: true }, { exigePago: true, seCobra: false }).ok, true);

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);

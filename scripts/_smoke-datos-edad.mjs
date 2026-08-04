/**
 * _smoke-datos-edad.mjs — la regla del DNI por edad y el reparto de los datos
 * antes/después de firmar (04/08/2026).
 *
 * Lógica pura, sin base de datos: se puede lanzar en cualquier sitio.
 *   node scripts/_smoke-datos-edad.mjs
 *
 * Existe porque estas dos reglas se equivocan en silencio: si el DNI vuelve a
 * ser obligatorio para una niña de 10 años, nadie se entera hasta que una
 * familia no puede terminar de firmar.
 */

import {
  campoEsObligatorio,
  camposQueFaltan,
  separarPorMomento,
} from "../lib/clients/datosFicha.js";

const dni = { key: "dni", label: "DNI", required: true, requiredDesdeEdad: 14, ficha: "cliente.taxId" };
const nombre = { key: "nombre", label: "Nombre", required: true, ficha: "cliente.name" };
const fecha = { key: "fn", label: "Fecha nac.", required: true, previo: true, ficha: "cliente.birthDate" };

const hoy = new Date();
const haceAnios = (n) =>
  new Date(hoy.getFullYear() - n, hoy.getMonth(), hoy.getDate()).toISOString().slice(0, 10);

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

process.stdout.write("\n▶ El DNI solo es obligatorio desde los 14\n");
check("a los 8 años, no", campoEsObligatorio(dni, haceAnios(8)), false);
check("a los 13 años, no", campoEsObligatorio(dni, haceAnios(13)), false);
check("a los 14 años, sí", campoEsObligatorio(dni, haceAnios(14)), true);
check("a los 40 años, sí", campoEsObligatorio(dni, haceAnios(40)), true);
check("sin fecha de nacimiento, sí (no rompe nada)", campoEsObligatorio(dni, null), true);
check("el nombre lo es siempre", campoEsObligatorio(nombre, haceAnios(8)), true);

process.stdout.write("\n▶ Huecos de la ficha\n");
const nina = { name: "Lucía", birthDate: haceAnios(10), taxId: null, customFields: {} };
check(
  "a una niña de 10 con su fecha puesta no le falta nada",
  camposQueFaltan([nombre, dni, fecha], nina).map((c) => c.key),
  []
);
const adulta = { name: "Ana", birthDate: null, taxId: null, customFields: {} };
check(
  "a una adulta sin DNI ni fecha le faltan los dos",
  camposQueFaltan([nombre, dni, fecha], adulta).map((c) => c.key),
  ["dni", "fn"]
);

process.stdout.write("\n▶ Qué se pide antes de firmar y qué después\n");
const { previos, posteriores } = separarPorMomento(camposQueFaltan([nombre, dni, fecha], adulta));
check("antes, solo la fecha de nacimiento", previos.map((c) => c.key), ["fn"]);
check("después, el resto", posteriores.map((c) => c.key), ["dni"]);

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);

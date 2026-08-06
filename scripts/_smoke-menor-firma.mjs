/**
 * _smoke-menor-firma.mjs — lo que cambia cuando la paciente es menor de edad
 * (06/08/2026, Rodrigo).
 *
 * Lógica pura, sin base de datos:
 *   node scripts/_smoke-menor-firma.mjs
 *
 * Cubre las tres reglas que se tocaron a la vez y que se equivocan en silencio:
 *   1. El DNI no bloquea a NINGÚN menor de edad (antes era desde los 14).
 *   2. La copia del contrato firmado se puede LISTAR y ABRIR: eran dos listas
 *      distintas y se desincronizaron (el portal lo enseñaba y daba 404).
 *   3. La edad declarada en el formulario tiene que cuadrar con la fecha de
 *      nacimiento de la ficha, con un año de margen por el cumpleaños.
 */

import { campoEsObligatorio } from "../lib/clients/datosFicha.js";
import { esMenor } from "../lib/clients/contratoFirma.js";
import { FUENTES_VISIBLES, wherePaciente } from "../lib/citas/portalDocumentos.js";
import { desajusteDeEdad, edadDeLasRespuestas } from "../lib/formularios/edadDeclarada.js";

const dni = { key: "dni", label: "DNI", required: true, requiredDesdeEdad: 18, ficha: "cliente.taxId" };

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

process.stdout.write("\n▶ El DNI no bloquea a ningún menor de edad\n");
check("a los 8, no", campoEsObligatorio(dni, haceAnios(8)), false);
check("a los 14, tampoco (antes sí)", campoEsObligatorio(dni, haceAnios(14)), false);
check("a los 17, tampoco", campoEsObligatorio(dni, haceAnios(17)), false);
check("a los 18, sí", campoEsObligatorio(dni, haceAnios(18)), true);
check("sin fecha, sí (no rompe nada)", campoEsObligatorio(dni, null), true);

process.stdout.write("\n▶ Quién es menor a efectos del consentimiento parental\n");
check("17 años, menor", esMenor(haceAnios(17)), true);
check("18 años, no", esMenor(haceAnios(18)), false);
check("sin fecha, se trata como mayor", esMenor(null), false);

process.stdout.write("\n▶ El portal lista y abre lo MISMO\n");
check("el contrato firmado está entre las fuentes", FUENTES_VISIBLES.includes("contrato_firmado"), true);
const filtro = wherePaciente("cli-1");
check("el filtro acota por la ficha", filtro.clientId, "cli-1");
// `Op.in` es un Symbol, así que la lista no sale con Object.values.
const enLista = filtro.source[Object.getOwnPropertySymbols(filtro.source)[0]];
check("y por las tres fuentes", enLista, FUENTES_VISIBLES);

process.stdout.write("\n▶ La edad del formulario contra la fecha de la ficha\n");
const respuestas = (edad) => [
  { key: "nombre", value: "Prueba" },
  { key: "edad", value: String(edad) },
];
check("se lee la edad declarada", edadDeLasRespuestas(respuestas(13)), 13);
check("sin respuesta de edad, null", edadDeLasRespuestas([{ key: "nombre", value: "x" }]), null);

const bandeja = (edad) => ({ findOne: async () => ({ answers: respuestas(edad) }) });
const desajuste = async (declarada, aniosReales) =>
  desajusteDeEdad({
    FormSubmission: bandeja(declarada),
    email: "a@b.com",
    birthDate: haceAnios(aniosReales),
  });

check("13 declarados y 13 reales, sin aviso", await desajuste(13, 13), null);
check("13 declarados y 14 reales (cumpleaños), sin aviso", await desajuste(13, 14), null);
check("20 declarados y 15 reales, AVISO", await desajuste(20, 15), { declarada: 20, real: 15 });
check("13 declarados y 40 reales, AVISO", await desajuste(13, 40), { declarada: 13, real: 40 });
check("sin bandeja, sin aviso", await desajusteDeEdad({ FormSubmission: null, email: "a@b.com", birthDate: haceAnios(9) }), null);
check("sin fecha de nacimiento, sin aviso", await desajusteDeEdad({ FormSubmission: bandeja(13), email: "a@b.com", birthDate: null }), null);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobacion(es) fallidas\n\n`
);
process.exit(fallos === 0 ? 0 : 1);

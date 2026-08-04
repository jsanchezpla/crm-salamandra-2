/**
 * _smoke-preguntas-cita.mjs — preguntas propias del tipo de cita (04/08/2026).
 * Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-preguntas-cita.mjs
 *
 * Lo que vigila: que una pregunta obligatoria no se pueda saltar, que la escala
 * no acepte un 7 cuando va del 1 al 5, y que el enunciado se guarde JUNTO a la
 * respuesta —si la profesional reescribe la pregunta el mes que viene, lo que
 * se contestó tiene que seguir leyéndose como se preguntó entonces—.
 */

import {
  normalizarPreguntas,
  validarRespuestas,
  paquetePreguntas,
  MAX_PREGUNTAS,
} from "../lib/citas/preguntasCita.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

process.stdout.write("\n▶ Normalizar lo que llega del navegador\n");
check("una pregunta sin enunciado se descarta",
  normalizarPreguntas([{ label: "  ", type: "corto" }]).length, 0);
check("un tipo inventado cae a texto corto",
  normalizarPreguntas([{ label: "X", type: "video" }])[0].type, "corto");
check("la escala coge 5 por defecto",
  normalizarPreguntas([{ label: "X", type: "escala" }])[0].max, 5);
check("una escala de 99 se recorta",
  normalizarPreguntas([{ label: "X", type: "escala", max: 99 }])[0].max, 5);
// El id es lo que une respuesta y pregunta con el tiempo: dos iguales harían
// que la segunda respuesta pisara a la primera. Al repetido se le da uno
// posicional (`p2`), no un apaño con guiones bajos.
check("un id repetido no pisa al primero",
  normalizarPreguntas([{ id: "a", label: "1" }, { id: "a", label: "2" }]).map((p) => p.id), ["a", "p2"]);
check(`no se guardan más de ${MAX_PREGUNTAS}`,
  normalizarPreguntas(Array.from({ length: 30 }, (_, i) => ({ label: `P${i}` }))).length, MAX_PREGUNTAS);

const PREGUNTAS = [
  { id: "peso", label: "¿Cuánto pesas?", type: "numero", required: true },
  { id: "animo", label: "¿Cómo te encuentras?", type: "escala", max: 5, required: true },
  { id: "nota", label: "Algo que quieras contarme", type: "largo", required: false },
];

process.stdout.write("\n▶ Contestar\n");
check("faltando una obligatoria, no pasa",
  validarRespuestas(PREGUNTAS, { animo: 3 }).error, "Falta contestar «¿Cuánto pesas?»");
check("la escala no acepta un 7 de 5",
  validarRespuestas(PREGUNTAS, { peso: 60, animo: 7 }).error, "«¿Cómo te encuentras?» tiene que ser del 1 al 5");
check("un número que no es número, tampoco",
  validarRespuestas(PREGUNTAS, { peso: "bastante", animo: 3 }).error, "«¿Cuánto pesas?» tiene que ser un número");
check("con las obligatorias puestas, pasa",
  validarRespuestas(PREGUNTAS, { peso: "60,5", animo: 3 }).ok, true);
check("las comas decimales valen",
  validarRespuestas(PREGUNTAS, { peso: "60,5", animo: 3 }).respuestas[0].valor, 60.5);
check("una opcional en blanco no se guarda",
  validarRespuestas(PREGUNTAS, { peso: 60, animo: 3 }).respuestas.length, 2);

process.stdout.write("\n▶ Lo que se guarda con la cita\n");
const paq = paquetePreguntas(PREGUNTAS, { peso: 60, animo: 4, nota: "  gracias  " });
check("el enunciado viaja con la respuesta",
  paq.paquete.respuestas[0], { id: "peso", label: "¿Cuánto pesas?", type: "numero", valor: 60 });
check("el texto se recorta de espacios",
  paq.paquete.respuestas[2].valor, "gracias");
check("sin preguntas no se guarda nada",
  paquetePreguntas([], {}).paquete, null);
check("lo que llega de más se tira",
  paquetePreguntas(PREGUNTAS, { peso: 60, animo: 4, colado: "x" }).paquete.respuestas.length, 2);

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);

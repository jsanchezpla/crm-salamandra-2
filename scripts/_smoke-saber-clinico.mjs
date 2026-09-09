// @prueba ligera
/**
 * _smoke-saber-clinico.mjs — el saber clínico de la IA, y la caché que lo hace
 * pagable (09/09/2026).
 *
 * Rodrigo: «si tienes que explicarle medio DSM-V, hazlo. Da igual, tiene que
 * saber identificar todo mucho mejor».
 *
 * Esta prueba defiende DOS cosas que se rompen de formas distintas:
 *
 *   · La CLÍNICA: que el material no empuje al modelo a diagnosticar ni a
 *     afirmar sobre lo que nadie ha mirado. Un diagnóstico inventado es lo
 *     único de todo esto que no se puede corregir después.
 *
 *   · La CACHÉ: que el núcleo del prompt no cambie entre llamadas. La clave de
 *     Anthropic la paga el centro, y con ~20.000 tokens por llamada la
 *     diferencia entre cachear y no cachear son 20 $ al mes de SU dinero.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { saberClinico, BLOQUES, ORDEN_BLOQUES } from "../lib/clinica/saberClinico.js";
import { nucleoClinico, restoClinico, estiloClinico, PROHIBIDO } from "../lib/clinica/estiloClinico.js";
import { partesDelPromptDeRegistro } from "../lib/clinica/registroCompleto.js";
import { systemDeLaPeticion } from "../lib/outreach/analysis/anthropic.js";

/* ── El material ─────────────────────────────────────────────────────────── */

test("están las siete áreas, y ninguna vacía", () => {
  assert.equal(ORDEN_BLOQUES.length, 7);
  for (const k of ORDEN_BLOQUES) {
    assert.ok(BLOQUES[k], `falta el bloque ${k}`);
    assert.ok(BLOQUES[k].length > 3000, `el bloque ${k} se ha quedado en ${BLOQUES[k].length} caracteres`);
  }
  // Y el saber los lleva todos, en su orden.
  const s = saberClinico();
  for (const k of ORDEN_BLOQUES) assert.ok(s.includes(BLOQUES[k]), k);
});

test("las áreas que no tenían NI UNA palabra en el prompt viejo ya están", () => {
  /*
   * En Aumenta hay 127 pacientes de terapia ocupacional, 95 de pedagogía y 32
   * de fisioterapia. El prompt de antes tenía una sola línea de terminología y
   * era toda de neuropsicología y logopedia: un registro de fisio se escribía
   * con vocabulario de atención.
   */
  // Sin mayúsculas: el término puede abrir una viñeta («Control postural: …»).
  const s = saberClinico().toLowerCase();
  for (const termino of [
    // Terapia ocupacional y motor, que no tenían nada:
    "propioceptivo",
    "integración sensorial",
    "control postural",
    "coordinación bilateral",
    "línea media",
    "grafomotricidad",
    "praxis",
    "marcha",
    "equilibrio",
    "avd",
    // Pedagogía, que tampoco:
    "hechos numéricos",
    "técnicas de estudio",
    "ortografía",
    // Emocional y conducta:
    "desregulación",
    "tolerancia a la frustración",
    // Y lo que sí había en el prompt viejo, que sigue estando:
    "conciencia fonológica",
    "memoria de trabajo",
  ]) {
    assert.ok(s.includes(termino), `falta «${termino}»`);
  }
});

test("EL CARTEL DE ARRIBA, que es lo que impide leerlo como una lista de comprobación", () => {
  /*
   * El fallo que más veces salió al revisar los siete bloques: con un catálogo
   * de marcadores delante, el modelo acaba AFIRMANDO EN NEGATIVO lo que nadie
   * observó —«no se aprecian inversiones», «mantiene el tono»—, que es inventar
   * con otras palabras.
   */
  const s = saberClinico();
  assert.match(s, /NO se nombran/);
  assert.match(s, /Ni siquiera para decir que están conservados/);
  assert.match(s, /Nada de aquí es un criterio que se cumple/);
  // Y el aviso de los adultos, que son el 22,5 % de los pacientes de Aumenta.
  assert.match(s, /un cuarto de los pacientes son adultos/i);
  assert.match(s, /no se habla de «el niño»/);
});

test("el saber no levanta ninguna prohibición: va DELANTE de PROHIBIDO", () => {
  // Si se colara detrás, un «convendría valorar» del saber podría leerse como
  // permiso para lo que la prohibición cierra dos párrafos antes.
  const n = nucleoClinico();
  assert.ok(n.indexOf(saberClinico()) < n.indexOf(PROHIBIDO));
  assert.ok(n.includes(PROHIBIDO));
});

/* ── La caché ────────────────────────────────────────────────────────────── */

test("el núcleo NO cambia entre pacientes ni entre documentos", () => {
  /*
   * ESTO ES LA CACHÉ. Una caché de prompt es un PREFIJO: basta con que delante
   * del saber clínico haya una línea que cambie —la edad del paciente, los
   * apartados de esta plantilla— para que no quede nada que reutilizar y se
   * pague la entrada entera en cada llamada.
   */
  const bloques = [{ key: "activities", label: "Actividades", tipo: "texto" }];
  const a = partesDelPromptDeRegistro(bloques, { paciente: { birthDate: "2018-05-01", specialties: ["logopedia"] } });
  const b = partesDelPromptDeRegistro(bloques, { paciente: { birthDate: "1990-01-01", specialties: ["fisioterapia"] } });
  const c = partesDelPromptDeRegistro([{ key: "otro", label: "Otro apartado", tipo: "lista" }]);
  assert.equal(a.systemCacheado, b.systemCacheado);
  assert.equal(a.systemCacheado, c.systemCacheado);
  // Y lo que cambia sí está en la otra mitad.
  assert.notEqual(a.system, b.system);
  assert.match(a.system, /EL PACIENTE \(sin nombre/);
});

test("nada del caso se cuela en el núcleo", () => {
  const partes = partesDelPromptDeRegistro([{ key: "activities", label: "Actividades", tipo: "texto" }], {
    paciente: { firstName: "Hugo", birthDate: "2018-05-01", specialties: ["logopedia"] },
  });
  assert.doesNotMatch(partes.systemCacheado, /Hugo/);
  assert.doesNotMatch(partes.systemCacheado, /EL PACIENTE \(sin nombre/);
  assert.doesNotMatch(partes.systemCacheado, /activities/);
});

test("pero el perfil del centro SÍ va dentro: no cambia entre llamadas suyas", () => {
  // Es lo que hace que cada centro tenga su propia entrada de caché, y está
  // bien: su texto es fijo para él.
  const con = nucleoClinico({ centro: { terapias: "Aquí decimos TO" } });
  assert.ok(con.includes("Aquí decimos TO"));
  assert.notEqual(con, nucleoClinico());
});

test("partirlo no pierde ni una línea del prompt de siempre", () => {
  const bloques = [{ key: "activities", label: "Actividades", tipo: "texto" }];
  const { systemCacheado, system } = partesDelPromptDeRegistro(bloques);
  const junto = `${systemCacheado}\n\n${system}`;
  const entero = [nucleoClinico(), restoClinico()].filter(Boolean).join("\n\n");
  for (const linea of entero.split("\n").map((l) => l.trim()).filter(Boolean)) {
    assert.ok(junto.includes(linea), `se ha perdido: ${linea.slice(0, 60)}`);
  }
});

/* ── Cómo viaja al modelo ────────────────────────────────────────────────── */

test("sin núcleo, el system se manda como cadena, igual que siempre", () => {
  // Los once llamantes que no son clínicos no se enteran de este cambio.
  assert.equal(systemDeLaPeticion("hola", null), "hola");
  assert.equal(systemDeLaPeticion("hola", ""), "hola");
  assert.equal(systemDeLaPeticion("hola", "   "), "hola");
  assert.equal(systemDeLaPeticion("hola", undefined), "hola");
});

test("con núcleo, va marcado para cachear y a UNA HORA", () => {
  /*
   * El TTL de una hora no es un capricho: medidos los huecos entre llamadas de
   * Aumenta en septiembre, solo el 39 % llega antes de 5 minutos. Con el TTL de
   * fábrica se fallaría la caché el 61 % de las veces y se pagaría la ESCRITURA
   * —que cuesta el doble— casi siempre. Escribir «1h» vale 14 $/mes.
   */
  const s = systemDeLaPeticion("lo de esta llamada", "el núcleo");
  assert.ok(Array.isArray(s));
  assert.equal(s.length, 2);
  assert.equal(s[0].text, "el núcleo", "lo cacheado va PRIMERO: una caché es un prefijo");
  assert.deepEqual(s[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.equal(s[1].text, "lo de esta llamada");
  assert.equal(s[1].cache_control, undefined, "solo se marca el prefijo");
});

test("con núcleo y sin resto, va un solo bloque y no uno vacío", () => {
  const s = systemDeLaPeticion("", "el núcleo");
  assert.equal(s.length, 1);
  assert.equal(s[0].text, "el núcleo");
});

/* ── Que el prompt entero sigue siendo el mismo texto ────────────────────── */

test("`estiloClinico` sigue devolviendo el todo, con el saber dentro", () => {
  const e = estiloClinico({ contexto: "EL PACIENTE (sin nombre, no lo necesitas): 7 años" });
  assert.ok(e.includes(saberClinico()));
  assert.ok(e.includes("EL PACIENTE (sin nombre"));
  assert.ok(e.startsWith(nucleoClinico()), "el núcleo va primero");
});

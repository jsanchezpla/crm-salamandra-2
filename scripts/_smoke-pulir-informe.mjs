/**
 * _smoke-pulir-informe.mjs — las dos reglas del informe clínico, fijadas.
 *
 * De todo lo que hace la redacción asistida, hay una cosa que si falla falla en
 * silencio y hacia fuera: que la IA meta un dato que no estaba. Un informe
 * clínico acaba en manos de una familia y a veces de un juzgado; una edad, una
 * fecha o un número inventados no los caza nadie leyendo por encima, porque
 * suenan bien. Eso no se comprueba a ojo, se fija aquí.
 *
 * Lo que se comprueba:
 *   · Solo se le mandan al modelo los CINCO apartados del volcado. El motivo de
 *     intervención y la propuesta de continuidad son de la profesional y no
 *     salen de su sitio.
 *   · `verificarSinInventar` caza números y meses nuevos, y deja pasar la
 *     redacción legítima.
 *   · Los apartados de SÍNTESIS (04/09/2026) solo se proponen si están VACÍOS:
 *     lo que la profesional haya escrito en los logros o en la continuidad no
 *     se le manda al modelo ni se pisa. Y como se elaboran leyendo el informe
 *     entero, se verifican contra TODO el volcado y no contra su casilla vacía
 *     —si no, repetir una fecha de la evolución los tumbaría siempre—.
 *   · La propuesta que encoge de más se AVISA (no se rechaza: unir dos líneas
 *     acorta con razón).
 *   · El modo simulado de la demo pasa su propia verificación — o sea que la
 *     demo no enseña algo que la de verdad rechazaría.
 *
 * No toca base de datos, ni red, ni servidor. Se ejecuta suelto:
 *   node scripts/_smoke-pulir-informe.mjs
 */

import {
  SECCIONES_PULIBLES,
  SECCIONES_SINTESIS,
  loQueHayQuePulir,
  loQueSePuedeProponer,
  verificarSinInventar,
  avisosDePerdida,
  fakePulirInforme,
} from "../lib/clinica/pulirInforme.js";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));

/** Un informe como el que deja `redactarDesdeSesiones`. */
const VOLCADO = {
  motiveOfIntervention: "La familia consulta por dificultades de atención en el aula.",
  continuityProposal: "Se propone continuar un trimestre más con la misma frecuencia.",
  objectives: ["Atención sostenida", "Regulación emocional"],
  evolution: [
    "3 de marzo: se trabajan tareas de atención sostenida con apoyo visual, responde con interés.",
    "17 de marzo, la familia refiere: en casa aguanta más rato con los deberes.",
    "2 de abril: se retira el apoyo visual y mantiene la tarea 15 minutos.",
  ],
  achievements: [],
  persistentDifficulties: ["17 de marzo: le cuesta empezar sin que se le indique."],
  recommendations: ["Mantener la rutina de deberes a la misma hora."],
  sourceSessionIds: ["a", "b", "c"],
};

process.stdout.write("\n═══ Smoke: la redacción asistida del informe clínico ═══\n");

// ── 1. Qué se le manda al modelo ───────────────────────────────────────────
paso("Lo que escribe la profesional no sale de su sitio");
{
  const entrada = loQueHayQuePulir(VOLCADO);
  const claves = Object.keys(entrada);
  esperar(
    !claves.includes("motiveOfIntervention") && !claves.includes("continuityProposal"),
    "el motivo de intervención y la continuidad NO se le mandan al modelo",
    claves.join(", ")
  );
  esperar(!claves.includes("sourceSessionIds"), "ni los ids de las sesiones");
  esperar(
    claves.every((k) => SECCIONES_PULIBLES.includes(k)),
    "solo van los apartados del volcado",
    claves.join(", ")
  );
  esperar(!claves.includes("achievements"), "un apartado vacío no se manda: no hay nada que redactar");
}

// ── 2. La verificación de invenciones ──────────────────────────────────────
paso("Un dato que no estaba se caza");
{
  const entrada = loQueHayQuePulir(VOLCADO);

  const legitima = {
    evolution: [
      "El 3 de marzo se trabajan tareas de atención sostenida con apoyo visual, ante las que responde con interés.",
      "El 17 de marzo la familia refiere que en casa aguanta más rato con los deberes.",
      "El 2 de abril se retira el apoyo visual y mantiene la tarea 15 minutos.",
    ],
  };
  const v1 = verificarSinInventar(entrada, legitima);
  esperar(v1.ok, "una redacción que no añade nada pasa", v1.motivos.join("; "));

  const conEdad = { evolution: ["El paciente, de 8 años, responde con interés el 3 de marzo."] };
  const v2 = verificarSinInventar(entrada, conEdad);
  esperar(!v2.ok, "una edad inventada NO pasa", "la ha dejado pasar");
  esperar(v2.motivos.some((m) => m.includes("8")), "y dice cuál era el número", v2.motivos.join("; "));

  const conMes = { evolution: ["El 12 de mayo mantiene la tarea 15 minutos."] };
  const v3 = verificarSinInventar(entrada, conMes);
  esperar(!v3.ok, "una fecha inventada NO pasa", "la ha dejado pasar");
  esperar(v3.motivos.some((m) => m.includes("mayo")), "y dice qué mes era", v3.motivos.join("; "));

  const porcentaje = { recommendations: ["Mantener la rutina, con una mejora del 30 % esperable."] };
  const v4 = verificarSinInventar(entrada, porcentaje);
  esperar(!v4.ok, "un porcentaje inventado NO pasa", "lo ha dejado pasar");

  // Los números que SÍ estaban tienen que poder repetirse: si no, la única
  // redacción válida sería una que borrase las fechas.
  const mismos = { evolution: ["El 2 de abril mantiene la tarea 15 minutos."] };
  esperar(verificarSinInventar(entrada, mismos).ok, "repetir un número que ya estaba sí pasa");

  // "mayor" lleva dentro "mayo" (04/09/2026): buscar el mes por `includes`
  // descartaba el informe entero por una fecha que nadie había escrito, y
  // "mayor" sale en cualquier redacción clínica.
  const conMayor = {
    evolution: ["El 3 de marzo responde con mayor interés y sostiene la tarea con mayor autonomía."],
  };
  const v5 = verificarSinInventar(entrada, conMayor);
  esperar(v5.ok, "«mayor» no es el mes de mayo", v5.motivos.join("; "));
}

// ── 3. Lo que se pierde se avisa ───────────────────────────────────────────
paso("Si la propuesta encoge de más, se avisa");
{
  const entrada = loQueHayQuePulir(VOLCADO);
  const recortada = { evolution: ["Evoluciona bien."] };
  const avisos = avisosDePerdida(entrada, recortada);
  esperar(avisos.some((a) => a.includes("Evolución")), "un apartado que encoge a la mitad se señala", avisos.join(" | "));

  const vacia = { recommendations: [] };
  esperar(
    avisosDePerdida(entrada, vacia).some((a) => a.includes("Recomendaciones")),
    "y uno que se queda vacío, también"
  );

  // Una propuesta ENTERA que no encoge no debe generar ni un aviso: si avisara
  // siempre, el aviso dejaría de leerse. (Se pasa completa a propósito: dejar
  // fuera un apartado que sí tenía contenido ES una pérdida, y por eso el caso
  // de arriba avisa.)
  const entera = {
    objectives: ["Atención sostenida en tareas escolares", "Regulación emocional"],
    evolution: VOLCADO.evolution,
    persistentDifficulties: VOLCADO.persistentDifficulties,
    recommendations: VOLCADO.recommendations,
  };
  esperar(avisosDePerdida(entrada, entera).length === 0, "lo que no encoge no molesta con avisos", avisosDePerdida(entrada, entera).join(" | "));
}

// ── 4. La demo ─────────────────────────────────────────────────────────────
paso("El modo simulado de la demo no hace trampas");
{
  const { propuesta, avisos } = fakePulirInforme({ contentSections: VOLCADO });
  esperar(Object.keys(propuesta).length > 0, "devuelve algo");
  const v = verificarSinInventar(loQueHayQuePulir(VOLCADO), propuesta);
  esperar(v.ok, "y pasa la MISMA verificación que la de verdad", v.motivos.join("; "));
  esperar(
    (propuesta.evolution ?? []).length < VOLCADO.evolution.length,
    "junta líneas, que es lo que se ve al redactar un volcado",
    `${(propuesta.evolution ?? []).length} de ${VOLCADO.evolution.length}`
  );
  esperar(!("motiveOfIntervention" in propuesta), "y tampoco toca lo que escribió la profesional");
  void avisos;
}

// ── 4 bis. Los apartados que se elaboran del conjunto ──────────────────────
paso("Los apartados de síntesis solo se proponen si están vacíos");
{
  // En VOLCADO: los logros están vacíos; las recomendaciones y la continuidad,
  // escritas. Solo se pide lo primero.
  const proponer = loQueSePuedeProponer(VOLCADO);
  esperar(proponer.includes("achievements"), "los logros vacíos sí se proponen", proponer.join(", "));
  esperar(
    !proponer.includes("recommendations") && !proponer.includes("continuityProposal"),
    "lo que ya escribió la profesional NO se propone",
    proponer.join(", ")
  );
  esperar(
    proponer.every((k) => SECCIONES_SINTESIS.includes(k)),
    "y no se cuela ningún apartado que no sea de síntesis"
  );

  // Un informe recién volcado: la continuidad viene en blanco siempre.
  const recienVolcado = { ...VOLCADO, continuityProposal: "", achievements: [] };
  esperar(
    loQueSePuedeProponer(recienVolcado).includes("continuityProposal"),
    "en un informe recién volcado, la continuidad entra en la propuesta"
  );

  // El motivo de intervención no es de síntesis: de las sesiones no se deduce.
  esperar(
    !loQueSePuedeProponer({ ...VOLCADO, motiveOfIntervention: "" }).includes("motiveOfIntervention"),
    "el motivo de intervención no se propone nunca, ni vacío"
  );
}

paso("Un apartado de síntesis se verifica contra el informe entero");
{
  const entrada = loQueHayQuePulir(VOLCADO);

  // Se elabora leyendo la evolución: puede citar una fecha que está allí.
  const conFechaDeOtroApartado = {
    achievements: ["El 2 de abril sostiene la tarea sin el apoyo visual, lo que sugiere mayor autorregulación."],
  };
  const v1 = verificarSinInventar(entrada, conFechaDeOtroApartado);
  esperar(v1.ok, "una síntesis que cita un dato de otro apartado pasa", v1.motivos.join("; "));

  // Pero inventarse una cifra sigue sin pasar, también aquí.
  const conCifraNueva = { achievements: ["Ha mejorado un 40 % en atención sostenida."] };
  esperar(!verificarSinInventar(entrada, conCifraNueva).ok, "una cifra inventada en la síntesis NO pasa");

  const continuidadInventada = { continuityProposal: ["Se propone continuar 6 meses más."] };
  esperar(
    !verificarSinInventar(entrada, continuidadInventada).ok,
    "ni una duración que nadie escribió en las sesiones"
  );
}

paso("La demo enseña que la IA completa lo vacío");
{
  const recienVolcado = { ...VOLCADO, achievements: [] };
  const { propuesta } = fakePulirInforme({ contentSections: recienVolcado });
  esperar((propuesta.achievements ?? []).length > 0, "el modo simulado propone los logros que faltaban");
  const v = verificarSinInventar(loQueHayQuePulir(recienVolcado), propuesta);
  esperar(v.ok, "y su propuesta pasa la verificación de siempre", v.motivos.join("; "));
}

// ── 5. Sin nada volcado ────────────────────────────────────────────────────
paso("Sin volcado no hay nada que redactar");
{
  const vacio = loQueHayQuePulir({ motiveOfIntervention: "algo escrito a mano" });
  esperar(Object.keys(vacio).length === 0, "un informe sin volcar no manda nada al modelo");
}

process.stdout.write(fallos === 0 ? "\n✅ Todo en orden\n\n" : `\n❌ ${fallos} fallo(s)\n\n`);
process.exit(fallos === 0 ? 0 : 1);

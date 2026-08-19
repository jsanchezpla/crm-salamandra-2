// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-nutricion-macros.mjs — los macros de una pauta suman lo que dicen (19/08/2026).
 *
 *   node scripts/_smoke-nutricion-macros.mjs
 *   node --test-name-pattern="scaleMacros" scripts/_smoke-nutricion-macros.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/nutricion/macros.js` calcula las proteínas, hidratos, grasas y fibra
 * de una pauta de Nutrición: lo que ve Laura (nutri_laura, la reina del
 * módulo) en el editor del menú, y lo que se imprime en el PDF que se manda a
 * la paciente cuando la pauta lleva «mostrar macros» (`lib/nutricion/menuPdf.js`).
 * Una suma mal hecha ahí no es un número feo en pantalla: es una dieta mal
 * calculada que sale por correo con el membrete de la consulta.
 *
 * Ya se rompió una vez en silencio: en el sprint C2 la rama de medidas
 * caseras ignoraba la cantidad (2 cucharadas de aceite contaban como 1) y
 * nadie lo vio hasta que el editor dejó escribir cantidades distintas de 1
 * (C3). Las únicas pruebas del helper vivían en la PARTE A de
 * `_smoke-nutri-laura-recetario-c3.mjs`, que pide base de datos y servidor y
 * por eso NO entra en `npm test`: el Mapa de `docs/modules/nutricion.md`
 * decía, con razón, «ningún _smoke ligero toca lib/nutricion/». Esta prueba
 * cierra ese hueco: corre sin nada encendido, antes de cada push.
 *
 * ── QUÉ FIJA ───────────────────────────────────────────────────────────────
 *
 * Lo que DEVUELVE cada función, con números que se comprueban a mano (100 g
 * de un alimento con 20 g de proteína por 100 g son 20 g; 50 g, 10 g); las
 * reglas escritas en los comentarios del helper (por 100 g; medida casera =
 * nº de medidas × gramos de UNA medida; texto libre = desconocido; un macro
 * desconocido se ignora en la suma y solo queda null si nadie lo aporta; 0 en
 * el catálogo es 0, no desconocido); que cada nivel suma exactamente lo que
 * devuelve el de abajo (opción = líneas sueltas + recetas × raciones; comida =
 * SU opción por defecto, no la suma de todas; plan = sus comidas); que las
 * cantidades que llegan de la base como texto («150.00») valen igual que un
 * número; y que nada toca lo que le dan.
 *
 * Sin kcal: el helper no las calcula a propósito (solo P / H / G / fibra).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeFoodMacros,
  computeRecipeMacros,
  scaleMacros,
  computeOptionMacros,
  computeMealMacros,
  computePlanMacros,
} from "../lib/nutricion/macros.js";

// ── Un catálogo pequeño con números redondos ────────────────────────────────
// La forma es la del catálogo `foods` (proteinPer100… por 100 g). Los valores
// no pretenden ser los de la tabla de composición: están elegidos para que la
// cuenta se haga de cabeza.

const AVENA = {
  id: "f-avena",
  name: "Copos de avena",
  proteinPer100: 10,
  carbsPer100: 60,
  fatPer100: 5,
  fiberPer100: 10,
};
const POLLO = {
  id: "f-pollo",
  name: "Pechuga de pollo",
  proteinPer100: 20,
  carbsPer100: 0,
  fatPer100: 5,
  fiberPer100: 0,
};
const ARROZ = {
  id: "f-arroz",
  name: "Arroz",
  proteinPer100: 8,
  carbsPer100: 80,
  fatPer100: 1,
  fiberPer100: 2,
};
const MERLUZA = {
  id: "f-merluza",
  name: "Merluza",
  proteinPer100: 15,
  carbsPer100: 0,
  fatPer100: 2,
  fiberPer100: 0,
};
const ACEITE = {
  id: "f-aceite",
  name: "Aceite de oliva",
  proteinPer100: 0,
  carbsPer100: 0,
  fatPer100: 100,
  fiberPer100: 0,
};
/** Alimento dado de alta sin composición: todo desconocido. */
const ESPECIAS = {
  id: "f-especias",
  name: "Especias",
  proteinPer100: null,
  carbsPer100: null,
  fatPer100: null,
  fiberPer100: null,
};
/** Solo se conoce una parte de la composición. */
const QUESO_A_MEDIAS = {
  id: "f-queso",
  name: "Queso (sin fibra en la ficha)",
  proteinPer100: 25,
  carbsPer100: 2,
  fatPer100: 30,
  fiberPer100: null,
};

const NADA = { protein: null, carbs: null, fat: null, fiber: null };

/** Una línea de alimento en gramos, como la que cuelga de una opción o de una receta. */
function gramos(food, amount, extra = {}) {
  return {
    id: `l-${food.id}-${amount}`,
    unit: "g",
    amount,
    householdLabel: null,
    householdGrams: null,
    notes: null,
    order: 0,
    food,
    ...extra,
  };
}
/** Una línea en medida casera: `amount` medidas de `householdGrams` gramos cada una. */
function casera(food, amount, householdGrams, label = "cucharada") {
  return {
    id: `l-${food.id}-${label}`,
    unit: "household",
    amount,
    householdLabel: label,
    householdGrams,
    notes: null,
    order: 0,
    food,
  };
}
/** Una línea de texto libre («ensalada al gusto»): no se calcula. */
function libre(texto, food = null) {
  return {
    id: `l-libre`,
    unit: "free",
    amount: null,
    householdLabel: null,
    householdGrams: null,
    notes: texto,
    order: 0,
    food,
  };
}

/** Congela en profundidad: si la función escribe en lo que le dan, revienta. */
function congelar(x) {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) congelar(v);
  }
  return x;
}

// ── Un plan como el de una paciente de Laura ────────────────────────────────
//
//   Desayuno  · una opción:            avena 50 g                → 5 / 30 / 2,5 / 5
//   Comida    · A (por defecto):       pollo 100 g + arroz 50 g
//                                      + 2 cucharadas de aceite  → 24 / 40 / 25,5 / 1
//             · B (alternativa):       merluza 200 g             → 30 / 0 / 4 / 0  (NO cuenta)
//   Cena      · una opción con receta: «Merluza con ensalada»
//               (merluza 100 g + ensalada libre) × 1,5 raciones  → 22,5 / 0 / 3 / 0
//   ────────────────────────────────────────────────────────────────────────
//   Plan                                                        → 51,5 / 70 / 31 / 6

function recetaMerluza(servings = 1.5) {
  return {
    id: "pmor-1",
    nameSnapshot: "Merluza con ensalada",
    servings,
    ordering: 0,
    ingredients: [gramos(MERLUZA, 100), libre("Ensalada al gusto")],
  };
}

function opcionComidaA() {
  return {
    id: "o-a",
    isDefault: true,
    order: 0,
    foods: [gramos(POLLO, 100), gramos(ARROZ, 50), casera(ACEITE, 2, 10)],
    recipes: [],
  };
}
function opcionComidaB() {
  return { id: "o-b", isDefault: false, order: 1, foods: [gramos(MERLUZA, 200)], recipes: [] };
}

function planDeLaura() {
  return {
    id: "p-1",
    name: "Semana 1",
    meals: [
      {
        id: "m-des",
        name: "Desayuno",
        order: 0,
        options: [
          { id: "o-des", isDefault: true, order: 0, foods: [gramos(AVENA, 50)], recipes: [] },
        ],
      },
      { id: "m-com", name: "Comida", order: 1, options: [opcionComidaA(), opcionComidaB()] },
      {
        id: "m-cen",
        name: "Cena",
        order: 2,
        options: [
          { id: "o-cen", isDefault: true, order: 0, foods: [], recipes: [recetaMerluza(1.5)] },
        ],
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe("computeFoodMacros: lo que aporta UNA línea de alimento, en gramos absolutos", () => {
  it("100 g de un alimento con 20 g de proteína por 100 g aportan 20 g; 50 g, 10 g (y así los cuatro macros)", () => {
    assert.deepEqual(computeFoodMacros(gramos(POLLO, 100)), {
      protein: 20,
      carbs: 0,
      fat: 5,
      fiber: 0,
    });
    assert.deepEqual(computeFoodMacros(gramos(POLLO, 50)), {
      protein: 10,
      carbs: 0,
      fat: 2.5,
      fiber: 0,
    });
    assert.deepEqual(computeFoodMacros(gramos(ARROZ, 50)), {
      protein: 4,
      carbs: 40,
      fat: 0.5,
      fiber: 1,
    });
  });

  it("la cantidad y la composición que la base guarda como texto («150.00», «20.50») valen igual que un número", () => {
    const linea = gramos(
      {
        ...POLLO,
        proteinPer100: "20.50",
        carbsPer100: "0.00",
        fatPer100: "5.00",
        fiberPer100: "1.10",
      },
      "150.00"
    );
    assert.deepEqual(computeFoodMacros(linea), { protein: 30.75, carbs: 0, fat: 7.5, fiber: 1.65 });
  });

  it("redondea cada macro a dos decimales (33,33 g × 10/100 = 3,333 → 3,33)", () => {
    assert.equal(computeFoodMacros(gramos(AVENA, 33.33)).protein, 3.33);
    assert.equal(computeFoodMacros(gramos(AVENA, 66.67)).protein, 6.67);
  });

  it("medida casera = nº de medidas × gramos de UNA medida: 2 cucharadas de 10 g de aceite son 20 g de grasa (en C2 contaban como 1)", () => {
    assert.deepEqual(computeFoodMacros(casera(ACEITE, 2, 10)), {
      protein: 0,
      carbs: 0,
      fat: 20,
      fiber: 0,
    });
    assert.equal(computeFoodMacros(casera(ACEITE, 1, 10)).fat, 10);
    assert.equal(computeFoodMacros(casera(ACEITE, 0.5, 10)).fat, 5);
  });

  it("la medida casera vale aunque llegue como texto («2.00» cucharadas de «10.00» g)", () => {
    assert.equal(computeFoodMacros(casera(ACEITE, "2.00", "10.00")).fat, 20);
  });

  it("medida casera sin nº de medidas o sin gramos por medida: no se inventa nada, todo desconocido", () => {
    assert.deepEqual(computeFoodMacros(casera(ACEITE, null, 10)), NADA);
    assert.deepEqual(computeFoodMacros(casera(ACEITE, 2, null)), NADA);
    assert.deepEqual(computeFoodMacros(casera(ACEITE, 2, 0)), NADA);
  });

  it("texto libre («ensalada al gusto») no se calcula: todo null aunque el alimento tenga composición", () => {
    assert.deepEqual(computeFoodMacros(libre("Ensalada al gusto", POLLO)), NADA);
    assert.deepEqual(computeFoodMacros({ unit: "free", amount: 100, food: POLLO }), NADA);
  });

  it("sin el alimento cargado (falta `food`), la línea no revienta: todo desconocido", () => {
    assert.deepEqual(computeFoodMacros({ unit: "g", amount: 100 }), NADA);
    assert.deepEqual(computeFoodMacros({ unit: "g", amount: 100, food: null }), NADA);
  });

  it("una cantidad que no es positiva (0, negativa, vacía, nula, texto) deja la línea sin macros: null, no 0", () => {
    for (const amount of [0, -5, "", null, undefined, "abc"]) {
      assert.deepEqual(
        computeFoodMacros(gramos(POLLO, amount)),
        NADA,
        `amount=${JSON.stringify(amount)}`
      );
    }
  });

  it("un macro que el catálogo no tiene es null (desconocido); los que tiene, número; y 0 en el catálogo es 0, no desconocido", () => {
    assert.deepEqual(computeFoodMacros(gramos(ESPECIAS, 5)), NADA);
    assert.deepEqual(computeFoodMacros(gramos(QUESO_A_MEDIAS, 100)), {
      protein: 25,
      carbs: 2,
      fat: 30,
      fiber: null,
    });
    assert.deepEqual(computeFoodMacros(gramos(ACEITE, 10)), {
      protein: 0,
      carbs: 0,
      fat: 10,
      fiber: 0,
    });
  });

  it("una unidad que no conoce («ml», ninguna) no calcula nada", () => {
    assert.deepEqual(computeFoodMacros({ unit: "ml", amount: 100, food: POLLO }), NADA);
    assert.deepEqual(computeFoodMacros({ amount: 100, food: POLLO }), NADA);
  });

  it("con null o undefined en vez de línea, todo desconocido (no revienta)", () => {
    assert.deepEqual(computeFoodMacros(null), NADA);
    assert.deepEqual(computeFoodMacros(undefined), NADA);
  });

  it("no toca la línea ni el alimento que le dan", () => {
    const linea = congelar(gramos(POLLO, 100));
    computeFoodMacros(linea);
    assert.deepEqual(linea, gramos(POLLO, 100));
    computeFoodMacros(congelar(casera(ACEITE, 2, 10)));
  });
});

describe("computeRecipeMacros: una receta suma sus ingredientes", () => {
  it("pollo 100 g + arroz 50 g = 24 / 40 / 5,5 / 1", () => {
    assert.deepEqual(
      computeRecipeMacros({ ingredients: [gramos(POLLO, 100), gramos(ARROZ, 50)] }),
      {
        protein: 24,
        carbs: 40,
        fat: 5.5,
        fiber: 1,
      }
    );
  });

  it("un ingrediente en texto libre o sin composición no anula la suma de los demás", () => {
    const receta = {
      ingredients: [gramos(POLLO, 100), libre("Ensalada al gusto"), gramos(ESPECIAS, 5)],
    };
    assert.deepEqual(computeRecipeMacros(receta), { protein: 20, carbs: 0, fat: 5, fiber: 0 });
  });

  it("un macro que solo conocen algunos ingredientes suma los que lo conocen; el que no conoce NADIE queda null, no 0", () => {
    const receta = { ingredients: [gramos(QUESO_A_MEDIAS, 100), gramos(ESPECIAS, 5)] };
    assert.deepEqual(computeRecipeMacros(receta), { protein: 25, carbs: 2, fat: 30, fiber: null });
    assert.deepEqual(
      computeRecipeMacros({ ingredients: [libre("Fruta"), gramos(ESPECIAS, 5)] }),
      NADA
    );
  });

  it("0 de un ingrediente es 0 y se suma; null es desconocido y se ignora (aceite + especias: fibra 0, no null)", () => {
    assert.equal(
      computeRecipeMacros({ ingredients: [gramos(ACEITE, 10), gramos(ESPECIAS, 5)] }).fiber,
      0
    );
  });

  it("acepta los ingredientes bajo `ingredients` (receta del recetario) o `foods` (el mismo shape de línea)", () => {
    const lineas = [gramos(POLLO, 100)];
    assert.deepEqual(
      computeRecipeMacros({ ingredients: lineas }),
      computeRecipeMacros({ foods: lineas })
    );
  });

  it("sin receta, sin ingredientes o con la lista vacía: todo desconocido", () => {
    assert.deepEqual(computeRecipeMacros(null), NADA);
    assert.deepEqual(computeRecipeMacros({}), NADA);
    assert.deepEqual(computeRecipeMacros({ ingredients: [] }), NADA);
  });

  it("no toca la receta ni sus ingredientes", () => {
    const receta = congelar(recetaMerluza());
    computeRecipeMacros(receta);
    assert.deepEqual(receta, recetaMerluza());
  });
});

describe("scaleMacros: las raciones multiplican cada macro en proporción", () => {
  const UNA_RACION = { protein: 10, carbs: null, fat: 2.5, fiber: 0 };

  it("× 2 dobla, × 0,5 parte por la mitad, × 1,5 una y media", () => {
    assert.deepEqual(scaleMacros(UNA_RACION, 2), { protein: 20, carbs: null, fat: 5, fiber: 0 });
    assert.deepEqual(scaleMacros(UNA_RACION, 0.5), {
      protein: 5,
      carbs: null,
      fat: 1.25,
      fiber: 0,
    });
    assert.deepEqual(scaleMacros(UNA_RACION, 1.5), {
      protein: 15,
      carbs: null,
      fat: 3.75,
      fiber: 0,
    });
  });

  it("las raciones de la base llegan como texto («2.00», «0.50») y valen igual", () => {
    assert.equal(scaleMacros(UNA_RACION, "2.00").protein, 20);
    assert.equal(scaleMacros(UNA_RACION, "0.50").protein, 5);
  });

  it("un macro desconocido (null) sigue desconocido al escalar: no se convierte en 0; y 0 sigue 0", () => {
    const escalado = scaleMacros(UNA_RACION, 3);
    assert.equal(escalado.carbs, null);
    assert.equal(escalado.fiber, 0);
  });

  it("0 raciones → 0 g de lo conocido (y null lo desconocido)", () => {
    assert.deepEqual(scaleMacros(UNA_RACION, 0), { protein: 0, carbs: null, fat: 0, fiber: 0 });
  });

  it("raciones ausentes (null/undefined) o negativas no escalan: se quedan las macros de UNA ración", () => {
    for (const servings of [null, undefined, -1, "abc"]) {
      assert.deepEqual(
        scaleMacros(UNA_RACION, servings),
        UNA_RACION,
        `servings=${JSON.stringify(servings)}`
      );
    }
  });

  it("redondea a dos decimales (1,25 g × 0,75 raciones = 0,9375 → 0,94)", () => {
    assert.equal(
      scaleMacros({ protein: 1.25, carbs: null, fat: null, fiber: null }, 0.75).protein,
      0.94
    );
    assert.equal(
      scaleMacros({ protein: 3.33, carbs: null, fat: null, fiber: null }, 3).protein,
      9.99
    );
  });

  it("devuelve siempre las cuatro claves, aunque a la entrada le falte alguna (la que falta, desconocida)", () => {
    assert.deepEqual(scaleMacros({ protein: 1 }, 2), {
      protein: 2,
      carbs: null,
      fat: null,
      fiber: null,
    });
  });

  it("no toca las macros que le dan", () => {
    const entrada = congelar({ ...UNA_RACION });
    const salida = scaleMacros(entrada, 2);
    assert.deepEqual(entrada, UNA_RACION);
    assert.notEqual(salida, entrada);
  });
});

describe("computeOptionMacros: una opción de comida = líneas sueltas + recetas × raciones", () => {
  it("solo líneas sueltas: su suma (pollo 100 g + arroz 50 g + 2 cucharadas de aceite = 24 / 40 / 25,5 / 1)", () => {
    assert.deepEqual(computeOptionMacros(opcionComidaA()), {
      protein: 24,
      carbs: 40,
      fat: 25.5,
      fiber: 1,
    });
  });

  it("solo recetas: macros de sus ingredientes × raciones (merluza 100 g × 1,5 raciones = 22,5 g de proteína)", () => {
    const opcion = { id: "o", foods: [], recipes: [recetaMerluza(1.5)] };
    assert.deepEqual(computeOptionMacros(opcion), { protein: 22.5, carbs: 0, fat: 3, fiber: 0 });
    assert.equal(computeOptionMacros({ recipes: [recetaMerluza(2)] }).protein, 30);
  });

  it("líneas sueltas y recetas conviven en la misma opción: se suman las dos fuentes", () => {
    const opcion = { ...opcionComidaA(), recipes: [recetaMerluza(1)] };
    // 24 / 40 / 25,5 / 1  +  15 / 0 / 2 / 0
    assert.deepEqual(computeOptionMacros(opcion), { protein: 39, carbs: 40, fat: 27.5, fiber: 1 });
  });

  it("es exactamente la suma de lo que devuelven los niveles de abajo (líneas + scaleMacros(computeRecipeMacros))", () => {
    const opcion = { ...opcionComidaA(), recipes: [recetaMerluza(1.5)] };
    const sueltas = computeRecipeMacros({ ingredients: opcion.foods });
    const receta = scaleMacros(computeRecipeMacros(opcion.recipes[0]), opcion.recipes[0].servings);
    assert.deepEqual(computeOptionMacros(opcion), {
      protein: sueltas.protein + receta.protein,
      carbs: sueltas.carbs + receta.carbs,
      fat: sueltas.fat + receta.fat,
      fiber: sueltas.fiber + receta.fiber,
    });
  });

  it("una receta sin raciones informadas cuenta como UNA ración", () => {
    assert.deepEqual(
      computeOptionMacros({ recipes: [recetaMerluza(null)] }),
      computeOptionMacros({ recipes: [recetaMerluza(1)] })
    );
  });

  it("la receta congelada del menú trae los ingredientes como `ingredients`; también los entiende como `foods`", () => {
    const { ingredients, ...resto } = recetaMerluza(2);
    assert.deepEqual(
      computeOptionMacros({ recipes: [{ ...resto, foods: ingredients }] }),
      computeOptionMacros({ recipes: [recetaMerluza(2)] })
    );
  });

  it("si NINGUNA fuente conoce un macro, ese macro es null; si alguna lo conoce, se suma ignorando las que no", () => {
    const opcion = {
      foods: [gramos(QUESO_A_MEDIAS, 100)],
      recipes: [{ servings: 1, ingredients: [libre("Fruta")] }],
    };
    assert.deepEqual(computeOptionMacros(opcion), { protein: 25, carbs: 2, fat: 30, fiber: null });
  });

  it("opción vacía (sin foods ni recipes, listas vacías, receta sin ingredientes) o null: todo desconocido", () => {
    assert.deepEqual(computeOptionMacros({}), NADA);
    assert.deepEqual(computeOptionMacros({ foods: [], recipes: [] }), NADA);
    assert.deepEqual(computeOptionMacros({ recipes: [{ servings: 2 }] }), NADA);
    assert.deepEqual(computeOptionMacros(null), NADA);
  });

  it("no toca la opción, sus líneas ni sus recetas", () => {
    const opcion = congelar({ ...opcionComidaA(), recipes: [recetaMerluza(1.5)] });
    computeOptionMacros(opcion);
    assert.deepEqual(opcion, { ...opcionComidaA(), recipes: [recetaMerluza(1.5)] });
  });
});

describe("computeMealMacros: una comida vale lo que SU opción por defecto", () => {
  it("con varias opciones cuenta SOLO la marcada por defecto: ni la suma de todas ni la primera del array", () => {
    const comida = { options: [opcionComidaB(), opcionComidaA()] }; // B primero en el array, A es la default
    assert.deepEqual(computeMealMacros(comida), { protein: 24, carbs: 40, fat: 25.5, fiber: 1 });
  });

  it("coincide con computeOptionMacros de la opción elegida", () => {
    const comida = planDeLaura().meals[1];
    assert.deepEqual(computeMealMacros(comida), computeOptionMacros(opcionComidaA()));
  });

  it("sin ninguna por defecto, la de menor `order` (no la primera del array)", () => {
    const segunda = { ...opcionComidaA(), isDefault: false, order: 1 };
    const primera = { ...opcionComidaB(), isDefault: false, order: 0 };
    assert.deepEqual(
      computeMealMacros({ options: [segunda, primera] }),
      computeOptionMacros(primera)
    );
  });

  it("si dos vienen marcadas por defecto (dato sucio), gana la de menor `order`", () => {
    const a = { ...opcionComidaA(), isDefault: true, order: 2 };
    const b = { ...opcionComidaB(), isDefault: true, order: 1 };
    assert.deepEqual(computeMealMacros({ options: [a, b] }), computeOptionMacros(b));
  });

  it("sin `order` ni defecto en ninguna, se queda con la primera del array", () => {
    const a = { ...opcionComidaA(), isDefault: false, order: undefined };
    const b = { ...opcionComidaB(), isDefault: false, order: undefined };
    assert.deepEqual(computeMealMacros({ options: [a, b] }), computeOptionMacros(a));
  });

  it("una comida sin opciones, sin nada, o null: todo desconocido", () => {
    assert.deepEqual(computeMealMacros({ options: [] }), NADA);
    assert.deepEqual(computeMealMacros({}), NADA);
    assert.deepEqual(computeMealMacros(null), NADA);
  });

  it("no reordena ni toca las opciones de la comida que le dan", () => {
    const comida = congelar({ options: [opcionComidaB(), opcionComidaA()] });
    computeMealMacros(comida);
    assert.deepEqual(
      comida.options.map((o) => o.id),
      ["o-b", "o-a"]
    );
    assert.deepEqual(comida, { options: [opcionComidaB(), opcionComidaA()] });
  });
});

describe("computePlanMacros: el plan suma sus comidas, cada una por su opción por defecto", () => {
  it("desayuno + comida (A) + cena = 51,5 / 70 / 31 / 6; la alternativa B de la comida no cuenta", () => {
    assert.deepEqual(computePlanMacros(planDeLaura()), {
      protein: 51.5,
      carbs: 70,
      fat: 31,
      fiber: 6,
    });
  });

  it("es exactamente la suma de computeMealMacros de cada comida", () => {
    const plan = planDeLaura();
    const comidas = plan.meals.map(computeMealMacros);
    const suma = (k) => comidas.reduce((acc, m) => acc + m[k], 0);
    assert.deepEqual(computePlanMacros(plan), {
      protein: suma("protein"),
      carbs: suma("carbs"),
      fat: suma("fat"),
      fiber: suma("fiber"),
    });
  });

  it("una comida sin opciones (o con todo desconocido) no resta ni anula: se ignora", () => {
    const plan = planDeLaura();
    plan.meals.push({ id: "m-vacia", name: "Media mañana", order: 3, options: [] });
    plan.meals.push({
      id: "m-libre",
      name: "Merienda",
      order: 4,
      options: [{ isDefault: true, order: 0, foods: [libre("Fruta")] }],
    });
    assert.deepEqual(computePlanMacros(plan), { protein: 51.5, carbs: 70, fat: 31, fiber: 6 });
  });

  it("si NINGUNA comida conoce un macro, ese macro es null; si una sí, vale lo suyo", () => {
    const plan = {
      meals: [
        { options: [{ isDefault: true, foods: [gramos(QUESO_A_MEDIAS, 100)] }] },
        { options: [{ isDefault: true, foods: [gramos(ESPECIAS, 5)] }] },
      ],
    };
    assert.deepEqual(computePlanMacros(plan), { protein: 25, carbs: 2, fat: 30, fiber: null });
  });

  it("la suma sale redondeada a dos decimales: 0,1 g + 0,2 g son 0,3, no 0,30000000000000004", () => {
    const plan = {
      meals: [
        { options: [{ isDefault: true, foods: [gramos(AVENA, 1)] }] }, // 0,1 g de proteína
        { options: [{ isDefault: true, foods: [gramos(AVENA, 2)] }] }, // 0,2 g
      ],
    };
    assert.equal(computePlanMacros(plan).protein, 0.3);
  });

  it("plan vacío, sin comidas o null: todo desconocido", () => {
    assert.deepEqual(computePlanMacros({ meals: [] }), NADA);
    assert.deepEqual(computePlanMacros({}), NADA);
    assert.deepEqual(computePlanMacros(null), NADA);
  });

  it("no toca el plan: ni comidas, ni opciones, ni líneas, ni recetas", () => {
    const plan = congelar(planDeLaura());
    computePlanMacros(plan);
    assert.deepEqual(plan, planDeLaura());
  });
});

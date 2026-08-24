// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-leads-stages-embudos.mjs — qué DEVUELVEN las etapas y los embudos de
 * Leads (20/08/2026).
 *
 *   node scripts/_smoke-leads-stages-embudos.mjs
 *   node --test-name-pattern="aumenta" scripts/_smoke-leads-stages-embudos.mjs
 *
 * Prueba `lib/leads/stages.js` (la lista canónica, sus rótulos, `isValidStage`)
 * y `lib/leads/embudos.js` (`GANADAS`/`PERDIDAS`, `etapasDe`,
 * `tieneEtapaGanada`, `EMBUDO_POR_DEFECTO`).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `_smoke-leads-etapas.mjs` (17/08/2026) vigila que las pantallas y /lib no se
 * desvíen ENTRE SÍ leyendo los componentes como texto; lo que nadie fijaba es
 * lo que estas funciones DEVUELVEN, que es lo que consumen el PATCH de leads
 * (422 si `isValidStage` dice que no), el Excel del export (`STAGE_LABELS`),
 * la página de Leads (`etapasDe` decide la botonera que se pinta) y
 * /leads/estadisticas (`tieneEtapaGanada` decide si se enseña «Convertidos»).
 * Tres cosas reales detrás, todas contadas en los comentarios de embudos.js:
 *
 *   · aumenta NO tiene etapa de ganado: su «Convertidos» es un 0 que no puede
 *     subir, y por eso la pantalla se lo tapa. Si alguien le «arregla» el
 *     embudo añadiendo `won` sin que lo pidan, cambia un DATO de la reina de
 *     los overrides — esta prueba lo dice en rojo.
 *   · un slug con guión («nutri-laura», la carpeta) en vez de guión bajo
 *     («nutri_laura», la BD) no da error: cae EN SILENCIO al embudo por
 *     defecto y el cliente ve la botonera de otro. Aquí queda fijado que eso
 *     es lo que pasa hoy, para que quien lo sufra lo encuentre con nombre.
 *   · el embudo por defecto son CINCO etapas, no las quince de
 *     `ALLOWED_STAGES` (decisión del 18/08/2026): quince tarjetas serían un
 *     despropósito y ofrecerían «Consulta agendada» en una consultora.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ALLOWED_STAGES, STAGE_LABELS, isValidStage } from "../lib/leads/stages.js";
import {
  GANADAS,
  PERDIDAS,
  EMBUDO_POR_DEFECTO,
  etapasDe,
  tieneEtapaGanada,
} from "../lib/leads/embudos.js";

/** Los cuatro clientes con embudo propio a 18/08/2026 (claves de BD, guión bajo). */
const SLUGS_CON_EMBUDO_PROPIO = ["aumenta", "nutri_laura", "retorika", "spain_enzymes"];

/** Las cinco estándar que ve un cliente sin configuración propia. */
const CINCO_POR_DEFECTO = ["new", "contacted", "qualified", "won", "lost"];

describe("la lista canónica: quince etapas, cada una con su rótulo", () => {
  it("son veinte y en este orden: siete estándar, cinco del import, tres de nutrición y cinco de booking", () => {
    assert.deepEqual(ALLOWED_STAGES, [
      "new",
      "contacted",
      "qualified",
      "proposal",
      "negotiation",
      "won",
      "lost",
      "in_progress",
      "demo_scheduled",
      "demo_done",
      "closed_yes",
      "closed_no",
      "consulta_agendada",
      "consulta_realizada",
      "paciente",
      "propuesta_enviada",
      "respuesta_recibida",
      "negociando_cache",
      "fecha_confirmada",
      "actuacion_realizada",
    ]);
  });

  it("sin repetidas: cada clave aparece una sola vez", () => {
    assert.equal(new Set(ALLOWED_STAGES).size, ALLOWED_STAGES.length);
  });

  it("cada etapa permitida tiene rótulo y ningún rótulo sobra (si no, la clave sale en crudo en el Excel)", () => {
    assert.deepEqual(Object.keys(STAGE_LABELS).sort(), [...ALLOWED_STAGES].sort());
  });

  it("los rótulos son exactamente los que ve el cliente en el Excel", () => {
    assert.deepEqual(STAGE_LABELS, {
      new: "Nuevo",
      contacted: "Contactado",
      qualified: "En seguimiento",
      proposal: "Propuesta",
      negotiation: "Negociación",
      won: "Convertido",
      lost: "Descartado",
      in_progress: "En proceso",
      demo_scheduled: "Demo agendada",
      demo_done: "Demo realizada",
      closed_yes: "Cerrado - Sí",
      closed_no: "Cerrado - No",
      consulta_agendada: "Consulta agendada",
      consulta_realizada: "Consulta realizada",
      paciente: "Paciente activo",
      propuesta_enviada: "Propuesta enviada",
      respuesta_recibida: "Han respondido",
      negociando_cache: "Negociando caché",
      fecha_confirmada: "Fecha cerrada",
      actuacion_realizada: "Actuación realizada",
    });
  });
});

describe("isValidStage: la puerta que decide si el PATCH guarda o responde 422", () => {
  it("acepta las veinte permitidas, una a una", () => {
    for (const etapa of ALLOWED_STAGES) {
      assert.equal(isValidStage(etapa), true, `rechaza «${etapa}», que está en la lista`);
    }
  });

  it("rechaza una etapa inventada: Lead.stage es STRING(50) sin ENUM y esta lista es la única defensa", () => {
    assert.equal(isValidStage("cerrado_vendido"), false);
    assert.equal(isValidStage("stage_que_no_existe"), false);
  });

  it("distingue mayúsculas: «New» o «WON» no son etapas", () => {
    assert.equal(isValidStage("New"), false);
    assert.equal(isValidStage("WON"), false);
    assert.equal(isValidStage("Won"), false);
  });

  it("el rótulo humano no es una etapa: se guarda la clave, no «Nuevo»", () => {
    assert.equal(isValidStage("Nuevo"), false);
    assert.equal(isValidStage("Convertido"), false);
  });

  it("con null, undefined o cadena vacía dice que no, sin reventar", () => {
    assert.equal(isValidStage(null), false);
    assert.equal(isValidStage(undefined), false);
    assert.equal(isValidStage(""), false);
  });

  it("no recorta espacios: « won » viene mal del import y se rechaza tal cual", () => {
    assert.equal(isValidStage(" won "), false);
    assert.equal(isValidStage("won "), false);
  });
});

describe("GANADAS y PERDIDAS: qué cierra un embudo", () => {
  // Booking añadió dos el 24/08/2026. `actuacion_realizada` cuenta como ganada
  // porque va DESPUÉS de cerrar la fecha: si no, la conversión bajaría el día
  // del concierto, que es justo cuando el trabajo salió bien.
  it("ganadas son won, closed_yes, paciente y las dos de booking — cinco nombres de ganado de cuatro embudos", () => {
    assert.deepEqual([...GANADAS].sort(), [
      "actuacion_realizada",
      "closed_yes",
      "fecha_confirmada",
      "paciente",
      "won",
    ]);
  });

  it("perdidas son lost y closed_no", () => {
    assert.deepEqual([...PERDIDAS].sort(), ["closed_no", "lost"]);
  });

  it("ninguna etapa está a la vez ganada y perdida", () => {
    const enLasDos = [...GANADAS].filter((e) => PERDIDAS.has(e));
    assert.deepEqual(enLasDos, []);
  });

  it("todas las cerradas existen en la lista canónica (si no, cuentan algo que el PATCH no deja guardar)", () => {
    for (const e of [...GANADAS, ...PERDIDAS]) {
      assert.equal(isValidStage(e), true, `«${e}» cierra embudos pero no es una etapa permitida`);
    }
  });
});

describe("etapasDe: el embudo de cada cliente (foto del 18/08/2026)", () => {
  it("aumenta: tres etapas y NINGUNA de ganado — es su embudo real, no un descuido que arreglar", () => {
    assert.deepEqual(etapasDe("aumenta"), ["new", "contacted", "lost"]);
  });

  it("nutri_laura: el camino del paciente, seis etapas en su orden", () => {
    assert.deepEqual(etapasDe("nutri_laura"), [
      "new",
      "contacted",
      "consulta_agendada",
      "consulta_realizada",
      "paciente",
      "lost",
    ]);
  });

  it("retorika: las cinco estándar", () => {
    assert.deepEqual(etapasDe("retorika"), CINCO_POR_DEFECTO);
  });

  it("spain_enzymes: las cinco estándar", () => {
    assert.deepEqual(etapasDe("spain_enzymes"), CINCO_POR_DEFECTO);
  });

  it("un slug desconocido cae en el embudo por defecto: somos y gm_alvar_alonso ven cinco etapas, no quince", () => {
    assert.deepEqual(etapasDe("somos"), CINCO_POR_DEFECTO);
    assert.deepEqual(etapasDe("gm_alvar_alonso"), CINCO_POR_DEFECTO);
    assert.deepEqual(etapasDe("un_slug_que_no_existe"), CINCO_POR_DEFECTO);
  });

  it("demo ya no tiene embudo propio (18/08/2026): el escaparate enseña el por defecto", () => {
    assert.deepEqual(etapasDe("demo"), CINCO_POR_DEFECTO);
  });

  it("la trampa del guión: «nutri-laura» (carpeta) no es «nutri_laura» (BD) y cae al por defecto sin error", () => {
    assert.deepEqual(etapasDe("nutri-laura"), CINCO_POR_DEFECTO);
    assert.notDeepEqual(etapasDe("nutri-laura"), etapasDe("nutri_laura"));
  });

  it("con null, undefined o cadena vacía devuelve el por defecto: nunca revienta ni devuelve vacío", () => {
    assert.deepEqual(etapasDe(null), CINCO_POR_DEFECTO);
    assert.deepEqual(etapasDe(undefined), CINCO_POR_DEFECTO);
    assert.deepEqual(etapasDe(""), CINCO_POR_DEFECTO);
  });

  // ARREGLADO el 24/08/2026. Este it fijaba una trampa conocida: `EMBUDOS` es un
  // objeto literal y el `??` de `etapasDe` solo cazaba null/undefined, así que
  // un slug que coincidiera con una propiedad heredada en minúsculas
  // —«constructor» y «__proto__» pasan la regex [a-z0-9_] de los slugs—
  // devolvía la función o el prototipo, y `tieneEtapaGanada` reventaba con
  // TypeError. El propio comentario decía: «lo esperable sería
  // EMBUDO_POR_DEFECTO en los dos; si alguien lo arregla, cámbialo».
  //
  // Se arregló de paso al añadir el embudo de `booking`, que obligaba a tocar
  // esa misma línea: ahora es `Object.prototype.hasOwnProperty.call`.
  it("la trampa del prototipo, cerrada: «constructor» y «__proto__» caen al por defecto como cualquier otro slug", () => {
    assert.deepEqual(etapasDe("constructor"), CINCO_POR_DEFECTO);
    assert.deepEqual(etapasDe("__proto__"), CINCO_POR_DEFECTO);
    assert.equal(tieneEtapaGanada("constructor"), true);
    assert.equal(tieneEtapaGanada("__proto__"), true);
  });

  it("toda etapa de todo embudo la acepta el PATCH (si no, botón en pantalla que responde 422)", () => {
    for (const slug of [...SLUGS_CON_EMBUDO_PROPIO, "un_slug_que_no_existe"]) {
      for (const etapa of etapasDe(slug)) {
        assert.equal(isValidStage(etapa), true, `${slug} ofrece «${etapa}» y el PATCH la rechaza`);
      }
    }
  });

  it("todo embudo entra por «new» y tiene una etapa perdida donde descartar", () => {
    for (const slug of [...SLUGS_CON_EMBUDO_PROPIO, "un_slug_que_no_existe"]) {
      const etapas = etapasDe(slug);
      assert.equal(etapas[0], "new", `${slug} no empieza en new: [${etapas.join(", ")}]`);
      assert.equal(
        etapas.some((e) => PERDIDAS.has(e)),
        true,
        `${slug} no tiene dónde descartar: [${etapas.join(", ")}]`
      );
    }
  });
});

describe("EMBUDO_POR_DEFECTO: cinco etapas, no quince", () => {
  it("son exactamente las cinco estándar, en el orden en que se recorren", () => {
    assert.deepEqual(EMBUDO_POR_DEFECTO, CINCO_POR_DEFECTO);
  });

  it("lleva ganado y perdido dentro: un cliente recién dado de alta puede convertir y descartar", () => {
    assert.equal(
      EMBUDO_POR_DEFECTO.some((e) => GANADAS.has(e)),
      true
    );
    assert.equal(
      EMBUDO_POR_DEFECTO.some((e) => PERDIDAS.has(e)),
      true
    );
  });
});

describe("tieneEtapaGanada: si /leads/estadisticas enseña «Convertidos»", () => {
  it("aumenta, no: su 0 de convertidos no puede subir y la pantalla se lo tapa a propósito", () => {
    assert.equal(tieneEtapaGanada("aumenta"), false);
  });

  it("nutri_laura, sí: su ganado se llama «paciente»", () => {
    assert.equal(tieneEtapaGanada("nutri_laura"), true);
  });

  it("retorika y spain_enzymes, sí: por «won»", () => {
    assert.equal(tieneEtapaGanada("retorika"), true);
    assert.equal(tieneEtapaGanada("spain_enzymes"), true);
  });

  it("un cliente sin embudo propio, sí: el por defecto lleva «won» dentro (decisión del 18/08/2026)", () => {
    assert.equal(tieneEtapaGanada("somos"), true);
    assert.equal(tieneEtapaGanada("un_slug_que_no_existe"), true);
  });

  it("la trampa del guión también aquí: «nutri-laura» dice sí, pero por el embudo por defecto, no por el suyo", () => {
    assert.equal(tieneEtapaGanada("nutri-laura"), true);
  });
});

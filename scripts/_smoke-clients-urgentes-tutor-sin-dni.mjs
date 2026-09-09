// @prueba ligera — SQL construido en memoria; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-urgentes-tutor-sin-dni.mjs — la carpeta de las familias cuyo
 * tutor no tiene DNI (09/09/2026, Rodrigo: «la solución es la A, meter la
 * carpeta nueva»).
 *
 *   node scripts/_smoke-clients-urgentes-tutor-sin-dni.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Desde el 08/09/2026 la factura sale sola a nombre del TUTOR PRINCIPAL y con
 * su DNI (`lib/billing/razonSocial.js`): 859 de las 1.098 familias de Aumenta.
 * Las 237 restantes siguen facturando a nombre de la ficha, que muchas veces es
 * el nombre del niño, y se arreglan solas en cuanto alguien escriba el DNI del
 * tutor en «Padres y tutores». Pero para escribirlo hay que saber a quién, y
 * **141 de ellas no salían en ninguna pantalla**: «Fichas a completar» tenía
 * carpeta para la familia SIN tutor —94, en las dos de «sin tutor»— y ninguna
 * para la que lo tiene apuntado sin DNI.
 *
 * Medido en producción el 09/09/2026 con el SQL de esta misma carpeta: 142
 * familias (una más que el día anterior, es un alta nueva), de las que 11 están
 * archivadas y no se enseñan. Las otras dos que facturan a la ficha tienen la
 * razón social escrita a mano y están BIEN: por eso el tercer AND.
 *
 * ── QUÉ FIJA ───────────────────────────────────────────────────────────────
 *
 *   1. La carpeta existe tal cual: bloque gris, de familia, y escondida donde
 *      no hay Facturación.
 *   2. Su WHERE pregunta las TRES cosas, y ninguna de más: tiene tutor
 *      apuntado, ninguno con nombre y DNI, y nadie ha escrito la razón social.
 *   3. Lo que decide es lo MISMO que decide `razonSocial.js` al facturar. Son
 *      dos escrituras de la misma regla —una en SQL para preguntar por 1.098
 *      fichas de golpe, otra en JavaScript para emitir una factura— y el día
 *      que se separen, la carpeta deja de enseñar el hueco EN SILENCIO.
 *   4. De esta pantalla no baja ningún DNI al navegador. El detalle son
 *      nombres, que es lo que hace falta para saber a quién pedírselo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARPETAS, filasDe, cuentasDe, carpetasCon } from "../lib/clients/urgentes.js";
import { LA_FICHA, razonSocialAutomatica, razonSocialPorDefecto } from "../lib/billing/razonSocial.js";

const ESQUEMA = "crm_x";
const CARPETA = "tutor_sin_dni";

function fakeSequelize({ conCuotas = true, cuenta = 0 } = {}) {
  const sqls = [];
  return {
    sqls,
    async query(sql) {
      sqls.push(sql);
      if (/to_regclass/.test(sql)) return [[{ con_pacientes: true, con_citas: true, con_cuotas: conCuotas }]];
      if (/count\(\*\)::int AS n/.test(sql)) return [[{ n: cuenta }]];
      return [[]];
    },
  };
}

/** El SQL de la carpeta, en una línea, que es como se puede mirar con regex. */
async function sqlDe(opts) {
  const s = fakeSequelize();
  await filasDe(s, ESQUEMA, CARPETA, opts);
  return (s.sqls[0] ?? "").replace(/\s+/g, " ");
}

describe("la carpeta existe tal cual", () => {
  it("gris, de familia, y detrás de las tres de cuotas", () => {
    const claves = CARPETAS.map((c) => c.key);
    const carpeta = CARPETAS.find((c) => c.key === CARPETA);
    assert.ok(carpeta, "no está la carpeta");
    assert.equal(carpeta.bloquea, false, "no es una alarma: son 141 y es una campaña");
    assert.equal(carpeta.entidad, "client", "el DNI que falta es de un tutor, y los tutores son de la familia");
    assert.equal(carpeta.requiere, "cuotas", "sin Facturación no hay factura y esto no le hace falta a nadie");
    assert.equal(carpeta.opcional, undefined, "se enseña también a cero: es un hueco que se calcula");
    assert.ok(claves.indexOf(CARPETA) > claves.indexOf("cuota_no_cuadra"), "va con las de dinero");
  });

  it("el rótulo dice a qué familia le pasa y la ayuda cómo se arregla", () => {
    const { label, ayuda } = CARPETAS.find((c) => c.key === CARPETA);
    assert.match(label, /DNI/);
    assert.match(ayuda, /Padres y tutores/, "sin decir dónde se escribe, la carpeta es una queja");
    assert.match(ayuda, /ya emitidas no cambian/, "una factura emitida no se reescribe, se rectifica");
  });
});

describe("sin Facturación no existe; con ella, sí", () => {
  it("filasDe no llega ni a preguntar", async () => {
    const s = fakeSequelize();
    const filas = await filasDe(s, ESQUEMA, CARPETA, { conCuotas: false });
    assert.deepEqual(filas, []);
    assert.equal(s.sqls.length, 0, "consultó sin tener Facturación");
  });

  it("ni se enseña ni se cuenta", async () => {
    const sin = await carpetasCon(fakeSequelize({ conCuotas: false }), ESQUEMA, null);
    assert.ok(!sin.some((c) => c.key === CARPETA), "sale en un centro sin Facturación");
    const con = await carpetasCon(fakeSequelize({ conCuotas: true }), ESQUEMA, null);
    assert.ok(con.some((c) => c.key === CARPETA), "no sale teniendo Facturación");

    const cuentaSin = await cuentasDe(fakeSequelize({ conCuotas: false }), ESQUEMA, { conRevisiones: false });
    assert.equal(cuentaSin.porCarpeta[CARPETA], undefined, "se cuenta sin tener Facturación");
    const cuentaCon = await cuentasDe(fakeSequelize({ conCuotas: true, cuenta: 141 }), ESQUEMA, { conRevisiones: false });
    assert.equal(cuentaCon.porCarpeta[CARPETA], 141);
  });
});

describe("pregunta las tres cosas, y ninguna de más", () => {
  it("1) la familia tiene tutor apuntado (la que no lo tiene ya sale en «sin tutor»)", async () => {
    const sql = await sqlDe();
    assert.match(sql, /NOT \( \(jsonb_typeof\(c\.guardians\) <> 'array' OR jsonb_array_length\(c\.guardians\) = 0\)\)/);
  });

  it("2) ninguno de ellos se puede facturar: hacen falta id, nombre y DNI", async () => {
    const sql = await sqlDe();
    assert.match(sql, /NOT EXISTS \( SELECT 1 FROM jsonb_array_elements\(/);
    // Las tres condiciones de `tutorPrincipalDe`, una por una: con que se caiga
    // la del DNI, la carpeta se queda vacía y nadie se entera.
    assert.match(sql, /g->>'id' ~\* '\^\[0-9a-f\]\{8\}-/, "sin el id, una entrada a medias contaría como tutor facturable");
    assert.match(sql, /coalesce\(g->>'name',''\) <> ''/, "un tutor sin nombre no se puede poner en una factura");
    assert.match(sql, /coalesce\(g->>'dni',''\) <> ''/, "es LA condición de la carpeta");
  });

  it("3) nadie ha escrito la razón social a mano (una empresa, una fundación)", async () => {
    // Son las 2 familias de Aumenta que facturan a la ficha y están BIEN. Sin
    // este AND se les reclamaría un DNI que no hace falta.
    const sql = await sqlDe();
    assert.match(sql, /NOT \(coalesce\(c\.fiscal_name,''\) <> '' OR coalesce\(c\.fiscal_tax_id,''\) <> ''\)/);
  });

  it("y no pregunta por tablas que ese schema puede no tener", async () => {
    // La consulta es de `clients` y nada más: ni pacientes ni cuotas. Lo único
    // que mira fuera es la agenda, y solo para la excepción de las bajas con
    // hora cogida, que es de `cuerpoDe()` y desaparece sin agenda.
    const sql = await sqlDe();
    assert.doesNotMatch(sql, /crm_x\.patients|billing_cuotas/);
    assert.doesNotMatch(await sqlDe({ conCitas: false }), /crm_x\.bookings/);
  });

  it("el detalle son NOMBRES: de esta pantalla no baja ningún DNI", async () => {
    const sql = await sqlDe();
    const select = sql.split(/FROM crm_x\.clients/)[0];
    assert.match(select, /string_agg\(coalesce\(nullif\(g->>'name',''\), '\(sin nombre\)'\), ', '\)/);
    assert.doesNotMatch(select, /'dni'/, "el DNI de quien sí lo tiene no pinta nada en una lista");
  });
});

describe("la carpeta y la factura deciden lo mismo", () => {
  /*
   * La condición vive dos veces: en SQL aquí (1.098 fichas de una consulta) y
   * en `razonSocial.js` al emitir. Esta prueba las empareja sobre los cuatro
   * casos que separan una de otra; que además coincidan contra los datos de
   * verdad se comprobó corriendo el SQL de la carpeta en producción el
   * 09/09/2026: 142, los mismos que contó `razonSocial.js` dentro del
   * contenedor.
   */
  const uuid = (n) => `0000000${n}-0000-4000-8000-000000000000`;
  const familia = (guardians, extra = {}) => ({ id: uuid(9), name: "LUCAS HERRANZ", guardians, ...extra });

  /** Lo que pregunta el SQL, dicho en JavaScript. */
  const laReclamaLaCarpeta = (c) =>
    (c.guardians ?? []).length > 0 &&
    !(c.guardians ?? []).some((g) => g.id && g.name && g.dni) &&
    !c.fiscalName &&
    !c.fiscalTaxId;

  it("tutor sin DNI: la factura sale a nombre de la ficha, y la carpeta la reclama", () => {
    const c = familia([{ id: uuid(1), name: "MARTA HERRANZ", relationship: "madre", dni: null }]);
    assert.equal(razonSocialAutomatica(c), null, "no hay tutor al que facturar");
    assert.equal(razonSocialPorDefecto(c), LA_FICHA, "la factura iría a nombre del niño");
    assert.equal(laReclamaLaCarpeta(c), true);
  });

  it("le escriben el DNI y sale sola de la carpeta, sin elegir nada más", () => {
    const c = familia([{ id: uuid(1), name: "MARTA HERRANZ", relationship: "madre", dni: "12345678Z" }]);
    assert.equal(razonSocialAutomatica(c)?.name, "MARTA HERRANZ");
    assert.equal(razonSocialPorDefecto(c), uuid(1));
    assert.equal(laReclamaLaCarpeta(c), false);
  });

  it("razón social escrita a mano: factura a la ficha y NO se le reclama nada", () => {
    // El caso que obliga al tercer AND: `razonSocialAutomatica` devuelve null
    // por dos motivos distintos —no hay tutor facturable, o ya está dicho a
    // nombre de quién— y solo el primero es un hueco.
    const c = familia([{ id: uuid(1), name: "MARTA HERRANZ", relationship: "madre", dni: null }], {
      fiscalName: "ASOCIACIÓN X",
      fiscalTaxId: "G12345678",
    });
    assert.equal(razonSocialAutomatica(c), null);
    assert.equal(razonSocialPorDefecto(c), LA_FICHA);
    assert.equal(laReclamaLaCarpeta(c), false, "se le pediría un DNI que no hace falta");
  });

  it("sin ningún tutor: eso ya lo enseñan las dos carpetas de «sin tutor»", () => {
    const c = familia([]);
    assert.equal(razonSocialPorDefecto(c), LA_FICHA);
    assert.equal(laReclamaLaCarpeta(c), false, "saldría dos veces por dos huecos distintos");
  });

  it("un tutor a medias (sin nombre) no cuenta como tutor facturable", () => {
    const c = familia([{ id: uuid(1), name: "", relationship: "tutor", dni: "12345678Z" }]);
    assert.equal(razonSocialAutomatica(c), null, "una factura no puede ir a nombre de nadie");
    assert.equal(laReclamaLaCarpeta(c), true);
  });
});

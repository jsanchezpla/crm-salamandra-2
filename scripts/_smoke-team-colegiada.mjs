// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-team-colegiada.mjs — el nº de colegiada y la titulación llegan a quien
 * firma el informe, y solo a esa puerta (28/08/2026).
 *
 *   node scripts/_smoke-team-colegiada.mjs
 *   node --test-name-pattern="colegiada" scripts/_smoke-team-colegiada.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El informe clínico rediseñado de Aumenta —el que la familia presenta en el
 * colegio o para la beca del Ministerio— cierra con quién lo firma: su nº de
 * colegiada y su titulación. El CRM no guardaba ni uno ni otro, así que los dos
 * nacen hoy como columnas de `team_members` y salen por
 * `lib/team/serializeTeamMember.js`.
 *
 * ── LO QUE ESTA PRUEBA DEFIENDE ────────────────────────────────────────────
 *
 * 1. Que salgan. Un campo que el serializer no expone se guarda bien en la base
 *    y no llega nunca a la pantalla ni al PDF: el fallo silencioso de siempre.
 *
 * 2. Que FALTEN BIEN. En producción hoy no los tiene NADIE (18 personas en
 *    Aumenta, cero colegiadas). Ausente, null y cadena vacía tienen que dar
 *    todos el mismo `null`: si uno de los tres se colara como `""`, el generador
 *    del PDF lo daría por relleno e imprimiría una línea en blanco justo debajo
 *    de una firma profesional. Nada de valores inventados ni de «—».
 *
 * 3. Que NO salgan por la lista recortada de desplegables. Esa lista existe para
 *    pintar y elegir a una persona (nombre, color, especialidad); la colegiada
 *    no ayuda a elegir a nadie, y quien la necesita —el PDF— se genera en el
 *    servidor leyendo la ficha entera. Ver CAMPOS_FUERA_DE_LA_LISTA.
 *
 * Prueba lo que DEVUELVE el serializer, no cómo está escrito.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE, MODULES } from "./_module-migrations.js";
import {
  serializeTeamMember,
  serializeProfesional,
  CAMPOS_FUERA_DE_LA_LISTA,
} from "../lib/team/serializeTeamMember.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Una ficha de equipo mínima; cada prueba le pone encima lo que quiere probar. */
function ficha(extra = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    displayName: "Araceli",
    position: "Psicóloga",
    status: "active",
    specialties: ["psicologia"],
    ...extra,
  };
}

describe("con los dos datos puestos, salen tal cual", () => {
  it("el nº de colegiada sale sin tocar", () => {
    const salida = serializeTeamMember(ficha({ collegiateNumber: "M-12345" }));
    assert.equal(salida.collegiateNumber, "M-12345");
  });

  it("la titulación sale sin tocar, con sus tildes y sus espacios de dentro", () => {
    const salida = serializeTeamMember(ficha({ qualification: "Graduada en Psicología · Máster en Neuropsicología" }));
    assert.equal(salida.qualification, "Graduada en Psicología · Máster en Neuropsicología");
  });

  it("salen también para quien no es dirección: no son dinero", () => {
    const datos = { collegiateNumber: "M-12345", qualification: "Logopeda" };
    const comoUsuaria = serializeTeamMember(ficha(datos), { isAdmin: false });
    assert.equal(comoUsuaria.collegiateNumber, "M-12345");
    assert.equal(comoUsuaria.qualification, "Logopeda");
  });
});

describe("sin los datos, `null` — nunca «», nunca «—»", () => {
  /*
   * Las tres formas de que falte un dato tienen que dar el MISMO null. Hoy en
   * producción faltan los dos en las 18 personas de Aumenta, así que este es el
   * caso normal, no el raro.
   */
  it("si la ficha no trae las claves, null", () => {
    const salida = serializeTeamMember(ficha());
    assert.equal(salida.collegiateNumber, null);
    assert.equal(salida.qualification, null);
  });

  it("si vienen a null, null", () => {
    const salida = serializeTeamMember(ficha({ collegiateNumber: null, qualification: null }));
    assert.equal(salida.collegiateNumber, null);
    assert.equal(salida.qualification, null);
  });

  it("si vienen como cadena vacía, TAMBIÉN null (una línea en blanco bajo una firma es peor que ninguna)", () => {
    const salida = serializeTeamMember(ficha({ collegiateNumber: "", qualification: "" }));
    assert.equal(salida.collegiateNumber, null);
    assert.equal(salida.qualification, null);
  });

  it("faltando, las claves siguen estando: quien las lee no tiene que adivinar si existen", () => {
    const salida = serializeTeamMember(ficha());
    assert.ok("collegiateNumber" in salida);
    assert.ok("qualification" in salida);
  });

  it("no se inventa nada: ni «—», ni «Sin colegiada», ni el puesto en su lugar", () => {
    const salida = serializeTeamMember(ficha({ position: "Psicóloga" }));
    assert.notEqual(salida.collegiateNumber, "—");
    assert.notEqual(salida.qualification, "—");
    assert.notEqual(salida.qualification, "Psicóloga");
  });
});

describe("la lista recortada de desplegables no los lleva", () => {
  it("no salen en serializeProfesional", () => {
    const salida = serializeProfesional(ficha({ collegiateNumber: "M-12345", qualification: "Logopeda" }));
    assert.equal("collegiateNumber" in salida, false);
    assert.equal("qualification" in salida, false);
  });

  it("y están declarados como tal, no olvidados", () => {
    // Si mañana alguien los mete en el recorte, tiene que quitarlos de aquí a
    // mano y enterarse de que existe esa puerta.
    assert.ok(CAMPOS_FUERA_DE_LA_LISTA.includes("collegiateNumber"));
    assert.ok(CAMPOS_FUERA_DE_LA_LISTA.includes("qualification"));
  });
});

describe("los dos campos existen en el modelo y en su migración", () => {
  /*
   * Esto sí es texto, y por el motivo de siempre: el serializer puede devolver
   * `null` tan tranquilo porque el atributo no exista en el modelo, y entonces
   * el dato no se guardaría NUNCA sin que nadie se entere. Y una columna que el
   * modelo declara pero ninguna migración crea es un 42703 esperando.
   */
  const modelo = readFileSync(join(RAIZ, "models/tenant/TeamMember.model.js"), "utf8");
  const migracion = readFileSync(join(RAIZ, "scripts/migrate-team-colegiada.js"), "utf8");

  it("TeamMember declara collegiateNumber y qualification", () => {
    assert.match(modelo, /^\s*collegiateNumber:\s*\{/m);
    assert.match(modelo, /^\s*qualification:\s*\{/m);
  });

  it("los declara NULL: hoy no los tiene nadie", () => {
    assert.ok(!/collegiateNumber:[\s\S]{0,200}?allowNull:\s*false/.test(modelo));
    assert.ok(!/qualification:[\s\S]{0,200}?allowNull:\s*false/.test(modelo));
  });

  it("la migración añade las dos columnas, y de forma idempotente", () => {
    assert.ok(migracion.includes("ADD COLUMN IF NOT EXISTS collegiate_number"));
    assert.ok(migracion.includes("ADD COLUMN IF NOT EXISTS qualification"));
  });

  it("la migración no rellena nada: un default se imprimiría en un informe firmado", () => {
    assert.ok(!/\bUPDATE\b/i.test(migracion), "esta migración no puede escribir ni una fila");
    // Solo el SQL: la cabecera del script SÍ habla de que no lleva DEFAULT.
    assert.ok(!/ADD COLUMN[^\n`]*DEFAULT/i.test(migracion), "las dos columnas nacen vacías a propósito");
  });

  it("está declarada en CORE, y no dentro del módulo `team`", () => {
    /*
     * La colocación es lo único que puede tumbar pantallas que no tienen nada
     * que ver. `TeamMember` se registra para TODOS los tenants
     * (`lib/db/tenantDb.js`), así que Sequelize pide estas dos columnas en cada
     * SELECT de `team_members` aunque el cliente no tenga el módulo `team`. En
     * `MODULES.team` la migración no se correría ahí y sería un 42703 en
     * Equipo, en los desplegables de profesionales y en la agenda.
     *
     * Hoy está bien puesta; esto es la red para el día que alguien la mueva
     * «porque es de equipo», que es el error natural. Mismo patrón que
     * `_smoke-incidencias-documentos.mjs`.
     */
    assert.ok(CORE.includes("migrate-team-colegiada"), "tiene que estar en CORE");
    assert.ok(
      !(MODULES.team ?? []).includes("migrate-team-colegiada"),
      "y NO en MODULES.team: sería un 42703 en cualquier tenant sin ese módulo"
    );
  });
});

describe("la API acepta los dos campos por sus dos puertas", () => {
  /*
   * Un campo que el endpoint no mira se guarda con un 200 y no se guarda nada:
   * la pantalla dice «Guardado», la ficha vuelve vacía y nadie sabe por qué. Es
   * una llamada que tiene que ESTAR, así que se comprueba leyendo el código.
   */
  const alta = readFileSync(join(RAIZ, "app/api/team/route.js"), "utf8");
  const edicion = readFileSync(join(RAIZ, "app/api/team/[id]/route.js"), "utf8");

  it("el POST los guarda al crear: llegan al TeamMember.create, no solo se leen", () => {
    /*
     * ⚠️ Esta aserción estaba HUECA: `alta.includes("collegiateNumber,")` se
     * cumplía con la línea que NORMALIZA el campo
     * (`normalizeTextoCorto(body.collegiateNumber, MAX_COLEGIADA)`), no con la
     * que lo mete en el `create`. O sea que se podía borrar el campo del
     * `create` —el fallo exacto del que dice proteger— y la prueba seguía
     * verde. Ahora se mira DENTRO del bloque del `create`.
     */
    const desde = alta.indexOf("TeamMember.create(");
    assert.ok(desde > 0, "no encuentro la llamada a TeamMember.create");
    const bloque = alta.slice(desde, alta.indexOf("});", desde));
    assert.match(bloque, /^\s*collegiateNumber,?\s*$/m, "TeamMember.create no recibe collegiateNumber");
    assert.match(bloque, /^\s*qualification,?\s*$/m, "TeamMember.create no recibe qualification");
  });

  it("el PATCH los edita, y vaciarlos vale", () => {
    assert.ok(edicion.includes('if ("collegiateNumber" in body)'));
    assert.ok(edicion.includes('if ("qualification" in body)'));
  });

  it("las dos puertas recortan a lo que cabe en la columna", () => {
    for (const [nombre, fuente] of [["POST", alta], ["PATCH", edicion]]) {
      assert.ok(
        fuente.includes("normalizeTextoCorto(body.collegiateNumber, MAX_COLEGIADA)"),
        `${nombre} no recorta el nº de colegiada: un pegado de más sería un 22001 de PostgreSQL`
      );
      assert.ok(
        fuente.includes("normalizeTextoCorto(body.qualification, MAX_TITULACION)"),
        `${nombre} no recorta la titulación`
      );
    }
  });
});

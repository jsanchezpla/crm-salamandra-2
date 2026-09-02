// @prueba ligera — SQL construido en memoria; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-urgentes-bajas.mjs — «Fichas a completar» no reclama datos de
 * fichas archivadas (25/08/2026).
 *
 *   node scripts/_smoke-clients-urgentes-bajas.mjs
 *   node --test-name-pattern="excepción" scripts/_smoke-clients-urgentes-bajas.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Lau (Aumenta) el 14/08/2026: la pantalla le reclamaba una y otra vez datos de
 * gente que ella ya había dado de baja. Medido en producción el 25/08: de las
 * 171 filas del bloque rojo —el que tiene que llegar a cero— 134 eran bajas, y
 * en «Sin tutor y sin ningún dato de contacto», 117 de 118.
 *
 * ── QUÉ FIJA, Y POR QUÉ CADA COSA ──────────────────────────────────────────
 *
 * No prueba «que el SQL esté escrito de una manera»: prueba las tres reglas que
 * si se rompen, se rompen EN SILENCIO —la pantalla sigue pintando filas y nadie
 * ve que son las equivocadas—.
 *
 *   1. La exclusión va en las DOS consultas, la que trae las filas y la que
 *      cuenta. Es la regla de la cabecera de `urgentes.js`: si la carpeta dice
 *      27 y al abrirla salen 25, nadie vuelve a fiarse del número.
 *   2. La excepción de quien tiene hora cogida existe de verdad. Sin ella, 11
 *      pacientes de baja con 304 citas confirmadas del curso que viene
 *      desaparecerían de la pantalla con la agenda ocupada.
 *   3. El `coalesce(c.status::text, '')`, que son DOS trampas en la misma línea.
 *      El coalesce, porque dos carpetas llegan a `clients` por un LEFT JOIN:
 *      sin él, un paciente sin familia da `NULL = 'inactive'` → NULL, el
 *      `NOT (...)` también sale NULL y la fila se cae por no tener familia. En
 *      la demo hay 6 pacientes así, y eso no daría ningún error. Y el `::text`,
 *      porque `status` es un ENUM y `''` no es uno de sus valores: eso sí da
 *      error, en la primera consulta, y se llevó por delante la primera versión.
 *
 * La sequelize de mentira solo guarda el SQL que se le pide y devuelve vacío:
 * lo que se mira es la consulta, que es donde vive la regla.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARPETAS, filasDe, cuentasDe, carpetasCon } from "../lib/clients/urgentes.js";

const ESQUEMA = "crm_x";

/** Sequelize de mentira: apunta cada consulta y contesta lo mínimo. */
function fakeSequelize({ filas = [], cuenta = 0 } = {}) {
  const sqls = [];
  return {
    sqls,
    async query(sql, opciones) {
      sqls.push(sql);
      if (/to_regclass/.test(sql)) {
        // Se guarda con qué se preguntó: el schema tiene que ir DENTRO.
        this.sondas = [...(this.sondas ?? []), opciones?.replacements];
        return [[{ con_pacientes: true, con_citas: true }]];
      }
      if (/count\(\*\)/.test(sql)) return [[{ n: cuenta }]];
      return [filas];
    },
  };
}

const DE_PACIENTE = CARPETAS.filter((c) => c.entidad === "patient").map((c) => c.key);
const DE_FAMILIA = CARPETAS.filter((c) => c.entidad === "client").map((c) => c.key);
const TODAS = CARPETAS.map((c) => c.key);

/**
 * Lo que va detrás del WHERE de VERDAD, en una línea.
 *
 * Se cuentan paréntesis en vez de buscar el primer «WHERE»: el SELECT de estas
 * carpetas lleva subconsultas («la próxima cita de este paciente») que tienen su
 * propio WHERE, y con una regex a secas se compara el trozo equivocado.
 */
function whereDe(sql) {
  let nivel = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "(") nivel++;
    else if (sql[i] === ")") nivel--;
    else if (nivel === 0 && sql.startsWith("WHERE", i)) {
      const resto = sql.slice(i + 5);
      const fin = resto.search(/\sORDER BY\s/);
      return (fin === -1 ? resto : resto.slice(0, fin)).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

describe("por defecto, las fichas archivadas no salen", () => {
  it("todas las carpetas excluyen a las bajas", async () => {
    for (const key of TODAS) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      const where = whereDe(s.sqls[0]);
      assert.match(where, /NOT\s*\(?\s*(p\.status|coalesce\(c\.status)/,
        `${key}: el WHERE no deja fuera a las bajas — «${where}»`);
    }
  });

  it("una carpeta de paciente mira el estado de los DOS: paciente y familia", async () => {
    for (const key of DE_PACIENTE) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      const sql = s.sqls[0];
      assert.match(sql, /p\.status IN \('paused','discharged'\)/, `${key}: no mira el estado del paciente`);
      // Los DOS estados que dejan de reclamar, no solo el que había el 25/08:
      // desde el 26/08 «No vino» (`prospect`) cuenta igual que «Baja».
      assert.match(sql, /coalesce\(c\.status::text,''\) IN \([^)]*'inactive'[^)]*\)/,
        `${key}: no mira si la familia está de baja`);
      assert.match(sql, /coalesce\(c\.status::text,''\) IN \([^)]*'prospect'[^)]*\)/,
        `${key}: una familia marcada «No vino» sigue reclamando datos`);
    }
  });

  it("una carpeta de familia NO inventa un `p.status` que no existe en su FROM", async () => {
    for (const key of DE_FAMILIA) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      assert.doesNotMatch(s.sqls[0], /p\.status/, `${key}: usa p.status y su FROM no tiene pacientes`);
    }
  });

  it("el estado va casteado a texto: `status` es un ENUM y `''` no cabe dentro", async () => {
    // Fallo real del 25/08/2026, y no lo cazó ninguna prueba: `coalesce(c.status,'')`
    // reventó en la PRIMERA consulta contra la base con «la sintaxis de entrada
    // no es válida para el enum enum_clients_status: ''». Los dos lados de un
    // coalesce tienen que ser del mismo tipo, y ahí manda el enum de la columna.
    for (const key of TODAS) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      assert.doesNotMatch(s.sqls[0], /coalesce\(c\.status,/,
        `${key}: coalesce sobre el enum sin ::text — no llega ni a ejecutarse`);
    }
  });

  it("el estado de la familia SIEMPRE pasa por coalesce (la trampa del LEFT JOIN)", async () => {
    for (const key of TODAS) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      // Ni un solo `c.status` suelto: todos dentro de un coalesce.
      const suelto = s.sqls[0].replace(/coalesce\(c\.status::text,''\)/g, "");
      assert.doesNotMatch(suelto, /c\.status/,
        `${key}: hay un c.status sin coalesce, y con LEFT JOIN eso tira filas sin familia`);
    }
  });
});

describe("la excepción: de baja pero con hora cogida sí sale", () => {
  it("la exclusión lleva siempre su «o tiene cita futura»", async () => {
    for (const key of TODAS) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      const where = whereDe(s.sqls[0]);
      assert.match(where, /OR EXISTS \(SELECT 1 FROM crm_x\.bookings b/,
        `${key}: la exclusión no tiene excepción, y esconde bajas con la agenda ocupada`);
    }
  });

  it("una cita ANULADA no cuenta como hora cogida", async () => {
    /*
     * Lo cazó la revisión adversarial del 25/08. Cancelar no borra la fila
     * (`lib/citas/cancelBooking.js` solo pone status='cancelled'), así que sin
     * este filtro el flujo más normal —dar de baja a alguien y anularle las
     * sesiones— dejaba la ficha rebotando en la pantalla marcada «Archivada»
     * con un aviso falso: «tiene horas cogidas en la agenda».
     *
     * Se comprueba en TODAS las subconsultas contra bookings que deciden si
     * hay hora cogida, no solo en la de la excepción.
     */
    for (const key of TODAS) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      const sql = s.sqls[0];
      const futuras = sql.match(/scheduled_at > now\(\)/g) ?? [];
      const limpias = sql.match(/scheduled_at > now\(\) AND b\.status NOT IN \('cancelled','no_show'\)/g) ?? [];
      assert.equal(limpias.length, futuras.length,
        `${key}: ${futuras.length - limpias.length} subconsulta(s) de citas futuras cuentan las anuladas`);
    }
  });

  it("cada carpeta busca la cita por su propia entidad", async () => {
    for (const key of DE_PACIENTE) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      assert.match(s.sqls[0], /OR EXISTS \(SELECT 1 FROM crm_x\.bookings b\s+WHERE b\.patient_id = p\.id/, key);
    }
    for (const key of DE_FAMILIA) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key);
      assert.match(s.sqls[0], /OR EXISTS \(SELECT 1 FROM crm_x\.bookings b\s+WHERE b\.client_id = c\.id/, key);
    }
  });

  it("sin agenda en el schema, la excepción se cae y no se pregunta por bookings", async () => {
    // Un centro con fichas pero sin `citas` no tiene la tabla: preguntar por
    // ella reventaría la carpeta entera con un 42P01.
    for (const key of DE_FAMILIA) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key, { conCitas: false });
      const where = whereDe(s.sqls[0]);
      assert.doesNotMatch(where, /bookings/, `${key}: pregunta por bookings sin tener agenda`);
      assert.match(where, /NOT \(coalesce\(c\.status::text,''\) IN \([^)]*'inactive'[^)]*\)\)/,
        `${key}: y encima ya no excluye bajas`);
    }
  });
});

describe("con incluirBajas, salen todas", () => {
  it("no queda ni rastro de la exclusión", async () => {
    for (const key of TODAS) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key, { incluirBajas: true });
      const where = whereDe(s.sqls[0]);
      assert.doesNotMatch(where, /NOT \(?p\.status IN/, `${key}: sigue excluyendo pacientes de baja`);
      assert.doesNotMatch(where, /NOT coalesce\(c\.status/, `${key}: sigue excluyendo familias de baja`);
    }
  });

  it("pero la fila sigue diciendo si está de baja", async () => {
    // El marcador se manda SIEMPRE: encendida la casilla es lo que distingue
    // unas filas de otras, y apagada es lo que explica por qué esa se ha
    // quedado (tiene citas).
    for (const incluirBajas of [true, false]) {
      for (const key of TODAS) {
        const s = fakeSequelize();
        await filasDe(s, ESQUEMA, key, { incluirBajas });
        assert.match(s.sqls[0], /\) AS de_baja/, `${key} (incluirBajas=${incluirBajas}): sin marcador`);
      }
    }
  });
});

describe("el número de la carpeta se cuenta con la MISMA regla que las filas", () => {
  it("cuentasDe excluye exactamente lo mismo que filasDe", async () => {
    const contador = fakeSequelize();
    await cuentasDe(contador, ESQUEMA, { conRevisiones: false });
    const cuentas = contador.sqls.filter((s) => /count\(\*\)/.test(s));
    assert.equal(cuentas.length, CARPETAS.length, "no se contaron todas las carpetas");

    for (const [i, key] of TODAS.entries()) {
      const lista = fakeSequelize();
      await filasDe(lista, ESQUEMA, key);
      const enLaLista = whereDe(lista.sqls[0]);
      const enElConteo = whereDe(cuentas[i]);
      assert.equal(enElConteo, enLaLista,
        `${key}: la carpeta cuenta una cosa y enseña otra`);
    }
  });

  it("y con incluirBajas también van a la par", async () => {
    const contador = fakeSequelize();
    await cuentasDe(contador, ESQUEMA, { conRevisiones: false, incluirBajas: true });
    const cuentas = contador.sqls.filter((s) => /count\(\*\)/.test(s));

    for (const [i, key] of TODAS.entries()) {
      const lista = fakeSequelize();
      await filasDe(lista, ESQUEMA, key, { incluirBajas: true });
      assert.equal(whereDe(cuentas[i]), whereDe(lista.sqls[0]), key);
    }
  });
});

describe("las carpetas no se solapan (25/08/2026)", () => {
  /*
   * La pantalla promete «cada ficha aparece en una sola». Hasta hoy era mentira:
   * 1.965 filas para 1.225 fichas en producción, con cinco solapes y cuatro de
   * ellos COMPLETOS. Aquí se fija que cada carpeta sigue callándose lo que ya
   * enseña otra por encima; la prueba de que de verdad no se solapan es la
   * matriz contra los datos de producción, que no cabe en una prueba ligera.
   */
  const whereDeCarpeta = async (key, opts) => {
    const s = fakeSequelize();
    await filasDe(s, ESQUEMA, key, opts);
    return whereDe(s.sqls[0]);
  };

  it("«pacientes sin terapeuta» se calla a los 31 que ya salen en rojo", async () => {
    const w = await whereDeCarpeta("sin_terapeuta");
    assert.match(w, /NOT \(p\.main_therapist_id IS NULL AND EXISTS \(SELECT 1 FROM crm_x\.bookings/,
      "vuelve a enseñar a los que tienen hora cogida, que ya salen arriba");
  });

  it("«activos sin ninguna cita» se calla a los que no tienen terapeuta", async () => {
    // Eran 482 de 813 repetidos: el hueco de «sin terapeuta» va antes.
    const w = await whereDeCarpeta("sin_citas");
    assert.match(w, /AND NOT \(p\.main_therapist_id IS NULL AND NOT /,
      "no defiere a «pacientes sin terapeuta»");
  });

  it("«con citas y sin contacto» se calla a los 7 que tampoco tienen terapeuta", async () => {
    const w = await whereDeCarpeta("citas_sin_contacto");
    assert.match(w, /NOT \(p\.main_therapist_id IS NULL AND EXISTS/,
      "los 7 que salían en las dos carpetas rojas siguen saliendo dos veces");
  });

  it("«sin correo» se calla a las familias mudas (eran 220 de 265)", async () => {
    const w = await whereDeCarpeta("sin_correo");
    assert.match(w, /AND NOT \(\s*coalesce\(c\.phone,''\) = ''/,
      "quien no tiene ni teléfono ni correo sigue contándose aquí además de arriba");
  });

  it("«sin correo» se calla también a las que no tienen tutor", async () => {
    // Lo cazó la revisión adversarial del 25/08 y es el par que sobrevivía:
    // una familia con guardians=[], teléfono puesto y sin correo cumplía
    // «sin tutor» Y «sin correo». Es justo el estado en el que queda una ficha
    // de la carpeta roja en cuanto alguien le rellena el teléfono — o sea que
    // arreglarla la hacía aparecer dos veces.
    const w = await whereDeCarpeta("sin_correo");
    assert.match(w, /AND NOT \(\s*\(jsonb_typeof\(c\.guardians\) <> 'array'/,
      "una familia sin tutor sigue saliendo aquí además de en «Familias sin tutor»");
  });

  it("las dos carpetas de familia se callan si el hueco ya lo enseña un hijo", async () => {
    // Es el MISMO teléfono el que falta: rellenarlo tacha las dos filas.
    for (const key of ["sin_tutor_ni_contacto", "sin_contacto"]) {
      const w = await whereDeCarpeta(key);
      assert.match(w, /NOT EXISTS \(SELECT 1 FROM crm_x\.patients p\s+WHERE p\.client_id = c\.id/,
        `${key}: no mira si uno de sus pacientes ya está enseñando el hueco`);
    }
  });

  it("sin tabla de pacientes, esa traducción es FALSE y no se pregunta por patients", async () => {
    // nutri_laura y spain_enzymes tienen fichas y agenda, pero no pacientes:
    // preguntar por esa tabla les rompería las cuatro carpetas de familia.
    for (const key of DE_FAMILIA) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key, { conPacientes: false });
      assert.doesNotMatch(s.sqls[0], /crm_x\.patients/, `${key}: pregunta por patients sin tenerla`);
    }
  });

  it("sin agenda, «tiene hora cogida» es FALSE y nadie pregunta por bookings", async () => {
    for (const key of TODAS) {
      const s = fakeSequelize();
      await filasDe(s, ESQUEMA, key, { conCitas: false, conPacientes: true });
      assert.doesNotMatch(s.sqls[0], /crm_x\.bookings/, `${key}: pregunta por bookings sin tener agenda`);
    }
  });
});

describe("cómo se averigua qué tablas tiene el schema", () => {
  it("no se pregunta con `SELECT table_name`, que Sequelize secuestra", async () => {
    // El dialecto de Postgres reconoce esa forma como «listar tablas» y le
    // cambia la forma al resultado: devuelve nombres sueltos repartidos entre
    // los dos huecos de la tupla. `filas.map(f => f.table_name)` sale
    // `[undefined]`, el centro se queda sin sus carpetas de pacientes y NO da
    // ningún error. Pasó el 25/08/2026 con crm_aumenta, que sí tiene patients.
    const s = fakeSequelize();
    await carpetasCon(s, ESQUEMA, null);
    const sonda = s.sqls.find((q) => /information_schema|to_regclass/.test(q));
    assert.ok(sonda, "no se llegó a mirar qué tablas hay");
    assert.doesNotMatch(sonda, /SELECT\s+table_name/i,
      "esa forma la secuestra el dialecto: devuelve cadenas, no filas");
  });

  it("y la sonda lleva el schema dentro: el searchPath no llega a las consultas crudas", async () => {
    const s = fakeSequelize();
    await carpetasCon(s, ESQUEMA, null);
    assert.deepEqual(s.sondas?.[0], {
      pacientes: `"${ESQUEMA}"."patients"`,
      citas: `"${ESQUEMA}"."bookings"`,
    });
  });
});

describe("lo que NO se ha cambiado sin querer", () => {
  it("las nueve carpetas siguen siendo las mismas, con su bloque (la de reservas de plaza es opcional)", async () => {
    assert.deepEqual(
      CARPETAS.map((c) => [c.key, c.bloquea, c.entidad, !!c.opcional]),
      [
        ["citas_sin_terapeuta", true, "patient", false],
        ["citas_sin_contacto", true, "patient", false],
        ["sin_tutor_ni_contacto", true, "client", false],
        ["sin_terapeuta", false, "patient", false],
        ["sin_tutor", false, "client", false],
        ["sin_contacto", false, "client", false],
        ["sin_correo", false, "client", false],
        ["sin_citas", false, "patient", false],
        // 02/09/2026: la lista de revisión de las reservas de plaza, que vive en
        // custom_fields.reservaPlaza y solo se enseña donde hay marca.
        ["reserva_plaza", false, "client", true],
      ]
    );
  });

  it("«reserva de plaza» lee la marca de la ficha y pone los avisos arriba", async () => {
    const s = fakeSequelize();
    await filasDe(s, ESQUEMA, "reserva_plaza");
    assert.match(s.sqls[0], /custom_fields \? 'reservaPlaza'/);
    assert.match(s.sqls[0], /->>'aviso'\) IS NULL, c\.name/);
    // Y una carpeta opcional sin filas no se enseña.
    const vacio = fakeSequelize();
    const carpetas = await carpetasCon(vacio, ESQUEMA, null);
    assert.equal(carpetas.some((c) => c.key === "reserva_plaza"), false);
  });

  it("«Pacientes sin terapeuta» sigue siendo main_therapist_id IS NULL", async () => {
    // Es el invariante que comparte con `lib/clinica/terapeutas.js`: el de
    // referencia es uno de la lista, y sin lista la columna va a null.
    const s = fakeSequelize();
    await filasDe(s, ESQUEMA, "sin_terapeuta");
    assert.match(s.sqls[0], /p\.main_therapist_id IS NULL/);
  });
});

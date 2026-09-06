// @prueba ligera — SQL construido en memoria; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-urgentes-cuotas.mjs — las cinco carpetas de cuotas y fichas
 * de «Fichas a completar» (06/09/2026, Rodrigo: «pon todos los problemas en
 * Fichas a completar»).
 *
 * Fija lo que se rompería EN SILENCIO:
 *   1. Las cinco existen, con su bloque y su entidad, y las tres de cuotas
 *      declaran `requiere: "cuotas"`.
 *   2. Sin la tabla de cuotas (un centro sin Facturación) ni se preguntan ni
 *      se enseñan; con ella, sí — en el listado y en los recuentos por igual.
 *   3. Cada una pregunta lo que dice: cita cobrable sin cobro, familia con o
 *      sin cuota viva, minutos del curso frente a los del concepto, paciente
 *      sin familia, dos fichas con el mismo nombre. Y excluyen a las bajas
 *      como las demás.
 *   4. Una carpeta que reviente no tumba la pantalla: se salta y se apunta.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARPETAS, filasDe, cuentasDe, carpetasCon } from "../lib/clients/urgentes.js";

const ESQUEMA = "crm_x";
const DE_CUOTAS = ["citas_sin_cuota", "citas_sin_cobro", "cuota_no_cuadra"];
const NUEVAS = [...DE_CUOTAS, "paciente_sin_familia", "ficha_duplicada"];

function fakeSequelize({ filas = [], cuenta = 0, conCuotas = true, revienta = null } = {}) {
  const sqls = [];
  return {
    sqls,
    async query(sql) {
      sqls.push(sql);
      if (/to_regclass/.test(sql)) return [[{ con_pacientes: true, con_citas: true, con_cuotas: conCuotas }]];
      if (revienta && sql.includes(revienta)) throw new Error("column bookings.cobro_modo does not exist");
      if (/count\(\*\)::int AS n/.test(sql)) return [[{ n: cuenta }]];
      return [filas];
    },
  };
}

describe("las cinco carpetas nuevas existen tal cual", () => {
  it("con su bloque, su entidad y la marca de cuotas", () => {
    const por = Object.fromEntries(CARPETAS.map((c) => [c.key, c]));
    assert.equal(por.citas_sin_cuota?.bloquea, true);
    assert.equal(por.citas_sin_cuota?.entidad, "client");
    assert.equal(por.citas_sin_cobro?.bloquea, false);
    assert.equal(por.cuota_no_cuadra?.bloquea, false);
    assert.equal(por.paciente_sin_familia?.bloquea, true);
    assert.equal(por.paciente_sin_familia?.entidad, "patient");
    assert.equal(por.ficha_duplicada?.bloquea, false);
    assert.equal(por.ficha_duplicada?.entidad, "patient");
    for (const k of DE_CUOTAS) assert.equal(por[k]?.requiere, "cuotas", `${k} tiene que exigir la tabla de cuotas`);
    for (const k of ["paciente_sin_familia", "ficha_duplicada"]) assert.equal(por[k]?.requiere, undefined, `${k} no depende de cuotas`);
  });
});

describe("sin Facturación no existen; con ella, sí", () => {
  it("filasDe sin cuotas no pregunta nada por las tres de cuotas", async () => {
    for (const k of DE_CUOTAS) {
      const s = fakeSequelize();
      const filas = await filasDe(s, ESQUEMA, k, { conCuotas: false });
      assert.deepEqual(filas, []);
      assert.equal(s.sqls.length, 0, `${k}: consultó sin tener la tabla`);
    }
  });

  it("carpetasCon las esconde sin la tabla y las enseña con ella (a cero también: no son opcionales)", async () => {
    const sin = await carpetasCon(fakeSequelize({ conCuotas: false }), ESQUEMA, null);
    for (const k of DE_CUOTAS) assert.ok(!sin.some((c) => c.key === k), `${k} sale sin tabla de cuotas`);
    for (const k of ["paciente_sin_familia", "ficha_duplicada"]) assert.ok(sin.some((c) => c.key === k), `${k} no depende de cuotas y tiene que salir`);
    const con = await carpetasCon(fakeSequelize({ conCuotas: true }), ESQUEMA, null);
    for (const k of NUEVAS) assert.ok(con.some((c) => c.key === k), `${k} no sale con la tabla de cuotas`);
  });

  it("cuentasDe cuenta las mismas carpetas que enseña el listado", async () => {
    const sin = await cuentasDe(fakeSequelize({ conCuotas: false }), ESQUEMA, { conRevisiones: false });
    for (const k of DE_CUOTAS) assert.equal(sin.porCarpeta[k], undefined, `${k} se cuenta sin tabla de cuotas`);
    const con = await cuentasDe(fakeSequelize({ conCuotas: true, cuenta: 3 }), ESQUEMA, { conRevisiones: false });
    for (const k of NUEVAS) assert.equal(con.porCarpeta[k], 3, `${k} no se cuenta con la tabla de cuotas`);
    // Las rojas suman al bloque que tiene que llegar a cero.
    assert.ok(con.bloquea >= 6, "citas_sin_cuota y paciente_sin_familia van al bloque rojo");
  });
});

describe("cada carpeta pregunta lo que dice", () => {
  const sqlDe = async (k, opts) => {
    const s = fakeSequelize();
    await filasDe(s, ESQUEMA, k, opts);
    return s.sqls[0];
  };

  it("«citas sin cuota»: cita cobrable sin cobro Y familia sin cuota viva", async () => {
    const sql = await sqlDe("citas_sin_cuota");
    assert.match(sql, /b\.cobro_modo IS NULL/);
    assert.match(sql, /b\.taller_grupo_id IS NULL/, "las citas de taller no van por cuota");
    assert.match(sql, /date_trunc\('month', now\(\)\) - interval '1 month'/, "este mes y el anterior");
    assert.match(sql, /AND NOT EXISTS \(SELECT 1 FROM crm_x\.billing_cuotas q WHERE q\.client_id = c\.id AND q\.active\)/);
    assert.match(sql, /paciente en pausa/, "avisa del paciente en pausa");
    assert.match(sql, /coalesce\(c\.status::text,''\)/, "excluye a las familias de baja como las demás");
  });

  it("«citas sin cobro»: lo mismo pero la familia SÍ tiene cuota", async () => {
    const sql = await sqlDe("citas_sin_cobro");
    assert.match(sql, /b\.cobro_modo IS NULL/);
    assert.match(sql, /AND EXISTS \(SELECT 1 FROM crm_x\.billing_cuotas q WHERE q\.client_id = c\.id AND q\.active\)/);
    assert.doesNotMatch(sql, /NOT EXISTS \(SELECT 1 FROM crm_x\.billing_cuotas/);
  });

  it("«la cuota no cuadra»: los minutos del curso contra los del concepto atado", async () => {
    const sql = await sqlDe("cuota_no_cuadra");
    assert.match(sql, /JOIN crm_x\.billing_concepts bc ON bc\.id = b\.cobro_concept_id/);
    // Los minutos salen del curso («· C_T.O. 45»), no de la cadena entera: el id «#126600» lleva un 60.
    assert.match(sql, /substring\(substring\(b\.additional_data from '· \(\.\*\)\$'\) from '\(30\|45\|60\)'\) IS DISTINCT FROM substring\(bc\.name from '\(30\|45\|60\)'\)/);
    assert.match(sql, /b\.additional_data ~ '· C_'/, "solo las citas importadas, que llevan curso");
    // Y la terapia: logopedia cobrada como psicología también es «no cuadra».
    assert.match(sql, /CASE WHEN b\.additional_data ~\* 'LOGOP' THEN 'logopedia'/);
    assert.match(sql, /IS DISTINCT FROM CASE WHEN bc\.name ~\* 'LOGOP' THEN 'logopedia'/);
  });

  it("«paciente sin familia»: client_id a NULL y hora cogida", async () => {
    const sql = await sqlDe("paciente_sin_familia");
    assert.match(sql, /p\.client_id IS NULL AND EXISTS \(SELECT 1 FROM crm_x\.bookings b/);
    assert.match(sql, /LEFT JOIN crm_x\.clients c ON c\.id = p\.client_id/, "sin familia el estado de la familia es coalesce, no un reventón");
  });

  it("«ficha duplicada»: otra ficha con el mismo nombre, sin tildes de más ni espacios dobles", async () => {
    const sql = await sqlDe("ficha_duplicada");
    assert.match(sql, /p2\.id <> p\.id/);
    assert.match(sql, /regexp_replace\(p2\.first_name \|\| ' ' \|\| p2\.last_name, '\\s\+', ' ', 'g'\)/);
    assert.match(sql, /'sin familia'/, "chip para la copia que no cuelga de nadie");
  });

  it("sin tabla de pacientes, las de familia no preguntan por patients; sin agenda, las de cuotas no preguntan nada", async () => {
    for (const k of DE_CUOTAS) {
      assert.doesNotMatch((await sqlDe(k, { conPacientes: false })) ?? "", /crm_x\.patients/, `${k} pregunta por patients sin tenerla`);
      assert.equal(await sqlDe(k, { conCitas: false }), undefined, `${k} pregunta sin agenda`);
    }
  });
});

describe("una carpeta que revienta no tumba la pantalla", () => {
  it("se salta y las demás siguen", async () => {
    const s = fakeSequelize({ revienta: "b.cobro_modo IS NULL" });
    const errores = [];
    const original = process.stderr.write;
    process.stderr.write = (m) => { errores.push(String(m)); return true; };
    let carpetas;
    try { carpetas = await carpetasCon(s, ESQUEMA, null); } finally { process.stderr.write = original; }
    assert.ok(!carpetas.some((c) => c.key === "citas_sin_cuota"), "la carpeta rota tendría que saltarse");
    assert.ok(carpetas.some((c) => c.key === "ficha_duplicada"), "las demás tienen que seguir");
    assert.ok(errores.some((e) => /citas_sin_cuota/.test(e)), "y el fallo queda apuntado en stderr");
  });
});

// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-module-assignments.mjs — las etiquetas de módulo de una ficha
 * («Paciente Nutrición», «Profesional de la salud», «Paciente Clínica») y el
 * freno de `autoAsignarEnAlta` (20/08/2026).
 *
 *   node scripts/_smoke-clients-module-assignments.mjs
 *   node --test-name-pattern="autoAsignarEnAlta" scripts/_smoke-clients-module-assignments.mjs
 *
 * Prueba `lib/clients/moduleAssignments.js` con modelos falsos por parámetro:
 * ni base de datos ni tenant de verdad.
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El auto-marcado de «Paciente Nutrición» al dar de alta nació en la consulta
 * de Laura, donde TODO cliente nuevo es paciente. Atado solo a TENER el módulo
 * era una bomba de relojería: el día que Nutrición se encendiera en Aumenta
 * (1.083 familias, muchas van solo a terapia), cada ficha nueva quedaría
 * marcada de dietas sin que nada lo dijera — se descubriría semanas después,
 * mirando por qué el buscador de nutrición lista a medio centro. Por eso el
 * 13/08/2026 se le puso el flag `nutricion.autoAsignarEnAlta`: apagado por
 * defecto, encendido solo para quien lo pida (hoy, nutri_laura).
 *
 * Esta prueba fija lo que DEVUELVE cada función: que el flag frena ANTES de
 * tocar la tabla; que sin función de flags no se marca nada (marcar de menos
 * se arregla con un clic, marcar de más son mil fichas mal etiquetadas); que
 * `clinica` no se auto-asigna JAMÁS (Aumenta: quien paga no siempre asiste);
 * que `profesional_salud` es una marca gateada por `citas` y no un módulo; y
 * que los fallos de tabla sin migrar nunca tumban un alta ni una conversión.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ASSIGNABLE_MODULE_KEYS,
  MARCAS_ASIGNABLES,
  AUTO_ASSIGN_MODULE_KEYS,
  AUTO_ASSIGN_FLAG,
  marcasYModulosAsignables,
  marcarProfesionalDesdeLead,
  esProfesionalDeLaSalud,
  syncClinicPatient,
  applyAutoAssignments,
  listAssignments,
  isMissingTable,
} from "../lib/clients/moduleAssignments.js";

/* ── Piezas falsas ───────────────────────────────────────────────────────── */

/**
 * La tabla de asignaciones, de mentira: apunta cada llamada y devuelve lo que
 * se le diga. `existente` simula una fila previa (findOrCreate → creada=false);
 * `fallo` hace que cualquier método reviente con ese error.
 */
function tablaAsignaciones(opciones = {}) {
  const llamadas = [];
  return {
    llamadas,
    async findOrCreate({ where, defaults }) {
      llamadas.push({ metodo: "findOrCreate", where, defaults });
      if (opciones.fallo) throw opciones.fallo;
      if (opciones.existente) return [opciones.existente, false];
      return [{ ...where, ...defaults }, true];
    },
    async findOne({ where }) {
      llamadas.push({ metodo: "findOne", where });
      if (opciones.fallo) throw opciones.fallo;
      return opciones.fila ?? null;
    },
    async findAll(args) {
      llamadas.push({ metodo: "findAll", ...args });
      if (opciones.fallo) throw opciones.fallo;
      return opciones.filas ?? [];
    },
  };
}

/** Un Lead de mentira: findByPk devuelve siempre esta ficha (o null). */
const leadQueDevuelve = (lead) => ({
  async findByPk() {
    return lead;
  },
});

/** El error de PostgreSQL cuando la tabla no existe en un tenant viejo. */
const tablaSinMigrar = () =>
  Object.assign(new Error('relation "client_module_assignments" does not exist'), {
    parent: { code: "42P01" },
  });

/** hasModule de mentira: activo lo que se liste, nada más. */
const tenantCon =
  (...modulos) =>
  (k) =>
    modulos.includes(k);

/** hasFeatureFlag de mentira: encendidos los "modulo.flag" que se listen. */
const flagsEncendidos =
  (...encendidos) =>
  (modulo, flag) =>
    encendidos.includes(`${modulo}.${flag}`);

/** Ejecuta fn capturando lo que escriba en stderr, y lo restaura pase lo que pase. */
async function capturandoStderr(fn) {
  const original = process.stderr.write;
  const lineas = [];
  process.stderr.write = (trozo) => {
    lineas.push(String(trozo));
    return true;
  };
  try {
    return { resultado: await fn(), lineas };
  } finally {
    process.stderr.write = original;
  }
}

/* ── El contrato: qué es módulo, qué es marca, qué se auto-asigna ────────── */

describe("el contrato: módulos asignables, marcas y auto-asignación", () => {
  it("los módulos asignables desde la ficha son nutricion y clinica", () => {
    assert.deepEqual(ASSIGNABLE_MODULE_KEYS, ["nutricion", "clinica"]);
  });

  it("profesional_salud es una MARCA, no un módulo: se gatea por citas (sin agenda no hay nada que abrir)", () => {
    assert.deepEqual(MARCAS_ASIGNABLES, [{ key: "profesional_salud", requiereModulo: "citas" }]);
  });

  it("solo nutricion puede marcarse sola en el alta; clinica jamás (quien paga no siempre es quien asiste)", () => {
    assert.deepEqual(AUTO_ASSIGN_MODULE_KEYS, ["nutricion"]);
    assert.equal(AUTO_ASSIGN_MODULE_KEYS.includes("clinica"), false);
  });

  it("el flag se llama autoAsignarEnAlta: renombrarlo apagaría a Laura en silencio (su fila lo guarda con ese nombre)", () => {
    assert.equal(AUTO_ASSIGN_FLAG, "autoAsignarEnAlta");
  });
});

/* ── marcasYModulosAsignables ────────────────────────────────────────────── */

describe("marcasYModulosAsignables: qué casillas se pintan en la ficha", () => {
  it("con todo activo salen las tres, y en su orden: profesional_salud pegada a nutricion (Rodrigo, 12/08)", () => {
    assert.deepEqual(marcasYModulosAsignables(tenantCon("nutricion", "clinica", "citas")), [
      "nutricion",
      "profesional_salud",
      "clinica",
    ]);
  });

  it("solo nutricion → solo su casilla: sin citas no se pinta la de profesional", () => {
    assert.deepEqual(marcasYModulosAsignables(tenantCon("nutricion")), ["nutricion"]);
  });

  it("solo citas → solo la marca de profesional (la casilla vive del módulo que le da sentido)", () => {
    assert.deepEqual(marcasYModulosAsignables(tenantCon("citas")), ["profesional_salud"]);
  });

  it("solo clinica → solo clinica", () => {
    assert.deepEqual(marcasYModulosAsignables(tenantCon("clinica")), ["clinica"]);
  });

  it("no existe un módulo llamado profesional_salud: aunque hasModule dijera que sí, la casilla no sale", () => {
    assert.deepEqual(marcasYModulosAsignables(tenantCon("profesional_salud")), []);
  });

  it("sin ningún módulo activo, ninguna casilla", () => {
    assert.deepEqual(marcasYModulosAsignables(tenantCon()), []);
  });

  it("sin función (null, undefined, un objeto) devuelve [], no revienta", () => {
    assert.deepEqual(marcasYModulosAsignables(null), []);
    assert.deepEqual(marcasYModulosAsignables(undefined), []);
    assert.deepEqual(marcasYModulosAsignables({}), []);
  });

  it("ninguna clave declarada se pierde por el camino: todas salen cuando todo está activo", () => {
    // Si alguien añade una clave a las listas y olvida meterla en el orden de
    // pintado, desaparecería en silencio de la ficha. Esto lo chilla.
    const todas = marcasYModulosAsignables(() => true);
    for (const k of ASSIGNABLE_MODULE_KEYS) assert.ok(todas.includes(k), `falta el módulo ${k}`);
    for (const m of MARCAS_ASIGNABLES) assert.ok(todas.includes(m.key), `falta la marca ${m.key}`);
  });
});

/* ── applyAutoAssignments ────────────────────────────────────────────────── */

describe("applyAutoAssignments: el flag autoAsignarEnAlta decide, no el módulo", () => {
  it("en la consulta de Laura (módulo activo + flag encendido) el alta marca «nutricion» con su rastro", async () => {
    const tabla = tablaAsignaciones();
    const preguntas = [];
    const marcados = await applyAutoAssignments({
      tenantModels: { ClientModuleAssignment: tabla },
      clientId: "c-1",
      tenantHasModule: tenantCon("nutricion", "citas"),
      hasFeatureFlag: (modulo, flag) => {
        preguntas.push(`${modulo}.${flag}`);
        return true;
      },
      userId: "u-9",
    });
    assert.deepEqual(marcados, ["nutricion"]);
    assert.deepEqual(preguntas, ["nutricion.autoAsignarEnAlta"]);
    assert.equal(tabla.llamadas.length, 1);
    const { where, defaults } = tabla.llamadas[0];
    assert.deepEqual(where, { clientId: "c-1", moduleKey: "nutricion" });
    assert.equal(defaults.enabled, true);
    assert.deepEqual(defaults.metadata, { auto: true });
    assert.equal(defaults.assignedByUserId, "u-9");
    assert.ok(defaults.assignedAt instanceof Date);
  });

  it("en Aumenta (módulo activo, flag APAGADO) no se marca nada y NI SE TOCA la tabla", async () => {
    // La razón de ser del flag: con 1.083 familias, marcar de dietas a quien
    // solo va a terapia. Apagado = ninguna escritura, no «escritura a false».
    const tabla = tablaAsignaciones();
    const marcados = await applyAutoAssignments({
      tenantModels: { ClientModuleAssignment: tabla },
      clientId: "c-1",
      tenantHasModule: tenantCon("nutricion", "clinica", "citas"),
      hasFeatureFlag: flagsEncendidos(),
    });
    assert.deepEqual(marcados, []);
    assert.deepEqual(tabla.llamadas, []);
  });

  it("sin función de flags (una ruta que no la pase) no se marca nada: ante la duda, no tocar la ficha", async () => {
    const tabla = tablaAsignaciones();
    const marcados = await applyAutoAssignments({
      tenantModels: { ClientModuleAssignment: tabla },
      clientId: "c-1",
      tenantHasModule: tenantCon("nutricion"),
    });
    assert.deepEqual(marcados, []);
    assert.deepEqual(tabla.llamadas, []);
  });

  it("el flag encendido sin el módulo activo tampoco marca (el flag no enciende módulos)", async () => {
    const tabla = tablaAsignaciones();
    const marcados = await applyAutoAssignments({
      tenantModels: { ClientModuleAssignment: tabla },
      clientId: "c-1",
      tenantHasModule: tenantCon(),
      hasFeatureFlag: flagsEncendidos("nutricion.autoAsignarEnAlta"),
    });
    assert.deepEqual(marcados, []);
    assert.deepEqual(tabla.llamadas, []);
  });

  it("clinica no se auto-asigna NUNCA, ni con todo encendido: el paciente es siempre explícito", async () => {
    const tabla = tablaAsignaciones();
    const marcados = await applyAutoAssignments({
      tenantModels: { ClientModuleAssignment: tabla },
      clientId: "c-1",
      tenantHasModule: () => true,
      hasFeatureFlag: () => true,
    });
    assert.deepEqual(marcados, ["nutricion"]);
    assert.equal(tabla.llamadas.length, 1);
    assert.equal(tabla.llamadas[0].where.moduleKey, "nutricion");
  });

  it("un alta repetida (doble clic, import) no duplica: la fila ya encendida cuenta como marcada", async () => {
    const tabla = tablaAsignaciones({ existente: { enabled: true } });
    const marcados = await applyAutoAssignments({
      tenantModels: { ClientModuleAssignment: tabla },
      clientId: "c-1",
      tenantHasModule: tenantCon("nutricion"),
      hasFeatureFlag: () => true,
    });
    assert.deepEqual(marcados, ["nutricion"]);
  });

  it("si alguien desmarcó la casilla a mano, el alta no la reenciende ni la cuenta", async () => {
    const tabla = tablaAsignaciones({ existente: { enabled: false } });
    const marcados = await applyAutoAssignments({
      tenantModels: { ClientModuleAssignment: tabla },
      clientId: "c-1",
      tenantHasModule: tenantCon("nutricion"),
      hasFeatureFlag: () => true,
    });
    assert.deepEqual(marcados, []);
  });

  it("tenant viejo sin la tabla (42P01): [] y en silencio, el alta ya está bien hecha", async () => {
    const { resultado, lineas } = await capturandoStderr(() =>
      applyAutoAssignments({
        tenantModels: { ClientModuleAssignment: tablaAsignaciones({ fallo: tablaSinMigrar() }) },
        clientId: "c-1",
        tenantHasModule: tenantCon("nutricion"),
        hasFeatureFlag: () => true,
      })
    );
    assert.deepEqual(resultado, []);
    assert.deepEqual(lineas, []);
  });

  it("cualquier otro fallo: [] también, pero con su línea en stderr diciendo módulo y ficha", async () => {
    const { resultado, lineas } = await capturandoStderr(() =>
      applyAutoAssignments({
        tenantModels: {
          ClientModuleAssignment: tablaAsignaciones({ fallo: new Error("se cortó la luz") }),
        },
        clientId: "c-1",
        tenantHasModule: tenantCon("nutricion"),
        hasFeatureFlag: () => true,
      })
    );
    assert.deepEqual(resultado, []);
    assert.equal(lineas.length, 1);
    assert.match(lineas[0], /clients:autoAssign/);
    assert.match(lineas[0], /nutricion en c-1/);
    assert.match(lineas[0], /se cortó la luz/);
  });

  it("sin userId, el autor de la marca queda a null (no se inventa)", async () => {
    const tabla = tablaAsignaciones();
    await applyAutoAssignments({
      tenantModels: { ClientModuleAssignment: tabla },
      clientId: "c-1",
      tenantHasModule: tenantCon("nutricion"),
      hasFeatureFlag: () => true,
    });
    assert.equal(tabla.llamadas[0].defaults.assignedByUserId, null);
  });

  it("sin el modelo de asignaciones o sin tenantHasModule de verdad, []", async () => {
    assert.deepEqual(
      await applyAutoAssignments({
        tenantModels: {},
        clientId: "c-1",
        tenantHasModule: tenantCon("nutricion"),
        hasFeatureFlag: () => true,
      }),
      []
    );
    assert.deepEqual(
      await applyAutoAssignments({
        tenantModels: { ClientModuleAssignment: tablaAsignaciones() },
        clientId: "c-1",
        tenantHasModule: null,
        hasFeatureFlag: () => true,
      }),
      []
    );
  });

  it("con tenantModels ausente REVIENTA en vez de devolver [] (hoy es así)", async () => {
    // SOSPECHOSO: la doc del fichero dice «best-effort: un fallo aquí no puede
    // tumbar un alta», y las hermanas (marcarProfesionalDesdeLead,
    // esProfesionalDeLaSalud) usan `tenantModels ?? {}`; esta desestructura a
    // pelo y con undefined la promesa se rechaza. Los callers de hoy siempre
    // pasan modelos, pero un caller nuevo que no los pase se lleva el TypeError.
    await assert.rejects(
      applyAutoAssignments({
        clientId: "c-1",
        tenantHasModule: tenantCon("nutricion"),
        hasFeatureFlag: () => true,
      }),
      TypeError
    );
  });
});

/* ── marcarProfesionalDesdeLead ──────────────────────────────────────────── */

describe("marcarProfesionalDesdeLead: la marca la pone el lead del servidor, no el navegador", () => {
  const armar = (lead, opcionesTabla = {}) => {
    const tabla = tablaAsignaciones(opcionesTabla);
    return {
      tabla,
      tenantModels: { Lead: leadQueDevuelve(lead), ClientModuleAssignment: tabla },
    };
  };

  it("el lead del formulario de profesionales (profesionalSalud === true) marca la ficha y deja rastro del lead", async () => {
    const { tabla, tenantModels } = armar({ id: "l-7", customFields: { profesionalSalud: true } });
    const marcado = await marcarProfesionalDesdeLead({
      tenantModels,
      clientId: "c-1",
      leadId: "l-7",
      userId: "u-1",
    });
    assert.equal(marcado, true);
    assert.equal(tabla.llamadas.length, 1);
    const { where, defaults } = tabla.llamadas[0];
    assert.deepEqual(where, { clientId: "c-1", moduleKey: "profesional_salud" });
    assert.equal(defaults.enabled, true);
    assert.deepEqual(defaults.metadata, { auto: true, desdeLead: "l-7" });
    assert.equal(defaults.assignedByUserId, "u-1");
  });

  it("solo vale el true estricto: ni «true», ni 1, ni «sí», ni «no» abren los tipos de cita reservados", async () => {
    for (const valor of ["true", 1, "sí", "no", false, undefined, null]) {
      const { tabla, tenantModels } = armar({
        id: "l-7",
        customFields: { profesionalSalud: valor },
      });
      const marcado = await marcarProfesionalDesdeLead({
        tenantModels,
        clientId: "c-1",
        leadId: "l-7",
      });
      assert.equal(marcado, false, `coló ${JSON.stringify(valor)}`);
      assert.deepEqual(tabla.llamadas, [], `escribió con ${JSON.stringify(valor)}`);
    }
  });

  it("un lead sin customFields, o que ya no existe, no marca", async () => {
    const sinCampos = armar({ id: "l-7" });
    assert.equal(
      await marcarProfesionalDesdeLead({
        tenantModels: sinCampos.tenantModels,
        clientId: "c-1",
        leadId: "l-7",
      }),
      false
    );
    const borrado = armar(null);
    assert.equal(
      await marcarProfesionalDesdeLead({
        tenantModels: borrado.tenantModels,
        clientId: "c-1",
        leadId: "l-7",
      }),
      false
    );
  });

  it("sin clientId o sin leadId, false sin tocar nada", async () => {
    const { tabla, tenantModels } = armar({ id: "l-7", customFields: { profesionalSalud: true } });
    assert.equal(await marcarProfesionalDesdeLead({ tenantModels, leadId: "l-7" }), false);
    assert.equal(await marcarProfesionalDesdeLead({ tenantModels, clientId: "c-1" }), false);
    assert.deepEqual(tabla.llamadas, []);
  });

  it("sin modelos (tenant a medias o argumento ausente), false y no revienta", async () => {
    assert.equal(await marcarProfesionalDesdeLead({ clientId: "c-1", leadId: "l-7" }), false);
    assert.equal(
      await marcarProfesionalDesdeLead({ tenantModels: {}, clientId: "c-1", leadId: "l-7" }),
      false
    );
  });

  it("si la tabla de asignaciones no está migrada (42P01), false y silencio", async () => {
    const { tenantModels } = armar(
      { id: "l-7", customFields: { profesionalSalud: true } },
      { fallo: tablaSinMigrar() }
    );
    const { resultado, lineas } = await capturandoStderr(() =>
      marcarProfesionalDesdeLead({ tenantModels, clientId: "c-1", leadId: "l-7" })
    );
    assert.equal(resultado, false);
    assert.deepEqual(lineas, []);
  });

  it("cualquier otro fallo al escribir: false con su línea en stderr, la conversión que creó la ficha sigue", async () => {
    const { tenantModels } = armar(
      { id: "l-7", customFields: { profesionalSalud: true } },
      { fallo: new Error("timeout") }
    );
    const { resultado, lineas } = await capturandoStderr(() =>
      marcarProfesionalDesdeLead({ tenantModels, clientId: "c-1", leadId: "l-7" })
    );
    assert.equal(resultado, false);
    assert.equal(lineas.length, 1);
    assert.match(lineas[0], /clients:profesional/);
    assert.match(lineas[0], /l-7 → c-1/);
  });

  it("con la marca ya existente pero DESACTIVADA a mano, hoy devuelve true sin reencenderla", async () => {
    // SOSPECHOSO: findOrCreate no pisa la fila (bien: respeta lo desmarcado a
    // mano), pero la función devuelve true = «quedó marcado» cuando la marca
    // sigue apagada. applyAutoAssignments sí mira `fila.enabled` para esto.
    // Hoy nadie decide nada con este boolean, así que no rompe nada visible.
    const { tenantModels } = armar(
      { id: "l-7", customFields: { profesionalSalud: true } },
      { existente: { enabled: false } }
    );
    assert.equal(
      await marcarProfesionalDesdeLead({ tenantModels, clientId: "c-1", leadId: "l-7" }),
      true
    );
  });
});

/* ── esProfesionalDeLaSalud ──────────────────────────────────────────────── */

describe("esProfesionalDeLaSalud: la pregunta que abre los tipos de cita de profesionales", () => {
  it("con la marca encendida, sí — y la consulta EXIGE enabled: una marca apagada no abre nada", async () => {
    const tabla = tablaAsignaciones({ fila: { id: "a-1" } });
    const es = await esProfesionalDeLaSalud({ ClientModuleAssignment: tabla }, "c-1");
    assert.equal(es, true);
    assert.deepEqual(tabla.llamadas[0].where, {
      clientId: "c-1",
      moduleKey: "profesional_salud",
      enabled: true,
    });
  });

  it("sin fila, no", async () => {
    const tabla = tablaAsignaciones();
    assert.equal(await esProfesionalDeLaSalud({ ClientModuleAssignment: tabla }, "c-1"), false);
  });

  it("sin modelo, sin clientId o sin modelos siquiera, no (y sin reventar)", async () => {
    assert.equal(await esProfesionalDeLaSalud({}, "c-1"), false);
    assert.equal(await esProfesionalDeLaSalud(undefined, "c-1"), false);
    assert.equal(
      await esProfesionalDeLaSalud({ ClientModuleAssignment: tablaAsignaciones() }, null),
      false
    );
  });

  it("tabla sin migrar: no, y en silencio — es el lado que cierra la puerta", async () => {
    const { resultado, lineas } = await capturandoStderr(() =>
      esProfesionalDeLaSalud(
        { ClientModuleAssignment: tablaAsignaciones({ fallo: tablaSinMigrar() }) },
        "c-1"
      )
    );
    assert.equal(resultado, false);
    assert.deepEqual(lineas, []);
  });

  it("cualquier otro fallo: no, con su línea en stderr", async () => {
    const { resultado, lineas } = await capturandoStderr(() =>
      esProfesionalDeLaSalud(
        { ClientModuleAssignment: tablaAsignaciones({ fallo: new Error("timeout") }) },
        "c-1"
      )
    );
    assert.equal(resultado, false);
    assert.equal(lineas.length, 1);
    assert.match(lineas[0], /clients:profesional/);
  });
});

/* ── syncClinicPatient ───────────────────────────────────────────────────── */

describe("syncClinicPatient: asignar clinica ya no crea ni borra pacientes", () => {
  it("devuelve siempre skip con su motivo, se active o se desactive", async () => {
    const esperado = { action: "skip", reason: "explicit_patient_creation" };
    assert.deepEqual(
      await syncClinicPatient({ tenantModels: {}, client: { id: "c-1" }, enabled: true }),
      esperado
    );
    assert.deepEqual(
      await syncClinicPatient({ tenantModels: {}, client: { id: "c-1" }, enabled: false }),
      esperado
    );
  });

  it("no toca ningún modelo: el paciente se crea con su botón, explícito (Aumenta)", async () => {
    // Si alguien vuelve a materializar pacientes desde aquí, este Proxy chilla.
    const intocable = new Proxy(
      {},
      {
        get() {
          throw new Error("syncClinicPatient no debe tocar los modelos");
        },
      }
    );
    const r = await syncClinicPatient({
      tenantModels: intocable,
      client: { id: "c-1", name: "Familia García" },
      enabled: true,
    });
    assert.equal(r.action, "skip");
  });
});

/* ── listAssignments ─────────────────────────────────────────────────────── */

describe("listAssignments: leer las asignaciones aguanta un schema parcial", () => {
  it("devuelve las filas del cliente, pedidas por módulo en orden alfabético", async () => {
    const filas = [{ moduleKey: "clinica" }, { moduleKey: "nutricion" }];
    const tabla = tablaAsignaciones({ filas });
    assert.equal(await listAssignments(tabla, "c-1"), filas);
    assert.deepEqual(tabla.llamadas[0], {
      metodo: "findAll",
      where: { clientId: "c-1" },
      order: [["moduleKey", "ASC"]],
    });
  });

  it("tenant sin la tabla todavía (42P01): [] — el GET degrada, no revienta", async () => {
    assert.deepEqual(
      await listAssignments(tablaAsignaciones({ fallo: tablaSinMigrar() }), "c-1"),
      []
    );
  });

  it("cualquier otro fallo SUBE: no se disfraza de lista vacía", async () => {
    await assert.rejects(
      listAssignments(tablaAsignaciones({ fallo: new Error("se cortó la luz") }), "c-1"),
      /se cortó la luz/
    );
  });
});

/* ── isMissingTable ──────────────────────────────────────────────────────── */

describe("isMissingTable: reconocer el «esta tabla aún no existe» de PostgreSQL", () => {
  it("el 42P01 se reconoce venga en parent o en original", () => {
    assert.equal(isMissingTable({ parent: { code: "42P01" } }), true);
    assert.equal(isMissingTable({ original: { code: "42P01" } }), true);
  });

  it("otro código o un error normal, no", () => {
    assert.equal(isMissingTable({ parent: { code: "23505" } }), false);
    assert.equal(isMissingTable(new Error("cualquiera")), false);
  });

  it("null y undefined no revientan", () => {
    assert.equal(isMissingTable(null), false);
    assert.equal(isMissingTable(undefined), false);
  });
});

// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-portal-contrato.mjs — el Contrato del Centro visto desde el
 * portal de la familia: qué se enseña, cuándo está pendiente o firmado y qué
 * bloquea (20/08/2026).
 *
 *   node scripts/_smoke-citas-portal-contrato.mjs
 *   node --test-name-pattern="bloquea" scripts/_smoke-citas-portal-contrato.mjs
 *
 * Prueba `lib/citas/portalContract.js`: `gatePortal`, `plantillasActivas`,
 * `huecosDeFicha` y `estadoContrato`, pasándoles modelos FALSOS por parámetro
 * (solo se usan sus `findAll`/`findOne`/`findByPk`, así que un objeto con esos
 * tres métodos basta y no se abre ninguna conexión).
 * `resolvePortalContractSession` NO se prueba aquí: es la puerta de la sesión
 * del portal, y las puertas ya probadas viven en otras smokes. Las piezas que
 * este fichero compone —`situacionDocumentos`, `camposQueFaltan`, `esMenor`…—
 * tienen su propia prueba en `_smoke-clients-contrato-firma.mjs`; aquí se fija
 * la COMPOSICIÓN: lo que el endpoint del portal le devuelve a la pantalla.
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `bloqueado` es la llave de medio portal («Mis documentos» se cierra mientras
 * falte una firma) y sus dos errores posibles ya pasaron DE VERDAD:
 *
 *   · 31/07/2026: el cerrojo se activaba con solo tener el portal encendido, y
 *     a los pacientes reales de nutri_laura les salió una pantalla pidiendo
 *     firmar un contrato que no existía. Regla: sin contrato subido y sin
 *     plantilla activa NO se bloquea nada.
 *   · 06/08/2026: el tutor declarado con `signer: false` y el mismo correo que
 *     la ficha dejaba `firmante` a null: «tienes el contrato pendiente de
 *     firmar» sin ningún botón para firmarlo, y la familia encerrada. Regla:
 *     entrar con el correo de la ficha te identifica como titular, aunque
 *     además figures apuntado como tutor.
 *
 * Y el orden de los documentos también mordió: el consentimiento parental va
 * PRIMERO (`onlyMinors DESC`), y en el deduplicado de huecos manda la
 * definición del documento que NO es solo para menores — si gana la copia del
 * consentimiento, la fecha de nacimiento deja de pedirse antes de firmar y el
 * DNI deja de ser un hueco.
 *
 * Las fechas de nacimiento se construyen a 10 y a 40 años de hoy, a mitad de
 * enero, para que la prueba no caduque ni cambie con la zona horaria.
 *
 * ── POR QUÉ SE IMPORTA CON UN GANCHO ────────────────────────────────────────
 *
 * `portalContract.js` importa `lib/utils/apiResponse.js`, que arrastra
 * `next/server` (a Node pelado le falta el `.js`). Se registra el mismo gancho
 * de `_abrir-lib-hooks.mjs` —solo completa esa extensión, no sustituye nada— y
 * se importa después, igual que `_smoke-projects-ai-parsePlan-editOps.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./_abrir-lib-hooks.mjs", import.meta.url));
const {
  TEMPLATE_SOURCE,
  FIRMA_SIMPLE,
  gatePortal,
  plantillasActivas,
  huecosDeFicha,
  estadoContrato,
} = await import("../lib/citas/portalContract.js");

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

// A 40 y a 10 años de hoy, en enero: adulta y menor en cualquier zona horaria
// y en cualquier fecha en la que se lance la prueba.
const ESTE_ANO = new Date().getUTCFullYear();
const NACIMIENTO_ADULTA = `${ESTE_ANO - 40}-01-15`;
const NACIMIENTO_MENOR = `${ESTE_ANO - 10}-01-15`;

/** La ficha como llega de `resolvePortalAccess`: sin DNI ni teléfono todavía. */
function fichaAdulta(extra = {}) {
  return {
    id: "c1",
    name: "Marta Vega",
    email: "marta@example.com",
    birthDate: NACIMIENTO_ADULTA,
    taxId: null,
    phone: null,
    customFields: {},
    guardians: [],
    ...extra,
  };
}

function fichaMenor(extra = {}) {
  return fichaAdulta({ name: "Lucía Vega", birthDate: NACIMIENTO_MENOR, ...extra });
}

/** El contrato principal: para todo el mundo, con la fecha como campo PREVIO. */
function plantillaContrato() {
  return {
    key: "contrato",
    title: "Contrato del Centro",
    onlyMinors: false,
    fields: [
      { key: "nombre", label: "Nombre y apellidos", ficha: "cliente.name" },
      {
        key: "fechaNacimiento",
        label: "Fecha de nacimiento",
        type: "date",
        previo: true,
        ficha: "cliente.birthDate",
      },
      { key: "dni", label: "DNI", type: "dni", requiredDesdeEdad: 14, ficha: "cliente.taxId" },
      { key: "telefono", label: "Teléfono", type: "tel", ficha: "cliente.phone" },
      { key: "localidad", label: "Localidad" }, // del acto de firmar, no de la persona
    ],
    blocks: [{ id: "principal", title: "Contrato del Centro" }],
  };
}

/**
 * El consentimiento parental: solo menores, y los datos de la paciente son una
 * COPIA con sus propias reglas (DNI opcional, fecha no previa). Es la copia
 * que NO debe ganar el deduplicado de huecos.
 */
function plantillaConsentimiento() {
  return {
    key: "consentimiento",
    title: "Consentimiento parental",
    onlyMinors: true,
    fields: [
      { key: "nombrePaciente", label: "Nombre de la paciente", ficha: "cliente.name" },
      { key: "fnac", label: "Fecha de nacimiento", type: "date", ficha: "cliente.birthDate" },
      { key: "dniPaciente", label: "DNI de la paciente", required: false, ficha: "cliente.taxId" },
      { key: "nombreTutor", label: "Nombre del tutor o tutora", ficha: "tutor.name" },
    ],
    blocks: [{ id: "autorizacion", title: "Autorización" }],
  };
}

const AMBAS = () => [plantillaConsentimiento(), plantillaContrato()]; // el orden de la base: onlyMinors DESC

/** El contrato estándar del centro: un PDF suelto en `documents`. */
const ESTANDAR = () => ({
  id: "doc-estandar",
  source: TEMPLATE_SOURCE,
  fileName: "contrato-del-centro.pdf",
});
/** El contrato de ESTA familia firmado en papel y subido a su ficha. */
const PAPEL = () => ({
  id: "doc-papel",
  clientId: "c1",
  source: "contrato",
  fileName: "contrato-firmado.pdf",
});

/**
 * Modelos falsos con la misma cara que usa `estadoContrato`:
 *   · `puntero` — lo que devuelve `findByPk` (el doc al que apunta la ficha);
 *   · `papel`   — lo que devuelve el respaldo `findOne({ source: "contrato" })`;
 *   · `estandar`, `plantillas`, `firmas` — lo demás.
 */
function modelos({
  puntero = null,
  papel = null,
  estandar = null,
  plantillas = [],
  firmas = [],
} = {}) {
  return {
    Document: {
      findByPk: async (id) => (puntero && String(puntero.id) === String(id) ? puntero : null),
      findOne: async ({ where }) =>
        where.source === "contrato" ? papel : where.source === TEMPLATE_SOURCE ? estandar : null,
    },
    ContractSignature: { findAll: async () => firmas },
    ContractTemplate: { findAll: async () => plantillas },
  };
}

/** Un error de «la tabla no existe», por el camino `parent` o el `original`. */
function errorTablaAusente(via) {
  const err = new Error("relation does not exist");
  err[via] = { code: "42P01" };
  return err;
}

const claves = (campos) => campos.map((c) => c.key);

/* ── gatePortal ───────────────────────────────────────────────────────────── */

const conCitas = (m) => m === "citas";
const TENANT_CON_SSO = { settings: { widget: { sso: { enabled: true } } } };

describe("gatePortal: el mismo portón que el resto del portal", () => {
  it("sin el módulo de citas, 404: el portal no existe para ese centro", async () => {
    const r = gatePortal(TENANT_CON_SSO, () => false);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { ok: false, error: "Módulo no disponible" });
  });

  it("con el módulo pero sin SSO encendido, 403 (también sin settings)", () => {
    assert.equal(
      gatePortal({ settings: { widget: { sso: { enabled: false } } } }, conCitas).status,
      403
    );
    assert.equal(gatePortal({ settings: {} }, conCitas).status, 403);
    assert.equal(gatePortal({}, conCitas).status, 403);
  });

  it("solo el booleano true abre: «true» en texto o un 1 no valen", () => {
    assert.equal(
      gatePortal({ settings: { widget: { sso: { enabled: "true" } } } }, conCitas).status,
      403
    );
    assert.equal(
      gatePortal({ settings: { widget: { sso: { enabled: 1 } } } }, conCitas).status,
      403
    );
  });

  it("módulo y SSO encendidos → null: no hay nada que cortar", () => {
    assert.equal(gatePortal(TENANT_CON_SSO, conCitas), null);
  });
});

/* ── plantillasActivas ────────────────────────────────────────────────────── */

describe("plantillasActivas: qué se firma y en qué orden", () => {
  it("sin el modelo en el schema, lista vacía", async () => {
    assert.deepEqual(await plantillasActivas({}), []);
  });

  it("pide solo las activas, con el consentimiento parental primero (onlyMinors DESC), y devuelve las filas tal cual", async () => {
    let recibido = null;
    const filas = AMBAS();
    const r = await plantillasActivas({
      ContractTemplate: {
        findAll: async (opts) => {
          recibido = opts;
          return filas;
        },
      },
    });
    assert.equal(r, filas);
    assert.deepEqual(recibido, {
      where: { active: true },
      order: [
        ["onlyMinors", "DESC"],
        ["createdAt", "ASC"],
      ],
    });
  });

  it("si la tabla no existe (42P01, venga por parent o por original), lista vacía en vez de tumbar el portal", async () => {
    for (const via of ["parent", "original"]) {
      const r = await plantillasActivas({
        ContractTemplate: {
          findAll: async () => {
            throw errorTablaAusente(via);
          },
        },
      });
      assert.deepEqual(r, [], `con el código en «${via}» tendría que devolver []`);
    }
  });

  it("cualquier otro error de la base se relanza", async () => {
    await assert.rejects(
      plantillasActivas({
        ContractTemplate: {
          findAll: async () => {
            throw new Error("se cayó la conexión");
          },
        },
      }),
      /se cayó la conexión/
    );
  });
});

/* ── huecosDeFicha ────────────────────────────────────────────────────────── */

describe("huecosDeFicha: cada dato se pregunta una vez, y manda el documento que no es solo de menores", () => {
  it("sin plantillas (o con null), no falta nada", () => {
    const vacio = { todos: [], huecos: [], previos: [], posteriores: [] };
    assert.deepEqual(huecosDeFicha([], fichaAdulta()), vacio);
    assert.deepEqual(huecosDeFicha(null, fichaAdulta()), vacio);
  });

  it("el mismo hueco pedido por dos documentos se pregunta una sola vez", () => {
    const { todos } = huecosDeFicha(AMBAS(), fichaAdulta());
    const destinos = todos.map((c) => c.ficha);
    assert.equal(new Set(destinos).size, destinos.length, "hay un destino de ficha repetido");
    assert.equal(todos.filter((c) => c.ficha === "cliente.name").length, 1);
  });

  it("gana la definición del documento que NO es solo para menores: la fecha sigue siendo previa y el DNI sigue siendo hueco", () => {
    const sinFecha = fichaAdulta({ birthDate: null });
    const { huecos, previos, posteriores } = huecosDeFicha(AMBAS(), sinFecha);
    // Si ganara la copia del consentimiento: previos vacío (su fecha no es
    // previa) y sin DNI (allí es opcional). Es justo el fallo del 06/08/2026.
    assert.deepEqual(claves(previos), ["fechaNacimiento"]);
    assert.deepEqual(claves(huecos), ["fechaNacimiento", "dni", "telefono"]);
    assert.deepEqual(claves(posteriores), ["dni", "telefono"]);
  });

  it("con las plantillas en el otro orden sale lo mismo: el orden ya no manda", () => {
    const sinFecha = fichaAdulta({ birthDate: null });
    const alReves = huecosDeFicha([plantillaContrato(), plantillaConsentimiento()], sinFecha);
    assert.deepEqual(claves(alReves.previos), ["fechaNacimiento"]);
    assert.deepEqual(claves(alReves.huecos), ["fechaNacimiento", "dni", "telefono"]);
    assert.deepEqual(
      claves(alReves.todos).sort(),
      claves(huecosDeFicha(AMBAS(), sinFecha).todos).sort()
    );
  });

  it("entre dos documentos del mismo tipo se queda la primera definición", () => {
    const generales = [
      { key: "a", onlyMinors: false, fields: [{ key: "telefonoA", ficha: "cliente.phone" }] },
      { key: "b", onlyMinors: false, fields: [{ key: "telefonoB", ficha: "cliente.phone" }] },
    ];
    assert.deepEqual(claves(huecosDeFicha(generales, fichaAdulta()).todos), ["telefonoA"]);

    const deMenores = [
      { key: "a", onlyMinors: true, fields: [{ key: "telefonoA", ficha: "cliente.phone" }] },
      { key: "b", onlyMinors: true, fields: [{ key: "telefonoB", ficha: "cliente.phone" }] },
    ];
    assert.deepEqual(claves(huecosDeFicha(deMenores, fichaAdulta()).todos), ["telefonoA"]);
  });

  it("la localidad (sin sitio en la ficha) no cuenta, y los datos del tutor no son huecos de la ficha", () => {
    const { todos, huecos } = huecosDeFicha(AMBAS(), fichaAdulta());
    assert.equal(
      todos.some((c) => c.key === "localidad"),
      false
    );
    assert.equal(
      todos.some((c) => c.key === "nombreTutor"),
      true
    ); // sí tiene destino…
    assert.equal(
      huecos.some((c) => c.ficha?.startsWith("tutor.")),
      false
    ); // …pero no es hueco de la ficha
  });

  it("a la menor de 14 no se le exige el DNI, y con la fecha ya en la ficha no quedan previos", () => {
    const { huecos, previos } = huecosDeFicha(AMBAS(), fichaMenor());
    assert.deepEqual(claves(huecos), ["telefono"]);
    assert.deepEqual(previos, []);
  });

  it("una instancia del ORM que solo enseña onlyMinors por get() también cuenta como «solo menores»", () => {
    const instancia = {
      key: "consentimiento",
      fields: [{ key: "nombrePaciente", ficha: "cliente.name" }],
      get: (k) => (k === "onlyMinors" ? true : undefined),
    };
    const { todos } = huecosDeFicha([instancia, plantillaContrato()], fichaAdulta());
    assert.equal(todos.find((c) => c.ficha === "cliente.name").key, "nombre");
  });
});

/* ── estadoContrato: el cerrojo ───────────────────────────────────────────── */

describe("estadoContrato: sin nada que firmar no se cierra el portal (arreglo del 31/07/2026)", () => {
  it("sin contrato subido y sin plantilla activa, no bloquea aunque nadie haya firmado", async () => {
    const r = await estadoContrato(modelos(), fichaAdulta(), null);
    assert.equal(r.bloqueado, false);
    assert.equal(r.documento, null);
    assert.equal(r.estructurado, false);
    assert.equal(r.situacion.contratoCompleto, false);
    assert.equal(r.situacion.firmantes, 1);
  });

  it("sin los modelos siquiera en el schema, lo mismo y sin reventar", async () => {
    const r = await estadoContrato({}, fichaAdulta(), null);
    assert.equal(r.bloqueado, false);
    assert.equal(r.documento, null);
    assert.deepEqual(r.situacion.pendientes, ["Marta Vega"]);
  });

  it("con las tablas sin migrar (42P01 en las tres), lo mismo", async () => {
    const sinTablas = {
      Document: {
        findByPk: async () => {
          throw errorTablaAusente("parent");
        },
        findOne: async () => {
          throw errorTablaAusente("parent");
        },
      },
      ContractSignature: {
        findAll: async () => {
          throw errorTablaAusente("original");
        },
      },
      ContractTemplate: {
        findAll: async () => {
          throw errorTablaAusente("parent");
        },
      },
    };
    const r = await estadoContrato(sinTablas, fichaAdulta(), null);
    assert.equal(r.bloqueado, false);
    assert.equal(r.documento, null);
    assert.equal(r.situacion.firmas, 0);
  });

  it("un error de verdad de la base sí se relanza", async () => {
    const rotos = modelos();
    rotos.Document.findOne = async () => {
      throw new Error("se cayó la conexión");
    };
    await assert.rejects(estadoContrato(rotos, fichaAdulta(), null), /se cayó la conexión/);
  });

  it("una ficha sin nadie que pueda firmar tampoco se bloquea: sería una puerta sin llave", async () => {
    const sinAlta = { name: "Ficha sin alta", guardians: [] }; // sin id: cero firmantes efectivos
    const r = await estadoContrato(modelos({ estandar: ESTANDAR() }), sinAlta, null);
    assert.equal(r.situacion.firmantes, 0);
    assert.equal(r.bloqueado, false);
    assert.equal(r.firmante, null);
  });
});

/* ── estadoContrato: el contrato estándar en PDF ──────────────────────────── */

describe("estadoContrato con el contrato estándar en PDF (el camino de Aumenta)", () => {
  it("subido y sin firmar: pendiente, bloquea, y el PDF que se enseña es el estándar", async () => {
    const r = await estadoContrato(modelos({ estandar: ESTANDAR() }), fichaAdulta(), null);
    assert.equal(r.bloqueado, true);
    assert.equal(r.estructurado, false);
    assert.equal(r.enPapel, false);
    assert.equal(r.documento.id, "doc-estandar");
    assert.equal(r.documento, r.plantilla);
    assert.equal(r.siguienteDocumento, null);
    assert.equal(r.documentosPendientes, 0);
    assert.equal(r.miFirma, null);
    assert.deepEqual(r.datosPendientes, []);
    assert.deepEqual(r.datosPosteriores, []);
    assert.deepEqual(r.situacion, {
      firmantes: 1,
      firmas: 0,
      pendientes: ["Marta Vega"],
      viaPapel: false,
      contratoCompleto: false,
    });
  });

  it("la firma del titular lo completa y desbloquea", async () => {
    const r = await estadoContrato(
      modelos({ estandar: ESTANDAR(), firmas: [{ guardianId: "c1", templateKey: FIRMA_SIMPLE }] }),
      fichaAdulta(),
      null
    );
    assert.equal(r.situacion.contratoCompleto, true);
    assert.equal(r.bloqueado, false);
    assert.equal(r.miFirma.templateKey, FIRMA_SIMPLE);
    assert.deepEqual(r.situacion.pendientes, []);
  });

  it("miFirma prefiere la clave «simple»; sin ella cae a la primera que haya", async () => {
    const dos = await estadoContrato(
      modelos({
        estandar: ESTANDAR(),
        firmas: [
          { guardianId: "c1", templateKey: "anexo" },
          { guardianId: "c1", templateKey: FIRMA_SIMPLE },
        ],
      }),
      fichaAdulta(),
      null
    );
    assert.equal(dos.miFirma.templateKey, FIRMA_SIMPLE);

    const otra = await estadoContrato(
      modelos({ estandar: ESTANDAR(), firmas: [{ guardianId: "c1", templateKey: "anexo" }] }),
      fichaAdulta(),
      null
    );
    assert.equal(otra.miFirma.templateKey, "anexo");
    // SOSPECHOSO: sin plantillas estructuradas, CUALQUIER fila de firma del
    // titular completa el contrato estándar, tenga la clave que tenga: la
    // situación se cuenta por guardianId sin mirar templateKey. Con los datos
    // de hoy no pasa (el endpoint solo escribe "simple"), pero una firma
    // heredada de una plantilla desactivada daría el contrato por firmado.
    assert.equal(otra.situacion.contratoCompleto, true);
    assert.equal(otra.bloqueado, false);
  });

  it("el contrato firmado en PAPEL cuenta como firmado y es el PDF que se enseña", async () => {
    const r = await estadoContrato(
      modelos({ papel: PAPEL(), estandar: ESTANDAR() }),
      fichaAdulta(),
      null
    );
    assert.equal(r.enPapel, true);
    assert.equal(r.situacion.viaPapel, true);
    assert.equal(r.situacion.contratoCompleto, true);
    assert.equal(r.bloqueado, false);
    assert.equal(r.documento.id, "doc-papel");
  });

  it("el papel se encuentra por el puntero de la ficha, y un puntero a un documento de OTRA ficha no vale", async () => {
    const conPuntero = fichaAdulta({ contractDocumentId: "doc-papel" });
    const bien = await estadoContrato(modelos({ puntero: PAPEL() }), conPuntero, null);
    assert.equal(bien.enPapel, true);
    assert.equal(bien.documento.id, "doc-papel");

    const ajeno = { ...PAPEL(), clientId: "c-ajena" };
    const mal = await estadoContrato(
      modelos({ puntero: ajeno, estandar: ESTANDAR() }),
      conPuntero,
      null
    );
    assert.equal(mal.enPapel, false);
    assert.equal(mal.documento.id, "doc-estandar");
  });
});

/* ── estadoContrato: plantillas estructuradas ─────────────────────────────── */

describe("estadoContrato con plantillas estructuradas (el camino de tunutrilaura)", () => {
  it("a la adulta solo le aplica el contrato, y bloquea aunque el centro no tenga PDF estándar", async () => {
    const r = await estadoContrato(modelos({ plantillas: AMBAS() }), fichaAdulta(), null);
    assert.equal(r.estructurado, true);
    assert.equal(r.bloqueado, true);
    assert.equal(r.documento, null); // sin PDF estándar no hay nada que descargar
    assert.equal(r.documentosPendientes, 1);
    assert.equal(r.siguienteDocumento.key, "contrato");
    assert.equal(r.miFirma, null);
    assert.deepEqual(r.situacion.pendientes, ["Marta Vega"]);
    assert.equal(r.situacion.firmas, 0);
    assert.deepEqual(r.datosPendientes, []); // la fecha ya está en la ficha
    assert.deepEqual(claves(r.datosPosteriores), ["dni", "telefono"]);
  });

  it("con plantillas activas Y PDF estándar a la vez, mandan las plantillas; el PDF queda solo como descarga", async () => {
    // El orden de preferencia de la cabecera del fichero: 1º estructuradas,
    // 2º el PDF estándar. Un centro que migra del PDF a las plantillas firma
    // por las plantillas, pero el PDF sigue siendo lo que se descarga.
    const r = await estadoContrato(
      modelos({ estandar: ESTANDAR(), plantillas: AMBAS() }),
      fichaAdulta(),
      null
    );
    assert.equal(r.estructurado, true);
    assert.equal(r.siguienteDocumento.key, "contrato");
    assert.equal(r.documentosPendientes, 1);
    assert.equal(r.documento.id, "doc-estandar");
    assert.equal(r.bloqueado, true);
  });

  it("la firma «simple» del PDF de antes no vale para las plantillas: al activarlas se vuelve a pedir firma", async () => {
    // Quien firmó el PDF estándar y luego el centro activó plantillas tiene un
    // documento NUEVO delante: su firma antigua no lo completa ni asoma como
    // miFirma mientras quede algo por firmar.
    const r = await estadoContrato(
      modelos({
        estandar: ESTANDAR(),
        plantillas: AMBAS(),
        firmas: [{ guardianId: "c1", templateKey: FIRMA_SIMPLE }],
      }),
      fichaAdulta(),
      null
    );
    assert.equal(r.situacion.contratoCompleto, false);
    assert.equal(r.bloqueado, true);
    assert.equal(r.siguienteDocumento.key, "contrato");
    assert.equal(r.miFirma, null);
    assert.equal(r.situacion.firmas, 0);
    assert.deepEqual(r.situacion.pendientes, ["Marta Vega"]);
  });

  it("el siguiente documento viaja serializado y con los datos de la ficha ya resueltos", async () => {
    const r = await estadoContrato(modelos({ plantillas: AMBAS() }), fichaAdulta(), null);
    const nombre = r.siguienteDocumento.fields.find((f) => f.key === "nombre");
    assert.equal(nombre.valor, "Marta Vega");
    assert.equal(nombre.desdeFicha, true);
    const localidad = r.siguienteDocumento.fields.find((f) => f.key === "localidad");
    assert.equal(localidad.valor, null);
    assert.equal(localidad.desdeFicha, false);
    assert.deepEqual(
      r.siguienteDocumento.blocks.map((b) => b.id),
      ["principal"]
    );
  });

  it("a la menor el consentimiento parental le sale PRIMERO", async () => {
    const r = await estadoContrato(modelos({ plantillas: AMBAS() }), fichaMenor(), null);
    assert.equal(r.documentosPendientes, 2);
    assert.equal(r.siguienteDocumento.key, "consentimiento");
    assert.equal(r.siguienteDocumento.onlyMinors, true);
  });

  it("firmado el consentimiento, el siguiente es el contrato y sigue bloqueado", async () => {
    const r = await estadoContrato(
      modelos({
        plantillas: AMBAS(),
        firmas: [{ guardianId: "c1", templateKey: "consentimiento" }],
      }),
      fichaMenor(),
      null
    );
    assert.equal(r.documentosPendientes, 1);
    assert.equal(r.siguienteDocumento.key, "contrato");
    assert.equal(r.bloqueado, true);
    assert.equal(r.situacion.contratoCompleto, false);
  });

  it("firmado todo: completo, desbloqueado y miFirma es la última mía", async () => {
    const r = await estadoContrato(
      modelos({
        plantillas: AMBAS(),
        firmas: [
          { guardianId: "c1", templateKey: "consentimiento" },
          { guardianId: "c1", templateKey: "contrato" },
        ],
      }),
      fichaMenor(),
      null
    );
    assert.equal(r.siguienteDocumento, null);
    assert.equal(r.documentosPendientes, 0);
    assert.equal(r.bloqueado, false);
    assert.equal(r.miFirma.templateKey, "contrato");
    assert.deepEqual(r.situacion.pendientes, []);
    assert.equal(r.situacion.firmas, 1);
    assert.equal(r.situacion.contratoCompleto, true);
  });

  it("el papel también completa el contrato estructurado", async () => {
    const r = await estadoContrato(
      modelos({ plantillas: AMBAS(), papel: PAPEL() }),
      fichaAdulta(),
      null
    );
    assert.equal(r.enPapel, true);
    assert.equal(r.situacion.contratoCompleto, true);
    assert.equal(r.bloqueado, false);
    assert.equal(r.documento.id, "doc-papel");
  });

  it("con padres separados, que yo firme todo no completa el contrato: falta el otro tutor", async () => {
    const familia = fichaMenor({
      guardians: [
        { id: "g1", name: "Padre", email: "padre@example.com", signer: true },
        { id: "g2", name: "Madre", email: "madre@example.com", signer: true },
      ],
    });
    const r = await estadoContrato(
      modelos({
        plantillas: AMBAS(),
        firmas: [
          { guardianId: "g1", templateKey: "consentimiento" },
          { guardianId: "g1", templateKey: "contrato" },
        ],
      }),
      familia,
      { id: "G1" } // el id llega con otras mayúsculas: da igual
    );
    assert.equal(r.firmante.id, "g1");
    assert.equal(r.firmante.titular, false);
    assert.equal(r.documentosPendientes, 0); // a MÍ no me queda nada
    assert.equal(r.siguienteDocumento, null);
    assert.equal(r.miFirma.templateKey, "contrato");
    assert.deepEqual(r.situacion.pendientes, ["Madre"]); // …pero a la familia sí
    assert.equal(r.situacion.firmas, 1);
    assert.equal(r.bloqueado, true);
  });

  it("los datos previos solo se piden mientras quede algo que firmar; los posteriores, siempre", async () => {
    const sinFecha = fichaAdulta({ birthDate: null });
    const antes = await estadoContrato(modelos({ plantillas: AMBAS() }), sinFecha, null);
    assert.deepEqual(claves(antes.datosPendientes), ["fechaNacimiento"]);
    assert.deepEqual(claves(antes.datosPosteriores), ["dni", "telefono"]);

    const despues = await estadoContrato(
      modelos({ plantillas: AMBAS(), firmas: [{ guardianId: "c1", templateKey: "contrato" }] }),
      sinFecha,
      null
    );
    assert.deepEqual(despues.datosPendientes, []); // a quien ya firmó no se le para por una fecha
    assert.deepEqual(claves(despues.datosPosteriores), ["dni", "telefono"]);
  });

  it("un dato que solo pide el documento de menores se le pide también a la adulta", async () => {
    // SOSPECHOSO: los huecos se calculan sobre TODAS las plantillas activas,
    // sin filtrar por las que APLICAN a esta persona (documentosQueAplican).
    // Un campo de ficha que solo declare el consentimiento parental acaba en
    // los datos posteriores de una adulta que nunca firmará ese documento.
    // Hoy no se nota porque las plantillas reales duplican los campos.
    const consentimiento = plantillaConsentimiento();
    consentimiento.fields.push({
      key: "colegio",
      label: "Colegio",
      ficha: "cliente.customFields.colegio",
    });
    const r = await estadoContrato(
      modelos({ plantillas: [consentimiento, plantillaContrato()] }),
      fichaAdulta(),
      null
    );
    assert.equal(r.siguienteDocumento.key, "contrato"); // el consentimiento NO le aplica…
    assert.equal(claves(r.datosPosteriores).includes("colegio"), true); // …pero su campo se le pide igual
  });
});

/* ── estadoContrato: quién ha entrado ─────────────────────────────────────── */

describe("estadoContrato: quién ha entrado (firmante)", () => {
  it("sin tutores estructurados, quien entra es el titular de la ficha", async () => {
    const r = await estadoContrato(modelos({ estandar: ESTANDAR() }), fichaAdulta(), null);
    assert.deepEqual(r.firmante, {
      id: "c1",
      name: "Marta Vega",
      email: "marta@example.com",
      titular: true,
    });
  });

  it("el tutor firmante se identifica sin mirar mayúsculas en el id", async () => {
    const familia = fichaMenor({ guardians: [{ id: "AbC123", name: "Padre", signer: true }] });
    const r = await estadoContrato(modelos({ estandar: ESTANDAR() }), familia, { id: "abc123" });
    assert.equal(r.firmante.id, "AbC123");
    assert.equal(r.firmante.titular, false);
  });

  it("un tutor que NO firma con el correo de la ficha no desbanca al titular (el callejón sin salida del 06/08/2026)", async () => {
    // La madre se declaró en el consentimiento con el correo de la ficha y
    // quedó guardada con signer: false. resolvePortalAccess la devuelve como
    // «tutora», pero las firmas están a nombre del titular: si el firmante se
    // quedara a null, la pantalla diría «pendiente» sin botón para firmar.
    const familia = fichaAdulta({
      guardians: [{ id: "g-tutora", name: "Madre", email: "marta@example.com", signer: false }],
    });
    const tutora = { id: "g-tutora" };

    const sinFirmar = await estadoContrato(modelos({ estandar: ESTANDAR() }), familia, tutora);
    assert.equal(sinFirmar.firmante.titular, true);
    assert.equal(sinFirmar.firmante.id, "c1"); // hay botón: puede firmar como titular

    const firmado = await estadoContrato(
      modelos({ estandar: ESTANDAR(), firmas: [{ guardianId: "c1", templateKey: FIRMA_SIMPLE }] }),
      familia,
      tutora
    );
    assert.equal(firmado.situacion.contratoCompleto, true); // las firmas del titular siguen valiendo
    assert.equal(firmado.bloqueado, false);
    assert.equal(firmado.miFirma.templateKey, FIRMA_SIMPLE);
  });
});

/* ── Las claves que guardan las filas ─────────────────────────────────────── */

describe("las claves con las que se guardan las filas no cambian solas", () => {
  it("el contrato estándar vive en documents.source = contract_template y su firma es la «simple»", () => {
    assert.equal(TEMPLATE_SOURCE, "contract_template");
    assert.equal(FIRMA_SIMPLE, "simple");
  });
});

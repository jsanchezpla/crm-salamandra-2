// @prueba ligera — funciones puras de /lib y lectura del repo; sin base, sin servidor, sin .env.
/**
 * _smoke-actividad-etiquetas.mjs — cada acción de auditoría tiene su frase en
 * cristiano para Equipo → Actividad (19/08/2026).
 *
 *   node scripts/_smoke-actividad-etiquetas.mjs
 *   node --test-name-pattern="CRUCE" scripts/_smoke-actividad-etiquetas.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * La auditoría guarda strings como «nutricion.plan.assigned». La pantalla
 * Equipo → Actividad (`/api/actividad`) los enseña traducidos por
 * `lib/actividad/etiquetas.js`: «Nutrición · Asignó una pauta a un paciente».
 * La regla está en CLAUDE.md (Seguridad → Auditoría): «cada acción con su
 * frase en lib/actividad/etiquetas.js». Lo que no está en el catálogo pasa por
 * un traductor genérico (prefijo → módulo, verbo → pasado) para que una acción
 * nueva nunca salga en crudo… pero sale peor: el 18/08/2026 las cinco de
 * fichaje no tenían frase y en Actividad se leía «Volcado», «Corregido»,
 * «Dado de baja», sin decir de qué. El catálogo no tenía ninguna prueba.
 *
 * Esta fija cuatro cosas:
 *   1. las frases conocidas salen TAL CUAL, con su módulo;
 *   2. una acción desconocida sale legible (frase con mayúscula, sin puntos ni
 *      guiones bajos; nunca undefined ni la clave pelada) y en el módulo de su
 *      prefijo, o en «Otros»;
 *   3. `modulosConocidos()` y `prefijosDeModulo()` devuelven lo que el mapa
 *      dice, y van y vuelven: cada prefijo que da un módulo lleva a ese módulo
 *      por `etiqueta()` (es lo que hace que el filtro en SQL del endpoint y la
 *      etiqueta de la fila no se contradigan);
 *   4. el CRUCE: se leen `app/api/**` y `lib/**` y cada `action: "x.y"` que
 *      escribe el código tiene frase PROPIA en el catálogo. El día que nació
 *      esta prueba faltaban 21 (la lista `LAS_21_DEL_19_08`); ganaron su frase
 *      ese mismo día y `DEUDA_CONOCIDA` quedó vacía. Una acción NUEVA sin frase
 *      pone la prueba en rojo y la salida dice cuál y en qué fichero;
 *   5. ningún prefijo con frase cae en «Otros»: el filtro «Configuración» de la
 *      pantalla buscaba `tenant.*` y lo que se escribe es `configuracion.*`
 *      (no devolvía nada nunca); lo mismo con patient, suppliers, arqueo,
 *      buzon y provisioning.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 * Aserciones sobre lo que devuelven las funciones; el único texto que se lee es
 * el de los endpoints, para saber qué acciones existen de verdad.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { etiqueta, modulosConocidos, prefijosDeModulo } from "../lib/actividad/etiquetas.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ¿Tiene esta acción frase propia en el catálogo, o sale por el genérico?
 *
 * El genérico no mira el prefijo para construir la frase (solo para el
 * módulo): «fichaje.volcado» y «zz_sin_catalogo.volcado» darían la misma
 * «Volcado». Así que una acción tiene frase propia si su texto es DISTINTO del
 * que sale al cambiarle el prefijo por uno que seguro no está catalogado. Esa
 * propiedad del genérico la fija un `it` más abajo: si algún día deja de
 * cumplirse, ese `it` avisa antes de que este atajo mienta.
 */
function tieneFrasePropia(action) {
  const resto = String(action).split(".").slice(1).join(".");
  return etiqueta(action).texto !== etiqueta(`zz_sin_catalogo.${resto}`).texto;
}

// ── 1. Las frases conocidas salen tal cual ──────────────────────────────────

describe("etiqueta: las frases del catálogo salen tal cual, con su módulo", () => {
  it("client.created → Clientes · «Dio de alta un cliente»", () => {
    assert.deepEqual(etiqueta("client.created"), {
      modulo: "Clientes",
      texto: "Dio de alta un cliente",
    });
  });
  it("una muestra de cada módulo", () => {
    const muestra = [
      ["team.created", "Equipo", "Dio de alta a un empleado"],
      ["lead.deleted", "Leads", "Borró un lead"],
      ["ticket.deleted", "Soporte", "Borró un ticket (y su conversación)"],
      ["invoice.issued", "Facturación", "Emitió una factura"],
      ["payment.created", "Facturación", "Registró un cobro"],
      ["order.updated", "Pedidos", "Editó un pedido"],
      ["inventory.stock.adjusted", "Inventario", "Ajustó el stock a mano"],
      ["calendar.task.deleted", "Calendario", "Borró una tarea del calendario"],
      ["project.ai_reorganized", "Proyectos", "Reorganizó un proyecto con IA"],
      ["task.moved", "Proyectos", "Movió una tarea de columna"],
      ["citas.booking_cancelled", "Citas", "Canceló una cita"],
      ["clinica.session.created", "Clínica", "Registró una sesión clínica"],
      ["pacientes.created", "Pacientes", "Dio de alta a un paciente"],
      ["nutricion.plan.assigned", "Nutrición", "Asignó una pauta a un paciente"],
      ["outreach.lead.analyzed", "Captación", "Analizó una empresa con IA"],
      ["document.uploaded", "Documentos", "Subió un documento"],
      ["document_folder.created", "Documentos", "Creó una carpeta de documentos"],
      ["training.sync_manual", "Formación", "Sincronizó la formación con la web"],
      [
        "formularios.solicitud.aceptada",
        "Formularios",
        "Aceptó una solicitud y creó la ficha de cliente",
      ],
      ["ai.uso", "IA", "Usó la IA"],
      ["auth.login_failed", "Accesos", "Intento de acceso fallido"],
    ];
    for (const [action, modulo, texto] of muestra) {
      assert.deepEqual(etiqueta(action), { modulo, texto }, action);
    }
  });
  it("las cinco de fichaje tienen frase propia y módulo Fichaje (faltaban hasta el 18/08/2026)", () => {
    const fichaje = {
      "fichaje.volcado": "Volcó el Excel del reloj de fichar de un mes",
      "fichaje.volcado_deshecho": "Deshizo el volcado de un mes de fichajes",
      "fichaje.creado_a_mano": "Apuntó un fichaje a mano",
      "fichaje.corregido": "Corrigió un fichaje",
      "fichaje.dado_de_baja": "Dio de baja un fichaje",
    };
    for (const [action, texto] of Object.entries(fichaje)) {
      assert.deepEqual(etiqueta(action), { modulo: "Fichaje", texto }, action);
      assert.ok(tieneFrasePropia(action), `${action} sale por el genérico`);
    }
  });
  it("los prefijos legacy «appointment.» y «booking.» son de Citas", () => {
    assert.deepEqual(etiqueta("appointment.meet_link_set"), {
      modulo: "Citas",
      texto: "Puso el enlace de videollamada a una cita",
    });
    assert.deepEqual(etiqueta("booking.reschedule_approved"), {
      modulo: "Citas",
      texto: "Aprobó un cambio de hora de cita",
    });
  });
  it("las de inventario de antes del rework del 02/08/2026 conservan su frase: el histórico las sigue teniendo", () => {
    assert.equal(etiqueta("inventory.inbound.updated").texto, "Editó un producto entrante");
    assert.equal(etiqueta("inventory.outbound.deleted").texto, "Borró un producto de salida");
    assert.equal(etiqueta("inventory.formula.updated").texto, "Editó una receta de inventario");
  });
  it("el «no» se registra igual que el «sí»: las dos respuestas del consentimiento de imágenes tienen frase", () => {
    assert.equal(
      etiqueta("patient.consent.images.granted").texto,
      "Una familia autorizó el uso de imágenes"
    );
    assert.equal(
      etiqueta("patient.consent.images.refused").texto,
      "Una familia NO autorizó el uso de imágenes"
    );
  });
  it("las tres de permisos de IA tienen frase (se escriben por plantilla `ai.permiso_${status}` y el rastreo del CRUCE no las ve)", () => {
    assert.equal(etiqueta("ai.permiso_concedido").texto, "Concedió un permiso de IA");
    assert.equal(etiqueta("ai.permiso_denegado").texto, "Denegó un permiso de IA");
    assert.equal(etiqueta("ai.permiso_revocado").texto, "Revocó un permiso de IA");
  });
});

// ── 2. Lo desconocido sale legible ──────────────────────────────────────────

describe("etiqueta: una acción desconocida pasa por el traductor genérico y sale legible", () => {
  it("el verbo inglés se traduce al pasado y la entidad va detrás: zz.cosa.created → «Creó cosa»", () => {
    const verbos = {
      created: "Creó",
      updated: "Editó",
      deleted: "Borró",
      archived: "Archivó",
      uploaded: "Subió",
      moved: "Movió",
      sent: "Envió",
      issued: "Emitió",
      cancelled: "Canceló",
      assigned: "Asignó",
      confirmed: "Confirmó",
    };
    for (const [ingles, castellano] of Object.entries(verbos)) {
      assert.equal(etiqueta(`zz.cosa.${ingles}`).texto, `${castellano} cosa`, ingles);
    }
  });
  it("sin entidad, solo el verbo: zz.created → «Creó»", () => {
    assert.equal(etiqueta("zz.created").texto, "Creó");
  });
  it("un verbo que no está en la lista se enseña tal cual, con guiones bajos como espacios y mayúscula inicial: fichaje.algo_nuevo → «Algo nuevo»", () => {
    assert.deepEqual(etiqueta("fichaje.algo_nuevo"), { modulo: "Fichaje", texto: "Algo nuevo" });
  });
  it("la entidad también pierde los guiones bajos, y si tiene varios tramos se juntan: «Creó contacto externo», «Borró a b»", () => {
    assert.equal(etiqueta("zz.contacto_externo.created").texto, "Creó contacto externo");
    assert.equal(etiqueta("zz.a.b.deleted").texto, "Borró a b");
  });
  it("nunca devuelve la clave en crudo ni undefined: un string con mayúscula inicial, sin puntos ni guiones bajos", () => {
    for (const action of ["zz.cosa.created", "nutricion.batido.created", "fichaje.algo_nuevo"]) {
      const { texto } = etiqueta(action);
      assert.equal(typeof texto, "string");
      assert.notEqual(texto, action);
      assert.ok(texto.length > 0, "vacío");
      assert.equal(texto[0], texto[0].toUpperCase());
      assert.ok(!texto.includes(".") && !texto.includes("_"), texto);
    }
  });
  it("el prefijo decide el módulo, no la frase: la misma acción con otro prefijo lleva la misma frase y otro módulo", () => {
    // Es la propiedad en la que se apoya `tieneFrasePropia` (arriba).
    assert.equal(etiqueta("fichaje.algo_nuevo").texto, etiqueta("zz.algo_nuevo").texto);
    assert.equal(etiqueta("nutricion.batido.created").texto, etiqueta("zz.batido.created").texto);
    assert.equal(etiqueta("fichaje.algo_nuevo").modulo, "Fichaje");
    assert.equal(etiqueta("zz.algo_nuevo").modulo, "Otros");
  });
  it("un prefijo que no está en el mapa cae en «Otros», y uno conocido lleva a su módulo aunque la frase sea genérica", () => {
    assert.equal(etiqueta("marciano.cosa.created").modulo, "Otros");
    assert.equal(etiqueta("nutricion.batido.created").modulo, "Nutrición");
    assert.equal(etiqueta("citas.cosa_rara").modulo, "Citas");
  });
  it("devuelve exactamente { modulo, texto } y nada más", () => {
    assert.deepEqual(Object.keys(etiqueta("zz.cosa.created")), ["modulo", "texto"]);
    assert.deepEqual(Object.keys(etiqueta("client.created")), ["modulo", "texto"]);
  });
});

// ── 3. Los filtros: lo que el mapa dice, y va y vuelve ──────────────────────

describe("modulosConocidos / prefijosDeModulo: lo que el mapa dice", () => {
  const MODULOS_QUE_HOY_EXISTEN = [
    "Equipo",
    "Clientes",
    "Leads",
    "Soporte",
    "Facturación",
    "Pedidos",
    "Inventario",
    "Calendario",
    "Proyectos",
    "Citas",
    "Clínica",
    "Pacientes",
    "Nutrición",
    "Captación",
    "Documentos",
    "Formación",
    "Formularios",
    "Fichaje",
    "IA",
    "Accesos",
    "Configuración",
  ];

  it("la lista de filtros lleva cada módulo una vez, sin «Otros», e incluye los que hoy existen (si se añade uno, aquí no pasa nada; si se quita, avisa)", () => {
    const lista = modulosConocidos();
    assert.equal(new Set(lista).size, lista.length, "hay módulos repetidos");
    assert.ok(!lista.includes("Otros"));
    for (const m of MODULOS_QUE_HOY_EXISTEN) assert.ok(lista.includes(m), `falta ${m}`);
  });
  it("Fichaje está en la lista (el prefijo faltaba hasta el 18/08/2026)", () => {
    assert.ok(modulosConocidos().includes("Fichaje"));
    assert.deepEqual(prefijosDeModulo("Fichaje"), { prefijos: ["fichaje"] });
  });
  it("es estable: dos llamadas dan lo mismo, y tocar una copia no rompe la siguiente", () => {
    const a = modulosConocidos();
    const b = modulosConocidos();
    assert.deepEqual(a, b);
    a.push("Inventado");
    a.shift();
    assert.deepEqual(modulosConocidos(), b);
  });
  it("Facturación agrupa los siete prefijos de facturas, cobros, gastos, presupuestos, tarifas, series y recurrentes", () => {
    const { prefijos } = prefijosDeModulo("Facturación");
    for (const p of [
      "invoice",
      "payment",
      "cost",
      "quote",
      "rate",
      "invoice_series",
      "recurring",
    ]) {
      assert.ok(prefijos.includes(p), `falta ${p}`);
    }
  });
  it("Citas incluye los prefijos legacy appointment y booking, para que el filtro en SQL no deje fuera las filas viejas", () => {
    const { prefijos } = prefijosDeModulo("Citas");
    assert.ok(prefijos.includes("citas"));
    assert.ok(prefijos.includes("appointment"));
    assert.ok(prefijos.includes("booking"));
  });
  it("ida y vuelta: cada prefijo que devuelve un módulo lleva a ese mismo módulo por etiqueta(), y ningún otro módulo lo reclama", () => {
    const modulos = modulosConocidos();
    for (const modulo of modulos) {
      const r = prefijosDeModulo(modulo);
      assert.ok(r?.prefijos?.length, `${modulo} no tiene prefijos`);
      for (const p of r.prefijos) {
        assert.equal(etiqueta(`${p}.cosa.created`).modulo, modulo, `${p} no vuelve a ${modulo}`);
      }
      for (const otro of modulos) {
        if (otro === modulo) continue;
        for (const p of prefijosDeModulo(otro).prefijos) {
          assert.ok(!r.prefijos.includes(p), `${p} está en ${modulo} y en ${otro}`);
        }
      }
    }
  });
  it("«Otros» devuelve los prefijos a EXCLUIR: todos los conocidos, sin repetir, y ninguno cae en Otros", () => {
    const r = prefijosDeModulo("Otros");
    assert.ok(Array.isArray(r.excluir) && !("prefijos" in r));
    assert.equal(new Set(r.excluir).size, r.excluir.length, "prefijos repetidos");
    for (const modulo of modulosConocidos()) {
      for (const p of prefijosDeModulo(modulo).prefijos) {
        assert.ok(r.excluir.includes(p), `${p} (${modulo}) no se excluye de Otros`);
      }
    }
    for (const p of r.excluir) assert.notEqual(etiqueta(`${p}.cosa`).modulo, "Otros", p);
  });
  it("sin módulo, o con uno desconocido o mal escrito (minúsculas), null: el endpoint no filtra", () => {
    assert.equal(prefijosDeModulo(null), null);
    assert.equal(prefijosDeModulo(undefined), null);
    assert.equal(prefijosDeModulo(""), null);
    assert.equal(prefijosDeModulo("Marciano"), null);
    assert.equal(prefijosDeModulo("facturación"), null);
  });
});

// ── 4. CRUCE: lo que escribe el código tiene frase ──────────────────────────

/**
 * Acciones que se escriben y no tienen frase propia, con el fichero donde se
 * escriben. El 19/08/2026 la prueba nació con 21 aquí dentro; ese mismo día
 * ganaron su frase y la lista quedó VACÍA. Si alguien añade una acción sin
 * frase, el `it` de abajo se pone rojo y la salida dice cuál y dónde: la
 * respuesta correcta es darle frase en `lib/actividad/etiquetas.js`, no
 * apuntarla aquí. Esta lista existe solo para el caso en que una acción se
 * deje a propósito sin frase por un tiempo, con su fichero y sabiendo por qué.
 */
const DEUDA_CONOCIDA = {};

/** Las 21 que faltaban el 19/08/2026 y ya tienen frase propia. */
const LAS_21_DEL_19_08 = [
  "buzon.aviso_creado",
  "buzon.aviso_actualizado",
  "citas.aviso_enviado",
  "citas.booking_confirm_failed",
  "citas.booking_confirm_tarde",
  "citas.booking_tarjeta_pedida",
  "citas.pack_manual_created",
  "citas.pack_actualizado",
  "citas.pack_anulado",
  "client.datos.completados",
  "clinica.contacto_externo.created",
  "clinica.contacto_externo.updated",
  "clinica.contacto_externo.deleted",
  "clinica.derivaciones.updated",
  "clinica.performance.create",
  "clinica.performance.update",
  "clinica.performance.config.update",
  "clinica.report.polished",
  "provisioning.cliente_creado",
  "provisioning.cliente_eliminado",
  "provisioning.credenciales_cliente",
];

/** Ficheros .js/.jsx/.mjs bajo un directorio, recursivo. */
function ficherosBajo(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) out.push(...ficherosBajo(ruta));
    else if (/\.(m?js|jsx)$/.test(e.name)) out.push(ruta);
  }
  return out;
}

/**
 * Las acciones que escribe el código: en cada línea con `action:`, todos los
 * literales "x.y" (también los de un ternario `cond ? "a.b" : "a.c"`). Las que
 * se montan con plantilla (`ai.permiso_${status}`) no se ven aquí; están
 * cubiertas a mano más arriba.
 *
 * Devuelve Map acción → ficheros (relativos a la raíz) donde se escribe.
 */
function accionesEnCodigo() {
  const enCodigo = new Map();
  const literal = /"([a-z_]+(?:\.[a-z_]+)+)"/g;
  for (const carpeta of [join(RAIZ, "app", "api"), join(RAIZ, "lib")]) {
    for (const ruta of ficherosBajo(carpeta)) {
      const rel = relative(RAIZ, ruta).split("\\").join("/");
      for (const linea of readFileSync(ruta, "utf8").split("\n")) {
        if (!/\baction:/.test(linea)) continue;
        for (const m of linea.matchAll(literal)) {
          if (!enCodigo.has(m[1])) enCodigo.set(m[1], new Set());
          enCodigo.get(m[1]).add(rel);
        }
      }
    }
  }
  return enCodigo;
}

describe("CRUCE: cada acción que escriben los endpoints y la lógica tiene frase propia", () => {
  const enCodigo = accionesEnCodigo();

  it("el rastreo encuentra acciones (si da menos de 100, se ha roto el rastreo, no es que no haya)", () => {
    assert.ok(enCodigo.size >= 100, `solo ${enCodigo.size}`);
    assert.ok(enCodigo.has("client.created"));
    assert.ok(enCodigo.has("citas.booking_cancelled"), "lib/citas/cancelBooking.js no se ha leído");
  });

  it("toda acción escrita en app/api o lib tiene frase propia, salvo la deuda apuntada en DEUDA_CONOCIDA", () => {
    const sinFrase = [...enCodigo.keys()]
      .filter((a) => !tieneFrasePropia(a) && !(a in DEUDA_CONOCIDA))
      .sort();
    assert.deepEqual(
      sinFrase,
      [],
      "acciones SIN frase en lib/actividad/etiquetas.js (salen por el traductor genérico):\n" +
        sinFrase.map((a) => `  ${a}  ←  ${[...enCodigo.get(a)].join(", ")}`).join("\n")
    );
  });

  it("la deuda apuntada sigue siendo deuda: cada acción se sigue escribiendo y sigue sin frase (si ya la tiene o ya no se escribe, bórrala de la lista)", () => {
    const caducas = Object.entries(DEUDA_CONOCIDA)
      .filter(([a]) => tieneFrasePropia(a) || !enCodigo.has(a))
      .map(
        ([a, f]) => `${a} (${f}): ${tieneFrasePropia(a) ? "ya tiene frase" : "ya no se escribe"}`
      );
    assert.deepEqual(caducas, []);
  });

  it("las cinco de fichaje se escriben en app/api/fichaje y ya no son deuda", () => {
    for (const a of [
      "fichaje.volcado",
      "fichaje.volcado_deshecho",
      "fichaje.creado_a_mano",
      "fichaje.corregido",
      "fichaje.dado_de_baja",
    ]) {
      assert.ok(enCodigo.has(a), `${a} no se escribe en ningún endpoint`);
      assert.ok(
        [...enCodigo.get(a)].every((f) => f.startsWith("app/api/fichaje/")),
        a
      );
      assert.ok(tieneFrasePropia(a), `${a} sale por el genérico`);
    }
  });

  it("las 21 que faltaban el 19/08/2026 se siguen escribiendo y ya tienen frase propia", () => {
    for (const a of LAS_21_DEL_19_08) {
      assert.ok(enCodigo.has(a), `${a} ya no se escribe en ningún sitio: quítala de esta lista`);
      assert.ok(tieneFrasePropia(a), `${a} ha vuelto a quedarse sin frase`);
    }
  });

  it("la frase de la carrera «cobrada pero ya cancelada» no promete una devolución (decisión pendiente en el Registro)", () => {
    assert.doesNotMatch(etiqueta("citas.booking_confirm_tarde").texto, /devol/i);
  });
});

describe("ningún prefijo con frase cae en «Otros» (19/08/2026: configuracion, patient, suppliers, arqueo, buzon, provisioning)", () => {
  it("toda acción CON frase propia lleva a un módulo de verdad, nunca a «Otros»", () => {
    const enOtros = [
      ...new Set([
        ...Object.keys(DEUDA_CONOCIDA),
        ...LAS_21_DEL_19_08,
        ...accionesEnCodigo().keys(),
      ]),
    ]
      .filter((a) => tieneFrasePropia(a) && etiqueta(a).modulo === "Otros")
      .sort();
    assert.deepEqual(
      enOtros,
      [],
      "tienen frase pero su prefijo no está en MODULOS:\n  " + enOtros.join("\n  ")
    );
  });
  it("el filtro «Configuración» encuentra lo que se escribe: configuracion.updated, no solo el viejo tenant.*", () => {
    assert.equal(etiqueta("configuracion.updated").modulo, "Configuración");
    assert.ok(prefijosDeModulo("Configuración").prefijos.includes("configuracion"));
  });
  it("los huérfanos del 19/08 tienen módulo", () => {
    assert.equal(etiqueta("patient.consent.images.granted").modulo, "Pacientes");
    assert.equal(etiqueta("suppliers.updated").modulo, "Inventario");
    assert.equal(etiqueta("arqueo.cierre.created").modulo, "Facturación");
    assert.equal(etiqueta("buzon.aviso_creado").modulo, "Buzón de ayuda");
    assert.equal(etiqueta("provisioning.cliente_baja").modulo, "Panel interno");
  });
});

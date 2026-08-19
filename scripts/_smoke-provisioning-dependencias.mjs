// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-provisioning-dependencias.mjs — qué necesita cada módulo para
 * funcionar, y qué deja pasar el alta (19/08/2026).
 *
 *   node scripts/_smoke-provisioning-dependencias.mjs
 *   node --test-name-pattern="validarSeleccion" scripts/_smoke-provisioning-dependencias.mjs
 *
 * Prueba `lib/provisioning/dependencias.js` (y, de rebote, lo que lee de
 * `lib/provisioning/catalogo.js`: `CATALOGO`, `CLAVES_VALIDAS`, `requiere`).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Hasta el 10/08/2026 el alta de clientes dejaba marcar Facturación sin
 * Clientes —un cliente que no puede emitir ni una factura, porque `clientId`
 * es NOT NULL y las fichas solo se crean desde Clientes— y, al revés, cuando
 * pedías Clínica metía Pacientes y Clientes EN SILENCIO. Lo que entra en esa
 * lista entra en el contrato y en la factura del cliente, así que ese día
 * `validarSeleccion()` pasó a ser la ÚNICA puerta del alta (`altaTenant.js`),
 * de la edición de módulos de un cliente en marcha (`cicloVida.js`) y de los
 * paquetes (`paquetes.js`); `enable-module.js` la usa para AVISAR. Escribir
 * una obligatoria en la matriz la hace cumplirse en producción: una de más
 * cierra una venta, una de menos vende algo que no funciona.
 *
 * Nada de esto tenía prueba: una clave mal escrita en `claves`, una alternativa
 * («Clínica o Citas») que alguien resolviera por el cliente, o una cascada que
 * volviera a colarse, se habrían notado en el 422 de un alta o en la factura de
 * alguien. Esta prueba fija lo que DEVUELVE cada función: qué selecciones
 * pasan, que se dice SOLO lo que falta (no el requisito entero), que
 * `completarSeleccion` completa cadenas pero nunca elige una alternativa por
 * nadie, que el `requiere` del catálogo se exigiría aunque la matriz no dijera
 * nada (Fichaje → Equipo lo fue hasta el 19/08/2026: hoy la matriz lo dice y el
 * catálogo ya no añade nada encima), y que la tabla del back-office se lee
 * rojo → ambar → verde, de arriba abajo, sin volver atrás.
 *
 * Lo que hoy devuelve algo que no cuadra con su propia cabecera va marcado con
 * `// SOSPECHOSO:` y se prueba tal como está, no como debería.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NIVELES,
  DEPENDENCIAS,
  dependenciasDe,
  seVendeSolo,
  textoNecesita,
  exigenciasDe,
  validarSeleccion,
  completarSeleccion,
  fraseDeExigencia,
  catalogoConExigencias,
  discrepanciasConCatalogo,
  matrizCompleta,
  sinEstudiar,
} from "../lib/provisioning/dependencias.js";
import {
  CATALOGO,
  CLAVES_VALIDAS,
  PAQUETES_SEMILLA,
  moduloPorClave,
} from "../lib/provisioning/catalogo.js";

/* ── Ayudas ──────────────────────────────────────────────────────────────── */

/** Nombre de venta, como lo usan el alta y enable-module.js. */
const nombreDe = (k) => moduloPorClave(k)?.nombre ?? k;

/** El orden del catálogo, que es el orden en que salen las selecciones. */
const ORDEN_CATALOGO = CATALOGO.flatMap((g) => g.modulos.map((m) => m.key));

/** Lo que hoy NO se vende solo (tiene alguna obligatoria), en orden de matriz. */
const NO_SE_VENDEN_SOLOS = [
  "orders",
  "fichaje", // en la matriz desde el 19/08/2026 (antes solo lo protegía el catálogo)
  "billing",
  "nutricion",
  "formularios",
  "pacientes",
  "clinica",
  "team_avanzado",
  "clients_avanzado",
  "documents_avanzado",
  "documents",
];

/** Lo que se vende solo pero pierde algo (solo parciales). */
const PIERDEN_ALGO = [
  "citas",
  "projects",
  "support",
  "outreach",
  "inventory",
  "calendar",
  "analytics",
];

/** Lo que funciona solo al 100 %. */
const INDEPENDIENTES = ["clients", "leads", "team", "training"];

/* ── La matriz: lo que dice de sí misma ──────────────────────────────────── */

describe("la matriz DEPENDENCIAS: coherente con el catálogo y consigo misma", () => {
  it("NIVELES son exactamente dos: obligatorio y parcial", () => {
    assert.deepEqual(Object.keys(NIVELES), ["obligatorio", "parcial"]);
  });

  it("cada módulo de la matriz está en el catálogo y ninguno se repite", () => {
    const claves = DEPENDENCIAS.map((d) => d.modulo);
    assert.equal(new Set(claves).size, claves.length, "hay un módulo repetido");
    for (const k of claves) assert.ok(CLAVES_VALIDAS.has(k), `«${k}» no está en el catálogo`);
  });

  it("cada dependencia apunta a módulos del catálogo, con nivel conocido, porqué y su «donde» fichero:línea", () => {
    for (const d of DEPENDENCIAS) {
      for (const dep of d.necesita) {
        assert.ok(Array.isArray(dep.claves) && dep.claves.length > 0, `${d.modulo}: claves vacías`);
        for (const k of dep.claves)
          assert.ok(CLAVES_VALIDAS.has(k), `${d.modulo} necesita «${k}», que no se vende`);
        assert.ok(dep.nivel in NIVELES, `${d.modulo}: nivel «${dep.nivel}» desconocido`);
        assert.ok(
          typeof dep.porque === "string" && dep.porque.length > 0,
          `${d.modulo}: sin porqué`
        );
        assert.ok(Array.isArray(dep.donde) && dep.donde.length > 0, `${d.modulo}: sin donde`);
        for (const sitio of dep.donde)
          assert.match(sitio, /^[^:]+:\d+$/, `${d.modulo}: donde «${sitio}» no es fichero:línea`);
      }
    }
  });

  it("ningún módulo se necesita a sí mismo", () => {
    for (const d of DEPENDENCIAS) {
      for (const dep of d.necesita)
        assert.ok(!dep.claves.includes(d.modulo), `${d.modulo} se necesita a sí mismo`);
    }
  });

  it("la única alternativa («cualquiera») es la de Equipo avanzado: Clínica o Citas", () => {
    const conAlternativa = DEPENDENCIAS.flatMap((d) =>
      d.necesita.filter((dep) => dep.cualquiera).map((dep) => [d.modulo, dep.claves])
    );
    assert.deepEqual(conAlternativa, [["team_avanzado", ["clinica", "citas"]]]);
  });

  it("paraFuncionar usa las cuatro palabras del teléfono («Sí, total» / «Sí» / «En la práctica sí» / «No») y dice «No» exactamente cuando se vende solo", () => {
    const PALABRAS = ["Sí, total", "Sí", "En la práctica sí", "No"];
    for (const d of DEPENDENCIAS) {
      assert.ok(PALABRAS.includes(d.paraFuncionar), `${d.modulo}: «${d.paraFuncionar}»`);
      // «¿Necesita otro módulo para funcionar?» → «No» ⇔ no tiene obligatorias.
      assert.equal(d.paraFuncionar === "No", seVendeSolo(d.modulo), d.modulo);
    }
  });

  it("los dos paquetes semilla (Nutrición y Clínica) se sostienen tal como están escritos", () => {
    for (const p of PAQUETES_SEMILLA) {
      assert.deepEqual(
        validarSeleccion(p.modulos).problemas,
        [],
        `el paquete «${p.key}» no se sostiene`
      );
    }
  });
});

/* ── dependenciasDe / seVendeSolo ────────────────────────────────────────── */

describe("dependenciasDe / seVendeSolo: ¿se puede vender suelto?", () => {
  it("Pedidos necesita tres cosas: Clientes y Facturación (obligatorias) e Inventario (parcial)", () => {
    assert.deepEqual(
      dependenciasDe("orders").map((d) => [d.claves, d.nivel]),
      [
        [["clients"], "obligatorio"],
        [["billing"], "obligatorio"],
        [["inventory"], "parcial"],
      ]
    );
  });

  it("Clientes, Leads, Equipo y Formación no necesitan nada: []", () => {
    for (const k of INDEPENDIENTES) assert.deepEqual(dependenciasDe(k), [], k);
  });

  it("una clave que no está en la matriz (inventada, null, undefined) devuelve [] y se da por vendible sola", () => {
    assert.deepEqual(dependenciasDe("nope"), []);
    assert.deepEqual(dependenciasDe(null), []);
    assert.deepEqual(dependenciasDe(undefined), []);
    assert.equal(seVendeSolo("nope"), true);
    assert.equal(seVendeSolo(undefined), true);
  });

  it("no se venden solos los once que tienen alguna obligatoria", () => {
    for (const k of NO_SE_VENDEN_SOLOS)
      assert.equal(seVendeSolo(k), false, `${k} debería NO venderse solo`);
  });

  it("se venden solos los que solo tienen parciales y los independientes: las parciales no cierran ventas", () => {
    for (const k of [...PIERDEN_ALGO, ...INDEPENDIENTES])
      assert.equal(seVendeSolo(k), true, `${k} debería venderse solo`);
  });

  it("Citas se vende sola aunque pierda cuatro cosas (Healim la tuvo así, agenda del centro sin reparto)", () => {
    assert.equal(seVendeSolo("citas"), true);
    assert.deepEqual(
      dependenciasDe("citas").map((d) => d.claves[0]),
      ["team", "clients", "pacientes", "team_avanzado"]
    );
    assert.ok(dependenciasDe("citas").every((d) => d.nivel === "parcial"));
  });

  // Hasta el 19/08/2026 `fichaje` estaba en el catálogo (`requiere: ["team"]`)
  // pero no en la matriz: `seVendeSolo` y `textoNecesita` decían que no
  // necesitaba nada mientras el alta lo frenaba. Ahora todas las puertas
  // contestan lo mismo.
  it("Fichaje: la matriz lo tiene, Equipo es obligatoria, y seVendeSolo, textoNecesita y validarSeleccion dicen lo mismo: no se vende solo", () => {
    assert.deepEqual(
      dependenciasDe("fichaje").map((d) => [d.claves, d.nivel]),
      [[["team"], "obligatorio"]]
    );
    assert.equal(seVendeSolo("fichaje"), false);
    assert.equal(textoNecesita("fichaje"), "team");
    assert.equal(textoNecesita("fichaje", nombreDe), "Equipo básico");
    assert.equal(validarSeleccion(["fichaje"]).problemas.length, 1);
  });
});

/* ── textoNecesita ───────────────────────────────────────────────────────── */

describe("textoNecesita: la columna «Necesita» de la tabla", () => {
  it("con obligatorias, solo ESAS y unidas con «+»: Pedidos = clients + billing (Inventario, parcial, no sale)", () => {
    assert.equal(textoNecesita("orders"), "clients + billing");
  });

  it("un requisito con dos claves a la vez también va con «+»: Documentos = citas + clients", () => {
    assert.equal(textoNecesita("documents"), "citas + clients");
  });

  it("una alternativa va entre paréntesis y con «o»: Equipo avanzado = team + (clinica o citas)", () => {
    assert.equal(textoNecesita("team_avanzado"), "team + (clinica o citas)");
  });

  it("sin obligatorias, las parciales separadas por comas y en el orden de la matriz: Citas", () => {
    assert.equal(textoNecesita("citas"), "team, clients, pacientes, team_avanzado");
    assert.equal(textoNecesita("calendar"), "projects, team, clients");
  });

  it("sin dependencias, «—»; una clave desconocida, también «—»", () => {
    assert.equal(textoNecesita("clients"), "—");
    assert.equal(textoNecesita("training"), "—");
    assert.equal(textoNecesita("nope"), "—");
  });

  it("Clínica lleva el texto escrito a mano «Pacientes (→ Clientes)», y gana aunque le den nombres", () => {
    assert.equal(textoNecesita("clinica"), "Pacientes (→ Clientes)");
    assert.equal(textoNecesita("clinica", nombreDe), "Pacientes (→ Clientes)");
  });

  it("nombreDe traduce las claves a nombres de venta sin tocar los separadores", () => {
    assert.equal(textoNecesita("orders", nombreDe), "Clientes + Facturación");
    assert.equal(textoNecesita("team_avanzado", nombreDe), "Equipo básico + (Clínica o Citas)");
    assert.equal(
      textoNecesita("citas", nombreDe),
      "Equipo básico, Clientes, Pacientes, Equipo avanzado"
    );
  });
});

/* ── exigenciasDe ────────────────────────────────────────────────────────── */

describe("exigenciasDe: lo que el alta exige de verdad (matriz + catálogo)", () => {
  it("las obligatorias de la matriz salen con claves, cualquiera (booleano) y porque; las parciales no salen", () => {
    assert.deepEqual(exigenciasDe("clients_avanzado"), [
      {
        claves: ["clients"],
        cualquiera: false,
        porque: "Es una capa sobre las fichas: lista de espera de admisión y huecos de datos.",
      },
    ]);
    // Facturación tiene Clientes (obligatoria) y Equipo (parcial): sale solo una.
    assert.deepEqual(
      exigenciasDe("billing").map((d) => d.claves),
      [["clients"]]
    );
  });

  it("un módulo sin obligatorias y sin requiere en el catálogo: []", () => {
    for (const k of [...INDEPENDIENTES, ...PIERDEN_ALGO]) assert.deepEqual(exigenciasDe(k), [], k);
    assert.deepEqual(exigenciasDe("nope"), []);
  });

  // Hasta el 19/08/2026 Fichaje → Equipo era lo ÚNICO que salía marcado
  // `delCatalogo` (en el catálogo y no en la matriz). Ya está en la matriz, así
  // que hoy el catálogo no exige nada que la matriz no diga ya; la red sigue
  // puesta para el próximo módulo que alguien venda sin repasar.
  it("Fichaje → Equipo sale de la matriz (con su porqué, sin delCatalogo), y hoy ninguna exigencia nace solo del catálogo", () => {
    const [ex, ...resto] = exigenciasDe("fichaje");
    assert.deepEqual(resto, []);
    assert.deepEqual(ex.claves, ["team"]);
    assert.equal(ex.cualquiera, false);
    assert.match(ex.porque, /NOT NULL/);
    assert.equal("delCatalogo" in ex, false);
    for (const k of CLAVES_VALIDAS)
      assert.deepEqual(
        exigenciasDe(k).filter((d) => d.delCatalogo),
        [],
        `${k}: el catálogo exige algo que la matriz no dice`
      );
  });

  it("lo que el catálogo repite de la matriz NO se duplica: Leads comerciales pide clients + leads una sola vez", () => {
    assert.deepEqual(moduloPorClave("formularios").requiere, ["clients", "leads"]);
    const ex = exigenciasDe("formularios");
    assert.equal(ex.length, 1);
    assert.deepEqual(ex[0].claves, ["clients", "leads"]);
    assert.equal("delCatalogo" in ex[0], false);
    // Pedidos igual: el catálogo dice clients y billing, la matriz ya los tiene.
    assert.deepEqual(
      exigenciasDe("orders").map((d) => [d.claves, "delCatalogo" in d]),
      [
        [["clients"], false],
        [["billing"], false],
      ]
    );
  });

  it("Equipo avanzado: Equipo (todos) y además Clínica o Citas (cualquiera: true), en ese orden", () => {
    assert.deepEqual(
      exigenciasDe("team_avanzado").map((d) => [d.claves, d.cualquiera]),
      [
        [["team"], false],
        [["clinica", "citas"], true],
      ]
    );
  });

  it("ninguna exigencia del catálogo lleva alternativa: requiere significa «todos»", () => {
    for (const k of CLAVES_VALIDAS) {
      for (const d of exigenciasDe(k)) if (d.delCatalogo) assert.equal(d.cualquiera, false, k);
    }
  });

  // OJO (no probado: hoy no hay caso): el «ya dicho» con el que `exigenciasDe`
  // evita duplicar el catálogo junta las claves de TODAS las obligatorias,
  // incluidas las de un grupo `cualquiera`. Si el catálogo pusiera algún día
  // `requiere: ["citas"]` a team_avanzado, ese «citas» (todos) se daría por
  // dicho por la alternativa «clinica o citas» y dejaría de exigirse a secas.
  // Hoy el catálogo solo declara `team`, así que no se ve.
  it("Equipo avanzado con Equipo y Clínica pasa, y el catálogo no añade nada encima", () => {
    assert.deepEqual(
      validarSeleccion(["team_avanzado", "team", "clinica", "pacientes", "clients"]).problemas,
      []
    );
    assert.equal(exigenciasDe("team_avanzado").filter((d) => d.delCatalogo).length, 0);
  });
});

/* ── validarSeleccion ────────────────────────────────────────────────────── */

describe("validarSeleccion: la puerta — dice qué falta y NO lo arregla", () => {
  it("una selección vacía, null o undefined pasa: sin módulos y sin problemas", () => {
    assert.deepEqual(validarSeleccion([]), { modulos: [], problemas: [] });
    assert.deepEqual(validarSeleccion(null), { modulos: [], problemas: [] });
    assert.deepEqual(validarSeleccion(undefined), { modulos: [], problemas: [] });
  });

  it("Facturación sola no se sostiene: falta Clientes, y el porqué habla del NOT NULL (el caso del 10/08/2026)", () => {
    const r = validarSeleccion(["billing"]);
    assert.deepEqual(r.modulos, ["billing"]);
    assert.equal(r.problemas.length, 1);
    const [p] = r.problemas;
    assert.equal(p.modulo, "billing");
    assert.deepEqual(p.claves, ["clients"]);
    assert.deepEqual(p.faltan, ["clients"]);
    assert.equal(p.cualquiera, false);
    assert.match(p.porque, /NOT NULL/);
  });

  it("Facturación con Clientes pasa, y los módulos salen en el orden del catálogo (clients antes que billing)", () => {
    assert.deepEqual(validarSeleccion(["billing", "clients"]), {
      modulos: ["clients", "billing"],
      problemas: [],
    });
  });

  it("NO completa en cascada: Clínica sola devuelve Clínica y el problema, sin meter Pacientes ni Clientes", () => {
    const r = validarSeleccion(["clinica"]);
    assert.deepEqual(r.modulos, ["clinica"]);
    assert.deepEqual(
      r.problemas.map((p) => [p.modulo, p.faltan]),
      [["clinica", ["pacientes"]]]
    );
  });

  it("dice solo lo que falta, no el requisito entero: Documentos con Clientes → faltan [citas] aunque claves sea [citas, clients]", () => {
    const [p] = validarSeleccion(["documents", "clients"]).problemas;
    assert.deepEqual(p.claves, ["citas", "clients"]);
    assert.deepEqual(p.faltan, ["citas"]);
  });

  it("con alternativa no falta ninguna en concreto, falta elegir: faltan son las dos y cualquiera es true", () => {
    const r = validarSeleccion(["team_avanzado", "team"]);
    assert.deepEqual(r.modulos, ["team", "team_avanzado"]);
    assert.deepEqual(
      r.problemas.map((p) => [p.modulo, p.claves, p.faltan, p.cualquiera]),
      [["team_avanzado", ["clinica", "citas"], ["clinica", "citas"], true]]
    );
  });

  it("la alternativa se cumple con una cualquiera de las dos: con Citas basta, con Clínica (y su cadena) también", () => {
    assert.deepEqual(validarSeleccion(["team_avanzado", "team", "citas"]).problemas, []);
    assert.deepEqual(
      validarSeleccion(["team_avanzado", "team", "clinica", "pacientes", "clients"]).problemas,
      []
    );
  });

  it("una cadena se valida un peldaño por vez: Clínica + Pacientes solo se queja de que a Pacientes le falta Clientes", () => {
    assert.deepEqual(
      validarSeleccion(["clinica", "pacientes"]).problemas.map((p) => [p.modulo, p.faltan]),
      [["pacientes", ["clients"]]]
    );
  });

  it("un módulo con dos requisitos sin cubrir da dos problemas, en el orden de la matriz: Pedidos → clients y luego billing", () => {
    assert.deepEqual(
      validarSeleccion(["orders"]).problemas.map((p) => [p.modulo, p.faltan]),
      [
        ["orders", ["clients"]],
        ["orders", ["billing"]],
      ]
    );
  });

  it("Equipo avanzado solo: dos problemas (Equipo, y Clínica o Citas)", () => {
    assert.deepEqual(
      validarSeleccion(["team_avanzado"]).problemas.map((p) => [p.faltan, p.cualquiera]),
      [
        [["team"], false],
        [["clinica", "citas"], true],
      ]
    );
  });

  it("Fichaje sin Equipo no pasa, con Equipo sí (y Equipo sale antes, en el orden del catálogo)", () => {
    assert.deepEqual(
      validarSeleccion(["fichaje"]).problemas.map((p) => [p.modulo, p.faltan]),
      [["fichaje", ["team"]]]
    );
    assert.deepEqual(validarSeleccion(["fichaje", "team"]), {
      modulos: ["team", "fichaje"],
      problemas: [],
    });
  });

  it("una selección completa pasa limpia: el Paquete Clínica entero", () => {
    const paquete = PAQUETES_SEMILLA.find((p) => p.key === "clinica").modulos;
    const r = validarSeleccion(paquete);
    assert.deepEqual(r.problemas, []);
    assert.deepEqual([...r.modulos].sort(), [...paquete].sort());
  });

  it("claves repetidas se quedan en una; las que no están en el catálogo (inventadas o internas como provisioning) se descartan en silencio", () => {
    assert.deepEqual(validarSeleccion(["nope", "clients", "clients"]), {
      modulos: ["clients"],
      problemas: [],
    });
    assert.deepEqual(validarSeleccion(["provisioning"]), { modulos: [], problemas: [] });
  });

  it("lo que no es una clave de texto (null, undefined, números) se descarta igual, sin romper", () => {
    assert.deepEqual(validarSeleccion([null, undefined, 1, "clients"]), {
      modulos: ["clients"],
      problemas: [],
    });
  });

  // SOSPECHOSO: si `seleccion` no es un array (un body con `"modulos":
  // "clients"`), no filtra ni devuelve 422: revienta con TypeError. El alta
  // (`altaTenant.js`) le pasa `body.modulos` tal cual, así que ese body acaba
  // en un 500 del endpoint en vez de en «Elige al menos un módulo». La edición
  // (`cicloVida.js`) sí comprueba `Array.isArray` antes. Hoy la pantalla siempre
  // manda un array; se deja escrito lo que hace.
  it("con una cadena en vez de un array revienta con TypeError en vez de tratarla como vacía (SOSPECHOSO)", () => {
    assert.throws(() => validarSeleccion("clients"), TypeError);
    assert.throws(() => completarSeleccion("clients"), TypeError);
  });

  it("los módulos devueltos van en el orden del catálogo, no en el que llegaron", () => {
    const r = validarSeleccion(["training", "clients", "leads"]);
    assert.deepEqual(r.modulos, ["clients", "leads", "training"]);
    const todo = validarSeleccion([...ORDEN_CATALOGO].reverse());
    assert.deepEqual(todo.modulos, ORDEN_CATALOGO);
  });

  it("con TODO el catálogo marcado no falta nada", () => {
    assert.deepEqual(validarSeleccion(ORDEN_CATALOGO).problemas, []);
  });

  it("cada problema lleva exactamente: modulo, claves, faltan, cualquiera, porque (también los que nacen del catálogo, sin delCatalogo)", () => {
    const problemas = validarSeleccion(["orders", "team_avanzado", "fichaje"]).problemas;
    assert.equal(problemas.length, 5);
    for (const p of problemas) {
      assert.deepEqual(Object.keys(p).sort(), [
        "claves",
        "cualquiera",
        "faltan",
        "modulo",
        "porque",
      ]);
    }
  });

  it("no toca la selección que le dan", () => {
    const sel = ["clinica", "nope", "clinica"];
    validarSeleccion(sel);
    assert.deepEqual(sel, ["clinica", "nope", "clinica"]);
  });
});

/* ── completarSeleccion ──────────────────────────────────────────────────── */

describe("completarSeleccion: el botón «añadir también …» (completa cadenas, no elige por nadie)", () => {
  it("Clínica sola → añade Pacientes y Clientes (la cadena entera), en orden del catálogo, y no queda nada sin resolver", () => {
    assert.deepEqual(completarSeleccion(["clinica"]), {
      modulos: ["clients", "pacientes", "clinica"],
      anadidos: ["clients", "pacientes"],
      sinResolver: [],
    });
  });

  it("Pedidos → añade Clientes y Facturación", () => {
    assert.deepEqual(completarSeleccion(["orders"]), {
      modulos: ["clients", "billing", "orders"],
      anadidos: ["clients", "billing"],
      sinResolver: [],
    });
  });

  it("Documentos avanzado → añade Documentos y, por él, Citas y Clientes (transitivo, dos saltos)", () => {
    const r = completarSeleccion(["documents_avanzado"]);
    assert.deepEqual(r.modulos, ["clients", "documents", "documents_avanzado", "citas"]);
    assert.deepEqual(r.anadidos, ["clients", "documents", "citas"]);
    assert.deepEqual(r.sinResolver, []);
  });

  it("Fichaje → añade Equipo (un solo peldaño, sin alternativa: no queda nada sin resolver)", () => {
    assert.deepEqual(completarSeleccion(["fichaje"]), {
      modulos: ["team", "fichaje"],
      anadidos: ["team"],
      sinResolver: [],
    });
  });

  it("una alternativa NO se resuelve por nadie: Equipo avanzado solo añade Equipo y deja «Clínica o Citas» en sinResolver", () => {
    const r = completarSeleccion(["team_avanzado"]);
    assert.deepEqual(r.modulos, ["team", "team_avanzado"]);
    assert.deepEqual(r.anadidos, ["team"]);
    assert.deepEqual(
      r.sinResolver.map((p) => [p.modulo, p.faltan, p.cualquiera]),
      [["team_avanzado", ["clinica", "citas"], true]]
    );
  });

  it("si la alternativa ya viene cubierta (Citas marcada), no queda nada sin resolver", () => {
    assert.deepEqual(completarSeleccion(["team_avanzado", "citas"]), {
      modulos: ["team", "team_avanzado", "citas"],
      anadidos: ["team"],
      sinResolver: [],
    });
  });

  it("lo ya completo no añade nada: anadidos [] (Paquete Nutrición, y Clientes sola)", () => {
    const paquete = PAQUETES_SEMILLA.find((p) => p.key === "nutricion").modulos;
    const r = completarSeleccion(paquete);
    assert.deepEqual(r.anadidos, []);
    assert.deepEqual([...r.modulos].sort(), [...paquete].sort());
    assert.deepEqual(completarSeleccion(["clients"]), {
      modulos: ["clients"],
      anadidos: [],
      sinResolver: [],
    });
  });

  it("vacía, null o solo claves inventadas → todo vacío", () => {
    const vacio = { modulos: [], anadidos: [], sinResolver: [] };
    assert.deepEqual(completarSeleccion([]), vacio);
    assert.deepEqual(completarSeleccion(null), vacio);
    assert.deepEqual(completarSeleccion(["nope"]), vacio);
  });

  it("anadidos es solo lo que NO se pidió, y modulos = pedidos + anadidos (sin repetir)", () => {
    const r = completarSeleccion(["formularios", "clients"]);
    assert.deepEqual(r.modulos, ["clients", "leads", "formularios"]);
    assert.deepEqual(r.anadidos, ["leads"]);
  });

  it("es idempotente: completar lo ya completado no añade nada", () => {
    for (const inicio of [
      ["clinica"],
      ["orders"],
      ["documents_avanzado"],
      ["team_avanzado", "clinica"],
    ]) {
      const una = completarSeleccion(inicio);
      const dos = completarSeleccion(una.modulos);
      assert.deepEqual(dos.anadidos, [], inicio.join(","));
      assert.deepEqual(dos.modulos, una.modulos, inicio.join(","));
    }
  });

  it("no toca la selección que le dan", () => {
    const sel = ["clinica"];
    completarSeleccion(sel);
    assert.deepEqual(sel, ["clinica"]);
  });
});

/* ── fraseDeExigencia ────────────────────────────────────────────────────── */

describe("fraseDeExigencia: la frase que lee quien vende", () => {
  it("«Para activar X hace falta también Y.», con las claves tal cual si no hay nombres", () => {
    assert.equal(
      fraseDeExigencia({
        modulo: "nutricion",
        claves: ["clients"],
        faltan: ["clients"],
        cualquiera: false,
      }),
      "Para activar nutricion hace falta también clients."
    );
  });

  it("con nombreDe usa los nombres de venta, para el módulo y para lo que falta", () => {
    assert.equal(
      fraseDeExigencia(
        { modulo: "nutricion", claves: ["clients"], faltan: ["clients"], cualquiera: false },
        nombreDe
      ),
      "Para activar Nutrición hace falta también Clientes."
    );
  });

  it("varias faltas van con «y»; una alternativa va con «o»", () => {
    assert.equal(
      fraseDeExigencia(
        {
          modulo: "orders",
          claves: ["clients", "billing"],
          faltan: ["clients", "billing"],
          cualquiera: false,
        },
        nombreDe
      ),
      "Para activar Pedidos hace falta también Clientes y Facturación."
    );
    assert.equal(
      fraseDeExigencia(
        {
          modulo: "team_avanzado",
          claves: ["clinica", "citas"],
          faltan: ["clinica", "citas"],
          cualquiera: true,
        },
        nombreDe
      ),
      "Para activar Equipo avanzado hace falta también Clínica o Citas."
    );
  });

  it("usa faltan si viene (solo lo que hay que marcar); si no viene (undefined o null), las claves enteras", () => {
    assert.equal(
      fraseDeExigencia(
        { modulo: "documents", claves: ["citas", "clients"], faltan: ["citas"], cualquiera: false },
        nombreDe
      ),
      "Para activar Documentos básico hace falta también Citas."
    );
    assert.equal(
      fraseDeExigencia(
        { modulo: "documents", claves: ["citas", "clients"], cualquiera: false },
        nombreDe
      ),
      "Para activar Documentos básico hace falta también Citas y Clientes."
    );
    assert.equal(
      fraseDeExigencia(
        { modulo: "documents", claves: ["citas", "clients"], faltan: null, cualquiera: false },
        nombreDe
      ),
      "Para activar Documentos básico hace falta también Citas y Clientes."
    );
  });

  it("lo que devuelve validarSeleccion entra directo: las frases del 422 del alta", () => {
    const frases = validarSeleccion(["orders"]).problemas.map((p) => fraseDeExigencia(p, nombreDe));
    assert.deepEqual(frases, [
      "Para activar Pedidos hace falta también Clientes.",
      "Para activar Pedidos hace falta también Facturación.",
    ]);
  });

  // SOSPECHOSO: con `faltan: []` la frase sale coja («hace falta también .»).
  // Hoy ningún llamador lo produce —validarSeleccion y enable-module.js solo
  // construyen `faltan` cuando algo falta de verdad—, pero la función no se
  // protege. Se deja escrito lo que devuelve.
  it("con faltan [] la frase sale coja («hace falta también .»); ningún llamador lo produce hoy (SOSPECHOSO)", () => {
    assert.equal(
      fraseDeExigencia({ modulo: "x", claves: ["a", "b"], faltan: [], cualquiera: false }),
      "Para activar x hace falta también ."
    );
  });
});

/* ── catalogoConExigencias ───────────────────────────────────────────────── */

describe("catalogoConExigencias: el catálogo con lo que exige cada módulo pegado (lo que lee la pantalla de alta)", () => {
  it("misma forma que el catálogo: mismos grupos y mismos módulos en el mismo orden", () => {
    const con = catalogoConExigencias();
    assert.deepEqual(
      con.map((g) => g.grupo),
      CATALOGO.map((g) => g.grupo)
    );
    assert.deepEqual(
      con.flatMap((g) => g.modulos.map((m) => m.key)),
      ORDEN_CATALOGO
    );
  });

  it("cada módulo conserva sus datos de venta y lleva exige = exigenciasDe(key)", () => {
    for (const g of catalogoConExigencias()) {
      for (const m of g.modulos) {
        const original = moduloPorClave(m.key);
        assert.deepEqual(m, { ...original, exige: exigenciasDe(m.key) }, m.key);
      }
    }
  });

  it("no muta el CATALOGO: después de llamarla, los módulos del catálogo siguen sin exige", () => {
    catalogoConExigencias();
    for (const g of CATALOGO) for (const m of g.modulos) assert.equal("exige" in m, false, m.key);
  });
});

/* ── discrepanciasConCatalogo ────────────────────────────────────────────── */

describe("discrepanciasConCatalogo: el catálogo dice todo lo que el alta va a exigir", () => {
  it("hoy no hay ninguna: cada obligatoria sin alternativa está en el requiere de su módulo", () => {
    assert.deepEqual(discrepanciasConCatalogo(), []);
  });

  it("la alternativa de Equipo avanzado no cuenta aunque el catálogo solo declare Equipo: «Clínica o Citas» no cabe en requiere", () => {
    assert.deepEqual(moduloPorClave("team_avanzado").requiere, ["team"]);
    assert.ok(
      dependenciasDe("team_avanzado").some((d) => d.cualquiera && d.nivel === "obligatorio")
    );
    assert.deepEqual(
      discrepanciasConCatalogo().filter((d) => d.modulo === "team_avanzado"),
      []
    );
  });

  it("las parciales nunca son discrepancia: Citas pierde cuatro cosas y el catálogo no le pone requiere", () => {
    assert.equal(moduloPorClave("citas").requiere, undefined);
    assert.deepEqual(
      discrepanciasConCatalogo().filter((d) => d.modulo === "citas"),
      []
    );
  });
});

/* ── matrizCompleta / sinEstudiar ────────────────────────────────────────── */

describe("matrizCompleta / sinEstudiar: la tabla del back-office, lo más roto arriba", () => {
  it("una fila por módulo de la matriz, en su mismo orden", () => {
    assert.deepEqual(
      matrizCompleta().map((f) => f.modulo),
      DEPENDENCIAS.map((d) => d.modulo)
    );
  });

  it("severidad: rojo si tiene alguna obligatoria, ambar si solo parciales, verde si nada; soloSeVendeSolo va a la par", () => {
    for (const f of matrizCompleta()) {
      const esperada = NO_SE_VENDEN_SOLOS.includes(f.modulo)
        ? "rojo"
        : PIERDEN_ALGO.includes(f.modulo)
          ? "ambar"
          : "verde";
      assert.equal(f.severidad, esperada, f.modulo);
      assert.equal(f.soloSeVendeSolo, esperada !== "rojo", f.modulo);
      assert.equal(f.soloSeVendeSolo, seVendeSolo(f.modulo), f.modulo);
    }
  });

  it("se lee rojo → ambar → verde sin volver atrás (de arriba abajo, y se para cuando deja de doler)", () => {
    const peso = { rojo: 0, ambar: 1, verde: 2 };
    const pesos = matrizCompleta().map((f) => peso[f.severidad]);
    for (let i = 1; i < pesos.length; i++) {
      assert.ok(
        pesos[i] >= pesos[i - 1],
        `la fila ${i} (${matrizCompleta()[i].modulo}) rompe el orden`
      );
    }
    assert.deepEqual(
      [
        pesos.filter((p) => p === 0).length,
        pesos.filter((p) => p === 1).length,
        pesos.filter((p) => p === 2).length,
      ],
      [11, 7, 4]
    );
  });

  it("la fila de Pedidos, entera: grupo de venta, necesita tal cual, y lo que no tiene va a null", () => {
    const [orders] = matrizCompleta();
    assert.deepEqual(orders, {
      modulo: "orders",
      grupo: "Dinero",
      necesita: DEPENDENCIAS[0].necesita,
      paraFuncionar: "Sí, total",
      resumen:
        "`Order.clientId` es NOT NULL → no se puede crear un pedido. Y completarlo da 403 sin Facturación.",
      necesitaTexto: null,
      soloSeVendeSolo: false,
      severidad: "rojo",
      nota: null,
      sinEstudiar: false,
    });
  });

  it("cada fila lleva el grupo de venta del catálogo y sinEstudiar en false", () => {
    for (const f of matrizCompleta()) {
      const grupo = CATALOGO.find((g) => g.modulos.some((m) => m.key === f.modulo))?.grupo ?? null;
      assert.equal(f.grupo, grupo, f.modulo);
      assert.equal(f.sinEstudiar, false, f.modulo);
    }
  });

  it("Clínica conserva su necesitaTexto a mano; Formación sale verde con su nota de venta (matrículas por empresa)", () => {
    const clinica = matrizCompleta().find((f) => f.modulo === "clinica");
    assert.equal(clinica.necesitaTexto, "Pacientes (→ Clientes)");
    const training = matrizCompleta().find((f) => f.modulo === "training");
    assert.equal(training.severidad, "verde");
    assert.match(training.nota, /POR EMPRESA/);
    assert.equal(training.necesita.length, 0);
  });

  // La cabecera de `sinEstudiar()` dice «Debería ser siempre vacío; si algún día
  // no lo es, es que se vendió algo que nadie repasó». Hasta el 19/08/2026
  // devolvía ["fichaje"]: estaba en el catálogo (requiere team) y nadie lo había
  // apuntado en la matriz. Esta prueba lo sacó y la fila entró ese día.
  it("sinEstudiar es vacío: todo lo que se vende está repasado en la matriz (Fichaje incluido, desde el 19/08/2026)", () => {
    assert.deepEqual(sinEstudiar(), []);
    assert.ok(CLAVES_VALIDAS.has("fichaje"));
    assert.equal(
      DEPENDENCIAS.some((d) => d.modulo === "fichaje"),
      true
    );
    // Y en su sitio de la tabla: rojo, segundo tras Pedidos (lo más roto arriba).
    const fila = matrizCompleta().find((f) => f.modulo === "fichaje");
    assert.equal(fila.severidad, "rojo");
    assert.equal(fila.paraFuncionar, "Sí, total");
    assert.equal(fila.grupo, "Base");
    assert.equal(matrizCompleta()[1].modulo, "fichaje");
  });

  it("sinEstudiar y la matriz se reparten el catálogo entero, sin solape", () => {
    const enMatriz = matrizCompleta().map((f) => f.modulo);
    const juntos = [...enMatriz, ...sinEstudiar()].sort();
    assert.deepEqual(juntos, [...ORDEN_CATALOGO].sort());
  });
});

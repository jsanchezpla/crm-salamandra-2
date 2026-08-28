// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-dinero.mjs — el equipo no ve el dinero de las citas (19/08/2026).
 *
 *   node scripts/_smoke-citas-dinero.mjs
 *   node --test-name-pattern="paymentStatus" scripts/_smoke-citas-dinero.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El 07/08/2026 la empleada de Laura (rol `user`) veía en la agenda el chip
 * «No se pudo cobrar · 360,00 €» de una clienta. Laura no quiere que su equipo
 * vea ni las tarifas del centro ni si a alguien le ha fallado un cobro. La regla
 * se recogió en UN fichero, `lib/citas/dinero.js`, para que «qué cuenta como
 * dinero» no quede escrito en seis endpoints que van divergiendo.
 *
 * `lib/citas/dinero.js` no tenía ninguna prueba: la única red era leer el
 * código. Esta prueba fija lo que DEVUELVE cada función —a quién tapa, qué
 * campos quita, qué deja— y que los campos que tapa siguen existiendo en los
 * modelos (si alguien renombra `paymentStatus` en el modelo, la lista de
 * `dinero.js` dejaría de taparlo en silencio: eso es una fuga, no un aviso).
 *
 * ── POR QUÉ `node:test` Y NO EL `check()` DE LAS OTRAS SMOKES ──────────────
 *
 * Es la primera prueba del repo escrita con `node:test` + `node:assert/strict`,
 * que vienen dentro de Node 22: cero dependencias, `package.json` no cambia (y
 * por tanto no dispara el deploy `--full`), y `scripts/pruebas.mjs` la lanza
 * igual que a las demás porque solo mira el código de salida. Lo que gana:
 *
 *   · cada `it` es independiente: si una aserción revienta con excepción, las
 *     demás siguen y el informe dice cuál fue (con `check()` se moría el fichero
 *     entero con un stack trace);
 *   · `assert.deepEqual` pinta la diferencia, no «MAL»;
 *   · `--test-name-pattern` deja lanzar una sola.
 *
 * Las smokes con `check()` no se reescriben por deporte: cuando se toque una,
 * su parte de «función pura» pasa a esta forma. Lo que lee texto del código
 * (¿sigue el `if` donde estaba?) se queda como está: ahí el texto ES la prueba.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  puedeVerDinero,
  citaSinDinero,
  tipoSinDinero,
  citaSegunRol,
  tipoSegunRol,
  filtrarCitas,
  filtrarTipos,
} from "../lib/citas/dinero.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── El contrato: esto es «dinero» y esto no ─────────────────────────────────
// Si alguien quita un campo de la lista de dinero.js, la prueba que falla lleva
// en el nombre el porqué de ese campo. Si añade uno, aquí no pasa nada (bien).

const DINERO_DE_UNA_CITA = [
  "amount",
  "paymentStatus",
  "holdExpiresAt",
  "authorizationExpiresAt",
  "paymentSessionId",
];
const TARIFA_DE_UN_TIPO = ["price", "instalmentPrice", "instalmentMonths"];

/** Una cita como la devuelve el detalle: con todo el dinero y el tipo anidado. */
function citaCompleta() {
  return {
    id: "b-1",
    status: "confirmed",
    clientName: "Paciente de prueba",
    clientEmail: "p@example.com",
    scheduledAt: "2026-08-27T10:00:00.000Z",
    duration: 60,
    teamMemberId: "tm-1",
    amount: 130,
    paymentStatus: "failed",
    holdExpiresAt: "2026-08-20T10:00:00.000Z",
    authorizationExpiresAt: "2026-08-26T10:00:00.000Z",
    paymentSessionId: "cs_test_123",
    eventType: tipoCompleto(),
  };
}

/** Un tipo de cita con su tarifa entera. */
function tipoCompleto() {
  return {
    id: "et-1",
    name: "Acompañamiento mensual",
    color: "#3F6E5B",
    sessionsCount: 1,
    price: 130,
    instalmentPrice: 140,
    instalmentMonths: 2,
  };
}

const SIN = (obj, campos) => campos.every((c) => !(c in obj));
const CON = (obj, campos) => campos.every((c) => c in obj);

describe("puedeVerDinero: solo dirección ve importes y estado de cobro", () => {
  it("admin y superadmin, sí", () => {
    assert.equal(puedeVerDinero("admin"), true);
    assert.equal(puedeVerDinero("superadmin"), true);
  });
  it("user, no (es el rol de la empleada de Laura)", () => {
    assert.equal(puedeVerDinero("user"), false);
  });
  it("sin rol, se cierra: null y undefined cuentan como user", () => {
    assert.equal(puedeVerDinero(null), false);
    assert.equal(puedeVerDinero(undefined), false);
  });
  it("un rol desconocido o mal escrito también se cierra", () => {
    assert.equal(puedeVerDinero("recepcion"), false);
    assert.equal(puedeVerDinero("ADMIN"), false);
    assert.equal(puedeVerDinero(""), false);
  });
});

describe("citaSinDinero: quita el dinero y deja la cita", () => {
  it("quita los cinco campos de dinero", () => {
    const limpia = citaSinDinero(citaCompleta());
    assert.ok(
      SIN(limpia, DINERO_DE_UNA_CITA),
      `siguen: ${DINERO_DE_UNA_CITA.filter((c) => c in limpia)}`
    );
  });
  it("paymentStatus se quita A PROPÓSITO (Laura, 07/08/2026: que no sepan que falló un cobro)", () => {
    assert.equal("paymentStatus" in citaSinDinero(citaCompleta()), false);
  });
  it("deja todo lo que no es dinero", () => {
    const limpia = citaSinDinero(citaCompleta());
    assert.ok(
      CON(limpia, [
        "id",
        "status",
        "clientName",
        "clientEmail",
        "scheduledAt",
        "duration",
        "teamMemberId",
        "eventType",
      ])
    );
    assert.equal(limpia.clientName, "Paciente de prueba");
  });
  it("limpia también la tarifa del tipo anidado (por ahí se colaba la tarifa entera)", () => {
    const limpia = citaSinDinero(citaCompleta());
    assert.ok(SIN(limpia.eventType, TARIFA_DE_UN_TIPO));
    assert.equal(limpia.eventType.name, "Acompañamiento mensual");
    assert.equal(limpia.eventType.color, "#3F6E5B");
  });
  it("no toca el objeto que le dan (el endpoint sigue necesitando el dinero para su lógica)", () => {
    const original = citaCompleta();
    citaSinDinero(original);
    assert.equal(original.amount, 130);
    assert.equal(original.paymentStatus, "failed");
    assert.equal(original.eventType.price, 130);
  });
  it("sin tipo anidado, no inventa uno", () => {
    const sinTipo = { ...citaCompleta(), eventType: null };
    assert.equal(citaSinDinero(sinTipo).eventType, null);
    const sinClave = citaCompleta();
    delete sinClave.eventType;
    assert.equal("eventType" in citaSinDinero(sinClave), false);
  });
  it("con algo que no es una cita, lo devuelve tal cual", () => {
    assert.equal(citaSinDinero(null), null);
    assert.equal(citaSinDinero(undefined), undefined);
    assert.equal(citaSinDinero("texto"), "texto");
  });
});

describe("tipoSinDinero: quita la tarifa y deja el tipo", () => {
  it("quita precio, precio a plazos y número de plazos", () => {
    const limpio = tipoSinDinero(tipoCompleto());
    assert.ok(SIN(limpio, TARIFA_DE_UN_TIPO));
  });
  it("deja nombre, color, sesiones del bono", () => {
    assert.deepEqual(tipoSinDinero(tipoCompleto()), {
      id: "et-1",
      name: "Acompañamiento mensual",
      color: "#3F6E5B",
      sessionsCount: 1,
    });
  });
  it("no toca el original; con null, null", () => {
    const original = tipoCompleto();
    tipoSinDinero(original);
    assert.equal(original.price, 130);
    assert.equal(tipoSinDinero(null), null);
  });
});

describe("citaSegunRol: el atajo de los endpoints que devuelven UNA cita", () => {
  it("a dirección le da la cita entera, el mismo objeto", () => {
    const cita = citaCompleta();
    assert.equal(citaSegunRol(cita, "admin"), cita);
  });
  it("a una usuaria le da la cita sin dinero", () => {
    const limpia = citaSegunRol(citaCompleta(), "user");
    assert.ok(SIN(limpia, DINERO_DE_UNA_CITA));
    assert.ok(SIN(limpia.eventType, TARIFA_DE_UN_TIPO));
  });
  it("sin rol, tapa (nunca se abre por defecto)", () => {
    assert.ok(SIN(citaSegunRol(citaCompleta(), undefined), DINERO_DE_UNA_CITA));
  });
});

describe("filtrarCitas / filtrarTipos: los listados", () => {
  it("a dirección le devuelve la misma lista, sin copiar", () => {
    const lista = [citaCompleta(), citaCompleta()];
    assert.equal(filtrarCitas(lista, "admin"), lista);
    const tipos = [tipoCompleto()];
    assert.equal(filtrarTipos(tipos, "superadmin"), tipos);
  });
  it("a una usuaria le tapa TODAS las citas, no solo la primera", () => {
    const limpias = filtrarCitas([citaCompleta(), citaCompleta(), citaCompleta()], "user");
    assert.equal(limpias.length, 3);
    for (const c of limpias) assert.ok(SIN(c, DINERO_DE_UNA_CITA));
  });
  it("y todos los tipos", () => {
    const limpios = filtrarTipos([tipoCompleto(), tipoCompleto()], "user");
    assert.equal(limpios.length, 2);
    for (const t of limpios) assert.ok(SIN(t, TARIFA_DE_UN_TIPO));
  });
  it("con una lista vacía o ausente, para una usuaria devuelve []", () => {
    assert.deepEqual(filtrarCitas([], "user"), []);
    assert.deepEqual(filtrarCitas(null, "user"), []);
    assert.deepEqual(filtrarCitas(undefined, "user"), []);
    assert.deepEqual(filtrarTipos(null, "user"), []);
  });
});


describe("tipoSegunRol: UN tipo de cita, según quién lo pida", () => {
  /*
   * Faltaba, y su ausencia borró tarifas (28/08/2026). El detalle de un tipo
   * llamaba a `tipoSinDinero` a secas: el formulario abría «Precio (€)» vacío
   * TAMBIÉN para un admin, y al guardar ese vacío pisaba el precio. De los 71
   * tipos de producción, los 3 con precio son de Laura, que cobra por la web.
   */
  it("a dirección le da el tipo entero, con su tarifa", () => {
    const tipo = tipoCompleto();
    assert.equal(tipoSegunRol(tipo, "admin"), tipo);
    assert.equal(tipoSegunRol(tipo, "superadmin").price, tipo.price);
  });
  it("a una usuaria le quita la tarifa", () => {
    assert.ok(SIN(tipoSegunRol(tipoCompleto(), "user"), TARIFA_DE_UN_TIPO));
  });
  it("sin rol, tapa (nunca se abre por defecto)", () => {
    assert.ok(SIN(tipoSegunRol(tipoCompleto(), undefined), TARIFA_DE_UN_TIPO));
  });
});

describe("el detalle de un tipo NO puede tapar el precio a quien puede editarlo", () => {
  /*
   * Esto sí es texto: lo que hay que impedir es que alguien vuelva a escribir
   * `tipoSinDinero(...)` a secas en el detalle. No es una función que se pueda
   * llamar desde aquí — es una llamada que tiene que NO estar.
   */
  const fuente = readFileSync(
    new URL("../app/api/citas/event-types/[id]/route.js", import.meta.url),
    "utf8"
  );
  it("usa tipoSegunRol con el rol de quien pregunta", () => {
    assert.ok(
      fuente.includes("tipoSegunRol(row.toJSON(), rol)"),
      "el detalle tiene que mirar el rol, como hace el listado con filtrarTipos"
    );
    assert.ok(
      fuente.includes('request.headers.get("x-user-role")'),
      "sin leer el rol, tapar «según quién» es imposible"
    );
  });
  it("ya no queda ningún tapado incondicional", () => {
    assert.ok(
      !fuente.includes("tipoSinDinero("),
      "tapar siempre es lo que borraba la tarifa al guardar"
    );
  });
});

describe("los campos que tapa siguen existiendo en los modelos", () => {
  // Si el modelo renombra un campo y dinero.js no se entera, la lista sigue
  // «tapando» un nombre que ya no existe y el dinero sale por el nuevo. Leer el
  // modelo es la forma más barata de enterarse sin abrir la base de datos.
  const booking = readFileSync(join(RAIZ, "models/tenant/Booking.model.js"), "utf8");
  const eventType = readFileSync(join(RAIZ, "models/tenant/EventType.model.js"), "utf8");
  const defineCampo = (texto, campo) => new RegExp(`^\\s*${campo}:\\s*\\{`, "m").test(texto);

  for (const campo of DINERO_DE_UNA_CITA) {
    it(`Booking define «${campo}»`, () => {
      assert.ok(
        defineCampo(booking, campo),
        `${campo} no está en Booking.model.js: ¿se renombró? entonces dinero.js ya no lo tapa`
      );
    });
  }
  for (const campo of TARIFA_DE_UN_TIPO) {
    it(`EventType define «${campo}»`, () => {
      assert.ok(
        defineCampo(eventType, campo),
        `${campo} no está en EventType.model.js: ¿se renombró? entonces dinero.js ya no lo tapa`
      );
    });
  }
});

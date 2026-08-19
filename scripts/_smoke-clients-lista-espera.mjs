// @prueba ligera — funciones de /lib con modelos de mentira; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-lista-espera.mjs — la cola de ADMISIÓN: qué número le toca a
 * una familia nueva y con qué profesional entra (19/08/2026).
 *
 *   node scripts/_smoke-clients-lista-espera.mjs
 *   node --test-name-pattern="terapeuta" scripts/_smoke-clients-lista-espera.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/clients/listaEspera.js` (01/08/2026) es la lista de espera de ADMISIÓN
 * de `clients_avanzado` —gente esperando PLAZA por orden de llegada, la de
 * Aumenta—, que no es la «lista de espera» de Citas. Lo comparten el endpoint
 * de la cola (`/api/clients/waitlist`) y el alta de clientes, que desde esa
 * fecha puede meter a la familia en la cola en el mismo movimiento en que se le
 * abre la ficha; y la ficha pregunta por él para decir «En lista de espera
 * desde el…».
 *
 * Tiene cuatro reglas escritas en sus comentarios y ninguna prueba:
 *
 *   1. el terapeuta se valida ANTES de consultar (la forma de UUID) y contra la
 *      plantilla del propio tenant; `null` («no asignar», el caso normal de una
 *      cola) y `false` («asignar a alguien que no existe», que tiene que dar
 *      error) son cosas DISTINTAS;
 *   2. la posición se calcula leyendo la última (max + 1), dentro de la
 *      transacción si se la pasan, sin contador guardado;
 *   3. una familia con ficha entra en `active` con su `clientId`, no en
 *      `converted`: tiene ficha pero sigue esperando plaza;
 *   4. la entrada viva de un cliente se lee sin ruido: si la tabla no existe en
 *      ese schema (42P01) es `null`, y cualquier otro error sale.
 *
 * Las cuatro funciones reciben los modelos por parámetro (o un `ctx` con
 * `tenantModels`), así que se prueban con un `WaitlistEntry` y un `TeamMember`
 * de mentira que apuntan lo que se les pide y devuelven lo que se les diga.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  terapeutaValido,
  siguientePosicion,
  entrarEnListaEspera,
  entradaDeCliente,
} from "../lib/clients/listaEspera.js";

/** La transacción: un testigo; lo que importa es que llegue ESTE a cada llamada. */
const TX = { nombre: "transacción de prueba" };

const UUID_OK = "3f2a9c1e-7b4d-4e8a-9c2b-1d5e6f7a8b90";
const UUID_OTRO = "9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e";

// ── Dobles ──────────────────────────────────────────────────────────────────

/** Un `ctx` como el de withTenant, con un TeamMember de mentira que conoce unos ids. */
function ctxFalso({ ids = [], sinEquipo = false, revienta = false } = {}) {
  const llamadas = [];
  const TeamMember = {
    async findOne(opts) {
      llamadas.push(["findOne", opts]);
      if (revienta) throw new Error("la base no contesta");
      return ids.includes(opts?.where?.id) ? { id: opts.where.id } : null;
    },
  };
  const ctx = { tenantModels: sinEquipo ? {} : { TeamMember } };
  return { ctx, llamadas };
}

/**
 * Un `WaitlistEntry` de mentira: `findOne` devuelve lo que le digas (la última
 * de la cola, o la entrada viva de un cliente), `create` apunta y devuelve una
 * fila con id. Si `falloAlLeer` es un error, `findOne` lo lanza.
 */
function colaFalsa({ ultima = null, entrada = null, falloAlLeer = null } = {}) {
  const llamadas = [];
  let seq = 0;
  const WaitlistEntry = {
    async findOne(opts) {
      llamadas.push(["findOne", opts]);
      if (falloAlLeer) throw falloAlLeer;
      // La misma función sirve a siguientePosicion (sin where) y a
      // entradaDeCliente (con where): se distingue por lo que piden.
      return opts?.where ? entrada : ultima;
    },
    async create(datos, opts) {
      llamadas.push(["create", datos, opts]);
      return { id: `w-${++seq}`, ...datos };
    },
  };
  return { WaitlistEntry, llamadas };
}

const clienteDePrueba = () => ({
  id: "c-1",
  name: "Familia Pérez",
  email: "familia.perez@ejemplo.com",
  phone: "600 12-34-56",
});

// ── terapeutaValido ─────────────────────────────────────────────────────────

describe("terapeutaValido: null es «sin asignar», false es «no existe», el id es «vale»", () => {
  it("sin valor (undefined, null o «»), null: entrar sin terapeuta es el caso normal de una cola", async () => {
    const { ctx, llamadas } = ctxFalso({ ids: [UUID_OK] });
    assert.equal(await terapeutaValido(ctx, undefined), null);
    assert.equal(await terapeutaValido(ctx, null), null);
    assert.equal(await terapeutaValido(ctx, ""), null);
    assert.deepEqual(llamadas, [], "sin valor no hay nada que consultar");
  });

  it("un id que existe en la plantilla vuelve tal cual, como texto", async () => {
    const { ctx } = ctxFalso({ ids: [UUID_OK] });
    const r = await terapeutaValido(ctx, UUID_OK);
    assert.equal(r, UUID_OK);
    assert.equal(typeof r, "string");
  });

  it("busca por id en la plantilla, pidiendo solo el id", async () => {
    const { ctx, llamadas } = ctxFalso({ ids: [UUID_OK] });
    await terapeutaValido(ctx, UUID_OK);
    assert.deepEqual(llamadas, [["findOne", { where: { id: UUID_OK }, attributes: ["id"] }]]);
  });

  it("un UUID bien formado que no es de nadie del equipo, false (no null: tiene que dar error, no guardarse como «sin asignar»)", async () => {
    const { ctx, llamadas } = ctxFalso({ ids: [UUID_OTRO] });
    const r = await terapeutaValido(ctx, UUID_OK);
    assert.equal(r, false);
    assert.notEqual(r, null);
    assert.equal(llamadas.length, 1, "sí se consultó: la forma era buena");
  });

  it("algo que no tiene forma de UUID es false SIN consultar (la base reventaría con un 500)", async () => {
    const { ctx, llamadas } = ctxFalso({ ids: [UUID_OK] });
    assert.equal(await terapeutaValido(ctx, "juan"), false);
    assert.equal(await terapeutaValido(ctx, "123"), false);
    assert.equal(await terapeutaValido(ctx, 123), false);
    assert.equal(await terapeutaValido(ctx, UUID_OK + "x"), false);
    assert.equal(await terapeutaValido(ctx, "3f2a9c1e7b4d4e8a9c2b1d5e6f7a8b90"), false);
    assert.deepEqual(llamadas, []);
  });

  it("el UUID vale en mayúsculas y se consulta tal y como llegó", async () => {
    const mayus = UUID_OK.toUpperCase();
    const { ctx, llamadas } = ctxFalso({ ids: [mayus] });
    assert.equal(await terapeutaValido(ctx, mayus), mayus);
    assert.equal(llamadas[0][1].where.id, mayus);
  });

  it("sin módulo de equipo (sin TeamMember en el ctx), un id con buena forma es false", async () => {
    const { ctx, llamadas } = ctxFalso({ sinEquipo: true });
    assert.equal(await terapeutaValido(ctx, UUID_OK), false);
    assert.deepEqual(llamadas, []);
  });

  it("sin ctx, o con un ctx sin tenantModels, también false (y no revienta)", async () => {
    assert.equal(await terapeutaValido(null, UUID_OK), false);
    assert.equal(await terapeutaValido(undefined, UUID_OK), false);
    assert.equal(await terapeutaValido({}, UUID_OK), false);
  });

  it("pero sin ctx y sin valor sigue siendo null: «no asignar» no necesita plantilla", async () => {
    assert.equal(await terapeutaValido(null, null), null);
    assert.equal(await terapeutaValido(undefined, ""), null);
  });

  it("si la consulta revienta, el error SALE (el endpoint lo convierte en 500, no en «sin asignar»)", async () => {
    const { ctx } = ctxFalso({ revienta: true });
    await assert.rejects(terapeutaValido(ctx, UUID_OK), /la base no contesta/);
  });
});

// ── siguientePosicion ───────────────────────────────────────────────────────

describe("siguientePosicion: la última más uno, sin contador guardado", () => {
  it("con la cola vacía, la primera posición es 1", async () => {
    const { WaitlistEntry } = colaFalsa({ ultima: null });
    assert.equal(await siguientePosicion(WaitlistEntry), 1);
  });

  it("con una última en 7, la siguiente es 8", async () => {
    const { WaitlistEntry } = colaFalsa({ ultima: { position: 7 } });
    assert.equal(await siguientePosicion(WaitlistEntry), 8);
  });

  it("lee SOLO la última por posición descendente, y solo la posición", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa({ ultima: { position: 3 } });
    await siguientePosicion(WaitlistEntry);
    assert.deepEqual(llamadas, [
      ["findOne", { order: [["position", "DESC"]], attributes: ["position"] }],
    ]);
  });

  it("con transacción, la pasa tal cual; sin ella, no manda la clave (ni siquiera vacía)", async () => {
    const con = colaFalsa({ ultima: { position: 3 } });
    await siguientePosicion(con.WaitlistEntry, TX);
    assert.equal(con.llamadas[0][1].transaction, TX);

    const sin = colaFalsa({ ultima: { position: 3 } });
    await siguientePosicion(sin.WaitlistEntry);
    assert.equal("transaction" in sin.llamadas[0][1], false);

    const nula = colaFalsa({ ultima: { position: 3 } });
    await siguientePosicion(nula.WaitlistEntry, null);
    assert.equal("transaction" in nula.llamadas[0][1], false);
  });

  it("una última sin posición (null o undefined) cuenta como cero: la siguiente es 1", async () => {
    assert.equal(
      await siguientePosicion(colaFalsa({ ultima: { position: null } }).WaitlistEntry),
      1
    );
    assert.equal(await siguientePosicion(colaFalsa({ ultima: {} }).WaitlistEntry), 1);
  });

  it("una última en 0 da 1 (0 es un número, no «sin posición»)", async () => {
    assert.equal(await siguientePosicion(colaFalsa({ ultima: { position: 0 } }).WaitlistEntry), 1);
  });
});

// ── entrarEnListaEspera ─────────────────────────────────────────────────────

describe("entrarEnListaEspera: una familia YA con ficha entra al final de la cola", () => {
  it("sin modelo (el tenant no tiene la cola), null y sin tocar nada", async () => {
    assert.equal(
      await entrarEnListaEspera({ WaitlistEntry: null, client: clienteDePrueba() }),
      null
    );
    assert.equal(await entrarEnListaEspera({ client: clienteDePrueba() }), null);
  });

  it("sin cliente, null y sin tocar nada", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa();
    assert.equal(await entrarEnListaEspera({ WaitlistEntry, client: null }), null);
    assert.equal(await entrarEnListaEspera({ WaitlistEntry }), null);
    assert.deepEqual(llamadas, []);
  });

  it("entra en `active` con su clientId (tiene ficha pero sigue esperando plaza), nunca en `converted`", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa({ ultima: { position: 4 } });
    await entrarEnListaEspera({ WaitlistEntry, client: clienteDePrueba() });
    const creada = llamadas.find(([que]) => que === "create")[1];
    assert.equal(creada.status, "active");
    assert.equal(creada.clientId, "c-1");
  });

  it("copia nombre, correo y teléfono de la ficha, y toma la siguiente posición", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa({ ultima: { position: 4 } });
    await entrarEnListaEspera({ WaitlistEntry, client: clienteDePrueba() });
    assert.deepEqual(llamadas, [
      ["findOne", { order: [["position", "DESC"]], attributes: ["position"] }],
      [
        "create",
        {
          name: "Familia Pérez",
          email: "familia.perez@ejemplo.com",
          phone: "600 12-34-56",
          specialty: null,
          notes: null,
          status: "active",
          position: 5,
          clientId: "c-1",
        },
        {},
      ],
    ]);
  });

  it("con la cola vacía, entra en la posición 1", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa({ ultima: null });
    await entrarEnListaEspera({ WaitlistEntry, client: clienteDePrueba() });
    assert.equal(llamadas.find(([que]) => que === "create")[1].position, 1);
  });

  it("devuelve la fila creada (lo que dé el modelo)", async () => {
    const { WaitlistEntry } = colaFalsa({ ultima: { position: 4 } });
    const fila = await entrarEnListaEspera({ WaitlistEntry, client: clienteDePrueba() });
    assert.equal(fila.id, "w-1");
    assert.equal(fila.position, 5);
    assert.equal(fila.clientId, "c-1");
  });

  it("notas y especialidad van si vienen; vacías o ausentes, null", async () => {
    const con = colaFalsa();
    await entrarEnListaEspera({
      WaitlistEntry: con.WaitlistEntry,
      client: clienteDePrueba(),
      notes: "Prefiere tardes",
      specialty: "logopedia",
    });
    const creadaCon = con.llamadas.find(([que]) => que === "create")[1];
    assert.equal(creadaCon.notes, "Prefiere tardes");
    assert.equal(creadaCon.specialty, "logopedia");

    const sin = colaFalsa();
    await entrarEnListaEspera({
      WaitlistEntry: sin.WaitlistEntry,
      client: clienteDePrueba(),
      notes: "",
      specialty: undefined,
    });
    const creadaSin = sin.llamadas.find(([que]) => que === "create")[1];
    assert.equal(creadaSin.notes, null);
    assert.equal(creadaSin.specialty, null);
  });

  it("una ficha sin correo ni teléfono entra con null en los dos, no con cadena vacía", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa();
    await entrarEnListaEspera({
      WaitlistEntry,
      client: { id: "c-2", name: "Familia Sin Datos", email: "", phone: undefined },
    });
    const creada = llamadas.find(([que]) => que === "create")[1];
    assert.equal(creada.email, null);
    assert.equal(creada.phone, null);
    assert.equal(creada.name, "Familia Sin Datos");
  });

  it("con transacción, la lectura de la última y el create van dentro de ELLA (el alta es todo o nada)", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa({ ultima: { position: 1 } });
    await entrarEnListaEspera({ WaitlistEntry, client: clienteDePrueba(), transaction: TX });
    assert.equal(llamadas.length, 2);
    assert.equal(llamadas[0][0], "findOne");
    assert.equal(llamadas[0][1].transaction, TX);
    assert.equal(llamadas[1][0], "create");
    assert.deepEqual(llamadas[1][2], { transaction: TX });
  });

  it("sin transacción, el create va con opciones vacías (no con transaction: null)", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa();
    await entrarEnListaEspera({ WaitlistEntry, client: clienteDePrueba(), transaction: null });
    assert.deepEqual(llamadas[1][2], {});
    assert.equal("transaction" in llamadas[0][1], false);
  });

  it("no toca la ficha que le dan", async () => {
    const { WaitlistEntry } = colaFalsa();
    const client = clienteDePrueba();
    const foto = JSON.stringify(client);
    await entrarEnListaEspera({ WaitlistEntry, client, notes: "x" });
    assert.equal(JSON.stringify(client), foto);
  });

  it("si leer la última revienta, no crea nada y el error SALE (la transacción del alta hace rollback)", async () => {
    const err = new Error("la base no contesta");
    const { WaitlistEntry, llamadas } = colaFalsa({ falloAlLeer: err });
    await assert.rejects(
      entrarEnListaEspera({ WaitlistEntry, client: clienteDePrueba(), transaction: TX }),
      err
    );
    assert.equal(
      llamadas.some(([que]) => que === "create"),
      false
    );
  });
});

// ── entradaDeCliente ────────────────────────────────────────────────────────

describe("entradaDeCliente: la entrada VIVA de una ficha, sin ruido", () => {
  it("sin modelo o sin id, null sin consultar (la ficha no puede romperse por una sección que no todos tienen)", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa({ entrada: { id: "w-1" } });
    assert.equal(await entradaDeCliente(null, "c-1"), null);
    assert.equal(await entradaDeCliente(undefined, "c-1"), null);
    assert.equal(await entradaDeCliente(WaitlistEntry, null), null);
    assert.equal(await entradaDeCliente(WaitlistEntry, ""), null);
    assert.equal(await entradaDeCliente(WaitlistEntry, undefined), null);
    assert.deepEqual(llamadas, []);
  });

  it("busca SOLO la activa de ese cliente, la de menor posición", async () => {
    const { WaitlistEntry, llamadas } = colaFalsa({ entrada: { id: "w-1", position: 3 } });
    await entradaDeCliente(WaitlistEntry, "c-1");
    assert.deepEqual(llamadas, [
      ["findOne", { where: { clientId: "c-1", status: "active" }, order: [["position", "ASC"]] }],
    ]);
  });

  it("devuelve la fila tal cual la da el modelo (la ficha lee createdAt, position e id)", async () => {
    const entrada = { id: "w-1", position: 3, createdAt: "2026-08-01T09:00:00.000Z" };
    const { WaitlistEntry } = colaFalsa({ entrada });
    assert.equal(await entradaDeCliente(WaitlistEntry, "c-1"), entrada);
  });

  it("sin entrada viva, null", async () => {
    const { WaitlistEntry } = colaFalsa({ entrada: null });
    assert.equal(await entradaDeCliente(WaitlistEntry, "c-1"), null);
  });

  it("si la tabla no existe en ese schema (42P01), null sin ruido", async () => {
    const enParent = Object.assign(new Error("relation does not exist"), {
      parent: { code: "42P01" },
    });
    assert.equal(
      await entradaDeCliente(colaFalsa({ falloAlLeer: enParent }).WaitlistEntry, "c-1"),
      null
    );
    const enOriginal = Object.assign(new Error("relation does not exist"), {
      original: { code: "42P01" },
    });
    assert.equal(
      await entradaDeCliente(colaFalsa({ falloAlLeer: enOriginal }).WaitlistEntry, "c-1"),
      null
    );
  });

  it("cualquier otro error SALE: no se tapa un fallo de verdad con un «no está en la cola»", async () => {
    const otro = Object.assign(new Error("permission denied"), { parent: { code: "42501" } });
    await assert.rejects(
      entradaDeCliente(colaFalsa({ falloAlLeer: otro }).WaitlistEntry, "c-1"),
      otro
    );
    const pelado = new Error("la base no contesta");
    await assert.rejects(
      entradaDeCliente(colaFalsa({ falloAlLeer: pelado }).WaitlistEntry, "c-1"),
      pelado
    );
  });
});

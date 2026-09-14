// @prueba ligera — funciones de /lib con la base y la campana sustituidas; sin servidor ni .env.
/**
 * _smoke-tope-gasto-ia.mjs — el tope mensual de gasto de IA de un centro
 * (14/09/2026).
 *
 *   node scripts/_smoke-tope-gasto-ia.mjs
 *
 * Nace del 10/09/2026: Aumenta se quedó sin saldo a media tarde y nada avisó
 * antes. Prueba lo que DEVUELVEN las dos piezas:
 *
 *   · `lib/ai/topeDeGasto.js` (pura): qué se guarda, cómo se lee, cuándo es
 *     aviso (80 %) y cuándo freno (100 %) —en ENTEROS: 52,80 de 66 da
 *     0.7999999999999999 en coma flotante—, a quién se frena y qué frases.
 *   · `lib/ai/frenoDeGasto.js` (servidor): la suma del mes con su caché de
 *     60 s y su cambio de mes en Madrid, que ante un fallo o una consulta
 *     colgada deja pasar, que la campana sale una vez por admin, tramo, mes e
 *     importe, que una campana colgada no retiene la llamada ni se reintenta en
 *     cada una, y lo que `topeFueraDeVetoAi` le dice al portal de Soporte. La
 *     consulta y el modelo `Notification` se inyectan: no se toca ninguna base
 *     (importar `masterDb.js` no conecta, es perezoso).
 *
 * Y, como TEXTO, solo lo que de verdad es texto: que en `vetoAi` el tope va
 * antes de la puerta de los admins y del candado, que la llamada del portal a
 * la IA va condicionada por el tope, que `topeDeGasto.js` y la tarjeta no
 * importan nada de servidor (irían al paquete del navegador) y que el bot
 * enseña la frase del 403/429.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register(new URL("./_abrir-lib-hooks.mjs", import.meta.url));
// Una dirección MUERTA antes de cargar nada: si algún modelo se quedara sin
// sustituir, la consulta fallaría al momento en vez de tocar una base de verdad.
process.env.DATABASE_URL = "postgres://nadie:nada@127.0.0.1:1/ninguna";

const {
  topeParaGuardar,
  leerTope,
  topeEnUsd,
  estadoDelTope,
  decidirConTope,
  importeEnMoneda,
  mensajeDeTopeAlcanzado,
  textoDelAvisoDeTope,
  resumenDelTope,
  MOTIVO_TOPE,
  TIPO_AVISO_TOPE,
  FRASE_CORTA_DE_TOPE,
} = await import("../lib/ai/topeDeGasto.js");
const { USD_POR_EUR } = await import("../lib/ai/precios.js");
const { gastoDelMesUsd, comprobarTopeDeGasto, avisarTramoDelTope, idDelAvisoDeTope, olvidarGastoDelMes, topeFueraDeVetoAi } =
  await import("../lib/ai/frenoDeGasto.js");

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const PROBLEMA_IMPORTE = "El tope tiene que ser un importe entre 1 y 5.000.";
const EUR60 = Object.freeze({ importe: 60, moneda: "EUR" });

// ── topeDeGasto.js ──────────────────────────────────────────────────────────

describe("topeParaGuardar: lo que llega del PATCH", () => {
  it("un importe con su moneda se guarda tal cual", () => {
    assert.deepEqual(topeParaGuardar({ importe: 60, moneda: "EUR" }), { valor: { importe: 60, moneda: "EUR" }, problema: null });
  });

  it("con coma decimal, redondea a 2 decimales como a mano y pone € por defecto", () => {
    assert.deepEqual(topeParaGuardar({ importe: "60,555" }), { valor: { importe: 60.56, moneda: "EUR" }, problema: null });
    assert.deepEqual(topeParaGuardar({ importe: 60.555, moneda: "USD" }).valor, { importe: 60.56, moneda: "USD" });
  });

  it("«1.500» son mil quinientos y «1.500,25» también lleva los miles", () => {
    assert.equal(topeParaGuardar({ importe: "1.500" }).valor.importe, 1500);
    assert.equal(topeParaGuardar({ importe: "1.500,25" }).valor.importe, 1500.25);
    assert.equal(topeParaGuardar({ importe: "60.5" }).valor.importe, 60.5);
  });

  it("vacío, null o sin importe es QUITAR el tope, no un error", () => {
    for (const entrada of [null, "", undefined, { importe: null }, { importe: "" }, { importe: "  " }]) {
      assert.deepEqual(topeParaGuardar(entrada), { valor: null, problema: null }, JSON.stringify(entrada));
    }
  });

  it("fuera de 1–5.000 o que no es un número: la frase, y nada que guardar", () => {
    for (const importe of [0, -5, 5001, "abc", Number.NaN, "-5", "0,99", Infinity]) {
      assert.deepEqual(topeParaGuardar({ importe }), { valor: null, problema: PROBLEMA_IMPORTE }, String(importe));
    }
    assert.deepEqual(topeParaGuardar([60]), { valor: null, problema: PROBLEMA_IMPORTE });
  });

  it("una moneda que no es € ni $ no se guarda", () => {
    assert.deepEqual(topeParaGuardar({ importe: 60, moneda: "GBP" }), { valor: null, problema: "La moneda del tope es € o $." });
  });

  it("descarta cualquier otra clave: añadir un `modo` mañana no exige migrar", () => {
    assert.deepEqual(topeParaGuardar({ importe: 10, moneda: "USD", modo: "freno", x: 1 }).valor, { importe: 10, moneda: "USD" });
  });
});

describe("leerTope: lo guardado, leído con tolerancia", () => {
  it("lo que no es un tope válido cuenta como sin tope", () => {
    for (const integ of [undefined, {}, { iaTopeMensual: null }, { iaTopeMensual: { importe: "x" } }, { iaTopeMensual: { importe: -1 } }, { iaTopeMensual: { importe: 10, moneda: "GBP" } }]) {
      assert.equal(leerTope(integ), null, JSON.stringify(integ));
    }
  });

  it("acepta un importe pequeño en $ y pone € si falta la moneda", () => {
    assert.deepEqual(leerTope({ iaTopeMensual: { importe: 0.01, moneda: "USD" } }), { importe: 0.01, moneda: "USD" });
    assert.deepEqual(leerTope({ iaTopeMensual: { importe: 60 } }), { importe: 60, moneda: "EUR" });
  });
});

describe("estadoDelTope: aviso al 80 %, freno al 100 %, en enteros", () => {
  it("60 € son 66 $ y 60 $ son 60 $, con el mismo cambio que la tarjeta de consumo", () => {
    assert.equal(USD_POR_EUR, 1.1);
    assert.equal(topeEnUsd(EUR60), 66);
    assert.equal(topeEnUsd({ importe: 60, moneda: "USD" }), 60);
  });

  it("sin tope, sin_tope", () => {
    assert.deepEqual(estadoDelTope({ gastadoUsd: 1000, tope: null }), { nivel: "sin_tope" });
  });

  const casos = [
    [52.79, "bien", 79],
    [52.8, "aviso", 80], // 52.8 / 66 = 0.7999999999999999 en coma flotante
    [65.934, "aviso", 99],
    [66, "alcanzado", 100],
    [70, "alcanzado", 106],
  ];
  for (const [gastadoUsd, nivel, porcentaje] of casos) {
    it(`con 60 € de tope, ${gastadoUsd} $ es «${nivel}» al ${porcentaje} %`, () => {
      const e = estadoDelTope({ gastadoUsd, tope: EUR60 });
      assert.equal(e.nivel, nivel);
      assert.equal(e.porcentaje, porcentaje);
      assert.equal(e.topeUsd, 66);
      assert.equal(e.importe, 60);
      assert.equal(e.moneda, "EUR");
    });
  }

  it("un gasto negativo o ilegible cuenta como 0", () => {
    assert.equal(estadoDelTope({ gastadoUsd: -3, tope: EUR60 }).porcentaje, 0);
    assert.equal(estadoDelTope({ gastadoUsd: "x", tope: EUR60 }).nivel, "bien");
  });
});

describe("decidirConTope: a quién se frena", () => {
  it("sin tope o bien: pasa todo el mundo y no hay campana", () => {
    for (const nivel of ["sin_tope", "bien"]) {
      assert.deepEqual(decidirConTope({ nivel }, { esAdmin: false }), { permitir: true, avisarTramo: null });
    }
  });

  it("en aviso pasan todos y toca la campana del 80", () => {
    assert.deepEqual(decidirConTope({ nivel: "aviso" }, { esAdmin: false }), { permitir: true, avisarTramo: 80 });
    assert.deepEqual(decidirConTope({ nivel: "aviso" }, { esAdmin: true }), { permitir: true, avisarTramo: 80 });
  });

  it("alcanzado: se frena a quien no es admin, el admin pasa, y los dos disparan la del 100", () => {
    assert.deepEqual(decidirConTope({ nivel: "alcanzado" }, { esAdmin: false }), { permitir: false, avisarTramo: 100 });
    assert.deepEqual(decidirConTope({ nivel: "alcanzado" }, { esAdmin: true }), { permitir: true, avisarTramo: 100 });
  });
});

describe("las frases", () => {
  it("quien se frena sabe hasta cuándo, con el mes de Madrid", () => {
    assert.match(mensajeDeTopeAlcanzado(new Date("2026-09-17T10:00:00Z")), /1 de octubre/);
    assert.match(mensajeDeTopeAlcanzado(new Date("2026-12-20T10:00:00Z")), /1 de enero/);
    // 22:30 UTC del 30/09 son las 00:30 del 1/10 en Madrid: vuelve en noviembre.
    assert.match(mensajeDeTopeAlcanzado(new Date("2026-09-30T22:30:00Z")), /1 de noviembre/);
  });

  it("y no ve cifras ni la palabra «saldo»", () => {
    const m = mensajeDeTopeAlcanzado(new Date("2026-09-17T10:00:00Z"));
    assert.ok(!/saldo/i.test(m));
    assert.ok(!m.includes("€") && !m.includes("$"));
  });

  it("la campana del 80 lleva el porcentaje y los dos importes en la moneda del tope", () => {
    const e = estadoDelTope({ gastadoUsd: 52.8, tope: EUR60 });
    const { title, body } = textoDelAvisoDeTope(e, 80, new Date("2026-09-17T10:00:00Z"));
    assert.match(title, /80 %/);
    assert.ok(body.startsWith("48,00 € de 60,00 €."), body);
    assert.match(body, /1 de octubre/);
    const cien = textoDelAvisoDeTope(estadoDelTope({ gastadoUsd: 70, tope: EUR60 }), 100);
    assert.notEqual(cien.title, title);
    assert.match(cien.body, /administradores pueden seguir/);
  });

  it("los importes se escriben en español", () => {
    assert.equal(importeEnMoneda(52.8, "USD"), "52,80 $");
    assert.equal(importeEnMoneda(52.8, "EUR"), "48,00 €");
  });

  it("el resumen para la auditoría y el recibo", () => {
    assert.equal(resumenDelTope({ importe: 60, moneda: "EUR" }), "60,00 € al mes");
    assert.equal(resumenDelTope({ importe: 10.5, moneda: "USD" }), "10,50 $ al mes");
    assert.equal(resumenDelTope(undefined), "(sin tope)");
  });

  it("las constantes que leen las pantallas y la base", () => {
    assert.equal(MOTIVO_TOPE, "tope_ia");
    assert.equal(TIPO_AVISO_TOPE, "ia_tope");
  });
});

// ── frenoDeGasto.js ─────────────────────────────────────────────────────────

const TENANT = "11111111-1111-4111-8111-111111111111";

function consultaQueCuenta(usd = 1) {
  const c = async () => {
    c.veces += 1;
    return usd;
  };
  c.veces = 0;
  return c;
}

describe("gastoDelMesUsd: la suma del mes, 60 s en memoria", () => {
  beforeEach(() => olvidarGastoDelMes());

  it("a los 30 s reutiliza la suma y a los 61 s vuelve a preguntar", async () => {
    const consultar = consultaQueCuenta(2.5);
    const t0 = new Date("2026-09-17T10:00:00Z");
    assert.equal(await gastoDelMesUsd(TENANT, { ahora: t0, consultar }), 2.5);
    await gastoDelMesUsd(TENANT, { ahora: new Date(t0.getTime() + 30_000), consultar });
    assert.equal(consultar.veces, 1);
    await gastoDelMesUsd(TENANT, { ahora: new Date(t0.getTime() + 61_000), consultar });
    assert.equal(consultar.veces, 2);
  });

  it("al cambiar de mes en Madrid vuelve a preguntar aunque no hayan pasado 60 s", async () => {
    const consultar = consultaQueCuenta();
    await gastoDelMesUsd(TENANT, { ahora: new Date("2026-09-30T21:59:40Z"), consultar });
    await gastoDelMesUsd(TENANT, { ahora: new Date("2026-09-30T22:00:10Z"), consultar });
    assert.equal(consultar.veces, 2);
  });

  it("un fallo no se guarda: la siguiente vuelve a preguntar", async () => {
    let veces = 0;
    const consultar = async () => {
      veces += 1;
      if (veces === 1) throw new Error("la base no responde");
      return 3;
    };
    const ahora = new Date("2026-09-17T10:00:00Z");
    await assert.rejects(gastoDelMesUsd(TENANT, { ahora, consultar }));
    assert.equal(await gastoDelMesUsd(TENANT, { ahora, consultar }), 3);
    assert.equal(veces, 2);
  });
});

const ctxCon = (integrations, extra = {}) => ({ tenant: { id: TENANT, slug: "prueba", settings: { integrations } }, ...extra });

describe("comprobarTopeDeGasto: nunca apaga la IA por un fallo suyo", () => {
  beforeEach(() => olvidarGastoDelMes());

  it("sin tope deja pasar y NO consulta la base", async () => {
    const consultar = consultaQueCuenta(999);
    const r = await comprobarTopeDeGasto(ctxCon({}), { esAdmin: false, consultar });
    assert.equal(r.permitir, true);
    assert.equal(r.avisarTramo, null);
    assert.equal(consultar.veces, 0);
  });

  it("pasado el tope frena a quien no es admin y deja pasar al admin, con la campana del 100", async () => {
    const ctx = ctxCon({ iaTopeMensual: { importe: 0.5, moneda: "USD" } });
    const consultar = consultaQueCuenta(0.79);
    const equipo = await comprobarTopeDeGasto(ctx, { esAdmin: false, consultar });
    assert.equal(equipo.permitir, false);
    assert.equal(equipo.estado.nivel, "alcanzado");
    assert.equal(equipo.avisarTramo, 100);
    const admin = await comprobarTopeDeGasto(ctx, { esAdmin: true, consultar });
    assert.equal(admin.permitir, true);
    assert.equal(admin.avisarTramo, 100);
  });

  it("si la consulta falla, deja pasar", async () => {
    const r = await comprobarTopeDeGasto(ctxCon({ iaTopeMensual: { importe: 0.01, moneda: "USD" } }), {
      consultar: async () => {
        throw new Error("42P01");
      },
    });
    assert.equal(r.permitir, true);
  });

  it("si la consulta se cuelga, deja pasar en cuanto se acaba el tiempo", async () => {
    const inicio = Date.now();
    const r = await comprobarTopeDeGasto(ctxCon({ iaTopeMensual: { importe: 0.01, moneda: "USD" } }), {
      consultar: () => new Promise(() => {}),
      msMaximo: 20,
    });
    assert.equal(r.permitir, true);
    assert.ok(Date.now() - inicio < 200, `tardó ${Date.now() - inicio} ms`);
  });

  it("sin contexto tampoco rompe", async () => {
    assert.equal((await comprobarTopeDeGasto(undefined)).permitir, true);
  });
});

/** Un `Notification` en memoria con el índice único (user_id, type, entity_id). */
function notificacionesFalsas({ findOneSiempreNull = false, createColgado = false } = {}) {
  const filas = [];
  const llamadas = { findOne: 0, create: 0 };
  const casa = (a, b) => a.userId === b.userId && a.type === b.type && a.entityId === b.entityId;
  return {
    filas,
    llamadas,
    modelo: {
      async findOne({ where }) {
        llamadas.findOne += 1;
        return findOneSiempreNull ? null : (filas.find((f) => casa(f, where)) ?? null);
      },
      async create(fila) {
        llamadas.create += 1;
        // La base que no contesta: la promesa no se resuelve nunca.
        if (createColgado) return new Promise(() => {});
        if (filas.some((f) => casa(f, fila))) {
          const e = new Error("duplicate key");
          e.name = "SequelizeUniqueConstraintError";
          throw e;
        }
        filas.push(fila);
        return fila;
      },
    },
  };
}

const dosAdmins = async () => [{ id: "admin-1" }, { id: "admin-2" }];
const SEPT = new Date("2026-09-17T10:00:00Z");

describe("avisarTramoDelTope: una campana por admin, tramo, mes e importe", () => {
  beforeEach(() => olvidarGastoDelMes());
  const estado = estadoDelTope({ gastadoUsd: 53, tope: EUR60 });

  it("la primera vez, una a cada admin, con el mismo id", async () => {
    const n = notificacionesFalsas();
    const creadas = await avisarTramoDelTope({ tenant: { id: TENANT }, tenantModels: { Notification: n.modelo } }, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT });
    assert.equal(creadas, 2);
    assert.deepEqual(n.filas.map((f) => f.userId), ["admin-1", "admin-2"]);
    for (const f of n.filas) {
      assert.equal(f.type, "ia_tope");
      assert.equal(f.entityType, "IaTope");
      assert.equal(f.channel, "app");
      assert.equal(f.entityId, n.filas[0].entityId);
    }
  });

  it("la segunda en el mismo proceso no mira la base", async () => {
    const n = notificacionesFalsas();
    const ctx = { tenant: { id: TENANT }, tenantModels: { Notification: n.modelo } };
    await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT });
    const antes = { ...n.llamadas };
    assert.equal(await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT }), 0);
    assert.deepEqual(n.llamadas, antes);
  });

  it("tras un despliegue (proceso nuevo) las encuentra antes de insertar", async () => {
    const n = notificacionesFalsas();
    const ctx = { tenant: { id: TENANT }, tenantModels: { Notification: n.modelo } };
    await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT });
    olvidarGastoDelMes();
    const create = n.llamadas.create;
    assert.equal(await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT }), 0);
    assert.equal(n.llamadas.create, create);
  });

  it("si dos peticiones insertan a la vez, el índice único frena la segunda sin lanzar", async () => {
    const n = notificacionesFalsas({ findOneSiempreNull: true });
    const ctx = { tenant: { id: TENANT }, tenantModels: { Notification: n.modelo } };
    await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT });
    olvidarGastoDelMes();
    assert.equal(await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT }), 0);
    assert.equal(n.filas.length, 2);
  });

  it("otro mes, otro tramo u otro importe vuelven a avisar", async () => {
    const n = notificacionesFalsas();
    const ctx = { tenant: { id: TENANT }, tenantModels: { Notification: n.modelo } };
    await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT });
    assert.equal(await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: new Date("2026-10-02T10:00:00Z") }), 2);
    assert.equal(await avisarTramoDelTope(ctx, estado, 100, { buscarAdmins: dosAdmins, ahora: SEPT }), 2);
    const subido = estadoDelTope({ gastadoUsd: 53, tope: { importe: 65, moneda: "EUR" } });
    assert.equal(await avisarTramoDelTope(ctx, subido, 80, { buscarAdmins: dosAdmins, ahora: SEPT }), 2);
  });

  it("sin Notification, sin tramo o si buscar admins falla: 0 y sin lanzar", async () => {
    assert.equal(await avisarTramoDelTope({ tenant: { id: TENANT }, tenantModels: {} }, estado, 80, { buscarAdmins: dosAdmins }), 0);
    const n = notificacionesFalsas();
    const ctx = { tenant: { id: TENANT }, tenantModels: { Notification: n.modelo } };
    assert.equal(await avisarTramoDelTope(ctx, estado, null, { buscarAdmins: dosAdmins }), 0);
    const falla = async () => {
      throw new Error("sin base");
    };
    assert.equal(await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: falla, ahora: SEPT }), 0);
  });

  it("el id es estable con los mismos datos y cambia con el mes, el tramo o el importe", () => {
    const base = idDelAvisoDeTope(TENANT, "2026-09", 80, 66);
    assert.equal(idDelAvisoDeTope(TENANT, "2026-09", 80, 66), base);
    assert.match(base, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const otro of [
      idDelAvisoDeTope(TENANT, "2026-10", 80, 66),
      idDelAvisoDeTope(TENANT, "2026-09", 100, 66),
      idDelAvisoDeTope(TENANT, "2026-09", 80, 71.5),
    ]) {
      assert.notEqual(otro, base);
    }
  });

  it("si la base se cuelga, vuelve en cuanto se acaba el tiempo, con 0", async () => {
    const n = notificacionesFalsas({ createColgado: true });
    const ctx = { tenant: { id: TENANT }, tenantModels: { Notification: n.modelo } };
    const inicio = Date.now();
    assert.equal(await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT, msMaximo: 20 }), 0);
    assert.ok(Date.now() - inicio < 200, `tardó ${Date.now() - inicio} ms`);
  });

  it("un intento que falla o sigue en marcha no se repite en cada llamada: sí pasados 60 s", async () => {
    let busquedas = 0;
    const falla = async () => {
      busquedas += 1;
      throw new Error("sin base");
    };
    const n = notificacionesFalsas();
    const ctx = { tenant: { id: TENANT }, tenantModels: { Notification: n.modelo } };
    await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: falla, ahora: SEPT });
    assert.equal(await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: new Date(SEPT.getTime() + 30_000) }), 0);
    assert.equal(busquedas, 1);
    assert.equal(n.llamadas.findOne, 0);
    // Pasado el minuto, se vuelve a intentar, y esta vez sale.
    assert.equal(await avisarTramoDelTope(ctx, estado, 80, { buscarAdmins: dosAdmins, ahora: new Date(SEPT.getTime() + 61_000) }), 2);

    // Lo mismo con uno colgado: la siguiente llamada no se suma a la cola.
    olvidarGastoDelMes();
    const colgada = notificacionesFalsas({ createColgado: true });
    const ctxColgado = { tenant: { id: TENANT }, tenantModels: { Notification: colgada.modelo } };
    await avisarTramoDelTope(ctxColgado, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT, msMaximo: 20 });
    const antes = { ...colgada.llamadas };
    assert.equal(await avisarTramoDelTope(ctxColgado, estado, 80, { buscarAdmins: dosAdmins, ahora: SEPT, msMaximo: 20 }), 0);
    assert.deepEqual(colgada.llamadas, antes);
  });
});

describe("topeFueraDeVetoAi: lo que le dice al portal de Soporte", () => {
  beforeEach(() => olvidarGastoDelMes());
  const conModelo = (integrations, n) => ctxCon(integrations, { tenantModels: { Notification: n.modelo } });

  it("sin tope: null (clasifica), sin consultar ni campana", async () => {
    const n = notificacionesFalsas();
    const consultar = consultaQueCuenta(999);
    assert.equal(await topeFueraDeVetoAi(conModelo({}, n), "clasificar", { consultar, buscarAdmins: dosAdmins }), null);
    assert.equal(consultar.veces, 0);
    assert.equal(n.filas.length, 0);
  });

  it("al 80 %: null (clasifica) y campana del 80 a los admins", async () => {
    const n = notificacionesFalsas();
    const r = await topeFueraDeVetoAi(conModelo({ iaTopeMensual: { importe: 0.5, moneda: "USD" } }, n), "clasificar", {
      consultar: consultaQueCuenta(0.45),
      buscarAdmins: dosAdmins,
      ahora: SEPT,
    });
    assert.equal(r, null);
    assert.equal(n.filas.length, 2);
    assert.match(n.filas[0].title, /80 %/);
  });

  it("al 100 %: la frase corta (no clasifica), aunque quien lo pida se diga admin, y campana del 100", async () => {
    const n = notificacionesFalsas();
    const ctx = conModelo({ iaTopeMensual: { importe: 0.5, moneda: "USD" } }, n);
    ctx.user = { id: "x", role: "admin" };
    const r = await topeFueraDeVetoAi(ctx, "clasificar", { consultar: consultaQueCuenta(0.79), buscarAdmins: dosAdmins, ahora: SEPT, esAdmin: true });
    assert.equal(r, FRASE_CORTA_DE_TOPE);
    assert.match(r, /tope de gasto de IA/);
    assert.equal(n.filas.length, 2);
    assert.match(n.filas[0].title, /alcanzado/);
  });

  it("si la consulta falla: null (deja pasar)", async () => {
    const n = notificacionesFalsas();
    const r = await topeFueraDeVetoAi(conModelo({ iaTopeMensual: { importe: 0.01, moneda: "USD" } }, n), "clasificar", {
      consultar: async () => {
        throw new Error("42P01");
      },
    });
    assert.equal(r, null);
  });
});

// ── vetoAi de verdad, con master sustituido en memoria ─────────────────────

const { vetoAi } = await import("../lib/ai/aiAccess.js");
const { getMasterModels } = await import("../lib/db/masterDb.js");

describe("vetoAi con tope: lo que responde a cada uno", () => {
  const m = getMasterModels();
  const auditorias = [];
  // En memoria: `vetoAi` audita en `master.audit_logs` y busca a los admins en `master.users`.
  m.AuditLog.create = async (fila) => {
    auditorias.push(fila);
    return fila;
  };
  m.User.findAll = async () => [{ id: "admin-1" }, { id: "admin-2" }];

  const topeCorto = { iaTopeMensual: { importe: 0.5, moneda: "USD" } };
  const peticion = () => new Request("http://crm.local/api/assistant", { method: "POST" });

  async function contexto({ role, integrations = topeCorto, gastado = 0.79, aiAccess, AiPermission, createColgado = false } = {}) {
    // La suma del mes se deja en la caché, que es lo que `vetoAi` lee primero.
    await gastoDelMesUsd(TENANT, { consultar: async () => gastado });
    const n = notificacionesFalsas({ createColgado });
    return {
      n,
      ctx: {
        slug: "prueba",
        tenant: { id: TENANT, slug: "prueba", settings: { integrations, ...(aiAccess ? { aiAccess } : {}) } },
        user: { id: "persona-1", role },
        tenantModels: { Notification: n.modelo, ...(AiPermission ? { AiPermission } : {}) },
      },
    };
  }

  beforeEach(() => {
    olvidarGastoDelMes();
    auditorias.length = 0;
  });

  it("al 100 %, quien no es admin recibe 429 con el motivo y la frase, y queda la auditoría de la frenada", async () => {
    const { ctx, n } = await contexto({ role: "user" });
    const res = await vetoAi(ctx, peticion(), "el asistente Salamandrobot");
    assert.equal(res.status, 429);
    const cuerpo = await res.json();
    assert.equal(cuerpo.ok, false);
    assert.equal(cuerpo.motivo, "tope_ia");
    assert.match(cuerpo.error, /tope de gasto de IA/);
    assert.ok(!/saldo/i.test(cuerpo.error));
    assert.deepEqual(
      auditorias.map((a) => [a.action, a.after]),
      [["ai.tope_frenada", { accion: "el asistente Salamandrobot" }]]
    );
    // Y los dos admins, avisados con la campana del 100.
    assert.equal(n.filas.length, 2);
    assert.ok(n.filas.every((f) => f.type === "ia_tope"));
  });

  it("el admin pasa, audita su uso normal y también dispara la campana", async () => {
    const { ctx, n } = await contexto({ role: "admin" });
    assert.equal(await vetoAi(ctx, peticion(), "pulir un informe"), null);
    assert.deepEqual(auditorias.map((a) => a.action), ["ai.uso"]);
    assert.equal(n.filas.length, 2);
  });

  it("al 80 % pasa todo el mundo, con campana", async () => {
    const { ctx, n } = await contexto({ role: "user", gastado: 0.45 });
    assert.equal(await vetoAi(ctx, peticion(), "transcribir"), null);
    assert.equal(n.filas.length, 2);
    assert.match(n.filas[0].title, /80 %/);
  });

  it("sin tope no cambia nada: pasa, sin campana", async () => {
    const { ctx, n } = await contexto({ role: "user", integrations: {}, gastado: 9999 });
    assert.equal(await vetoAi(ctx, peticion(), "transcribir"), null);
    assert.deepEqual(auditorias.map((a) => a.action), ["ai.uso"]);
    assert.equal(n.filas.length, 0);
  });

  it("con el candado puesto, el tope frena ANTES: no gasta un permiso de un solo uso ni crea solicitudes", async () => {
    const tocado = [];
    const AiPermission = new Proxy({}, { get: (_, prop) => async () => { tocado.push(prop); return []; } });
    const { ctx } = await contexto({ role: "user", aiAccess: "restringido", AiPermission });
    const res = await vetoAi(ctx, peticion(), "transcribir");
    assert.equal(res.status, 429);
    assert.deepEqual(tocado, []);
  });

  it("con la suma ya en caché y la base colgada al poner la campana, responde a tiempo (500 ms de la campana)", async () => {
    const { ctx } = await contexto({ role: "user", createColgado: true });
    const inicio = Date.now();
    const res = await vetoAi(ctx, peticion(), "transcribir");
    const ms = Date.now() - inicio;
    assert.equal(res.status, 429);
    assert.ok(ms < 1500, `vetoAi tardó ${ms} ms`);
  });
});

// ── Lo que es texto ─────────────────────────────────────────────────────────

describe("el cableado", () => {
  it("en vetoAi el tope va antes de la puerta de los admins y del candado, y frena con 429 + motivo", () => {
    const fuente = leer("lib/ai/aiAccess.js");
    const inicio = fuente.indexOf("export async function vetoAi(");
    assert.ok(inicio >= 0, "no está vetoAi");
    const fin = fuente.indexOf("} catch (err)", inicio);
    const cuerpo = fuente.slice(inicio, fin);
    const tope = cuerpo.indexOf("comprobarTopeDeGasto(");
    assert.ok(tope >= 0, "vetoAi no mira el tope");
    assert.ok(tope < cuerpo.indexOf("if (esAdmin)"), "el tope va después de la puerta de los admins");
    assert.ok(tope < cuerpo.indexOf("aiRestringido(ctx)"), "el tope va después del candado");
    const retorno = cuerpo.indexOf("return errorConDatos(");
    assert.ok(retorno > tope, "no devuelve el freno");
    const sentencia = cuerpo.slice(retorno, cuerpo.indexOf(";", retorno));
    assert.match(sentencia, /429/);
    assert.match(sentencia, /MOTIVO_TOPE/);
    const auditoria = cuerpo.indexOf("auditaFrenada(");
    assert.ok(auditoria > tope && auditoria < retorno, "la frenada no deja rastro antes de responder");
    assert.match(fuente, /action: "ai\.tope_frenada"/);
  });

  it("topeDeGasto.js y la tarjeta no importan nada de servidor", () => {
    const importsDe = (ruta) => [...leer(ruta).matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]);
    assert.deepEqual(importsDe("lib/ai/topeDeGasto.js").sort(), ["../utils/madridDate.js", "./precios.js"]);
    assert.deepEqual(importsDe("modules/config/tarjetas/TopeIA.jsx").sort(), [
      "../../../components/ui/Select.jsx",
      "../../../lib/ai/topeDeGasto.js",
      "./ui.jsx",
      "react",
    ]);
  });

  it("la clasificación del portal va CONDICIONADA por el tope y apunta la acción antes de llamar a la IA", () => {
    const fuente = leer("app/api/public/c/[tenantSlug]/soporte/route.js");
    const ia = fuente.indexOf("ticketAiClassify({");
    assert.ok(ia >= 0);
    // El resultado del tope se guarda en `frenada`…
    const tope = fuente.search(/const frenada = [^;]*topeFueraDeVetoAi\(/);
    assert.ok(tope >= 0 && tope < ia, "el portal clasifica sin mirar el tope");
    // …y el `if` que abre la llamada a la IA lo exige (mirar el tope y no
    // hacerle caso también sería verde con solo buscar la llamada).
    const condicion = fuente.slice(fuente.lastIndexOf("if (", ia), ia);
    assert.match(condicion.slice(0, condicion.indexOf(")") + 1), /!frenada\b/, "la llamada a la IA no depende del tope");
    assert.match(fuente, /if \(frenada\) sinClasificar = frenada;/);
    const accion = fuente.indexOf("marcarAccion(");
    assert.ok(accion > tope && accion < ia, "la clasificación no apunta su acción");
  });

  it("el PATCH guarda el tope validado y lo audita resumido; consumo lo devuelve", () => {
    const settings = leer("app/api/tenant/settings/route.js");
    assert.match(settings, /topeParaGuardar\(body\.iaTopeMensual\)/);
    assert.match(settings, /anota\("iaTopeMensual", [^)]*resumenDelTope\)/);
    const consumo = leer("app/api/tenant/ia/consumo/route.js");
    assert.match(consumo, /estadoDelTope\(/);
    assert.match(consumo, /personasSinAdmin/);
  });

  it("el cambio de euros es uno solo, y el bot enseña la frase del 403/429", () => {
    assert.ok(!leer("modules/config/tarjetas/ConsumoIA.jsx").includes("USD_POR_EUR ="));
    const bot = leer("components/assistant/Salamandrobot.jsx");
    const rama = bot.indexOf("r.status === 429");
    assert.ok(rama >= 0, "el bot no distingue el 429");
    // Dentro de esa rama (hasta su `return;`), la frase del servidor va al mensaje.
    const cuerpo = bot.slice(rama, bot.indexOf("return;", rama));
    assert.match(cuerpo, /aviso: j\.error/, "el bot no enseña la frase del servidor");
  });

  it("la campana lleva a Configuración → Conexiones", async () => {
    const { notificationLink } = await import("../lib/notifications/alerts.js");
    assert.equal(notificationLink("IaTope"), "/configuracion?zona=conexiones");
  });
});

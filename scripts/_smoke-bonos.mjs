// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-bonos.mjs — el bono como forma de pago (10/09/2026, submódulo Bonos).
 *
 *   node scripts/_smoke-bonos.mjs
 *   node --test-name-pattern="renovar" scripts/_smoke-bonos.mjs
 *
 * ── DE QUÉ PETICIÓN REAL NACE ──────────────────────────────────────────────
 *
 * Rodrigo: «un submódulo en facturación llamado Bonos que tenga todos los bonos
 * de los pacientes, que se puedan ordenar por grupos igual que cuotas y que
 * sean de pago por bono en lugar de una cuota que se repite mes a mes. Pueden
 * volver a coger el bono si quieren».
 *
 * Lo que aquí se fija, por lo que DEVUELVE:
 *
 *  - UN BONO NO CADUCA POR CALENDARIO. Está agotado cuando no le quedan
 *    sesiones libres —lo dicen las citas— o anulado porque el centro lo
 *    canceló. Ninguna de las dos cosas depende del día de hoy, al revés que la
 *    baja de una cuota.
 *  - LAS RESERVAS CUENTAN. Quien tiene 10 sesiones y 3 citas puestas por
 *    delante no tiene 10 libres: tiene 7, y su bono no está agotado.
 *  - RENOVAR ES OTRO BONO. Copia tipo, sesiones, importe y paciente; NO copia
 *    el estado, ni las sesiones gastadas, ni la nota del trato anterior. Nunca
 *    reabre el de antes: la sesión 11 no puede volver a llamarse «la 1 de 10».
 *  - LOS GRUPOS SUMAN EXACTO. Un bono lleva UN tipo, así que —al contrario que
 *    las cuotas con varios conceptos— no hay importes que repartir a ojo.
 *  - NADIE SE CUENTA DOS VECES, y un bono sin paciente es de la FAMILIA: se
 *    cuenta esa familia, no sus hijos (un montón de diez sesiones sin dueño no
 *    son diez por hijo).
 *  - LOS CÉNTIMOS SON CÉNTIMOS. El bono se valida en céntimos enteros; un
 *    importe con decimales se rechaza en vez de guardarse a lo que salga, que
 *    es como nació un bono de 150 € con un pendiente de 15.000 €.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  estadoDelBono,
  bonoCerrado,
  rotuloDelBono,
  limpiarBono,
  bonoVivoIgual,
  renovacionDe,
  avisosDeRenovacion,
  totalesDeBonos,
  resumenPorTipoDeBono,
  contarGente,
  ordenarBonos,
  esNotaAutomaticaDeBono,
  parteDelCobro,
  SESIONES_MAX,
} from "../lib/billing/bonos.js";

/** Un bono contado como lo devuelve `bonosConSesiones`. */
const bono = (extra = {}) => ({
  id: "b1",
  eventTypeId: "t1",
  clientId: "c1",
  patientId: null,
  nombre: "Logopedia 10",
  amount: 30000,
  status: "active",
  compradoEl: "2026-09-01T10:00:00.000Z",
  total: 10,
  gastadas: 0,
  reservadas: 0,
  restantes: 10,
  cobro: null,
  ...extra,
});

describe("en qué estado está un bono", () => {
  it("vivo mientras le quedan sesiones libres", () => {
    assert.equal(estadoDelBono(bono({ gastadas: 3, restantes: 7 })), "vivo");
    assert.equal(bonoCerrado(bono({ gastadas: 3, restantes: 7 })), false);
  });

  it("agotado cuando no queda ninguna libre", () => {
    assert.equal(estadoDelBono(bono({ gastadas: 10, restantes: 0 })), "agotado");
    assert.equal(bonoCerrado(bono({ gastadas: 10, restantes: 0 })), true);
  });

  it("las RESERVADAS no dejan libre la sesión: sin libres, cerrado", () => {
    // 10 sesiones, 3 dadas y 7 en la agenda: no le queda ninguna por pedir.
    const b = bono({ gastadas: 3, reservadas: 7, restantes: 0 });
    assert.equal(estadoDelBono(b), "agotado");
    assert.match(rotuloDelBono(b), /7 en la agenda/);
  });

  it("anulado manda sobre el contador", () => {
    assert.equal(estadoDelBono(bono({ status: "anulado", restantes: 5 })), "anulado");
    assert.equal(rotuloDelBono(bono({ status: "anulado", restantes: 5 })), "Anulado");
  });

  it("no depende del día de hoy: un bono de 2023 con sesiones sigue vivo", () => {
    const viejo = bono({ compradoEl: "2023-01-15T10:00:00.000Z", gastadas: 8, restantes: 2 });
    assert.equal(estadoDelBono(viejo), "vivo");
  });

  it("dice cuántas quedan, en singular y en plural", () => {
    assert.match(rotuloDelBono(bono({ gastadas: 9, restantes: 1 })), /Le queda 1 de 10/);
    assert.match(rotuloDelBono(bono({ gastadas: 7, restantes: 3 })), /Le quedan 3 de 10/);
  });
});

describe("qué se valida al dar un bono", () => {
  it("pide el tipo de bono", () => {
    assert.match(limpiarBono({}).problema, /tipo de bono/i);
  });

  it("el importe es un entero de CÉNTIMOS: 150,50 € se manda como 15050", () => {
    const { valores } = limpiarBono({ eventTypeId: uuid(), amount: 15050 });
    assert.equal(valores.amount, 15050);
    // Con decimales se rechaza: sería un importe a medio convertir.
    assert.match(limpiarBono({ eventTypeId: uuid(), amount: 150.5 }).problema, /céntimos/i);
  });

  it("sin importe (null) es válido y NO es lo mismo que 0", () => {
    assert.equal(limpiarBono({ eventTypeId: uuid(), amount: "" }).valores.amount, null);
    assert.equal(limpiarBono({ eventTypeId: uuid(), amount: 0 }).valores.amount, 0);
  });

  it("las sesiones tienen tope, y en blanco significa «las del tipo»", () => {
    assert.equal(limpiarBono({ eventTypeId: uuid(), totalSessions: "" }).valores.totalSessions, null);
    assert.match(limpiarBono({ eventTypeId: uuid(), totalSessions: SESIONES_MAX + 1 }).problema, /entre 1 y/);
    assert.match(limpiarBono({ eventTypeId: uuid(), totalSessions: 0 }).problema, /entre 1 y/);
  });

  it("«agotado» no se puede escribir a mano: lo dice el contador", () => {
    assert.match(limpiarBono({ eventTypeId: uuid(), status: "agotado" }).problema, /activo o anulado/i);
    assert.equal(limpiarBono({ eventTypeId: uuid(), status: "anulado" }).valores.status, "anulado");
  });

  it("parcial (el PATCH) solo toca lo que venga: editar la nota no pide sesiones", () => {
    const { valores, problema } = limpiarBono({ notes: "  pagó en dos veces  " }, { parcial: true });
    assert.equal(problema, null);
    assert.deepEqual(Object.keys(valores), ["notes"]);
    assert.equal(valores.notes, "pagó en dos veces");
  });
});

describe("volver a coger el bono", () => {
  const agotado = bono({
    status: "active",
    gastadas: 10,
    restantes: 0,
    patientId: "p1",
    notes: "el trato de septiembre",
  });

  it("copia tipo, sesiones, importe y paciente", () => {
    const nuevo = renovacionDe(agotado);
    assert.equal(nuevo.eventTypeId, "t1");
    assert.equal(nuevo.clientId, "c1");
    assert.equal(nuevo.patientId, "p1");
    assert.equal(nuevo.totalSessions, 10);
    assert.equal(nuevo.amount, 30000);
  });

  it("NO copia la nota del trato anterior ni el estado", () => {
    const nuevo = renovacionDe(agotado);
    assert.equal(nuevo.notes, null);
    assert.equal("status" in nuevo, false);
    assert.equal("sesionesPrevias" in nuevo, false);
  });

  it("deja renovar con otro importe o más sesiones sin salir del botón", () => {
    const nuevo = renovacionDe(agotado, { totalSessions: 8, amount: 24000 });
    assert.equal(nuevo.totalSessions, 8);
    assert.equal(nuevo.amount, 24000);
  });

  it("avisa cuando el anterior todavía tiene sesiones sin usar", () => {
    const avisos = avisosDeRenovacion(bono({ gastadas: 7, restantes: 3 }));
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /3 sesiones sin usar/);
  });

  it("avisa de que un bono sin importe tampoco creará cobro al renovarlo", () => {
    const avisos = avisosDeRenovacion(bono({ amount: null, gastadas: 10, restantes: 0 }));
    assert.equal(avisos.some((a) => /no tenía importe/.test(a)), true);
  });

  it("no avisa de nada cuando el anterior está agotado y tenía importe", () => {
    assert.deepEqual(avisosDeRenovacion(agotado), []);
  });
});

describe("avisar de que ya tiene uno igual", () => {
  const lista = [
    bono({ id: "viejo", status: "active", gastadas: 10, restantes: 0 }), // agotado
    bono({ id: "vivo", patientId: "p1", gastadas: 2, restantes: 8 }),
  ];

  it("encuentra el vivo del mismo tipo, cliente y paciente", () => {
    const encontrado = bonoVivoIgual(lista, { eventTypeId: "t1", clientId: "c1", patientId: "p1" });
    assert.equal(encontrado?.id, "vivo");
  });

  it("el bono de la familia (sin paciente) NO es el mismo que el de un hijo", () => {
    assert.equal(bonoVivoIgual(lista, { eventTypeId: "t1", clientId: "c1", patientId: null }), null);
  });

  it("un bono agotado no cuenta: por eso se puede volver a coger", () => {
    const soloAgotados = [bono({ id: "viejo", gastadas: 10, restantes: 0 })];
    assert.equal(bonoVivoIgual(soloAgotados, { eventTypeId: "t1", clientId: "c1" }), null);
  });
});

describe("los totales y los grupos", () => {
  const bonos = [
    bono({ id: "1", amount: 30000, restantes: 4, cobro: { estado: "pendiente", pendiente: 300, cobrado: 0 } }),
    bono({ id: "2", amount: 20000, restantes: 2, patientId: "p2", cobro: { estado: "cobrado", pendiente: 0, cobrado: 200 } }),
    bono({ id: "3", amount: null, restantes: 1, patientId: "p3", cobro: null }),
  ];

  it("suma lo vendido en céntimos y lo pendiente convertido de euros", () => {
    const t = totalesDeBonos(bonos);
    assert.equal(t.vendido, 50000);
    assert.equal(t.pendiente, 30000); // 300 € del cobro pendiente
    assert.equal(t.sesionesLibres, 7);
    assert.equal(t.sinImporte, 1);
  });

  it("un bono lleva UN tipo: el importe del grupo es exacto, sin repartos", () => {
    const tipos = [{ id: "t1", name: "Logopedia 10", sessionsCount: 10, price: 30000 }];
    const [fila] = resumenPorTipoDeBono({ tipos, bonos });
    assert.equal(fila.bonos, 3);
    assert.equal(fila.vendido, 50000);
    assert.equal(fila.pendiente, 30000);
    assert.equal(fila.sesionesLibres, 7);
  });

  it("los bonos de un tipo borrado del catálogo no se pierden", () => {
    const [fila] = resumenPorTipoDeBono({ tipos: [], bonos: [bono()] });
    assert.equal(fila.enElCatalogo, false);
    assert.match(fila.name, /borrado del catálogo/);
    assert.equal(fila.bonos, 1);
  });

  it("separa abiertos de cerrados", () => {
    const tipos = [{ id: "t1", name: "Logopedia 10", sessionsCount: 10, price: 30000 }];
    const conCerrado = [...bonos, bono({ id: "4", status: "anulado" })];
    const [fila] = resumenPorTipoDeBono({ tipos, bonos: conCerrado });
    assert.equal(fila.bonos, 3);
    assert.equal(fila.cerrados, 1);
  });

  it("nadie se cuenta dos veces, y el bono sin paciente es de la FAMILIA", () => {
    const cuenta = contarGente([
      bono({ id: "a", patientId: "p1" }),
      bono({ id: "b", patientId: "p1" }), // el mismo niño, dos bonos
      bono({ id: "c", patientId: null }), // de la familia entera
    ]);
    assert.equal(cuenta.pacientes, 1);
    assert.equal(cuenta.familias, 1);
    assert.equal(cuenta.sinPaciente, 1);
  });
});

describe("el orden y los textos", () => {
  it("primero los abiertos, y dentro el más reciente arriba", () => {
    const lista = [
      bono({ id: "viejo", compradoEl: "2026-01-01T00:00:00.000Z" }),
      bono({ id: "cerrado", compradoEl: "2026-09-09T00:00:00.000Z", status: "anulado" }),
      bono({ id: "nuevo", compradoEl: "2026-09-08T00:00:00.000Z" }),
    ];
    assert.deepEqual(ordenarBonos(lista).map((b) => b.id), ["nuevo", "viejo", "cerrado"]);
  });

  it("reconoce la nota que escribe el programa, y respeta la de una persona", () => {
    assert.equal(esNotaAutomaticaDeBono("Bono «Logopedia 10» · 10 sesiones"), true);
    assert.equal(esNotaAutomaticaDeBono("Bono de sesiones"), true);
    assert.equal(esNotaAutomaticaDeBono("Lo paga la abuela, no la madre"), false);
    // La de una cuota no es de un bono: cada una tiene la suya.
    assert.equal(esNotaAutomaticaDeBono("Cuota septiembre 2026"), false);
  });

  it("dice qué ha pasado con el cobro, y calla cuando no ha pasado nada", () => {
    assert.match(parteDelCobro({ accion: "al día" }), /al día/);
    assert.match(parteDelCobro({ accion: "retirado", cobros: 2 }), /2 cobros pendientes retirados/);
    assert.match(parteDelCobro({ accion: "creado" }), /apuntado en Cobros/);
    assert.equal(parteDelCobro({ accion: "nada", motivo: null }), "");
    assert.equal(parteDelCobro(null), "");
  });
});

let n = 0;
/** Un UUID válido cualquiera, que es lo único que mira `limpiarBono`. */
function uuid() {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// @prueba ligera — funciones puras de lib/citas y lectura de texto; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-auditoria.mjs — la auditoría de una cita no lleva al paciente a master (13/09/2026).
 *
 *   node scripts/_smoke-citas-auditoria.mjs
 *   node --test-name-pattern="huella" scripts/_smoke-citas-auditoria.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El alta desde el panel, la reserva pública, la edición y las dos vías de
 * cancelar volcaban `row.toJSON()` en `master.audit_logs`: nombre, correo,
 * teléfono, notas, respuestas del formulario, el texto del cobro y el token del
 * enlace «cancelar». 1.550 filas el 13/09/2026, más 129 huellas de borrado con
 * el nombre. Ver docs/decisions/2026-09-13-la-auditoria-de-una-cita-no-lleva-al-paciente.md
 *
 * Qué fija:
 *   1. Lo que DEVUELVEN `resumenDeCita`, `cambiosDeCita`, `fijosDeCita`,
 *      `sinDatosPrivadosDeCita` y `ladosParaAuditar` (la red de logCitasAudit) con una cita llena de
 *      centinelas: ningún centinela sale, y la red no toca a otras entidades.
 *   2. Lo que devuelve `borrarCitaDeVerdad` con modelos falsos: la huella que de
 *      verdad llega a master, sin el nombre.
 *   3. Deriva contra el texto (aquí el texto ES el contrato): cada columna de
 *      `Booking.model.js` está decidida en una de las tres listas, cada alias de
 *      Booking en `tenantDb.js` está en ASOCIACIONES_CITA, y ninguna llamada de
 *      auditoría con `entity: "Booking"` vuelve a usar `toJSON(`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAMPOS_RESUMEN_CITA,
  CAMPOS_PRIVADOS_CITA,
  CAMPOS_FUERA_DEL_RESUMEN,
  ASOCIACIONES_CITA,
  CAMPOS_FIJOS_EDICION,
  resumenDeCita,
  cambiosDeCita,
  fijosDeCita,
  huellaDeCita,
  sinDatosPrivadosDeCita,
  ladosParaAuditar,
} from "../lib/citas/resumenDeCita.js";
import { borrarCitaDeVerdad, huellaDeCita as huellaDesdeBorrarCita } from "../lib/citas/borrarCita.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => readFileSync(join(RAIZ, rel), "utf8");

// ── Fixture ─────────────────────────────────────────────────────────────────

const FECHA = new Date("2026-10-05T08:30:00.000Z");

/** Los 9 valores privados: ninguno puede aparecer en lo que va a master. */
const CENTINELAS_PRIVADOS = [
  "Nombre Centinela",
  "centinela@example.com",
  "600111222",
  "adicional-centinela",
  "nota-centinela",
  "falta-centinela",
  "respuesta-centinela",
  "cobro-centinela",
  "tok-centinela",
];
/** Los dos que tienen su propia línea explícita: tampoco salen en el resumen ni en el diff. */
const CENTINELAS_CON_LINEA = ["https://meet.example/centinela", "motivo-centinela"];

function citaCompleta() {
  return {
    id: "b-1",
    eventTypeId: "et-1",
    clientName: "Nombre Centinela",
    clientEmail: "centinela@example.com",
    clientPhone: "600111222",
    additionalData: "adicional-centinela",
    scheduledAt: FECHA,
    duration: 50,
    modality: "presencial",
    meetUrl: "https://meet.example/centinela",
    status: "confirmed",
    reminderSentAt: new Date("2026-10-04T16:00:00.000Z"),
    cancellationToken: "tok-centinela",
    cancelledAt: null,
    cancellationReason: "motivo-centinela",
    noShowJustified: false,
    noShowReason: "falta-centinela",
    recoveredByBookingId: null,
    teamMemberId: "tm-1",
    patientId: "pa-1",
    clientId: "cl-1",
    paymentStatus: "none",
    amount: 4500,
    holdExpiresAt: null,
    authorizationExpiresAt: null,
    paymentSessionId: null,
    packId: "pk-1",
    sessionNumber: 3,
    formAnswers: { p1: "respuesta-centinela" },
    tallerGrupoId: "tg-1",
    cobroModo: "concepto",
    cobroConceptId: "cc-1",
    cobroTexto: "cobro-centinela",
    cobroImporte: 0,
    diagnosticoId: null,
    diagnosticoTramo: null,
    notes: "nota-centinela",
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
  };
}

function sinCentinelas(valor, centinelas = [...CENTINELAS_PRIVADOS, ...CENTINELAS_CON_LINEA], donde = "") {
  const json = JSON.stringify(valor);
  for (const c of centinelas) assert.ok(!json.includes(c), `${donde}: se ha colado «${c}» → ${json}`);
}

// ── 1-3. resumenDeCita ──────────────────────────────────────────────────────

describe("resumenDeCita", () => {
  it("no lleva nada privado ni lo que queda fuera, y conserva ids, hora, estado y dinero", () => {
    const r = resumenDeCita(citaCompleta());
    sinCentinelas(r, undefined, "resumen");
    for (const k of [...CAMPOS_PRIVADOS_CITA, ...CAMPOS_FUERA_DEL_RESUMEN]) {
      assert.ok(!(k in r), `el resumen no puede llevar «${k}»`);
    }
    const c = citaCompleta();
    for (const k of [
      "eventTypeId", "duration", "teamMemberId", "patientId", "clientId", "status", "packId",
      "sessionNumber", "cobroModo", "cobroImporte", "amount", "paymentStatus",
    ]) {
      assert.equal(r[k], c[k], `el resumen conserva «${k}»`);
    }
    assert.equal(r.scheduledAt, FECHA.toISOString());
  });

  it("la instancia (con toJSON) da lo mismo que el objeto plano", () => {
    assert.deepEqual(resumenDeCita({ toJSON: () => citaCompleta() }), resumenDeCita(citaCompleta()));
  });

  it("quita los nulos pero no los ceros ni los false", () => {
    const r = resumenDeCita({ ...citaCompleta(), packId: null });
    assert.ok(!("packId" in r));
    assert.equal(r.cobroImporte, 0);
    assert.equal(r.noShowJustified, false);
  });

  it("sin cita, null", () => {
    assert.equal(resumenDeCita(null), null);
    assert.equal(resumenDeCita(undefined), null);
  });
});

// ── 4-5. cambiosDeCita ──────────────────────────────────────────────────────

describe("cambiosDeCita", () => {
  it("de lo privado solo dice QUÉ cambió; de la hora, el antes y el después", () => {
    const antes = citaCompleta();
    const nueva = new Date("2026-10-06T09:00:00.000Z");
    const despues = { ...citaCompleta(), clientPhone: "699999888", notes: "otra-nota", scheduledAt: nueva };
    const r = cambiosDeCita(antes, despues);
    assert.deepEqual(r.antes, { scheduledAt: FECHA.toISOString() });
    assert.deepEqual(r.despues, { scheduledAt: nueva.toISOString() });
    assert.deepEqual(r.cambiadosSinValor, ["clientPhone", "notes"]);
    sinCentinelas(r, [...CENTINELAS_PRIVADOS, ...CENTINELAS_CON_LINEA, "699999888", "otra-nota"], "diff");
  });

  it("vaciar un campo de la lista blanca deja el null explícito", () => {
    const r = cambiosDeCita(citaCompleta(), { ...citaCompleta(), teamMemberId: null });
    assert.equal(r.antes.teamMemberId, "tm-1");
    assert.equal(r.despues.teamMemberId, null);
    assert.ok("teamMemberId" in r.despues);
  });

  it("si solo cambia updatedAt, no hay cambios", () => {
    const r = cambiosDeCita(citaCompleta(), { ...citaCompleta(), updatedAt: new Date() });
    assert.deepEqual(r, { antes: {}, despues: {}, cambiadosSinValor: [] });
  });

  it("la misma hora como Date y como texto ISO no cuenta como cambio", () => {
    const r = cambiosDeCita(citaCompleta(), { ...citaCompleta(), scheduledAt: FECHA.toISOString() });
    assert.deepEqual(r.antes, {});
  });

  it("meetUrl y cancellationReason salen por nombre, sin su valor", () => {
    const r = cambiosDeCita(citaCompleta(), {
      ...citaCompleta(),
      meetUrl: "https://meet.example/otra",
      cancellationReason: "otro-motivo",
    });
    assert.deepEqual(r.cambiadosSinValor, ["meetUrl", "cancellationReason"]);
    sinCentinelas(r, [...CENTINELAS_CON_LINEA, "meet.example/otra", "otro-motivo"], "diff");
  });

  it("acepta la instancia de después (con toJSON), como en el PATCH", () => {
    const r = cambiosDeCita(citaCompleta(), { toJSON: () => ({ ...citaCompleta(), status: "no_show" }) });
    assert.deepEqual(r.despues, { status: "no_show" });
  });
});

// ── 5b. fijosDeCita: lo que una edición lleva siempre ─────────────────────

describe("fijosDeCita (los dos lados de citas.booking_updated)", () => {
  /** Lo mismo que compone el PATCH de app/api/citas/bookings/[id]/route.js. */
  const lados = (antes, despues) => {
    const cambios = cambiosDeCita(antes, despues);
    return {
      before: { ...fijosDeCita(antes), ...cambios.antes },
      after: { ...fijosDeCita(despues), ...cambios.despues },
    };
  };

  it("mover solo la hora deja en los dos lados hora, duración, profesional, estado, tipo y paciente", () => {
    const nueva = new Date("2026-10-05T09:00:00.000Z");
    const { before, after } = lados(citaCompleta(), { ...citaCompleta(), scheduledAt: nueva });
    assert.deepEqual([...CAMPOS_FIJOS_EDICION].sort(), [
      "duration", "eventTypeId", "patientId", "scheduledAt", "status", "teamMemberId",
    ]);
    for (const lado of [before, after]) {
      for (const k of CAMPOS_FIJOS_EDICION) assert.ok(k in lado, `falta «${k}» en ${JSON.stringify(lado)}`);
    }
    assert.deepEqual(after, {
      scheduledAt: nueva.toISOString(),
      duration: 50,
      teamMemberId: "tm-1",
      status: "confirmed",
      eventTypeId: "et-1",
      patientId: "pa-1",
    });
    assert.equal(before.scheduledAt, FECHA.toISOString());
    assert.notEqual(before.scheduledAt, after.scheduledAt, "la consulta «cambia la hora» sigue siendo cierta");
    sinCentinelas({ before, after }, undefined, "lados de la edición");
  });

  it("si solo cambia el estado, la hora sale igual en los dos lados (no cuenta como movimiento)", () => {
    const { before, after } = lados(citaCompleta(), { ...citaCompleta(), status: "no_show" });
    assert.equal(before.scheduledAt, after.scheduledAt);
    assert.equal(before.status, "confirmed");
    assert.equal(after.status, "no_show");
  });

  it("una cita sin profesional ni paciente deja el null EXPLÍCITO", () => {
    const sinNadie = { ...citaCompleta(), teamMemberId: null, patientId: undefined };
    const f = fijosDeCita(sinNadie);
    assert.ok("teamMemberId" in f && f.teamMemberId === null);
    assert.ok("patientId" in f && f.patientId === null);
    const { after } = lados(sinNadie, { ...sinNadie, duration: 60 });
    assert.equal(after.teamMemberId, null);
    assert.equal(after.duration, 60);
  });

  it("acepta la instancia (toJSON) y no lanza con entradas raras", () => {
    assert.deepEqual(fijosDeCita({ toJSON: () => citaCompleta() }), fijosDeCita(citaCompleta()));
    for (const raro of [null, undefined, "x", 3, { toJSON: () => { throw new Error("roto"); } }]) {
      const f = fijosDeCita(raro);
      assert.deepEqual(Object.keys(f), [...CAMPOS_FIJOS_EDICION]);
      assert.ok(Object.values(f).every((v) => v === null));
    }
  });

  it("los fijos son de la lista blanca: nada privado", () => {
    for (const k of CAMPOS_FIJOS_EDICION) {
      assert.ok(CAMPOS_RESUMEN_CITA.includes(k), `«${k}» tiene que estar en CAMPOS_RESUMEN_CITA`);
    }
  });
});

// ── 6. borrarCitaDeVerdad: la huella que de verdad llega a master ──────────

describe("huella de la cita borrada", () => {
  function modelosFalsos({ cobro = null } = {}) {
    return {
      PaymentSession: { findOne: async () => cobro, destroy: async () => 0 },
      BookingChangeRequest: { destroy: async () => 0 },
      ClientNotice: { destroy: async () => 0 },
    };
  }

  it("borrarCitaDeVerdad devuelve la huella por sus FK y sin el nombre", async () => {
    let destruida = false;
    const row = { ...citaCompleta(), destroy: async () => { destruida = true; } };
    const res = await borrarCitaDeVerdad({ tenantModels: modelosFalsos(), row });
    assert.equal(res.ok, true);
    assert.equal(destruida, true);
    const c = citaCompleta();
    assert.deepEqual(res.huella, {
      clientId: c.clientId,
      patientId: c.patientId,
      tallerGrupoId: c.tallerGrupoId,
      scheduledAt: FECHA.toISOString(),
      estado: c.status,
      eventTypeId: c.eventTypeId,
      teamMemberId: c.teamMemberId,
      sessionNumber: c.sessionNumber,
    });
    assert.ok(!("cliente" in res.huella) && !("clientName" in res.huella));
    sinCentinelas(res, undefined, "borrarCitaDeVerdad");
  });

  it("con dinero de por medio no borra y lo dice", async () => {
    let destruida = false;
    const row = { ...citaCompleta(), destroy: async () => { destruida = true; } };
    const res = await borrarCitaDeVerdad({ tenantModels: modelosFalsos({ cobro: { status: "paid" } }), row });
    assert.deepEqual(res, { ok: false, freno: "está cobrada" });
    assert.equal(destruida, false);
  });

  it("una reserva pública sin ficha deja la huella sin «de quién», y no revienta", () => {
    const h = huellaDesdeBorrarCita({ ...citaCompleta(), clientId: null, patientId: null, tallerGrupoId: null });
    assert.equal(h.clientId, null);
    assert.equal(h.patientId, null);
    assert.equal(h.eventTypeId, "et-1");
    sinCentinelas(h, undefined, "huella sin ficha");
    assert.deepEqual(huellaDeCita(null).estado, null);
  });
});

// ── 7. sinDatosPrivadosDeCita ───────────────────────────────────────────────

describe("sinDatosPrivadosDeCita", () => {
  it("quita lo privado y las asociaciones anidadas; conserva lo propio de la línea", () => {
    const lado = {
      ...citaCompleta(),
      source: "manual",
      patient: { firstName: "Centinela", lastName: "Paciente" },
      diagnostico: { notas: "x" },
      asistentes: 3,
      reembolso: { importe: 0 },
    };
    const r = sinDatosPrivadosDeCita(lado);
    sinCentinelas(r, CENTINELAS_PRIVADOS, "red");
    for (const k of CAMPOS_PRIVADOS_CITA) assert.ok(!(k in r), `la red quita «${k}»`);
    assert.ok(!("patient" in r) && !("diagnostico" in r), "las asociaciones anidadas no pasan");
    assert.equal(r.source, "manual");
    assert.equal(r.asistentes, 3, "un número con nombre de asociación se queda (lo que monta el taller)");
    assert.deepEqual(r.reembolso, { importe: 0 });
    // cancellationReason y meetUrl se quedan: tienen su propia línea explícita
    // (precedente de `siguientes`/`desprogramar`, 12/09/2026).
    assert.equal(r.cancellationReason, "motivo-centinela");
    assert.equal(r.meetUrl, "https://meet.example/centinela");
  });

  it("una instancia con include (toJSON) también pierde la asociación", () => {
    const r = sinDatosPrivadosDeCita({ toJSON: () => ({ ...citaCompleta(), avisos: [{ texto: "Nombre Centinela" }] }) });
    assert.ok(!("avisos" in r));
    sinCentinelas(r, CENTINELAS_PRIVADOS, "instancia");
  });

  it("null y undefined dan null; un resumen ya limpio sale igual", () => {
    assert.equal(sinDatosPrivadosDeCita(null), null);
    assert.equal(sinDatosPrivadosDeCita(undefined), null);
    const limpio = { ...resumenDeCita(citaCompleta()), source: "landing" };
    assert.deepEqual(sinDatosPrivadosDeCita(limpio), limpio);
  });

  it("no lanza con entradas raras (va dentro de un try silencioso)", () => {
    for (const raro of ["x", 3, [], new Date(), true, { toJSON: () => { throw new Error("roto"); } }]) {
      assert.doesNotThrow(() => sinDatosPrivadosDeCita(raro));
    }
    assert.doesNotThrow(() => ladosParaAuditar());
    assert.doesNotThrow(() => ladosParaAuditar({ entity: "Booking", before: "x", after: 7 }));
  });
});

// ── 8. ladosParaAuditar: la red, por lo que devuelve ────────────────────────

describe("ladosParaAuditar (la red de logCitasAudit)", () => {
  it("con Booking, ningún lado lleva centinelas aunque le pasen la cita entera", () => {
    const { before, after } = ladosParaAuditar({
      entity: "Booking",
      before: citaCompleta(),
      after: { ...citaCompleta(), source: "manual" },
    });
    sinCentinelas(before, CENTINELAS_PRIVADOS, "red before");
    sinCentinelas(after, CENTINELAS_PRIVADOS, "red after");
    assert.equal(after.source, "manual");
  });

  it("con cualquier otra entidad devuelve los MISMOS objetos, sin tocarlos", () => {
    for (const entity of ["EventType", "Availability", "TeamBlock", "SessionPack"]) {
      const before = { name: "Primera visita", clientName: "no es una cita" };
      const after = { name: "Primera visita 2", notes: "texto del tipo" };
      const r = ladosParaAuditar({ entity, before, after });
      assert.equal(r.before, before, `${entity}: before intacto`);
      assert.equal(r.after, after, `${entity}: after intacto`);
    }
  });

  it("sin before ni after, nulls", () => {
    assert.deepEqual(ladosParaAuditar({ entity: "Booking" }), { before: null, after: null });
    assert.deepEqual(ladosParaAuditar({ entity: "EventType" }), { before: null, after: null });
  });
});

// ── 9. Deriva contra el modelo ──────────────────────────────────────────────

describe("deriva contra Booking.model.js", () => {
  const texto = leer("models/tenant/Booking.model.js");
  const desde = texto.indexOf("sequelize.define(");
  const hasta = texto.indexOf("tableName:", desde);
  assert.ok(desde > 0 && hasta > desde, "no encuentro el define de Booking");
  const bloque = texto.slice(desde, hasta);
  const OPCIONES = new Set(["validate", "references"]);
  const atributos = [...bloque.matchAll(/^[ \t]+(\w+): \{[ \t]*\r?$/gm)]
    .map((m) => m[1])
    .filter((k) => !OPCIONES.has(k));
  const columnas = new Set([...atributos, "createdAt", "updatedAt"]);
  const listas = { CAMPOS_RESUMEN_CITA, CAMPOS_PRIVADOS_CITA, CAMPOS_FUERA_DEL_RESUMEN };

  it("se leen todas las columnas (si no, la prueba pasaría en vacío)", () => {
    assert.ok(atributos.length >= 37, `solo ${atributos.length} atributos leídos`);
    assert.ok(atributos.includes("clientName") && atributos.includes("notes") && atributos.includes("id"));
  });

  it("cada columna está decidida en EXACTAMENTE una lista", () => {
    for (const col of columnas) {
      const en = Object.entries(listas).filter(([, l]) => l.includes(col)).map(([n]) => n);
      assert.equal(
        en.length,
        1,
        `columna nueva en bookings: decide si va al resumen, es privada o queda fuera → «${col}» está en [${en.join(", ")}]`
      );
    }
  });

  it("cada entrada de las listas existe en el modelo", () => {
    for (const [nombre, lista] of Object.entries(listas)) {
      for (const k of lista) assert.ok(columnas.has(k), `${nombre} nombra «${k}», que no está en Booking.model.js`);
    }
  });
});

// ── 10. Deriva de las asociaciones ──────────────────────────────────────────

describe("deriva contra los alias de Booking en tenantDb.js", () => {
  it("cada alias de Booking está en ASOCIACIONES_CITA", () => {
    const texto = leer("lib/db/tenantDb.js");
    const alias = [
      ...texto.matchAll(/\bBooking\.(?:belongsTo|hasMany|hasOne|belongsToMany)\([^)]*?as:\s*"(\w+)"/g),
    ].map((m) => m[1]);
    assert.ok(alias.length >= 11, `solo ${alias.length} alias leídos`);
    for (const a of alias) {
      assert.ok(ASOCIACIONES_CITA.includes(a), `alias nuevo de Booking «${a}»: añádelo a ASOCIACIONES_CITA`);
    }
  });
});

// ── 11. Las llamadas ────────────────────────────────────────────────────────

function ficherosJs(dir, fuera) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    const rel = relative(RAIZ, ruta).split(sep).join("/");
    if (nombre === "node_modules" || fuera.some((f) => rel === f || rel.startsWith(`${f}/`))) continue;
    const st = statSync(ruta);
    if (st.isDirectory()) out.push(...ficherosJs(ruta, fuera));
    else if (nombre.endsWith(".js")) out.push(rel);
  }
  return out;
}

/** Cada bloque `logCitasAudit({ … })` / `auditar({ … })`, cortado contando llaves. */
function bloquesDeAuditoria(texto) {
  const bloques = [];
  for (const m of texto.matchAll(/\b(?:logCitasAudit|auditar)\(\{/g)) {
    const inicio = m.index + m[0].length - 1;
    let prof = 0;
    let fin = -1;
    for (let i = inicio; i < texto.length; i++) {
      if (texto[i] === "{") prof++;
      else if (texto[i] === "}" && --prof === 0) {
        fin = i;
        break;
      }
    }
    if (fin > 0) bloques.push(texto.slice(inicio, fin + 1));
  }
  return bloques;
}

describe("las llamadas de auditoría de una cita", () => {
  const encontrados = [];
  const rutas = ["app", "lib", "scripts"].flatMap((d) => ficherosJs(join(RAIZ, d), ["scripts/_hechos"]));
  for (const rel of rutas) {
    for (const b of bloquesDeAuditoria(leer(rel))) {
      if (/entity:\s*"Booking"/.test(b)) encontrados.push({ rel, b });
    }
  }
  const de = (rel) => encontrados.filter((e) => e.rel === rel);

  it("se encuentran las que hay (si no, la prueba pasaría en vacío)", () => {
    assert.ok(encontrados.length >= 20, `solo ${encontrados.length} bloques con entity "Booking"`);
    for (const rel of [
      "app/api/citas/bookings/route.js",
      "app/api/public/c/[tenantSlug]/book/route.js",
      "lib/citas/cancelBooking.js",
      "scripts/convertir-bloqueos-en-citas-de-taller.js",
    ]) {
      assert.ok(de(rel).length >= 1, `no encuentro la auditoría de ${rel}`);
    }
    assert.ok(de("app/api/citas/bookings/[id]/route.js").length >= 5, "el [id] tiene cinco líneas de auditoría");
  });

  it("ninguna vuelca la fila con toJSON(", () => {
    for (const { rel, b } of encontrados) {
      assert.ok(!b.includes("toJSON("), `${rel} audita una cita con toJSON(): usa resumenDeCita\n${b}`);
    }
  });

  it("las piezas siguen en su sitio", () => {
    assert.ok(!leer("lib/citas/cancelBooking.js").includes("toJSON("), "cancelBooking.js guarda la foto con resumenDeCita");
    assert.ok(leer("lib/citas/audit.js").includes("ladosParaAuditar("), "logCitasAudit pasa por la red");
    const id = leer("app/api/citas/bookings/[id]/route.js");
    assert.ok(id.includes("cambiosDeCita(before, row)"), "el PATCH audita los cambios, no la fila");
    assert.ok(
      id.includes("fijosDeCita(before)") && id.includes("fijosDeCita(row)"),
      "el PATCH deja siempre hora, duración, profesional, estado, tipo y paciente en los dos lados"
    );
    assert.ok(id.includes("const before = resumenDeCita(row)"), "el DELETE que cancela guarda un resumen");
  });
});

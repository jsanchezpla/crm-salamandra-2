/**
 * lib/clinica/diagnosticoDb.js — lo que los endpoints del expediente de
 * diagnóstico necesitan de la base de datos, en pocas consultas
 * (12/09/2026, apartado Diagnóstico de Clínica).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad que NECESITA Sequelize de lo
 * que `lib/clinica/diagnostico.js` decide en puro —qué tipo de cita es el
 * DIAGNÓSTICO, qué concepto cobra cada producto, cuántas horas lleva un
 * expediente— y la piden los seis endpoints de `app/api/clinica/diagnosticos`
 * y el alta de citas cuando comprueba si una hora cabe. Copiado en cada uno,
 * habría seis maneras de contar la misma barra.)
 *
 * ── LAS HORAS SE CUENTAN CON UNA CONSULTA, NO CON UNA POR FILA ─────────────
 * La lista trae las citas de TODOS los expedientes de una vez y las reparte
 * en memoria (`agrupaPor`), como `lib/billing/bonosConSesiones.js` con los
 * bonos: en un centro con cincuenta diagnósticos abiertos, una consulta por
 * fila serían cincuenta consultas para pintar una tabla. La cuenta sigue
 * siendo la de `horasDe`, que es la única que sabe qué cita gasta hora.
 *
 * ── EL COBRO DE LA ENTREVISTA SE ATA POR ID; POR NOTA, SOLO LOS VIEJOS ─────
 * El cobro del bono se encuentra por `payments.pack_id`. El de la entrevista
 * tiene desde la segunda entrega (12/09/2026) su columna,
 * `diagnosticos.entrevista_payment_id`: la escribe `parar` (el cobro que
 * nace) o el alta que adopta una entrevista ya cobrada, y es lo que permite
 * DESCONTARLA del producto al seguir —para restar hay que saber sin adivinar
 * cuál es—. Los expedientes parados ANTES de la columna se siguen
 * encontrando como entonces: por el paciente, por la nota con la que nació el
 * cobro (`cobroDeLaEntrevista(...).texto`) y por haber nacido después que el
 * expediente. Y solo ellos: a un expediente con columna la nota no le cuenta.
 *
 * ── «EMPEZAR DESDE LO QUE YA HAY» ──────────────────────────────────────────
 * Aumenta tiene pacientes en diagnóstico desde antes de que existiera el
 * expediente. Qué se les mete al abrirlo lo decide en puro
 * `lib/clinica/adoptarEnDiagnostico.js`; aquí solo se trae lo que necesita
 * —las citas de los tipos de diagnóstico y de entrevista, los registros de
 * entrevista inicial y los cobros de la entrevista— en UNA consulta por tabla
 * para todos los pacientes de una vez (`GET …/candidatos`), que es la misma
 * consulta que hace el alta para un solo paciente. Nunca una por paciente.
 */

import { Op } from "sequelize";

import {
  productosDe,
  productoDe,
  tipoDiagnosticoDe,
  conceptoDeProducto,
  cobroDeLaEntrevista,
  cobroDelProducto,
  horasDe,
  cabeHora,
  estaAbierto,
  ROTULO_ESTADO,
  TRAMO_ENTREVISTA,
  TRAMO_HORAS,
} from "./diagnostico.js";
import { filaDeExpediente, agrupaPor, nombreDe } from "./diagnosticoFila.js";
import { citasAdoptables, descuentoDeLaEntrevista, resumenDeAdopcion, terapeutaSugerido } from "./adoptarEnDiagnostico.js";
import { CLAVE_PLANTILLA } from "./plantillas.js";
import { CLAVE_ENTREVISTA } from "./entrevistaInicial.js";

/** 42P01 = la tabla no existe en este schema (tenant sin la migración). */
export const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

/** 42703 = la columna no existe (tenant al que aún no le llegó una migración de columna). */
const columnaAusente = (err) => err?.parent?.code === "42703" || err?.original?.code === "42703";

/** Las columnas de una cita que la barra necesita: nada más, que las citas pesan. */
const ATRIBUTOS_DE_CITA = [
  "id", "diagnosticoId", "diagnosticoTramo", "status", "scheduledAt", "cancelledAt",
  "noShowJustified", "duration", "teamMemberId", "packId", "sessionNumber",
];

/** Y las que además hacen falta para decidir si una cita se ADOPTA (de qué tipo es, de quién, qué dice su nota). */
const ATRIBUTOS_DE_CITA_ADOPTABLE = [...ATRIBUTOS_DE_CITA, "eventTypeId", "patientId", "notes"];

/** Las columnas de un cobro que la fila y el descuento necesitan. */
const ATRIBUTOS_DE_COBRO = ["id", "packId", "patientId", "conceptId", "amount", "status", "refundedAt", "paidAt", "createdAt", "notes"];

/** Ventana por defecto y tope de «lo que ya hay» (meses hacia atrás). */
export const MESES_POR_DEFECTO = 12;
export const MESES_TOPE = 36;

/** Ids únicos como texto, sin nulos. `null`/`undefined` → []. */
const listaDeIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((v) => v !== null && v !== undefined && v !== "").map(String))];

/**
 * El catálogo que un expediente necesita, en dos consultas:
 *   · `tipos`            los tipos de cita activos del centro
 *   · `tipoDiagnostico`  el DIAGNÓSTICO (`informe_tipo = 'diagnostico'` y
 *                        nombre DIAGN…), o null si el centro no lo tiene
 *   · `tipoEntrevista`   el marcado como valoración inicial
 *                        (`isInitialAssessment`), o null
 *   · `conceptos`        el catálogo de conceptos (activos e inactivos: el
 *                        expediente puede apuntar a uno retirado)
 *   · `conceptoEntrevista` el concepto que cobra el tipo ENTREVISTA INICIAL,
 *                        o null (entonces la entrevista vale 50 € de fábrica)
 *
 * Nunca revienta: un centro sin Citas o sin Facturación devuelve listas
 * vacías y nulos, y quien llama lo dice en pantalla.
 */
export async function catalogoDelCentro(tenantModels) {
  const { EventType, BillingConcept } = tenantModels ?? {};
  let tipos = [];
  let conceptos = [];

  if (EventType) {
    try {
      tipos = await EventType.findAll({
        where: { active: true },
        attributes: ["id", "name", "duration", "informeTipo", "isInitialAssessment", "conceptId", "isHidden"],
        order: [["order", "ASC"], ["name", "ASC"]],
        raw: true,
      });
    } catch (err) {
      if (!tablaAusente(err)) throw err;
    }
  }
  if (BillingConcept) {
    try {
      conceptos = await BillingConcept.findAll({
        attributes: ["id", "name", "description", "unitPrice", "active"],
        raw: true,
      });
    } catch (err) {
      if (!tablaAusente(err)) throw err;
    }
  }

  const tipoDiagnostico = tipoDiagnosticoDe(tipos);
  const tipoEntrevista = tipos.find((t) => t.isInitialAssessment === true) ?? null;
  const conceptoEntrevista = tipoEntrevista?.conceptId
    ? conceptos.find((c) => String(c.id) === String(tipoEntrevista.conceptId)) ?? null
    : null;

  return { tipos, tipoDiagnostico, tipoEntrevista, conceptos, conceptoEntrevista };
}

/** El concepto de un expediente: el que tiene apuntado o, si no, el de su producto por nombre. */
export function conceptoDelExpediente({ tenant, expediente, catalogo }) {
  const conceptos = catalogo?.conceptos ?? [];
  if (expediente?.conceptId) {
    const fijado = conceptos.find((c) => String(c.id) === String(expediente.conceptId));
    if (fijado) return fijado;
  }
  return conceptoDeProducto(productoDelExpediente({ tenant, expediente }), conceptos);
}

/**
 * El producto de un expediente: el del catálogo del centro por su clave o,
 * si el centro lo retiró, uno reconstruido con la foto que guarda la fila
 * (nombre y tope): el expediente de hace un año sigue diciendo lo que se
 * contrató.
 */
export function productoDelExpediente({ tenant, expediente }) {
  const del = productoDe(tenant, expediente?.productoKey);
  if (del) return del;
  return {
    key: expediente?.productoKey ?? null,
    nombre: expediente?.productoNombre || expediente?.productoKey || "Diagnóstico",
    horas: Number(expediente?.horasMax) || 0,
    conceptId: expediente?.conceptId ?? null,
    precioEuros: null,
  };
}

/** Los miembros activos del equipo, para el desplegable del terapeuta asignado. */
export async function equipoActivo(tenantModels) {
  const { TeamMember } = tenantModels ?? {};
  if (!TeamMember) return [];
  try {
    const filas = await TeamMember.findAll({
      where: { status: "active" },
      attributes: ["id", "displayName"],
      order: [["displayName", "ASC"]],
      raw: true,
    });
    return filas.map((m) => ({ id: m.id, nombre: m.displayName || "(sin nombre)" }));
  } catch (err) {
    if (tablaAusente(err)) return [];
    throw err;
  }
}

/** Nombre legible de quien hace la petición, para `session_packs.created_by` (como en Facturación → Bonos). */
export async function nombreDeQuienPide(request, tenantModels) {
  const userId = request.headers.get("x-user-id");
  try {
    const { TeamMember } = tenantModels ?? {};
    if (TeamMember && userId) {
      const tm = await TeamMember.findOne({ where: { userId }, attributes: ["displayName", "email"] });
      if (tm) return tm.displayName || tm.email || userId;
    }
  } catch {
    // Sin ficha de equipo (dirección que no da servicio) o sin tabla: queda el
    // id, que al menos se rastrea con el log de auditoría.
  }
  return userId ?? null;
}

/** Las citas de varios expedientes, en UNA consulta: Map id de expediente → [citas]. */
export async function citasDeExpedientes(tenantModels, ids) {
  const { Booking } = tenantModels ?? {};
  const lista = listaDeIds(ids);
  if (!Booking || !lista.length) return new Map();
  try {
    const citas = await Booking.findAll({
      where: { diagnosticoId: { [Op.in]: lista } },
      attributes: ATRIBUTOS_DE_CITA,
      order: [["scheduledAt", "ASC"]],
      raw: true,
    });
    return agrupaPor(citas, "diagnosticoId");
  } catch (err) {
    // Un centro sin la tabla de citas (o sin la columna migrada) no tiene
    // horas que contar: la barra sale a cero, no en rojo.
    if (tablaAusente(err) || columnaAusente(err)) return new Map();
    throw err;
  }
}

/**
 * Los cobros de varios expedientes, en UNA consulta: Map id de expediente →
 * [filas de payments]. Los del bono, por `pack_id`; el de la entrevista, por
 * `entrevista_payment_id` y, SOLO para los parados que no tienen la columna
 * escrita (anteriores a la segunda entrega), por paciente + nota + fecha
 * (ver la cabecera).
 */
export async function cobrosDeExpedientes(tenantModels, expedientes, { textoEntrevista } = {}) {
  const { Payment } = tenantModels ?? {};
  const mapa = new Map();
  const lista = Array.isArray(expedientes) ? expedientes : [];
  if (!Payment || !lista.length) return mapa;

  const porPack = new Map();
  const porPago = new Map();
  const pararonPorPaciente = new Map();
  for (const e of lista) {
    if (e.packId) porPack.set(String(e.packId), e);
    if (e.entrevistaPaymentId) {
      porPago.set(String(e.entrevistaPaymentId), e);
    } else if (e.status === "no_continua" && e.patientId) {
      const k = String(e.patientId);
      if (!pararonPorPaciente.has(k)) pararonPorPaciente.set(k, []);
      pararonPorPaciente.get(k).push(e);
    }
  }

  const condiciones = [];
  if (porPago.size) condiciones.push({ id: { [Op.in]: [...porPago.keys()] } });
  if (porPack.size) condiciones.push({ packId: { [Op.in]: [...porPack.keys()] } });
  if (pararonPorPaciente.size && textoEntrevista) {
    condiciones.push({
      patientId: { [Op.in]: [...pararonPorPaciente.keys()] },
      packId: null,
      notes: textoEntrevista,
    });
  }
  if (!condiciones.length) return mapa;

  let filas = [];
  try {
    filas = await Payment.findAll({
      where: { [Op.or]: condiciones },
      attributes: ATRIBUTOS_DE_COBRO,
      order: [["createdAt", "ASC"]],
      raw: true,
    });
  } catch (err) {
    // Sin tabla de cobros (centro sin Facturación) no hay dinero que enseñar.
    if (tablaAusente(err) || columnaAusente(err)) return mapa;
    throw err;
  }

  const apunta = (id, fila) => {
    const k = String(id);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(fila);
  };

  for (const f of filas) {
    // El cobro de la entrevista atado por id: manda sobre todo lo demás.
    if (porPago.has(String(f.id))) {
      apunta(porPago.get(String(f.id)).id, f);
      continue;
    }
    if (f.packId && porPack.has(String(f.packId))) {
      apunta(porPack.get(String(f.packId)).id, f);
      continue;
    }
    // El cobro de una entrevista sin columna: del último expediente parado de
    // ese paciente que ya existía cuando nació el cobro.
    const candidatos = (pararonPorPaciente.get(String(f.patientId)) ?? [])
      .filter((e) => !e.createdAt || !f.createdAt || new Date(e.createdAt) <= new Date(f.createdAt))
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    if (candidatos.length) apunta(candidatos[0].id, f);
  }
  return mapa;
}

/**
 * Entre los cobros de un expediente (los de `cobrosDeExpedientes`), cuál es
 * el de la ENTREVISTA: el que dice la columna `entrevistaPaymentId` o, sin
 * columna (parado antes de la segunda entrega), la fila que no es de ningún
 * bono. Null si no hay. PURO.
 */
export function cobroDeEntrevistaEntre(expediente, cobros) {
  const lista = (Array.isArray(cobros) ? cobros : []).filter(Boolean);
  const id = expediente?.entrevistaPaymentId;
  if (id) return lista.find((c) => String(c.id) === String(id)) ?? null;
  return lista.find((c) => !c.packId) ?? null;
}

/** El cobro de la entrevista de UN expediente (una consulta), o null. */
export async function cobroDeEntrevistaDelExpediente(tenantModels, expediente, { textoEntrevista } = {}) {
  if (!expediente?.id) return null;
  const cobros = await cobrosDeExpedientes(tenantModels, [expediente], { textoEntrevista });
  return cobroDeEntrevistaEntre(expediente, cobros.get(String(expediente.id)) ?? []);
}

/**
 * LAS FILAS de una lista de expedientes, ya en JSON y con su barra, su
 * terapeuta, su paciente y su dinero: cuatro consultas para toda la lista.
 *
 * `expedientes` son instancias de `Diagnostico` (con los includes `patient` y
 * `therapist` si se cargaron; si no, se cargan aquí de una vez).
 *
 * Desde la segunda entrega cada fila lleva además `cobroAlSeguir` —lo que
 * costará «Seguir» en ESE expediente, con la entrevista ya cobrada
 * descontada— y `dinero.entrevista`. `tenant` hace falta para que el producto
 * sea el del centro (sin él, el de fábrica o la foto del expediente).
 * `extras` (Map id → objeto, o función (expediente) → objeto) añade a
 * `filaDeExpediente` lo que un endpoint tenga de más: `registros`,
 * `sesionesPorCita`, `informe`, `terapeutas`, `siguienteTitulo`.
 */
export async function filasDe({
  tenantModels,
  tenant = null,
  expedientes,
  puedeDecidir = false,
  catalogo = null,
  ahora = new Date(),
  conCitas = false,
  extras = null,
} = {}) {
  const lista = Array.isArray(expedientes) ? expedientes : [];
  if (!lista.length) return [];
  const { Patient, TeamMember } = tenantModels ?? {};

  const ids = lista.map((e) => e.id);
  const cat = catalogo ?? (await catalogoDelCentro(tenantModels));
  const textoEntrevista = cobroDeLaEntrevista(cat.conceptoEntrevista).texto;

  const [citas, cobros, pacientes, terapeutas] = await Promise.all([
    citasDeExpedientes(tenantModels, ids),
    cobrosDeExpedientes(tenantModels, lista, { textoEntrevista }),
    pacientesDe(Patient, lista),
    terapeutasDe(TeamMember, lista),
  ]);

  const extraDe = (e) => {
    if (typeof extras === "function") return extras(e) ?? {};
    if (extras instanceof Map) return extras.get(String(e.id)) ?? {};
    return {};
  };

  return lista.map((e) => {
    const cobrosDe = cobros.get(String(e.id)) ?? [];
    const cobroEntrevista = cobroDeEntrevistaEntre(e, cobrosDe);
    // Lo que costará «Seguir» en ESTE expediente: su producto, su concepto y
    // su entrevista descontada (el MISMO cálculo que hará el POST).
    const producto = productoDelExpediente({ tenant, expediente: e });
    const concepto = conceptoDelExpediente({ tenant, expediente: e, catalogo: cat });
    const cobroAlSeguir = cobroDelProducto(producto, concepto, { descuentoEuros: descuentoDeLaEntrevista(cobroEntrevista) });
    return filaDeExpediente({
      expediente: e,
      citas: citas.get(String(e.id)) ?? [],
      paciente: e.patient ?? pacientes.get(String(e.patientId)) ?? null,
      terapeuta: e.therapist ?? (e.therapistId ? terapeutas.get(String(e.therapistId)) ?? null : null),
      cobros: cobrosDe,
      cobroEntrevista,
      cobroAlSeguir,
      puedeDecidir,
      ahora,
      conCitas,
      ...extraDe(e),
    });
  });
}

/** Los pacientes de la lista que no vinieron por include, en una consulta. */
async function pacientesDe(Patient, expedientes) {
  const mapa = new Map();
  const ids = [...new Set(expedientes.filter((e) => !e.patient && e.patientId).map((e) => String(e.patientId)))];
  if (!Patient || !ids.length) return mapa;
  try {
    const filas = await Patient.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "firstName", "lastName"], raw: true });
    for (const p of filas) mapa.set(String(p.id), p);
  } catch (err) {
    if (!tablaAusente(err)) throw err;
  }
  return mapa;
}

/** Los terapeutas de la lista que no vinieron por include, en una consulta. */
async function terapeutasDe(TeamMember, expedientes) {
  const mapa = new Map();
  const ids = [...new Set(expedientes.filter((e) => !e.therapist && e.therapistId).map((e) => String(e.therapistId)))];
  if (!TeamMember || !ids.length) return mapa;
  try {
    const filas = await TeamMember.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "displayName"], raw: true });
    for (const t of filas) mapa.set(String(t.id), t);
  } catch (err) {
    if (!tablaAusente(err)) throw err;
  }
  return mapa;
}

/** Los miembros del equipo por id, en una consulta: Map id → { id, displayName }. */
export async function terapeutasPorId(tenantModels, ids) {
  const { TeamMember } = tenantModels ?? {};
  const lista = listaDeIds(ids);
  const mapa = new Map();
  if (!TeamMember || !lista.length) return mapa;
  try {
    const filas = await TeamMember.findAll({ where: { id: { [Op.in]: lista } }, attributes: ["id", "displayName"], raw: true });
    for (const t of filas) mapa.set(String(t.id), t);
  } catch (err) {
    if (!tablaAusente(err)) throw err;
  }
  return mapa;
}

/** La barra de UN expediente, contada desde sus citas (una consulta). */
export async function horasDelExpediente(tenantModels, expediente, ahora = new Date()) {
  const citas = await citasDeExpedientes(tenantModels, [expediente?.id]);
  return horasDe({ expediente, citas: citas.get(String(expediente?.id)) ?? [], ahora });
}

/**
 * ¿Cabe una cita de `duracionMin` en este expediente? La puerta que cruza el
 * alta de citas (`POST /api/citas/bookings`) cuando la cita trae
 * `diagnosticoId`.
 *
 * Devuelve `{ ok, motivo, status, expediente, horas, despues }`:
 *   · sin expediente → ok:false, motivo «Ese diagnóstico no existe»
 *   · cerrado o parado → ok:false, motivo con el estado (una cita nueva en un
 *     diagnóstico que no sigue no tiene dónde apuntarse)
 *   · no cabe → ok:false, motivo = la frase del 422 de `cabeHora`
 *   · si `citaId` viene, esa cita no se cuenta (reprogramar la misma cita no
 *     puede chocar consigo misma)
 * La entrevista (`tramo = 'entrevista'`) vale 1 h, como en la barra.
 */
export async function cabeCitaEnExpediente(tenantModels, { diagnosticoId, duracionMin, tramo = null, citaId = null, ahora = new Date() } = {}) {
  const { Diagnostico } = tenantModels ?? {};
  if (!Diagnostico || !diagnosticoId) return { ok: false, motivo: "Ese diagnóstico no existe", status: null, expediente: null, horas: null, despues: null };
  let expediente = null;
  try {
    expediente = await Diagnostico.findByPk(diagnosticoId);
  } catch (err) {
    if (!tablaAusente(err)) throw err;
  }
  if (!expediente) return { ok: false, motivo: "Ese diagnóstico no existe", status: null, expediente: null, horas: null, despues: null };

  const todas = (await citasDeExpedientes(tenantModels, [expediente.id])).get(String(expediente.id)) ?? [];
  const citas = citaId ? todas.filter((c) => String(c.id) !== String(citaId)) : todas;
  const horas = horasDe({ expediente, citas, ahora });

  if (!estaAbierto(expediente)) {
    const rotulo = ROTULO_ESTADO[expediente.status] ?? expediente.status;
    return { ok: false, motivo: `Este diagnóstico está ${String(rotulo).toLowerCase()}: no admite citas nuevas`, status: expediente.status, expediente, horas, despues: null };
  }

  // La entrevista vale 1 h dure lo que dure (la misma regla que `horasDe`).
  const minutos = tramo === "entrevista" ? 60 : Number(duracionMin);
  const cabe = cabeHora(horas, minutos);
  return { ok: cabe.cabe, motivo: cabe.mensaje, status: expediente.status, expediente, horas, despues: cabe.despues };
}

/** Los productos del centro tal como los da la API (para los desplegables). */
export function productosParaLaPantalla(tenant) {
  return productosDe(tenant).map((p) => ({ key: p.key, nombre: p.nombre, horas: p.horas, conceptId: p.conceptId, precioEuros: p.precioEuros }));
}

/* ═══ «Empezar desde lo que ya hay»: lo que se trae y lo que se escribe ═══ */

/** Meses hacia atrás de «lo que ya hay»: entero entre 1 y `MESES_TOPE`; sin valor legible, `MESES_POR_DEFECTO`. PURO. */
export function mesesDeAdopcion(valor) {
  if (valor === null || valor === undefined || valor === "") return MESES_POR_DEFECTO;
  const n = Number(valor);
  if (!Number.isFinite(n)) return MESES_POR_DEFECTO;
  return Math.min(MESES_TOPE, Math.max(1, Math.trunc(n)));
}

/** La fecha desde la que se mira: `ahora` menos `meses` meses. PURO. */
export function desdeHace(meses, ahora = new Date()) {
  const d = new Date(ahora);
  d.setMonth(d.getMonth() - mesesDeAdopcion(meses));
  return d;
}

/**
 * Los tipos de cita que pueden ADOPTARSE, por columnas y en una consulta:
 * los de horas de diagnóstico (`informe_tipo = 'diagnostico'`) y el de la
 * entrevista inicial (`is_initial_assessment`). Activos e INACTIVOS: una
 * cita de hace ocho meses de un tipo que el centro retiró sigue siendo una
 * hora de diagnóstico. Map id → tipo (lo que `citasAdoptables` espera).
 */
export async function tiposDeAdopcion(tenantModels) {
  const { EventType } = tenantModels ?? {};
  const mapa = new Map();
  if (!EventType) return mapa;
  try {
    const filas = await EventType.findAll({
      where: { [Op.or]: [{ informeTipo: "diagnostico" }, { isInitialAssessment: true }] },
      attributes: ["id", "name", "duration", "informeTipo", "isInitialAssessment", "active"],
      raw: true,
    });
    for (const t of filas) mapa.set(String(t.id), t);
  } catch (err) {
    if (!tablaAusente(err) && !columnaAusente(err)) throw err;
  }
  return mapa;
}

/**
 * Las citas que podrían adoptarse, en UNA consulta: las de los `tipos` de
 * adopción, sin expediente (`diagnosticoId` nulo), no canceladas y —si
 * `desde` viene— desde esa fecha (las futuras entran siempre). Map paciente
 * → [citas ASC]. `patientIds` a null = todos los pacientes del centro (el
 * buscador de candidatos); una lista = solo esos (el alta).
 */
export async function citasAdoptablesDe(tenantModels, { patientIds = null, tipos, desde = null } = {}) {
  const { Booking } = tenantModels ?? {};
  const idsDeTipo = tipos instanceof Map ? [...tipos.keys()] : [];
  if (!Booking || !idsDeTipo.length) return new Map();

  const where = {
    eventTypeId: { [Op.in]: idsDeTipo },
    diagnosticoId: null,
    status: { [Op.ne]: "cancelled" },
    patientId: { [Op.ne]: null },
  };
  if (patientIds !== null) {
    const pacientes = listaDeIds(patientIds);
    if (!pacientes.length) return new Map();
    where.patientId = { [Op.in]: pacientes };
  }
  if (desde instanceof Date && !Number.isNaN(desde.getTime())) where.scheduledAt = { [Op.gte]: desde };

  try {
    const citas = await Booking.findAll({
      where,
      attributes: ATRIBUTOS_DE_CITA_ADOPTABLE,
      order: [["scheduledAt", "ASC"]],
      raw: true,
    });
    return agrupaPor(citas, "patientId");
  } catch (err) {
    if (tablaAusente(err) || columnaAusente(err)) return new Map();
    throw err;
  }
}

/**
 * Los registros de ENTREVISTA INICIAL sin expediente
 * (`content_sections->>'plantilla' = 'entrevista_inicial'` y `diagnostico_id`
 * nulo), en UNA consulta: Map paciente → [sesiones, la más reciente primero].
 * Solo lo que hace falta para atarlas: nada clínico viaja.
 */
export async function registrosDeEntrevistaDe(tenantModels, { patientIds = null, desde = null } = {}) {
  const { ClinicSession } = tenantModels ?? {};
  if (!ClinicSession) return new Map();

  const where = { diagnosticoId: null, contentSections: { [CLAVE_PLANTILLA]: CLAVE_ENTREVISTA } };
  if (patientIds !== null) {
    const pacientes = listaDeIds(patientIds);
    if (!pacientes.length) return new Map();
    where.patientId = { [Op.in]: pacientes };
  }
  if (desde instanceof Date && !Number.isNaN(desde.getTime())) where.sessionDate = { [Op.gte]: desde };

  try {
    const filas = await ClinicSession.findAll({
      where,
      attributes: ["id", "patientId", "bookingId", "sessionDate", "status", "therapistId", "diagnosticoId"],
      order: [["sessionDate", "DESC"]],
      raw: true,
    });
    return agrupaPor(filas, "patientId");
  } catch (err) {
    if (tablaAusente(err) || columnaAusente(err)) return new Map();
    throw err;
  }
}

/**
 * Los cobros de ENTREVISTA de esos pacientes, en UNA consulta: los que llevan
 * el concepto de la entrevista del centro o dicen «entrevista inicial» en la
 * nota, cobrados o pendientes y no devueltos (el enum de `payments` es
 * pending/completed/failed/refunded). Map paciente → [cobros, el más reciente
 * primero]. Quién es EL cobro lo decide `adopcionDe`.
 */
export async function cobrosDeEntrevistaDe(tenantModels, { patientIds, conceptoEntrevistaId = null } = {}) {
  const { Payment } = tenantModels ?? {};
  const pacientes = listaDeIds(patientIds);
  if (!Payment || !pacientes.length) return new Map();

  const porQue = [{ notes: { [Op.iLike]: "%entrevista inicial%" } }];
  if (conceptoEntrevistaId) porQue.push({ conceptId: conceptoEntrevistaId });

  try {
    const filas = await Payment.findAll({
      where: {
        patientId: { [Op.in]: pacientes },
        status: { [Op.in]: ["completed", "pending"] },
        refundedAt: null,
        [Op.or]: porQue,
      },
      attributes: ATRIBUTOS_DE_COBRO,
      order: [["paidAt", "DESC"], ["createdAt", "DESC"]],
      raw: true,
    });
    return agrupaPor(filas, "patientId");
  } catch (err) {
    if (tablaAusente(err) || columnaAusente(err)) return new Map();
    throw err;
  }
}

/** El instante de una fila por una de sus fechas, o 0. */
function cuando(fila, ...campos) {
  for (const campo of campos) {
    const t = new Date(fila?.[campo] ?? NaN).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

/**
 * Qué se ADOPTA de un paciente, decidido en PURO sobre lo que trajeron las
 * consultas de arriba (es lo mismo para el buscador y para el alta):
 *
 *   citas               las de `citasAdoptablesDe` para ese paciente
 *   sesiones            las de `registrosDeEntrevistaDe` para ese paciente
 *   cobros              las de `cobrosDeEntrevistaDe` para ese paciente
 *   tipos               el Map de `tiposDeAdopcion`
 *   entrevistaBookingId la que quien abre señala como entrevista (o null)
 *   conHoras            false = solo la entrevista (la casilla de citas
 *                       desmarcada); true = también las horas
 *   cobrosUsados        ids de cobros que YA son la entrevista de otro
 *                       expediente del paciente: no se adoptan dos veces
 *
 * Devuelve `{ entrevista, horas, resumen, sesionEntrevista, cobroEntrevista,
 * entrevistaPedidaValida, hayAlgo }`:
 *   · `entrevista`/`horas`/`resumen` son los de `citasAdoptables`;
 *   · `sesionEntrevista` es el registro de la cita de la entrevista o, si no
 *     lo hay, el último de entrevista inicial del paciente sin expediente;
 *   · `cobroEntrevista` es el cobro más reciente no usado, y SOLO si hay una
 *     entrevista (cita o registro) que cobrar: sin entrevista no hay nada que
 *     descontar del producto;
 *   · `entrevistaPedidaValida` es false cuando se señaló una cita y no es
 *     adoptable (no es del paciente, está cancelada o ya es de un expediente).
 */
export function adopcionDe({
  citas = [],
  sesiones = [],
  cobros = [],
  tipos = null,
  entrevistaBookingId = null,
  conHoras = true,
  cobrosUsados = null,
  ahora = new Date(),
} = {}) {
  const a = citasAdoptables({ citas, tiposPorId: tipos, entrevistaBookingId, ahora });
  const pedida = String(entrevistaBookingId ?? "").trim();
  const entrevistaPedidaValida = !pedida || String(a.entrevista?.id ?? "") === pedida;

  const horas = conHoras ? a.horas : [];
  const resumen = conHoras ? a.resumen : { citas: 0, hechas: 0, horasHechas: 0, futuras: 0, horasReservadas: 0 };

  const registros = (Array.isArray(sesiones) ? sesiones : [])
    .map((s) => (s?.toJSON ? s.toJSON() : s))
    .filter((s) => s && !s.diagnosticoId)
    .sort((x, y) => cuando(y, "sessionDate") - cuando(x, "sessionDate"));
  const sesionEntrevista =
    (a.entrevista && registros.find((s) => String(s.bookingId ?? "") === String(a.entrevista.id))) ?? registros[0] ?? null;

  const usados = new Set(listaDeIds(cobrosUsados));
  const hayEntrevista = Boolean(a.entrevista || sesionEntrevista);
  const cobroEntrevista = hayEntrevista
    ? (Array.isArray(cobros) ? cobros : [])
        .map((c) => (c?.toJSON ? c.toJSON() : c))
        .filter((c) => c && c.id && !usados.has(String(c.id)))
        .sort((x, y) => cuando(y, "paidAt", "createdAt") - cuando(x, "paidAt", "createdAt"))[0] ?? null
    : null;

  return {
    entrevista: a.entrevista,
    horas,
    resumen,
    sesionEntrevista,
    cobroEntrevista,
    entrevistaPedidaValida,
    hayAlgo: Boolean(a.entrevista || horas.length || sesionEntrevista),
  };
}

/** Un cobro resumido para la pantalla: `{ id, importe, status }` o null. PURO. */
export function resumenDeCobro(cobro) {
  const c = cobro?.toJSON ? cobro.toJSON() : cobro;
  if (!c || typeof c !== "object" || !c.id) return null;
  return { id: c.id, importe: Math.round((Number(c.amount ?? c.importe) || 0) * 100) / 100, status: c.status ?? null };
}

/**
 * La FILA de un candidato de «Empezar desde lo que ya hay», o null si el
 * paciente no lo es (tiene un expediente abierto, o no hay nada que meter).
 * PURO: recibe lo que trajeron las consultas para ESE paciente.
 *
 *   paciente     { id, firstName, lastName, clientId }
 *   expedientes  sus filas de `diagnosticos` (con `status` y
 *                `entrevistaPaymentId`)
 *   terapeutas   Map id → { id, displayName } para nombrar al sugerido
 *                (opcional: sin él, `nombre` sale null y se rellena después)
 *   meses        la ventana con la que se buscó, para que `adoptar` la repita
 */
export function filaDeCandidato({
  paciente,
  citas = [],
  sesiones = [],
  cobros = [],
  expedientes = [],
  tipos = null,
  terapeutas = null,
  ahora = new Date(),
  meses = MESES_POR_DEFECTO,
} = {}) {
  if (!paciente?.id) return null;
  const lista = (Array.isArray(expedientes) ? expedientes : []).filter(Boolean);
  if (lista.some(estaAbierto)) return null;

  const a = adopcionDe({
    citas,
    sesiones,
    cobros,
    tipos,
    cobrosUsados: lista.map((e) => e.entrevistaPaymentId).filter(Boolean),
    ahora,
  });
  if (!a.hayAlgo) return null;

  const cobro = resumenDeCobro(a.cobroEntrevista);
  const entrevista =
    a.entrevista || a.sesionEntrevista
      ? {
          bookingId: a.entrevista?.id ?? null,
          fecha: a.entrevista?.scheduledAt ?? a.sesionEntrevista?.sessionDate ?? null,
          status: a.entrevista?.status ?? null,
          sessionId: a.sesionEntrevista?.id ?? null,
          cobro,
        }
      : null;

  const sugerido = terapeutaSugerido([...a.horas, ...(a.entrevista ? [a.entrevista] : [])]);
  const t = sugerido && terapeutas instanceof Map ? terapeutas.get(String(sugerido)) ?? null : null;

  return {
    paciente: { id: paciente.id, nombre: nombreDe(paciente) },
    clientId: paciente.clientId ?? null,
    terapeutaSugerido: sugerido ? { id: sugerido, nombre: t ? nombreDe(t) : null } : null,
    citasDiagnostico: a.horas.length
      ? {
          total: a.resumen.citas,
          hechas: a.resumen.hechas,
          horasHechas: a.resumen.horasHechas,
          futuras: a.resumen.futuras,
          horasReservadas: a.resumen.horasReservadas,
          primera: a.horas[0]?.scheduledAt ?? null,
          ultima: a.horas.at(-1)?.scheduledAt ?? null,
        }
      : null,
    entrevista,
    expedientesCerrados: lista.filter((e) => !estaAbierto(e)).length,
    // La frase de la casilla y el cuerpo que el alta espera en `adoptar`.
    resumen: resumenDeAdopcion({
      resumen: a.resumen,
      entrevista: a.entrevista ?? (a.sesionEntrevista ? { scheduledAt: a.sesionEntrevista.sessionDate } : null),
      cobroEntrevista: cobro,
    }),
    adoptar: { citas: true, entrevistaBookingId: a.entrevista?.id ?? null, meses: mesesDeAdopcion(meses) },
  };
}

/**
 * ESCRIBE la adopción dentro de la transacción del alta: `diagnosticoId` y
 * `diagnosticoTramo` en las citas, `diagnosticoId` en los registros de esas
 * citas y en el de la entrevista. Cada UPDATE exige `diagnostico_id IS NULL`:
 * si otro alta se adelantó con la misma cita, no se la roba. Devuelve cuántas
 * filas cambió: `{ citas, entrevista, registros }`. Si la entrevista no se
 * pudo atar (ya era de otro), limpia `entrevistaBookingId` del expediente.
 */
export async function adoptarEnExpediente(tenantModels, { expediente, adopcion, transaction }) {
  const { Booking, ClinicSession } = tenantModels ?? {};
  const salida = { citas: 0, entrevista: false, registros: 0 };
  if (!expediente?.id || !adopcion) return salida;

  const idsHoras = listaDeIds(adopcion.horas?.map((c) => c.id));
  const idEntrevista = adopcion.entrevista?.id ? String(adopcion.entrevista.id) : null;
  const diagnosticoId = expediente.id;
  // Candado de paciente en cada UPDATE (revisión 12/09/2026): las citas y los
  // registros ya vienen de consultas acotadas al paciente, pero el `where`
  // vuelve a exigirlo. Una fila mal atada —una sesión cuyo `booking_id`
  // apunte a la cita de otro niño— no puede entrar en este expediente.
  const patientId = expediente.patientId ?? null;
  const delPaciente = patientId ? { patientId } : {};

  if (Booking) {
    if (idEntrevista) {
      const [n] = await Booking.update(
        { diagnosticoId, diagnosticoTramo: TRAMO_ENTREVISTA },
        { where: { id: idEntrevista, diagnosticoId: null, ...delPaciente }, transaction }
      );
      salida.entrevista = n > 0;
      if (!salida.entrevista && expediente.entrevistaBookingId) {
        await expediente.update({ entrevistaBookingId: null }, { transaction });
      }
    }
    if (idsHoras.length) {
      const [n] = await Booking.update(
        { diagnosticoId, diagnosticoTramo: TRAMO_HORAS },
        { where: { id: { [Op.in]: idsHoras }, diagnosticoId: null, ...delPaciente }, transaction }
      );
      salida.citas = n;
    }
  }

  if (ClinicSession) {
    const todas = [...idsHoras, ...(idEntrevista ? [idEntrevista] : [])];
    if (todas.length) {
      const [n] = await ClinicSession.update(
        { diagnosticoId },
        { where: { bookingId: { [Op.in]: todas }, diagnosticoId: null, ...delPaciente }, transaction }
      );
      salida.registros += n;
    }
    if (adopcion.sesionEntrevista?.id) {
      const [n] = await ClinicSession.update(
        { diagnosticoId },
        { where: { id: adopcion.sesionEntrevista.id, diagnosticoId: null, ...delPaciente }, transaction }
      );
      salida.registros += n;
    }
  }

  return salida;
}

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
 * ── EL COBRO DE LA ENTREVISTA NO TIENE COLUMNA QUE LO ATE ──────────────────
 * El cobro del bono se encuentra por `payments.pack_id`. El de la entrevista
 * («Parar el diagnóstico») no tiene bono, y `payments` no sabe de
 * diagnósticos: se reconoce por el paciente, por la nota con la que nació
 * (`cobroDeLaEntrevista(...).texto`) y por haber nacido después que el
 * expediente. Si alguien reescribe esa nota a mano, la lista deja de verlo
 * como suyo —el cobro sigue en Cobros, no se pierde nada—; una columna
 * `entrevista_payment_id` lo dejaría clavado, y es un candidato para la
 * segunda entrega.
 */

import { Op } from "sequelize";

import {
  productosDe,
  productoDe,
  tipoDiagnosticoDe,
  conceptoDeProducto,
  cobroDeLaEntrevista,
  horasDe,
  cabeHora,
  estaAbierto,
  ROTULO_ESTADO,
} from "./diagnostico.js";
import { filaDeExpediente, agrupaPor } from "./diagnosticoFila.js";

/** 42P01 = la tabla no existe en este schema (tenant sin la migración). */
export const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

/** Las columnas de una cita que la barra necesita: nada más, que las citas pesan. */
const ATRIBUTOS_DE_CITA = [
  "id", "diagnosticoId", "diagnosticoTramo", "status", "scheduledAt", "cancelledAt",
  "noShowJustified", "duration", "teamMemberId", "packId", "sessionNumber",
];

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
  const lista = [...new Set((ids ?? []).filter(Boolean).map(String))];
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
    if (tablaAusente(err) || err?.parent?.code === "42703") return new Map();
    throw err;
  }
}

/**
 * Los cobros de varios expedientes, en UNA consulta: Map id de expediente →
 * [filas de payments]. Los del bono, por `pack_id`; los de la entrevista, por
 * paciente + nota + fecha (ver la cabecera).
 */
export async function cobrosDeExpedientes(tenantModels, expedientes, { textoEntrevista } = {}) {
  const { Payment } = tenantModels ?? {};
  const mapa = new Map();
  const lista = Array.isArray(expedientes) ? expedientes : [];
  if (!Payment || !lista.length) return mapa;

  const porPack = new Map();
  const pararonPorPaciente = new Map();
  for (const e of lista) {
    if (e.packId) porPack.set(String(e.packId), e);
    if (e.status === "no_continua" && e.patientId) {
      const k = String(e.patientId);
      if (!pararonPorPaciente.has(k)) pararonPorPaciente.set(k, []);
      pararonPorPaciente.get(k).push(e);
    }
  }

  const condiciones = [];
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
      attributes: ["id", "packId", "patientId", "amount", "status", "refundedAt", "paidAt", "createdAt"],
      order: [["createdAt", "ASC"]],
      raw: true,
    });
  } catch (err) {
    // Sin tabla de cobros (centro sin Facturación) no hay dinero que enseñar.
    if (tablaAusente(err) || err?.parent?.code === "42703") return mapa;
    throw err;
  }

  const apunta = (id, fila) => {
    const k = String(id);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(fila);
  };

  for (const f of filas) {
    if (f.packId && porPack.has(String(f.packId))) {
      apunta(porPack.get(String(f.packId)).id, f);
      continue;
    }
    // El cobro de una entrevista: del último expediente parado de ese paciente
    // que ya existía cuando nació el cobro.
    const candidatos = (pararonPorPaciente.get(String(f.patientId)) ?? [])
      .filter((e) => !e.createdAt || !f.createdAt || new Date(e.createdAt) <= new Date(f.createdAt))
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    if (candidatos.length) apunta(candidatos[0].id, f);
  }
  return mapa;
}

/**
 * LAS FILAS de una lista de expedientes, ya en JSON y con su barra, su
 * terapeuta, su paciente y su dinero: tres consultas para toda la lista.
 *
 * `expedientes` son instancias de `Diagnostico` (con los includes `patient` y
 * `therapist` si se cargaron; si no, se cargan aquí de una vez).
 */
export async function filasDe({ tenantModels, expedientes, puedeDecidir = false, catalogo = null, ahora = new Date(), conCitas = false } = {}) {
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

  return lista.map((e) =>
    filaDeExpediente({
      expediente: e,
      citas: citas.get(String(e.id)) ?? [],
      paciente: e.patient ?? pacientes.get(String(e.patientId)) ?? null,
      terapeuta: e.therapist ?? (e.therapistId ? terapeutas.get(String(e.therapistId)) ?? null : null),
      cobros: cobros.get(String(e.id)) ?? [],
      puedeDecidir,
      ahora,
      conCitas,
    })
  );
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

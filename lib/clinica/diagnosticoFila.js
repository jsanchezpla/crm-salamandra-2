/**
 * lib/clinica/diagnosticoFila.js — cómo se DEVUELVE un expediente de
 * diagnóstico: la fila que la API da a la lista, a la ficha y a las cuatro
 * acciones (12/09/2026, apartado Diagnóstico de Clínica).
 *
 * (Fichero nuevo en /lib, regla #2: la misma fila la devuelven el listado, el
 * alta, `GET /[id]`, el PATCH y los cuatro POST —parar, seguir, horas, cerrar—.
 * Montada en cada endpoint, la pantalla acabaría con seis formas del mismo
 * expediente y un botón que sale en la lista y no en la ficha. PURO a
 * propósito: sin ORM, para probarlo sin base de datos y para que el navegador
 * pueda reusar `accionesDe` si algún día decide sus botones sin preguntar.)
 *
 * Lo que decide QUÉ es un diagnóstico —horas, estados, productos— vive en
 * `lib/clinica/diagnostico.js`; aquí solo se junta y se le da forma.
 */

import {
  ESTADOS,
  ESTADOS_ABIERTOS,
  ROTULO_ESTADO,
  estaAbierto,
  puedePasarA,
  horasDe,
  rotuloDeBarra,
  tramosDeBarra,
  TRAMO_ENTREVISTA,
  TRAMO_HORAS,
} from "./diagnostico.js";
import { urlDeAltaDesdeDiagnostico } from "../citas/altaDesdeDiagnostico.js";
import { registrosPorFecha, siguienteTitulo as tituloSiguiente, urlDeNuevoRegistro, urlDeRegistro, tituloPorDefecto } from "./registroDeDiagnostico.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La frase del 403 de parar, seguir y desbloquear: la misma regla que dar un
 * bono (`lib/citas/quienDaBonos.js`), dicha para lo que es.
 */
export const MOTIVO_SIN_PERMISO_DIAGNOSTICO =
  "Solo dirección o quien lleve Facturación puede parar, seguir o desbloquear horas de un diagnóstico";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Euros → céntimos enteros (lo que guarda `session_packs.amount`), o null si no es un importe. */
export function centimosDe(euros) {
  // null/vacío es «nadie ha dicho lo que vale», que no es lo mismo que 0 €
  // (la misma distinción que `lib/billing/bonos.js`: sin precio no nace cobro).
  if (euros === null || euros === undefined || euros === "") return null;
  const n = Number(euros);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Nombre legible de un paciente, un miembro del equipo o una ficha; nunca vacío. */
export function nombreDe(fila) {
  if (!fila) return null;
  const compuesto = `${fila.firstName ?? ""} ${fila.lastName ?? ""}`.trim();
  return compuesto || fila.displayName || fila.name || "(sin nombre)";
}

/**
 * Qué estados pide el filtro de la lista: `en_curso` (por defecto) son los
 * abiertos —entrevista pendiente o en curso—, `cerrado` los que ya no lo
 * están (no continúa y cerrado) y `todos` todo (null = sin filtro).
 */
export function filtroDeEstado(valor) {
  const v = String(valor ?? "").trim().toLowerCase();
  if (v === "todos") return null;
  if (v === "cerrado" || v === "cerrados") return ESTADOS.filter((e) => !ESTADOS_ABIERTOS.includes(e));
  return [...ESTADOS_ABIERTOS];
}

/** Agrupa filas por una clave (id de expediente, de bono…): Map clave → [filas]. */
export function agrupaPor(filas, clave) {
  const mapa = new Map();
  for (const f of Array.isArray(filas) ? filas : []) {
    const k = f?.[clave];
    if (k === null || k === undefined) continue;
    const s = String(k);
    if (!mapa.has(s)) mapa.set(s, []);
    mapa.get(s).push(f);
  }
  return mapa;
}

/**
 * El «Texto en la factura» de un concepto del catálogo: su `description` y,
 * vacía, su nombre — la misma regla que `textosDeFacturaDeConceptos` en
 * `lib/billing/cuotas.js`. Null sin concepto: se factura por la nota.
 */
export function textoEnFacturaDe(concepto) {
  if (!concepto) return null;
  const texto = typeof concepto.description === "string" ? concepto.description.trim() : "";
  return texto || (concepto.name ? String(concepto.name).trim() : null) || null;
}

/**
 * El dinero de un expediente, resumido desde sus cobros (filas de `payments`).
 *
 * Casi siempre es UN cobro —el pendiente que nace al parar o al seguir—, pero
 * puede haber dos: el cajón de Cobros parte la fila cuando pagan una parte.
 * Por eso se suma en vez de coger la primera, y `cobroPendiente` apunta a la
 * primera fila pendiente con el TOTAL que queda por pagar.
 *
 * Devuelto es dinero que entró y salió: ni cobrado ni deuda.
 */
export function dineroDe(cobros) {
  let pendiente = 0;
  let cobrado = 0;
  let devuelto = 0;
  let primerPendiente = null;
  for (const c of Array.isArray(cobros) ? cobros : []) {
    const importe = round2(c?.amount);
    if (c?.refundedAt || c?.status === "refunded") devuelto = round2(devuelto + importe);
    else if (c?.status === "completed") cobrado = round2(cobrado + importe);
    else if (c?.status === "pending") {
      pendiente = round2(pendiente + importe);
      if (!primerPendiente) primerPendiente = c;
    }
  }
  return {
    pendiente,
    cobrado,
    devuelto,
    cobroPendiente: primerPendiente ? { id: primerPendiente.id, importe: pendiente, status: "pending" } : null,
  };
}

/**
 * Qué botones tiene un expediente según su estado y quién mira.
 *
 *   · abrirEntrevista — en `entrevista`: lleva a Citas con la cita preparada
 *   · parar / seguir  — en `entrevista` y solo quien decide (dirección o
 *                       Facturación, `puedeDarBonos`). No se exige que la
 *                       entrevista esté ya dada: la familia puede decidir por
 *                       teléfono antes de que la cita se marque como hecha.
 *   · anadirHoras     — en `en_curso`
 *   · desbloquear     — abierto y quien decide
 *   · cerrar          — desde cualquier estado que pueda pasar a `cerrado`
 */
export function accionesDe({ status, puedeDecidir = false } = {}) {
  const abierto = ESTADOS_ABIERTOS.includes(status);
  return {
    abrirEntrevista: status === "entrevista",
    parar: status === "entrevista" && puedeDecidir === true,
    seguir: status === "entrevista" && puedeDecidir === true,
    anadirHoras: status === "en_curso",
    desbloquear: abierto && puedeDecidir === true,
    cerrar: puedePasarA(status, "cerrado"),
  };
}

/** La cita de la entrevista inicial entre las del expediente: la última que no esté cancelada, o la última. */
export function entrevistaEntre(citas) {
  const lista = (Array.isArray(citas) ? citas : []).filter((c) => c?.diagnosticoTramo === TRAMO_ENTREVISTA);
  if (!lista.length) return null;
  const vivas = lista.filter((c) => c.status !== "cancelled");
  const elegida = (vivas.length ? vivas : lista).at(-1);
  return { id: elegida.id, scheduledAt: elegida.scheduledAt ?? null, status: elegida.status ?? null };
}

/** El cobro de la entrevista, resumido para la fila: `{ id, importe, status }` o null. */
function cobroDeEntrevistaDe(cobro) {
  const c = cobro && typeof cobro.toJSON === "function" ? cobro.toJSON() : cobro;
  if (!c || typeof c !== "object" || !c.id) return null;
  return { id: c.id, importe: round2(c.amount ?? c.importe), status: c.status ?? null };
}

/** Lo que costará «Seguir» en ESTE expediente: `{ importe, descuento, texto }` o null. */
function cobroAlSeguirDe(cobro) {
  if (!cobro || typeof cobro !== "object") return null;
  const importe = cobro.importe ?? cobro.importeEuros;
  return {
    importe: importe === null || importe === undefined ? null : round2(importe),
    descuento: round2(cobro.descuento ?? cobro.descuentoEuros),
    texto: cobro.texto ? String(cobro.texto) : null,
  };
}

/** `sesionesPorCita` puede ser un Map, un objeto plano o nada. */
function sesionDeLaCita(sesionesPorCita, bookingId) {
  if (bookingId === null || bookingId === undefined) return null;
  const k = String(bookingId);
  if (sesionesPorCita instanceof Map) return sesionesPorCita.get(k) ?? sesionesPorCita.get(bookingId) ?? null;
  if (sesionesPorCita && typeof sesionesPorCita === "object") return sesionesPorCita[k] ?? null;
  return null;
}

/** El informe del expediente para la fila: `{ id, status, statusLabel, reportDate, url }` o null. */
function informeDe(informe, informeId) {
  const i = informe && typeof informe.toJSON === "function" ? informe.toJSON() : informe;
  const id = i?.id ?? informeId ?? null;
  if (!id) return null;
  return {
    id,
    status: i?.status ?? null,
    statusLabel: i?.statusLabel ?? null,
    reportDate: i?.reportDate ?? null,
    url: `/clinica/informes/${id}`,
  };
}

/**
 * LA FILA de un expediente, tal como la devuelve la API.
 *
 *   expediente      la fila de `diagnosticos` (instancia o JSON)
 *   citas           sus reservas (con status, scheduledAt, cancelledAt,
 *                   noShowJustified, duration y diagnosticoTramo)
 *   paciente        { id, firstName, lastName } o null (ficha borrada)
 *   terapeuta       { id, displayName } o null
 *   cobros          sus filas de `payments` (las del bono o la de la entrevista)
 *   puedeDecidir    `puedeDarBonos` de quien mira
 *   ahora           para contar las canceladas antiguas, como en los bonos
 *   conCitas        true = la fila lleva también la lista de citas (la ficha)
 *
 * Y desde la segunda entrega (12/09/2026):
 *   cobroAlSeguir   lo que costará «Seguir» en ESTE expediente, ya con la
 *                   entrevista descontada: `{ importe, descuento, texto }`
 *                   (lo calcula `filasDe` con `cobroDelProducto`) o null
 *   cobroEntrevista la fila de `payments` de la entrevista (o null): sale en
 *                   `dinero.entrevista`
 *   registros       sus registros (`clinic_sessions` con `diagnosticoId`),
 *                   crudos o con `terapeuta` ya resuelto
 *   terapeutas      Map id → { id, displayName } para nombrar a quien firma
 *                   cada registro (opcional)
 *   sesionesPorCita Map bookingId → sessionId: qué citas ya tienen registro
 *   informe         `{ id, status, statusLabel, reportDate }` o null
 *   siguienteTitulo el título del próximo registro (si no viene, se calcula)
 */
export function filaDeExpediente({
  expediente,
  citas = [],
  paciente = null,
  terapeuta = null,
  cobros = [],
  puedeDecidir = false,
  ahora = new Date(),
  conCitas = false,
  cobroAlSeguir = null,
  cobroEntrevista = null,
  registros = [],
  terapeutas = null,
  sesionesPorCita = null,
  informe = null,
  siguienteTitulo = null,
} = {}) {
  const e = expediente && typeof expediente.toJSON === "function" ? expediente.toJSON() : expediente ?? {};
  const lista = Array.isArray(citas) ? citas : [];
  const horas = horasDe({ expediente: e, citas: lista, ahora });
  const dinero = dineroDe(cobros);
  const entrevista = entrevistaEntre(lista);
  const patientId = e.patientId ?? null;
  const entrevistaCobro = cobroDeEntrevistaDe(cobroEntrevista);
  const informeFila = informeDe(informe, e.informeId);
  const tituloQueToca = siguienteTitulo || tituloSiguiente(registros);
  // Las URLs de registro exigen paciente y expediente: sin uno de los dos no
  // hay enlace (un expediente sin paciente es una fila rota, no un 500).
  const puedeEnlazar = Boolean(e.id && patientId);
  const nombreDeTerapeuta = (id) => {
    if (!id || !(terapeutas instanceof Map)) return null;
    const t = terapeutas.get(String(id)) ?? terapeutas.get(id);
    return t ? { id: t.id ?? id, nombre: nombreDe(t) } : null;
  };

  const fila = {
    id: e.id,
    status: e.status,
    rotuloEstado: ROTULO_ESTADO[e.status] ?? e.status,
    abierto: estaAbierto(e),
    paciente: paciente ? { id: paciente.id, nombre: nombreDe(paciente) } : patientId ? { id: patientId, nombre: "(paciente borrado)" } : null,
    clientId: e.clientId ?? null,
    producto: { key: e.productoKey, nombre: e.productoNombre || e.productoKey },
    terapeuta: terapeuta ? { id: terapeuta.id, nombre: nombreDe(terapeuta) } : null,
    therapistId: e.therapistId ?? null,
    horas,
    rotuloHoras: rotuloDeBarra(horas),
    tramos: tramosDeBarra(horas),
    horasMax: horas.max,
    horasDesbloqueadasPor: e.horasDesbloqueadasPor ?? null,
    horasDesbloqueadasAt: e.horasDesbloqueadasAt ?? null,
    eventTypeId: e.eventTypeId ?? null,
    conceptId: e.conceptId ?? null,
    packId: e.packId ?? null,
    // La cita de la entrevista: la columna si Citas la escribió, o la que se
    // deduce de las propias citas del expediente (la verdad son las citas).
    entrevistaBookingId: e.entrevistaBookingId ?? entrevista?.id ?? null,
    entrevista,
    // El cobro de la entrevista: la columna si la escribió `parar` o el alta
    // que adopta, o la fila que encontró `cobrosDeExpedientes` por nota+fecha.
    entrevistaPaymentId: e.entrevistaPaymentId ?? entrevistaCobro?.id ?? null,
    informeId: informeFila?.id ?? null,
    informe: informeFila,
    cobroPendiente: dinero.cobroPendiente,
    dinero: { pendiente: dinero.pendiente, cobrado: dinero.cobrado, devuelto: dinero.devuelto, entrevista: entrevistaCobro },
    cobroAlSeguir: cobroAlSeguirDe(cobroAlSeguir),
    notes: e.notes ?? null,
    createdById: e.createdById ?? null,
    createdAt: e.createdAt ?? null,
    updatedAt: e.updatedAt ?? null,
    // Los registros de diagnóstico, por fecha, cada uno con su enlace.
    registros: registrosPorFecha(registros).map((r) => ({
      ...r,
      terapeuta: r.terapeuta ?? nombreDeTerapeuta(r.therapistId),
      url: puedeEnlazar && r.id ? urlDeRegistro({ patientId, sessionId: r.id }) : null,
    })),
    siguienteTitulo: tituloQueToca,
    urls: {
      expediente: e.id ? `/clinica/diagnosticos/${e.id}` : null,
      entrevista: e.id ? urlDeAltaDesdeDiagnostico({ diagnosticoId: e.id, tramo: TRAMO_ENTREVISTA, patientId }) : null,
      horas: e.id ? urlDeAltaDesdeDiagnostico({ diagnosticoId: e.id, tramo: TRAMO_HORAS, patientId }) : null,
      // El informe nace desde el expediente (segunda entrega): el enlace solo
      // existe cuando el informe existe. Antes llevaba a la ficha con
      // `?informe=diagnostico`; ya no.
      informe: informeFila?.url ?? null,
      // «Nuevo registro» sin cita: tramo horas, firmado por el asignado, con
      // el título que toca.
      nuevoRegistro: puedeEnlazar
        ? urlDeNuevoRegistro({ patientId, diagnosticoId: e.id, tramo: TRAMO_HORAS, therapistId: e.therapistId ?? null, titulo: tituloQueToca, ahora })
        : null,
    },
    permisos: { puedeDecidir: puedeDecidir === true },
    acciones: accionesDe({ status: e.status, puedeDecidir }),
  };

  if (conCitas) {
    fila.citas = lista.map((c) => {
      const sessionId = sesionDeLaCita(sesionesPorCita, c.id);
      const tramo = c.diagnosticoTramo ?? null;
      // «Seguir registro» si la cita ya tiene uno; si no, «Escribir registro»
      // con la cita, su fecha, su profesional (o el asignado) y la plantilla
      // que le toca por tramo.
      let registro = null;
      if (puedeEnlazar && sessionId) registro = urlDeRegistro({ patientId, sessionId });
      else if (puedeEnlazar && c.id) {
        const esEntrevista = tramo === TRAMO_ENTREVISTA;
        registro = urlDeNuevoRegistro({
          patientId,
          diagnosticoId: e.id,
          tramo: esEntrevista ? TRAMO_ENTREVISTA : TRAMO_HORAS,
          bookingId: c.id,
          therapistId: c.teamMemberId ?? e.therapistId ?? null,
          scheduledAt: c.scheduledAt ?? null,
          titulo: esEntrevista ? tituloPorDefecto({ tramo: TRAMO_ENTREVISTA }) : tituloQueToca,
          ahora,
        });
      }
      return {
        id: c.id,
        scheduledAt: c.scheduledAt ?? null,
        duration: c.duration ?? null,
        status: c.status ?? null,
        tramo,
        teamMemberId: c.teamMemberId ?? null,
        packId: c.packId ?? null,
        sessionNumber: c.sessionNumber ?? null,
        sessionId: sessionId ?? null,
        urls: { registro },
      };
    });
  }

  return fila;
}

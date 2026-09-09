/**
 * lib/billing/tiposDeCuota.js — el catálogo visto DESDE LOS PACIENTES
 * (09/09/2026, petición de Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos de
 * la pantalla de tipos de cuota —cuántos pacientes lleva cada tipo, cuánto
 * suma al mes y qué pasa al quitarle un paciente—, compartida por la API y la
 * pantalla, y fijada por `scripts/_smoke-tipos-de-cuota.mjs`.)
 *
 * ── QUÉ ES UN «TIPO DE CUOTA» ──────────────────────────────────────────────
 * Un concepto del catálogo (`BillingConcept`): «Cuota Logopedia 60x2», pero
 * también la entrevista inicial, un bono o un informe («también se incluyen:
 * E.I., bonos, informes etc.»). El catálogo dice el precio de la casa; la
 * asignación (`Cuota`) dice quién lo paga. Hasta hoy solo se podía mirar por
 * asignación —278 filas seguidas— y la pregunta del centro es la contraria:
 * «¿quién lleva ESTA cuota?».
 *
 * ── POR QUÉ «AL MES» NO SUMA TODAS LAS CUOTAS ──────────────────────────────
 * Una cuota puede llevar varios conceptos a la vez (logopedia + psicología, o
 * la cuota menos el descuento de la reserva). El importe de esa fila no es de
 * este tipo: es de los dos. Así que se suma solo lo de las cuotas cuyo ÚNICO
 * concepto es este —que es un número exacto— y las demás se cuentan aparte,
 * dichas por su nombre («3 lo llevan dentro de una cuota con más conceptos»).
 * Repartir el importe pactado entre conceptos sería inventarse un reparto que
 * nadie ha hecho, el mismo error que evita `lib/billing/cuotaPacientes.js`.
 */

import { cuotaDeBaja, importeDeCuota } from "./cuotas.js";
import { pacientesDeCuota } from "./cuotaPacientes.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Los ids de concepto de una cuota, como texto y sin repetir. */
export function conceptosDeCuota(cuota) {
  const ids = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  return [...new Set(ids.map(String))];
}

/** ¿Lleva esta cuota ese tipo? */
export function cuotaLlevaTipo(cuota, tipoId) {
  return conceptosDeCuota(cuota).includes(String(tipoId));
}

/**
 * A cuántos pacientes cubre un grupo de cuotas, sin contar a nadie dos veces.
 *
 * Con paciente asignado cuenta ese; sin él, los de su familia (la regla de
 * `cuotaPacientes.js`: la cuota de los Castro cubre a Hugo porque Hugo es de
 * los Castro). Un tenant sin módulo asistencial no tiene pacientes: entonces
 * lo que se cuenta son las familias, que es de quien se está hablando.
 */
export function contarPacientes(cuotas = []) {
  const pacientes = new Set();
  const familias = new Set();
  let sinPacientes = 0;
  for (const c of cuotas) {
    if (c?.clientId) familias.add(String(c.clientId));
    if (c?.patientId) { pacientes.add(String(c.patientId)); continue; }
    const suyos = Array.isArray(c?.familiaPacientes) ? c.familiaPacientes : [];
    if (!suyos.length) { sinPacientes += 1; continue; }
    for (const p of suyos) if (p?.id) pacientes.add(String(p.id));
  }
  return { pacientes: pacientes.size, familias: familias.size, cuotasSinPaciente: sinPacientes };
}

/**
 * El catálogo con lo que lleva cada tipo: cuotas vivas, de baja, pacientes e
 * importe al mes.
 *
 * `soloSuyas` son las cuotas cuyo único concepto es este (las que suman en
 * `alMes`); `compartidas`, las que lo llevan con otros conceptos.
 */
export function resumenPorTipo({ conceptos = [], cuotas = [], hoy = null } = {}) {
  const porId = new Map(conceptos.map((c) => [String(c.id), c]));
  const vacio = () => ({ vivas: [], bajas: [], soloSuyas: 0, compartidas: 0, alMes: 0 });
  const cubos = new Map(conceptos.map((c) => [String(c.id), vacio()]));

  // Las cuotas sin ningún concepto (importe pactado suelto) no son de ningún
  // tipo: se cuentan aparte en vez de repartirlas por ahí.
  const sinTipo = vacio();

  for (const cuota of cuotas) {
    const ids = conceptosDeCuota(cuota);
    const deBaja = cuotaDeBaja(cuota, hoy);
    if (!ids.length) {
      (deBaja ? sinTipo.bajas : sinTipo.vivas).push(cuota);
      continue;
    }
    for (const id of ids) {
      if (!cubos.has(id)) cubos.set(id, vacio()); // concepto borrado del catálogo
      const cubo = cubos.get(id);
      (deBaja ? cubo.bajas : cubo.vivas).push(cuota);
      if (deBaja) continue;
      if (ids.length === 1) {
        cubo.soloSuyas += 1;
        cubo.alMes = round2(cubo.alMes + importeDeCuota(cuota, porId).importe);
      } else {
        cubo.compartidas += 1;
      }
    }
  }

  const tipos = [...cubos.entries()].map(([id, cubo]) => {
    const c = porId.get(id) ?? null;
    return {
      id,
      name: c?.name ?? "(cuota borrada del catálogo)",
      description: c?.description ?? null,
      unitPrice: c ? Number(c.unitPrice) || 0 : null,
      vatRate: c ? Number(c.vatRate) || 0 : null,
      category: c?.category ?? null,
      periodicity: c?.periodicity ?? null,
      active: c ? c.active !== false : false,
      enElCatalogo: Boolean(c),
      cuotas: cubo.vivas.length,
      bajas: cubo.bajas.length,
      soloSuyas: cubo.soloSuyas,
      compartidas: cubo.compartidas,
      alMes: cubo.alMes,
      ...contarPacientes(cubo.vivas),
    };
  });

  return {
    tipos,
    sinTipo: { cuotas: sinTipo.vivas.length, bajas: sinTipo.bajas.length, ...contarPacientes(sinTipo.vivas) },
  };
}

/**
 * QUÉ HAY QUE HACER PARA QUITARLE ESTE TIPO A UNA CUOTA.
 *
 * Con más conceptos detrás, quitar el tipo NO es dar de baja a la familia: se
 * le quita esa terapia y sigue pagando el resto. Cuando es lo único que paga,
 * la respuesta correcta es la baja —conserva por qué se cobró lo que se cobró—
 * y nunca el borrado, que se hace desde Cuotas y con su aviso.
 *
 * @returns { accion: 'quitar-concepto', conceptIds } | { accion: 'dar-de-baja' }
 *          | { accion: 'nada', motivo }
 */
export function comoQuitarElTipo(cuota, tipoId) {
  const ids = conceptosDeCuota(cuota);
  const id = String(tipoId);
  if (!ids.includes(id)) return { accion: "nada", motivo: "esta cuota no lleva esa cuota" };
  const restantes = ids.filter((x) => x !== id);
  if (restantes.length) return { accion: "quitar-concepto", conceptIds: restantes };
  return { accion: "dar-de-baja" };
}

/**
 * Una fila de la ficha del tipo: quién paga, por quién, cuánto y desde cuándo.
 * Es lo que pintan las pestañas «Pacientes» y «Ficha», y lo que ordena la
 * rejilla de meses, para que las tres hablen de las mismas filas.
 */
export function filaDeCuota(cuota, { conceptosPorId = new Map(), hoy = null } = {}) {
  const { nombres, deLaFamilia } = pacientesDeCuota(cuota);
  const ids = conceptosDeCuota(cuota);
  const { importe, fuente, conceptosPerdidos } = importeDeCuota(cuota, conceptosPorId);
  return {
    cuotaId: String(cuota?.id ?? ""),
    clientId: cuota?.clientId ?? null,
    patientId: cuota?.patientId ?? null,
    paciente: nombres.join(", ") || null,
    pacienteEsDeLaFamilia: deLaFamilia,
    familia: cuota?.client?.fiscalName || cuota?.client?.name || null,
    pagador: cuota?.payer ? cuota.payer.fiscalName || cuota.payer.name : null,
    conceptos: ids.map((id) => ({
      id,
      name: conceptosPorId.get(id)?.name ?? "(cuota borrada del catálogo)",
      unitPrice: conceptosPorId.get(id) ? Number(conceptosPorId.get(id).unitPrice) || 0 : null,
      // El «Texto en la factura» del catálogo: lo que ve la familia impreso.
      textoFactura: conceptosPorId.get(id)?.description || conceptosPorId.get(id)?.name || null,
    })),
    importe,
    importePactado: cuota?.amount === null || cuota?.amount === undefined || cuota?.amount === "" ? null : round2(cuota.amount),
    importeDe: fuente,
    conceptosPerdidos,
    method: cuota?.method ?? null,
    dayOfMonth: cuota?.dayOfMonth ?? null,
    startDate: cuota?.startDate ?? null,
    endDate: cuota?.endDate ?? null,
    deBaja: cuotaDeBaja(cuota, hoy),
    notes: cuota?.notes ?? null,
  };
}

/** Las filas ordenadas como se leen: primero las vivas, y por paciente. */
export function ordenarFilas(filas = []) {
  return [...filas].sort((a, b) => {
    if (a.deBaja !== b.deBaja) return a.deBaja ? 1 : -1;
    const na = (a.paciente || a.familia || "").toLowerCase();
    const nb = (b.paciente || b.familia || "").toLowerCase();
    return na.localeCompare(nb, "es");
  });
}

/**
 * lib/billing/bajaDePaciente.js — dar de baja a UN paciente de una cuota que es
 * de la familia entera (15/09/2026, AV-0145 de Aumenta).
 *
 * ── EL FALLO ────────────────────────────────────────────────────────────────
 * Isabel: Williana (la madre) venía a psicología hasta junio y Fabián (el hijo)
 * sigue viniendo con otra psicóloga. Su cuota salía como UNA fila «Fabián,
 * Williana (toda la familia)» con las dos terapias, y el único botón era «Dar
 * de baja», que apaga la fila entera: para quitar a la madre había que dar de
 * baja también al hijo y volver a apuntarle a mano. De las cuotas activas de
 * Aumenta, 33 son de una familia con más de un paciente.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * Dar de baja a un paciente de la cuota familiar es PARTIRLA:
 *
 *   · La cuota de siempre se queda con lo que no era suyo (las líneas de
 *     concepto que siguen) y, si se sabe, con el paciente que sigue viniendo:
 *     deja de decir «toda la familia» y el prorrateo cuenta SUS citas.
 *   · Lo que era suyo sale a una cuota nueva a su nombre, con la fecha de baja,
 *     SOLO si aún queda algo por cobrarle: desde el mes en curso (lo pasado ya
 *     se cobró dentro de la cuota familiar, y rehacerlo sería inventar deuda) y
 *     sin repetir un mes que la familia ya ha pagado entero.
 *
 * Así una baja de junio no deja rastro nuevo —solo quita la línea—, y una baja
 * a mitad de este mes cobra a quien se va su parte prorrateada, como cualquier
 * otra baja.
 *
 * ── POR QUÉ LÍNEAS Y NO CONCEPTOS ───────────────────────────────────────────
 * Dos hermanos con la misma terapia llevan el mismo concepto DOS veces
 * (`[X, X]`, 3 cuotas así en Aumenta): quitar «el concepto» le quitaría la
 * terapia a los dos. Por eso se eligen posiciones y la lista que queda NO se
 * pasa por el quitarrepetidos de `limpiarCuota`.
 *
 * Es puro y se prueba sin base de datos (`scripts/_smoke-baja-de-paciente.mjs`).
 */

import { mesVigente, hoyVigente } from "./cuotas.js";

/** 'AAAA-MM-DD' válido o null (acepta también dd/mm/aaaa). */
function soloFecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** 'AAAA-MM' → 'AAAA-MM' del mes siguiente. */
function mesSiguiente(mes) {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * ¿Se le puede ofrecer esta baja? Solo a una cuota SIN paciente, de una familia
 * con más de uno, y con más de una línea (con una sola, lo que se va es todo y
 * es la baja de siempre).
 */
export function admiteBajaDePaciente(cuota) {
  const familia = Array.isArray(cuota?.familiaPacientes) ? cuota.familiaPacientes : [];
  const lineas = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  return !cuota?.patientId && familia.length > 1 && lineas.length > 1;
}

/**
 * planBajaDePaciente(cuota, peticion, { hoy, mesPagado }) → { problema } | plan
 *
 * `peticion`: { patientId, quitar: [posiciones], quedaPatientId|null, fecha
 * 'AAAA-MM-DD', importeQueda (solo con importe pactado) }.
 * `familia`: ids de los pacientes de la familia (lo resuelve la ruta).
 * `mesesPagados`: 'AAAA-MM' en los que la cuota ya tiene un cobro completado.
 *
 * El plan: { restante: cambios para la cuota de siempre, separada: fila nueva o
 * null, quitadas: conceptIds que salen }.
 */
export function planBajaDePaciente(cuota, peticion = {}, { familia = [], mesesPagados = [], hoy = null } = {}) {
  if (!cuota) return { problema: "Cuota no encontrada" };
  if (cuota.patientId) return { problema: "Esta cuota ya es de un solo paciente: dale de baja con «Dar de baja»" };

  const deLaFamilia = new Set(familia.map(String));
  const quien = String(peticion.patientId ?? "");
  if (!quien || !deLaFamilia.has(quien)) return { problema: "Elige qué paciente de la familia se da de baja" };

  const queda = peticion.quedaPatientId ? String(peticion.quedaPatientId) : null;
  if (queda && (!deLaFamilia.has(queda) || queda === quien)) {
    return { problema: "El paciente que sigue tiene que ser otro de la misma familia" };
  }

  const fecha = soloFecha(peticion.fecha);
  if (!fecha) return { problema: "La fecha de baja tiene que ser dd/mm/aaaa" };

  const lineas = (Array.isArray(cuota.conceptIds) ? cuota.conceptIds : []).map(String);
  const posiciones = [...new Set((Array.isArray(peticion.quitar) ? peticion.quitar : []).map(Number))]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < lineas.length);
  if (!posiciones.length) return { problema: "Marca qué terapia era la suya" };
  const restantes = lineas.filter((_, i) => !posiciones.includes(i));
  if (!restantes.length) {
    return { problema: "Si se quitan todas las terapias no queda nadie: usa «Toda la familia»" };
  }
  const quitadas = lineas.filter((_, i) => posiciones.includes(i));

  // Con importe pactado no se puede saber cuánto era de cada uno: se pregunta.
  const pactado = cuota.amount !== null && cuota.amount !== undefined && cuota.amount !== "" && Number.isFinite(Number(cuota.amount));
  let importeQueda = null;
  let importeSale = null;
  if (pactado) {
    const n = Number(String(peticion.importeQueda ?? "").replace(",", "."));
    if (peticion.importeQueda === null || peticion.importeQueda === undefined || peticion.importeQueda === "" || !Number.isFinite(n) || n < 0 || n > Number(cuota.amount)) {
      return { problema: `Esta cuota tiene un importe pactado (${round2(cuota.amount)} €): di cuánto paga lo que queda` };
    }
    importeQueda = round2(n);
    importeSale = round2(Number(cuota.amount) - n);
  }

  const restante = { conceptIds: restantes, patientId: queda };
  if (pactado) restante.amount = importeQueda;

  // ¿Queda algo por cobrarle a quien se va? Desde el mes en curso, o desde que
  // empezó la cuota si es posterior, y saltando los meses ya pagados.
  const dia = soloFecha(hoy) || hoyVigente();
  let mes = dia.slice(0, 7) || mesVigente();
  const alta = soloFecha(cuota.startDate);
  if (alta && alta.slice(0, 7) > mes) mes = alta.slice(0, 7);
  const pagados = new Set(mesesPagados.map((m) => String(m).slice(0, 7)));
  while (pagados.has(mes) && mes <= fecha.slice(0, 7)) mes = mesSiguiente(mes);
  let desde = `${mes}-01`;
  if (alta && alta > desde) desde = alta;

  let separada = null;
  if (desde <= fecha && (!pactado || importeSale > 0)) {
    separada = {
      clientId: cuota.clientId,
      patientId: quien,
      payerClientId: cuota.payerClientId ?? null,
      conceptIds: quitadas,
      amount: pactado ? importeSale : null,
      method: cuota.method ?? null,
      dayOfMonth: cuota.dayOfMonth ?? null,
      startDate: desde,
      endDate: fecha,
      // Misma vara que `cuadrarBajaYActiva`: una baja que ya llegó apaga; una
      // futura deja la cuota viva hasta ese día.
      active: fecha > dia,
    };
  }

  return { restante, separada, quitadas };
}

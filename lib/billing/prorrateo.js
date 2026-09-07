/**
 * prorrateo — la parte proporcional de una cuota cuando la familia empieza a
 * mitad de mes (31/08/2026).
 *
 * La regla de tres de toda la vida, escrita UNA vez: desde el día de inicio
 * (incluido) hasta fin de ese mes, sobre los días reales del mes. Devuelve el
 * desglose entero para que la pantalla pueda ENSEÑAR la cuenta («16 de 30
 * días»), que es lo que evita la llamada de la familia preguntando por el
 * importe raro.
 *
 *   prorrateoDeCuota(190, "2026-09-15") → { importe: 101.33, diasCobrados: 16, diasDelMes: 30, factor: … }
 *
 * Una fecha ilegible devuelve null: el que llama decide qué hacer (la
 * pantalla, no aplicar nada). El importe puede ser negativo (un descuento
 * también se prorratea).
 */
import { tramoDelMes, rotuloDeTramo } from "./cuotas.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * rotuloDeProrrateo("2026-09-13") → "desde el 13/09/2026 (18/30 días)".
 * Es la frase que queda ESCRITA (en la línea de la factura, en la nota del
 * cobro) para que la familia entienda el importe raro. Fecha ilegible → null.
 */
export function rotuloDeProrrateo(fechaInicio) {
  const p = prorrateoDeCuota(0, fechaInicio);
  if (!p) return null;
  const [a, m, d] = fechaInicio.split("-");
  return `desde el ${d}/${m}/${a} (${p.diasCobrados}/${p.diasDelMes} días)`;
}

/**
 * partesConProrrateo([{importe, inicio}], { mes, citas }) — varios servicios,
 * cada uno con SU fecha de inicio (13/09 logopedia, 17/09 psicología…).
 * `inicio` vacío o ilegible = mes entero. Devuelve cada parte con su importe
 * ya prorrateado y su rótulo, más el total y el total sin prorratear.
 *
 * ── POR SESIONES CUANDO SE SABE (07/09/2026, AV-0068 de Aumenta) ────────────
 *
 * Rosa: «lo quiero dejar hecho puesto que el sistema está calculando las
 * cuotas por días no por sesiones». Tenía razón a medias, y eso es lo que la
 * hacía dudar: desde el 07/09 la generación mensual prorratea por SESIONES
 * (AV-0062), pero este cajón —el que usa ella para dejar hecha la cuota de un
 * paciente que empieza tarde— seguía con la regla de tres por días. La misma
 * cuota daba dos importes según quién la calculara.
 *
 * Con `mes` y las citas del mes delante se usa la MISMA pareja que la
 * generación (`tramoDelMes` + `rotuloDeTramo`), no una copia parecida: el día
 * que cambie la regla, cambia en los dos sitios a la vez. Sin citas —no hay
 * módulo de citas, la familia no tiene ninguna ese mes, o quien llama no las
 * pasa— se cae a los días de siempre, que es lo que había.
 */
export function partesConProrrateo(partidas, { mes = null, citas = null } = {}) {
  const porSesiones = Boolean(mes) && Array.isArray(citas) && citas.length > 0;
  const partes = (partidas ?? []).map(({ importe, inicio }) => {
    if (inicio && porSesiones) {
      const tramo = tramoDelMes(mes, { startDate: inicio }, { citas });
      if (tramo) {
        return {
          importeCompleto: round2(importe),
          importe: tramo.completo ? round2(importe) : round2(Number(importe) * tramo.factor),
          prorrateo: tramo.completo ? null : tramo,
          rotulo: rotuloDeTramo(tramo),
        };
      }
    }
    const p = inicio ? prorrateoDeCuota(importe, inicio) : null;
    return {
      importeCompleto: round2(importe),
      importe: p ? p.importe : round2(importe),
      prorrateo: p,
      rotulo: p ? rotuloDeProrrateo(inicio) : null,
    };
  });
  return {
    total: round2(partes.reduce((s, x) => s + x.importe, 0)),
    totalCompleto: round2(partes.reduce((s, x) => s + x.importeCompleto, 0)),
    hayProrrateo: partes.some((x) => x.prorrateo),
    partes,
  };
}

export function prorrateoDeCuota(importe, fechaInicio) {
  if (typeof fechaInicio !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) return null;
  const [a, m, d] = fechaInicio.split("-").map(Number);
  const diasDelMes = new Date(a, m, 0).getDate(); // día 0 del mes siguiente
  if (!Number.isFinite(diasDelMes) || d < 1 || d > diasDelMes || m < 1 || m > 12) return null;
  const diasCobrados = diasDelMes - d + 1;
  const factor = diasCobrados / diasDelMes;
  return {
    importe: round2(Number(importe) * factor),
    diasCobrados,
    diasDelMes,
    factor,
  };
}

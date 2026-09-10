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
import { tramoDelMes, rotuloDeTramo, citasDelConcepto, mesValido } from "./cuotas.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const esFecha = (v) => typeof v === "string" && FECHA_RE.test(v);

/**
 * De qué MES es este tramo: el que diga quien llama y, si no lo dice, el de
 * las fechas que trae la partida. Sin ninguno de los dos no hay nada que
 * prorratear.
 */
function mesDelTramo(mes, inicio, fin) {
  if (mesValido(mes)) return String(mes);
  if (esFecha(inicio)) return inicio.slice(0, 7);
  if (esFecha(fin)) return fin.slice(0, 7);
  return null;
}

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
 * partesConProrrateo([{importe, inicio, fin}], { mes, citas }) — varios
 * servicios, cada uno con SU tramo del mes (13/09 logopedia, 17/09
 * psicología…). `inicio` y `fin` vacíos o ilegibles = mes entero. Devuelve cada
 * parte con su importe ya prorrateado y su rótulo, más el total y el total sin
 * prorratear.
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
 *
 * ── Y TAMBIÉN «ACABÓ EL» (10/09/2026, Rodrigo) ────────────────────────────
 *
 * «Aparte de Empezó el… también tiene que haber Acabó el…, para los pacientes
 * que fallan a final de mes pero han empezado bien.» Es el mismo tramo por el
 * otro extremo, y `tramoDelMes` ya lo sabía hacer —la generación mensual
 * prorratea así el mes de la BAJA desde el 01/09—: lo que faltaba era que este
 * cajón se lo pasara. Cada partida acepta ahora `fin` además de `inicio`, y
 * las dos fechas juntas cobran el trozo de en medio («del 03/09 al 18/09»).
 *
 * Por eso desde hoy el tramo se calcula SIEMPRE con `tramoDelMes` —haya citas
 * o no—: la regla de tres por días de `prorrateoDeCuota` solo mira el alta, y
 * mantener dos caminos para lo mismo era garantizar que se separaran otra vez.
 * Sin mes, se saca del propio `inicio`, así que quien ya llamaba sin decirlo
 * sigue obteniendo lo mismo.
 *
 * ── Y CADA LÍNEA CON SUS SESIONES (08/09/2026, vuelta de Rosa) ─────────────
 *
 * Cada partida puede decir de qué `conceptId` es, y entonces cuenta solo las
 * citas de ESA terapia: una cuota de pedagogía (3 martes) + psicología (1
 * martes) cobraba las dos por lo mismo, y son 3 de 5 y 1 de 5. Sin
 * `conceptId` —o con citas que no lo traen— se cuentan todas, que es lo que
 * había.
 */
export function partesConProrrateo(partidas, { mes = null, citas = null } = {}) {
  const porSesiones = Boolean(mes) && Array.isArray(citas) && citas.length > 0;
  const partes = (partidas ?? []).map(({ importe, inicio, fin = null, conceptId = null }) => {
    const elMes = mesDelTramo(mes, inicio, fin);
    if (elMes && (esFecha(inicio) || esFecha(fin))) {
      const tramo = tramoDelMes(
        elMes,
        { startDate: esFecha(inicio) ? inicio : null, endDate: esFecha(fin) ? fin : null },
        { citas: porSesiones ? citasDelConcepto(citas, conceptId) : null }
      );
      if (tramo) {
        return {
          importeCompleto: round2(importe),
          importe: tramo.completo ? round2(importe) : round2(Number(importe) * tramo.factor),
          prorrateo: tramo.completo ? null : tramo,
          rotulo: rotuloDeTramo(tramo),
        };
      }
    }
    // Sin tramo que calcular (fecha ilegible, o de un mes que no es este) queda
    // la regla de tres por días de siempre, que solo mira el alta.
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

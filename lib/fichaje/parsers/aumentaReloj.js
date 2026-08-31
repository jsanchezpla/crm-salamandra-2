/**
 * lib/fichaje/parsers/aumentaReloj.js — el volcado MENSUAL del reloj de fichar
 * de Aumenta («Julio 2026.xls»).
 *
 * Desde julio de 2026 Aumenta ya no rellena la hoja semanal a mano: sube tal
 * cual el fichero que exporta la máquina de fichar. Es un `.xls` con CINCO
 * hojas, y de las cinco SOLO UNA dice la verdad:
 *
 *   «Registro asistencia»  ← LOS MARCAJES EN CRUDO. Un bloque por persona
 *                            (fila de días 1..31, fila «ID :» + «Nombre :», y
 *                            debajo la fila de marcajes: cada celda es un día y
 *                            dentro van las horas fichadas separadas por saltos
 *                            de línea, «08:46\n14:05\n»). Esta es la que se lee.
 *
 *   «Resum. de asis.»      ← totales que calcula el reloj. No se leen.
 *   «Anormal»              ← interpretación del reloj contra su cuadro de
 *                            turnos, y se equivoca: en el fichero real de julio
 *                            a Estefanía el día 3 le consta «salida: Falta»
 *                            cuando los marcajes en crudo dicen 09:00 y 14:20.
 *   «Detalle de formulario»← lo mismo en formato calendario. Tampoco.
 *   «Tabla de información» ← el cuadro de turnos (1-10 turno, 25 licencia,
 *                            26 viaje). En julio todo es turno normal; el día
 *                            que traiga licencias se verá si merece leerse.
 *
 * La regla es la de siempre en este módulo: LOS MINUTOS SE RECALCULAN DE LOS
 * MARCAJES y las columnas calculadas de la máquina no pagan nóminas.
 *
 * ── CÓMO SE CASAN LOS MARCAJES ──────────────────────────────────────────────
 * Se emparejan EN ORDEN: 1º-2º un tramo, 3º-4º otro (así se guardan mañana y
 * tarde como dos tramos, igual que el «M-1 / M-2» del formato antiguo).
 *
 * Un marcaje SUELTO —el día de un solo fichaje, o el tercero sin cuarto— es
 * casi siempre alguien que olvidó fichar la salida. No se adivina cuántas horas
 * son: la jornada ENTRA con 0 minutos, la hora suelta como entrada y una nota,
 * y la pantalla del mes la pinta en rojo («Entrada sin salida») para
 * corregirla ahí con motivo. Bloquearla en el preview la escondería justo del
 * sitio donde se repasa el mes; inventarle horas sería peor.
 *
 * ── EL MES SE COMPRUEBA CONTRA EL FICHERO ───────────────────────────────────
 * A diferencia de la hoja semanal («02-6» no dice el mes por ningún lado), el
 * reloj SÍ escribe su rango: «07/01/2026 ~ 07/31/2026», EN FORMATO AMERICANO
 * (mes/día/año: el 07/31 lo delata). Si no coincide con el periodo elegido al
 * importar, no se lee nada: subir julio encima de agosto es exactamente el
 * accidente que este módulo existe para impedir.
 *
 * Contrato de todo lector: no lanza nunca, devuelve lo que entendió y lo que
 * no, y jamás adivina de quién es una fila.
 */

import {
  parseHoraDelDia,
  valorDeCelda,
  minutosEntre,
  formatearHora,
  formatearMinutos,
} from "../parseHora.js";

export const meta = {
  key: "aumenta_reloj",
  nombre: "Aumenta — volcado del reloj de fichar (.xls)",
  descripcion:
    "El fichero mensual que exporta la máquina de fichar. Se lee la hoja «Registro asistencia» (los marcajes en crudo por persona y día); las demás hojas son cálculos del reloj y se ignoran a propósito.",
};

/** Texto limpio de una celda, o "" si no hay nada. */
function texto(celda) {
  const v = valorDeCelda(celda);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return "";
  return String(v).trim();
}

function normalizar(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** La hoja de los marcajes, o null. Por nombre y sin fiarse de acentos. */
export function hojaDeMarcajes(workbook) {
  return (
    workbook.worksheets.find((ws) => {
      const n = normalizar(ws.name);
      return n.includes("registro") && n.includes("asistencia");
    }) || null
  );
}

/**
 * El rango que el reloj escribe en la cabecera: «07/01/2026 ~ 07/31/2026».
 * Formato AMERICANO mes/día/año. Devuelve {month, year} o null.
 */
function rangoDelFichero(ws) {
  for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 10; c++) {
      const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*~/.exec(texto(row.getCell(c)));
      if (m) return { month: Number(m[1]), year: Number(m[3]) };
    }
  }
  return null;
}

/** ¿Es la fila de números de día (1, 2, 3… en columnas)? Si sí, columna→día. */
function mapaDeDias(row, columnCount) {
  const uno = valorDeCelda(row.getCell(1));
  const dos = valorDeCelda(row.getCell(2));
  if (Number(uno) !== 1 || Number(dos) !== 2) return null;
  const mapa = new Map();
  for (let c = 1; c <= columnCount; c++) {
    const v = Number(valorDeCelda(row.getCell(c)));
    if (Number.isInteger(v) && v >= 1 && v <= 31) mapa.set(c, v);
  }
  return mapa.size >= 20 ? mapa : null;
}

/** De la fila «ID : … Nombre : …», el nombre (la celda no vacía tras el rótulo). */
function nombreDelBloque(row, columnCount) {
  for (let c = 1; c <= columnCount; c++) {
    if (/^nombre\b/i.test(texto(row.getCell(c)))) {
      for (let c2 = c + 1; c2 <= Math.min(c + 5, columnCount); c2++) {
        const t = texto(row.getCell(c2));
        if (t && !/^dept\b/i.test(t)) return t;
      }
      return "";
    }
  }
  return "";
}

function fechaISO(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const RECORTE = 40;
function recortar(s) {
  return s.length > RECORTE ? `${s.slice(0, RECORTE)}…` : s;
}

/**
 * @param {import('exceljs').Workbook} workbook
 * @param {{periodo: string}} opts periodo 'YYYY-MM' — lo elige quien importa
 */
export async function parse(workbook, { periodo }) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodo || ""));
  if (!m) {
    return {
      filas: [],
      anotaciones: [],
      avisos: [{ nivel: "error", texto: "Periodo inválido (se espera YYYY-MM)" }],
      nombres: [],
    };
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const diasDelMes = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const filas = [];
  const avisos = [];
  // Solo va a `nombres` quien aporta al menos una fila: obligar a mapear a
  // alguien que este mes no tiene NI UN marcaje (en julio, tres personas)
  // bloquearía el volcado entero sin proteger ninguna hora.
  const nombres = new Set();

  const ws = hojaDeMarcajes(workbook);
  if (!ws) {
    avisos.push({
      nivel: "error",
      texto: `No se encuentra la hoja «Registro asistencia» del reloj (el fichero trae: ${workbook.worksheets.map((w) => `«${w.name}»`).join(", ") || "ninguna hoja"}). No se ha leído nada.`,
    });
    return { filas, anotaciones: [], avisos, nombres: [] };
  }

  const rango = rangoDelFichero(ws);
  if (rango && (rango.year !== year || rango.month !== month)) {
    avisos.push({
      nivel: "error",
      texto: `El fichero dice ser de ${String(rango.month).padStart(2, "0")}/${rango.year} y estás importando ${periodo}. No se ha leído nada: elige el mes del fichero o sube el fichero del mes.`,
    });
    return { filas, anotaciones: [], avisos, nombres: [] };
  }
  if (!rango) {
    avisos.push({
      nivel: "aviso",
      texto: "El fichero no trae su rango de fechas en la cabecera: se ha leído confiando en el mes elegido. Revisa que sea el fichero correcto.",
    });
  }

  const columnCount = Math.max(ws.columnCount || 0, 31);
  let dias = null; // columna → día del mes, de la última fila de días vista
  let marcajesSueltos = 0;

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);

    const mapa = mapaDeDias(row, columnCount);
    if (mapa) {
      dias = mapa;
      continue;
    }

    if (!/^id\b/i.test(texto(row.getCell(1)))) continue;

    // Fila «ID : n … Nombre : fulana». La de DEBAJO son sus marcajes — salvo
    // que el bloque venga vacío (huecos sin persona del reloj) o que la
    // siguiente ya sea otra fila de días u otro «ID :».
    const nombre = nombreDelBloque(row, columnCount);
    const siguiente = r + 1 <= ws.rowCount ? ws.getRow(r + 1) : null;
    const esMarcajes =
      siguiente && !mapaDeDias(siguiente, columnCount) && !/^id\b/i.test(texto(siguiente.getCell(1)));
    if (!esMarcajes) continue;
    r += 1; // la fila de marcajes se consume aquí; el for no debe re-mirarla

    if (!dias) {
      avisos.push({
        nivel: "aviso",
        texto: `El bloque de la fila ${r - 1} de «${ws.name}» aparece antes de ninguna fila de días. Se ha saltado.`,
      });
      continue;
    }

    for (const [col, dia] of dias) {
      const bruto = texto(siguiente.getCell(col));
      if (!bruto) continue;

      if (!nombre) {
        avisos.push({
          nivel: "aviso",
          texto: `Hay marcajes sin nombre en la fila ${r} de «${ws.name}» (día ${dia}). Se han saltado: nada se importa sin saber de quién es.`,
        });
        break;
      }
      nombres.add(nombre);

      if (dia > diasDelMes) {
        avisos.push({
          nivel: "aviso",
          texto: `${nombre}: hay marcajes en el día ${dia}, que no existe en ${periodo}. Fila saltada.`,
        });
        continue;
      }
      const fecha = fechaISO(year, month, dia);

      // Los marcajes del día: una hora por línea dentro de la celda.
      const trozos = bruto.split(/[\n\r]+/).map((t) => t.trim()).filter(Boolean);
      const horas = [];
      const ilegibles = [];
      for (const t of trozos) {
        const h = parseHoraDelDia(t);
        if (h.ok) horas.push(h.valor);
        else ilegibles.push(t);
      }

      if (ilegibles.length) {
        // Texto que no se entiende NO se tira en silencio: la fila sale
        // bloqueada al preview diciendo qué ponía, como en los otros lectores.
        filas.push({
          nombreExcel: nombre,
          fecha,
          diaLetra: null,
          entrada: null,
          salida: null,
          entradaPrevista: null,
          salidaPrevista: null,
          minutos: null,
          minutosPrevistos: null,
          fuente: "marcajes",
          cruzaMedianoche: false,
          hoja: ws.name,
          fila: r,
          errores: [
            `no se han podido leer los marcajes del día ${dia} (la celda dice «${recortar(ilegibles.join(" / "))}»)`,
          ],
        });
        continue;
      }

      // Emparejar en orden: 1º-2º, 3º-4º… El suelto del final, si lo hay,
      // entra como jornada de 0 minutos con su nota (ver cabecera).
      for (let i = 0; i < horas.length; i += 2) {
        const entrada = horas[i];
        const salida = i + 1 < horas.length ? horas[i + 1] : null;

        if (salida === null) {
          marcajesSueltos += 1;
          filas.push({
            nombreExcel: nombre,
            fecha,
            diaLetra: null,
            entrada: formatearHora(entrada),
            salida: null,
            entradaPrevista: null,
            salidaPrevista: null,
            minutos: 0,
            minutosPrevistos: null,
            fuente: "marcaje_suelto",
            cruzaMedianoche: false,
            hoja: ws.name,
            fila: r,
            nota: "el reloj solo tiene este marcaje: falta la otra hora",
            errores: [],
          });
          continue;
        }

        const { minutos, cruzaMedianoche } = minutosEntre(entrada, salida);
        const errores = [];
        if (minutos > 16 * 60) {
          errores.push(`la jornada saldría de ${Math.round(minutos / 60)} h`);
        }
        // El reloj escribe los marcajes en orden cronológico, así que una
        // salida anterior a la entrada aquí es rarísima; si pasa, se cuenta
        // como jornada que cruza la medianoche y se avisa, como en el resto de
        // lectores.
        if (cruzaMedianoche) {
          avisos.push({
            nivel: "aviso",
            texto: `${nombre}: el día ${dia} tiene la salida (${formatearHora(salida)}) anterior a la entrada (${formatearHora(entrada)}). Se ha contado como jornada que cruza la medianoche (${formatearMinutos(minutos)}): revísala.`,
          });
        }

        filas.push({
          nombreExcel: nombre,
          fecha,
          diaLetra: null,
          entrada: formatearHora(entrada),
          salida: formatearHora(salida),
          entradaPrevista: null,
          salidaPrevista: null,
          minutos,
          minutosPrevistos: null,
          fuente: "marcajes",
          cruzaMedianoche,
          hoja: ws.name,
          fila: r,
          errores,
        });
      }
    }

    // Quien está en el reloj pero no fichó ni una vez en todo el mes se dice
    // aquí; el aviso «Sin ningún fichaje este mes» de la pantalla sale del
    // EQUIPO del CRM, y esta persona puede no estar aún mapeada a nadie.
    if (nombre && !nombres.has(nombre)) {
      avisos.push({
        nivel: "aviso",
        texto: `«${nombre}» está en el reloj pero no tiene ni un marcaje este mes.`,
      });
    }
  }

  if (marcajesSueltos > 0) {
    avisos.push({
      nivel: "aviso",
      texto: `${marcajesSueltos} ${marcajesSueltos === 1 ? "día tiene un marcaje suelto" : "días tienen un marcaje suelto"} (se fichó la entrada o la salida, no las dos). Entran con 0 minutos y quedan marcados como «Entrada sin salida» en la pantalla del mes: corrígelos ahí con la hora real.`,
    });
  }

  if (filas.length === 0) {
    avisos.push({ nivel: "error", texto: "No se ha encontrado ni una jornada en el fichero." });
  }

  return {
    filas,
    anotaciones: [],
    avisos,
    nombres: [...nombres].sort((a, b) => a.localeCompare(b, "es")),
  };
}

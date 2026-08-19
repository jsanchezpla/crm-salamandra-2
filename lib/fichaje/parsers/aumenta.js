/**
 * lib/fichaje/parsers/aumenta.js — lector del Excel de fichaje de Aumenta.
 *
 * El núcleo del módulo Fichaje es universal; el LECTOR es de cada cliente,
 * porque cada reloj de fichar y cada hoja de cálculo son distintos. Este lee el
 * fichero real que usa Aumenta («FICHAJE TRABAJADORES … MARZO 2026.xlsx»).
 *
 * ── LA FORMA DEL FICHERO ────────────────────────────────────────────────────
 * Un fichero por MES y una hoja por SEMANA, con el rango de días en el nombre:
 * «02-6», «9-13», «16-20», «23-27 PENDIENTE». El nombre NO dice el mes: eso lo
 * elige quien importa, y por eso el periodo es un dato de entrada y no se
 * adivina del fichero.
 *
 * Dentro de cada hoja, bloques por persona con cinco filas (L, M, X, J, V) y
 * una de totales. Columnas que importan:
 *
 *   C1  nombre de la persona … o una ANOTACIÓN (ver abajo)
 *   C2  día de la semana: L M X J V
 *   C3  entrada según HORARIO (lo que tenía que hacer)
 *   C4  entrada REAL (lo que fichó)
 *   C6  salida según HORARIO
 *   C7  salida REAL
 *   C9  horas de trabajo según horario     ─┐ calculadas por el Excel;
 *   C10 horas de trabajo según fichaje      │ se usan SOLO como respaldo
 *   C11 horas extra                        ─┘ (ver «las fórmulas» abajo)
 *
 * ── LOS TRES SITIOS DONDE ESTE FICHERO MUERDE ───────────────────────────────
 *
 * 1. LA COLUMNA DE NOMBRES TAMBIÉN LLEVA ANOTACIONES. En el fichero real hay
 *    «BAJA», «MÉDICO», «*MÉDICO», «JUSTIFICANTE DE MÉDICO» y «REUNIÓN DE
 *    AITOR» escritos en la MISMA columna que los nombres. Son información
 *    valiosa —explican por qué ese día está raro— y meterlas como personas
 *    sería absurdo.
 *
 *    La regla, sacada de los seis casos reales del fichero: una fila abre
 *    bloque de persona si tiene texto en C1 **y** su día está vacío o es `L`.
 *    Si el día es M/X/J/V, ese texto es una anotación sobre ESE día de la
 *    persona cuyo bloque está abierto.
 *
 *    Si algún día una anotación cae en lunes, se leerá como persona, no casará
 *    con nadie del equipo y saldrá en el preview como fila sin asignar. Es el
 *    fallo seguro: se ve y se resuelve a mano, en vez de colarse.
 *
 * 2. LOS BLOQUES NO SON DE TAMAÑO FIJO. «ISA» está en la fila 13 en unas hojas
 *    y en la 14 en otras porque alguien insertó filas. Se recorre de nombre a
 *    nombre; contar de cinco en cinco desalinearía el fichero entero a partir
 *    de la primera fila insertada, y en silencio.
 *
 * 3. LAS FÓRMULAS NO SIRVEN PARA PAGAR. Las columnas calculadas devuelven cosas
 *    como `21.000000000000245` minutos: son restas de horas en coma flotante.
 *    Los minutos se recalculan de las horas de entrada y salida reales; la
 *    columna del Excel solo se usa cuando no hay horas de las que sacarlos, y
 *    entonces se dice de dónde salió.
 *
 * Devuelve SIEMPRE, sin lanzar: lo que ha entendido, lo que no, y por qué.
 */

import {
  parseHoraDelDia,
  parseDuracion,
  valorDeCelda,
  minutosEntre,
  formatearHora,
  formatearMinutos,
} from "../parseHora.js";

export const meta = {
  key: "aumenta",
  nombre: "Aumenta — hoja semanal por persona",
  descripcion:
    "Un fichero por mes, una hoja por semana («02-6», «9-13»…). Bloques por persona con L/M/X/J/V, entrada y salida previstas y reales.",
};

// Índice del día dentro de la semana laboral.
const DIAS = { L: 0, M: 1, X: 2, J: 3, V: 4 };

/**
 * Lee la celda del día. Admite `L` y también `M-1` / `M-2`, que es como el
 * fichero escribe DOS TRAMOS EL MISMO DÍA: Rosa trabaja los martes por la
 * mañana y por la tarde, y son dos filas con el mismo día.
 *
 * Esta es la razón por la que el modelo guarda TRAMOS y no días: con una fila
 * por día habría que sumar aquí y se perdería a qué hora entró y salió cada
 * vez, que es justo lo que hay que poder enseñar si alguien discute su nómina.
 *
 * Devuelve `{indice, tramo}` o null si la celda no es un día.
 */
function leerDia(txt) {
  const m = /^([LMXJV])(?:\s*[-/]\s*(\d+))?$/i.exec(String(txt || "").trim());
  if (!m) return null;
  const letra = m[1].toUpperCase();
  return { letra, indice: DIAS[letra], tramo: m[2] ? Number(m[2]) : null };
}

const COL = {
  nombre: 1,
  dia: 2,
  entradaPrevista: 3,
  entrada: 4,
  salidaPrevista: 6,
  salida: 7,
  horasPrevistas: 9,
  horasFichadas: 10,
};

/** Texto limpio de una celda, o "" si no hay nada. */
function texto(celda) {
  const v = valorDeCelda(celda);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return "";
  return String(v).trim();
}

/**
 * Días que cubre una hoja, de su nombre: «02-6» → [2,6]. «23-27 PENDIENTE» →
 * [23,27]. Lo que no case devuelve null y la hoja se salta CON aviso: saltarse
 * una semana entera sin decirlo sería perder un cuarto del mes.
 */
export function diasDeLaHoja(nombre) {
  const m = /(\d{1,2})\s*[-–—aA]\s*(\d{1,2})/.exec(String(nombre || ""));
  if (!m) return null;
  const desde = Number(m[1]);
  const hasta = Number(m[2]);
  if (!(desde >= 1 && desde <= 31 && hasta >= 1 && hasta <= 31 && hasta >= desde)) return null;
  return { desde, hasta };
}

function fechaISO(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  const anotaciones = [];
  const avisos = [];
  const nombres = new Set();

  for (const ws of workbook.worksheets) {
    const rango = diasDeLaHoja(ws.name);
    if (!rango) {
      avisos.push({
        nivel: "error",
        texto: `La hoja «${ws.name}» no dice qué días cubre (se espera algo como «02-6»). No se ha leído.`,
      });
      continue;
    }
    if (rango.desde > diasDelMes) {
      avisos.push({
        nivel: "error",
        texto: `La hoja «${ws.name}» empieza el día ${rango.desde}, y ${periodo} solo tiene ${diasDelMes} días. No se ha leído.`,
      });
      continue;
    }

    // El día `L` es el primero del rango. Se comprueba que de verdad sea lunes:
    // si no lo es, el fichero no es la semana que dice ser y todas las fechas
    // saldrían corridas — mejor decirlo que importar un mes desplazado.
    const primerDia = new Date(Date.UTC(year, month - 1, rango.desde));
    if (primerDia.getUTCDay() !== 1) {
      avisos.push({
        nivel: "aviso",
        texto: `En la hoja «${ws.name}» el día ${rango.desde} de ${periodo} no cae en lunes. Se ha leído igualmente contando L, M, X, J, V desde ese día: revisa las fechas.`,
      });
    }

    let personaActual = null;
    // Días ya leídos de la persona en curso. Es lo que distingue «empieza otra
    // persona» de «anotación sobre el primer día de esta»: ver abajo.
    let diasDeLaPersona = 0;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nombre = texto(row.getCell(COL.nombre));
      const dia = leerDia(texto(row.getCell(COL.dia)));

      // ── ¿Abre bloque de persona? ─────────────────────────────────────────
      //
      // Un nombre SIN día abre bloque siempre. Con día `L` abre solo si la
      // persona anterior ya tiene días leídos; si no los tiene, es que su
      // cabecera está en la fila justo de arriba y este texto es una anotación
      // sobre su lunes.
      //
      // Sale del fichero real: en la última hoja, `VICTORIA` va sola en la fila
      // 81 y `JUSTIFICANTE DE MÉDICO` en la 82 con día `L`. Sin esta condición
      // el justificante se leía como una persona más y **se llevaba las horas
      // de Victoria**, que es peor que ignorarlo: no es ruido, es un error de
      // atribución de jornada.
      const abreBloque =
        nombre && (!dia || (dia.letra === "L" && (personaActual === null || diasDeLaPersona > 0)));

      if (abreBloque) {
        personaActual = nombre;
        diasDeLaPersona = 0;
        nombres.add(nombre);
      } else if (nombre && dia && personaActual) {
        anotaciones.push({
          nombreExcel: personaActual,
          fecha: fechaISO(year, month, rango.desde + dia.indice),
          texto: nombre,
          hoja: ws.name,
          fila: r,
        });
      } else if (nombre && !personaActual) {
        avisos.push({
          nivel: "aviso",
          texto: `«${nombre}» (hoja ${ws.name}, fila ${r}) aparece antes de ninguna persona. Se ha ignorado.`,
        });
      }

      if (!dia || !personaActual) continue;
      diasDeLaPersona += 1;

      const diaLetra = dia.tramo ? `${dia.letra}-${dia.tramo}` : dia.letra;
      const diaDelMes = rango.desde + dia.indice;
      if (diaDelMes > diasDelMes) {
        avisos.push({
          nivel: "aviso",
          texto: `${personaActual}: el ${diaLetra} de la hoja «${ws.name}» caería en el día ${diaDelMes}, que no existe en ${periodo}. Fila saltada.`,
        });
        continue;
      }
      const fecha = fechaISO(year, month, diaDelMes);

      const entrada = parseHoraDelDia(row.getCell(COL.entrada));
      const salida = parseHoraDelDia(row.getCell(COL.salida));
      const entradaPrev = parseHoraDelDia(row.getCell(COL.entradaPrevista));
      const salidaPrev = parseHoraDelDia(row.getCell(COL.salidaPrevista));

      // Minutos PREVISTOS: de las horas del horario; si no, de la columna
      // calculada del Excel.
      let minutosPrevistos = null;
      if (entradaPrev.ok && salidaPrev.ok) {
        minutosPrevistos = minutosEntre(entradaPrev.valor, salidaPrev.valor).minutos;
      } else {
        const d = parseDuracion(row.getCell(COL.horasPrevistas));
        if (d.ok) minutosPrevistos = d.valor;
      }

      // Minutos TRABAJADOS. Este es el número que acaba en una nómina, así que
      // se dice de dónde sale.
      let minutos = null;
      let fuente = null;
      let cruzaMedianoche = false;
      if (entrada.ok && salida.ok) {
        const r2 = minutosEntre(entrada.valor, salida.valor);
        minutos = r2.minutos;
        cruzaMedianoche = r2.cruzaMedianoche;
        fuente = "horas";
      } else {
        const d = parseDuracion(row.getCell(COL.horasFichadas));
        if (d.ok && d.valor > 0) {
          minutos = d.valor;
          fuente = "total_excel";
        }
      }

      // Una fila sin entrada, sin salida y sin total no es un error: es un día
      // que esa persona no trabajó. Se descarta en silencio; si de verdad
      // faltara, el aviso «sin fichajes» del resumen lo dirá.
      const vacia = !entrada.ok && !salida.ok && minutos === null;
      if (vacia) continue;

      const errores = [];
      if (minutos === null) {
        errores.push(
          entrada.ok || salida.ok
            ? `solo consta ${entrada.ok ? "la entrada" : "la salida"} y no hay total de horas`
            : "no se ha podido leer ninguna hora"
        );
      }
      if (minutos !== null && minutos > 16 * 60) {
        errores.push(`la jornada saldría de ${Math.round(minutos / 60)} h`);
      }

      // Salida anterior a la entrada: `minutosEntre` suma 24 h y lo marca, pero
      // nadie lo convertía en aviso y la jornada más común de Aumenta
      // (08:30-17:00) con las dos celdas cambiadas entraba como 15h 30min sin
      // que el preview dijera nada. Un turno de noche es legítimo, así que la
      // fila sigue entrando, pero avisada (lo sacó la prueba, 19/08/2026).
      if (cruzaMedianoche) {
        avisos.push({
          nivel: "aviso",
          texto: `${personaActual}: el ${diaLetra} de la hoja «${ws.name}» (fila ${r}) tiene la salida (${formatearHora(salida.valor)}) anterior a la entrada (${formatearHora(entrada.valor)}). Se ha contado como jornada que cruza la medianoche (${formatearMinutos(minutos)}): revisa si están cambiadas.`,
        });
      }

      filas.push({
        nombreExcel: personaActual,
        fecha,
        diaLetra,
        entrada: entrada.ok ? formatearHora(entrada.valor) : null,
        salida: salida.ok ? formatearHora(salida.valor) : null,
        entradaPrevista: entradaPrev.ok ? formatearHora(entradaPrev.valor) : null,
        salidaPrevista: salidaPrev.ok ? formatearHora(salidaPrev.valor) : null,
        minutos,
        minutosPrevistos,
        fuente,
        cruzaMedianoche,
        hoja: ws.name,
        fila: r,
        errores,
      });
    }
  }

  if (filas.length === 0) {
    avisos.push({ nivel: "error", texto: "No se ha encontrado ni una jornada en el fichero." });
  }

  return {
    filas,
    anotaciones,
    avisos,
    nombres: [...nombres].sort((a, b) => a.localeCompare(b, "es")),
  };
}

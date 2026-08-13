/**
 * lib/fichaje/parsers/generico.js — lector por COLUMNAS, el que vale para todos.
 *
 * Es el que se usa cuando un cliente no tiene lector propio, y el que
 * corresponde a la plantilla que el módulo ofrece descargar. Una fila = un
 * tramo trabajado:
 *
 *   Persona | Fecha | Entrada | Salida | Horas | Nota
 *
 * Reglas:
 *   · `Persona` y `Fecha` son obligatorias.
 *   · Con `Entrada` y `Salida` se calculan las horas. Si no las hay, se toma
 *     `Horas` (que admite `7:30`, `7,5` o `7.5`).
 *   · Dos filas del mismo día y la misma persona son dos tramos, no un error:
 *     mañana y tarde.
 *
 * La cabecera se busca por NOMBRE en las primeras filas, no por posición: quien
 * rellena una plantilla añade columnas, y exigir el orden exacto convierte un
 * añadido inofensivo en una importación fallida.
 */

import { parseFlexibleDate } from "../../training/parseDate.js";
import { parseHoraDelDia, parseDuracion, valorDeCelda, minutosEntre, formatearHora } from "../parseHora.js";

export const meta = {
  key: "generico",
  nombre: "Genérico — una fila por tramo",
  descripcion: "Persona · Fecha · Entrada · Salida · Horas · Nota. Es el formato de la plantilla descargable.",
};

// Sinónimos aceptados por columna. Todo en minúsculas y sin acentos.
const COLUMNAS = {
  persona: ["persona", "nombre", "trabajador", "trabajadora", "empleado", "empleada", "terapeuta"],
  fecha: ["fecha", "dia", "day", "date"],
  entrada: ["entrada", "hora entrada", "inicio", "desde"],
  salida: ["salida", "hora salida", "fin", "hasta"],
  horas: ["horas", "total", "duracion", "horas trabajadas", "tiempo"],
  nota: ["nota", "notas", "observaciones", "comentario", "incidencia"],
};

/**
 * Los motivos de `parseFlexibleDate` son códigos para programadores
 * (`formato_no_reconocido`, `ano_fuera_de_rango`). Esto se lee en el preview,
 * que mira una persona decidiendo si volca el mes: ahí un código no ayuda a
 * arreglar la celda.
 */
function motivoLegible(reason) {
  const frases = {
    vacio: "falta la fecha",
    date_invalida: "la fecha no es válida",
    tipo_no_soportado: "esa celda no contiene una fecha",
    formato_no_reconocido: "la fecha no se entiende (usa 2026-03-15 o 15/03/2026)",
    componentes_invalidos: "la fecha no se entiende",
    ano_fuera_de_rango: "el año está fuera de rango",
    mes_invalido: "el mes no existe",
    dia_invalido: "el día no existe",
    fecha_inexistente: "ese día no existe en ese mes",
    serial_invalido: "la fecha no se entiende",
  };
  return frases[reason] || "la fecha no se entiende";
}

function normalizar(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Busca la fila de cabecera en las primeras 10 y devuelve columna→índice. */
export function localizarColumnas(ws) {
  const limite = Math.min(10, ws.rowCount);
  for (let r = 1; r <= limite; r++) {
    const mapa = {};
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.max(ws.columnCount, 1); c++) {
      const txt = normalizar(valorDeCelda(row.getCell(c)));
      if (!txt) continue;
      for (const [clave, sinonimos] of Object.entries(COLUMNAS)) {
        if (mapa[clave] === undefined && sinonimos.includes(txt)) mapa[clave] = c;
      }
    }
    if (mapa.persona !== undefined && mapa.fecha !== undefined) return { fila: r, mapa };
  }
  return null;
}

export async function parse(workbook, { periodo }) {
  const filas = [];
  const avisos = [];
  const nombres = new Set();
  const rangoMes = /^(\d{4})-(\d{2})$/.exec(String(periodo || ""));
  if (!rangoMes) {
    return { filas: [], anotaciones: [], avisos: [{ nivel: "error", texto: "Periodo inválido (se espera YYYY-MM)" }], nombres: [] };
  }

  for (const ws of workbook.worksheets) {
    const cab = localizarColumnas(ws);
    if (!cab) {
      avisos.push({
        nivel: "aviso",
        texto: `La hoja «${ws.name}» no tiene columnas «Persona» y «Fecha». No se ha leído.`,
      });
      continue;
    }
    const { fila: filaCab, mapa } = cab;

    for (let r = filaCab + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const persona = String(valorDeCelda(row.getCell(mapa.persona)) ?? "").trim();
      const fechaBruta = valorDeCelda(row.getCell(mapa.fecha));
      if (!persona && (fechaBruta === null || fechaBruta === "")) continue; // fila vacía

      const errores = [];
      if (!persona) errores.push("falta la persona");

      // ⚠️ `parseFlexibleDate` devuelve la fecha en `date`, NO en `value`. Leerlo
      // mal no daba error: dejaba `fecha` en undefined y TODAS las filas se
      // rechazaban con «la fecha undefined no es de 2026-03». O sea, el lector
      // genérico —el que usa cualquier cliente sin lector propio— no importaba
      // ni una sola jornada.
      const f = parseFlexibleDate(fechaBruta);
      let fecha = null;
      if (!f.ok) {
        errores.push(motivoLegible(f.reason));
      } else {
        fecha = f.date.toISOString().slice(0, 10);
        // Una fila de otro mes dentro del fichero del mes M sería un fichaje
        // que nadie ve —la pantalla filtra por periodo— y que además el
        // reemplazo del mes siguiente no limpiaría. Mejor rechazarla.
        if (!fecha.startsWith(periodo)) errores.push(`la fecha ${fecha} no es de ${periodo}`);
      }

      const entrada = mapa.entrada !== undefined ? parseHoraDelDia(row.getCell(mapa.entrada)) : { ok: false };
      const salida = mapa.salida !== undefined ? parseHoraDelDia(row.getCell(mapa.salida)) : { ok: false };

      let minutos = null;
      let fuente = null;
      let cruzaMedianoche = false;
      if (entrada.ok && salida.ok) {
        const m = minutosEntre(entrada.valor, salida.valor);
        minutos = m.minutos;
        cruzaMedianoche = m.cruzaMedianoche;
        fuente = "horas";
      } else if (mapa.horas !== undefined) {
        const d = parseDuracion(row.getCell(mapa.horas));
        if (d.ok && d.valor > 0) {
          minutos = d.valor;
          fuente = "total_excel";
        }
      }
      if (minutos === null) errores.push("no hay horas ni total del que sacar la jornada");

      if (persona) nombres.add(persona);
      filas.push({
        nombreExcel: persona,
        fecha,
        diaLetra: null,
        entrada: entrada.ok ? formatearHora(entrada.valor) : null,
        salida: salida.ok ? formatearHora(salida.valor) : null,
        entradaPrevista: null,
        salidaPrevista: null,
        minutos,
        minutosPrevistos: null,
        fuente,
        cruzaMedianoche,
        hoja: ws.name,
        fila: r,
        nota: mapa.nota !== undefined ? String(valorDeCelda(row.getCell(mapa.nota)) ?? "").trim() || null : null,
        errores,
      });
    }
  }

  if (filas.length === 0) avisos.push({ nivel: "error", texto: "No se ha encontrado ni una jornada en el fichero." });

  return { filas, anotaciones: [], avisos, nombres: [...nombres].sort((a, b) => a.localeCompare(b, "es")) };
}

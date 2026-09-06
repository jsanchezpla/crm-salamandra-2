import { normalizarEmail } from "./bajaToken.js";

/**
 * lib/mailing/csv.js — leer un CSV de correos sueltos sin librerías.
 *
 * (Fichero nuevo en /lib, regla #2: lo usa el endpoint de importación y lo
 * prueba `_smoke-mailing-audiencia-csv.mjs`. Es lógica pura: texto → filas.)
 *
 * Lo que acepta, porque es lo que exportan Excel, Google Sheets y Mailchimp:
 *   · separador `;`, `,` o tabulador (se detecta en la primera línea)
 *   · comillas dobles con `""` dentro
 *   · una cabecera opcional (si la primera fila no tiene ningún `@`, es
 *     cabecera y se salta)
 *   · el correo en CUALQUIER columna (la primera celda con `@`), y como nombre
 *     la primera celda no vacía que no sea el correo
 *
 * Devuelve `{ filas: [{ email, nombre }], invalidos: [texto], duplicados: n }`
 * ya sin repetidos (gana la primera aparición).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_FILAS_CSV = 5000;

function detectarSeparador(linea) {
  const cuenta = (c) => (linea.match(new RegExp(c === "\t" ? "\t" : `\\${c}`, "g")) || []).length;
  const candidatos = [";", ",", "\t"].map((c) => [c, cuenta(c)]).sort((a, b) => b[1] - a[1]);
  return candidatos[0][1] > 0 ? candidatos[0][0] : ",";
}

/** Trocea una línea respetando comillas. */
export function trocearLinea(linea, sep) {
  const celdas = [];
  let actual = "";
  let dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (dentro) {
      if (ch === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i++;
        } else dentro = false;
      } else actual += ch;
    } else if (ch === '"') dentro = true;
    else if (ch === sep) {
      celdas.push(actual);
      actual = "";
    } else actual += ch;
  }
  celdas.push(actual);
  return celdas.map((c) => c.trim());
}

export function leerCsvDeContactos(texto) {
  const crudo = String(texto ?? "").replace(/^﻿/, "");
  const lineas = crudo.split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return { filas: [], invalidos: [], duplicados: 0, cabecera: false };
  const sep = detectarSeparador(lineas[0]);
  const primera = trocearLinea(lineas[0], sep);
  const cabecera = !primera.some((c) => c.includes("@"));
  const desde = cabecera ? 1 : 0;

  const vistos = new Set();
  const filas = [];
  const invalidos = [];
  let duplicados = 0;
  for (let i = desde; i < lineas.length && filas.length < MAX_FILAS_CSV; i++) {
    const celdas = trocearLinea(lineas[i], sep);
    const bruto = celdas.find((c) => c.includes("@"));
    const email = normalizarEmail(bruto);
    if (!bruto || !EMAIL_RE.test(email)) {
      invalidos.push(lineas[i].slice(0, 120));
      continue;
    }
    if (vistos.has(email)) {
      duplicados++;
      continue;
    }
    vistos.add(email);
    const nombre = celdas.find((c) => c && c !== bruto && !c.includes("@")) || null;
    filas.push({ email, nombre: nombre ? nombre.slice(0, 160) : null });
  }
  return { filas, invalidos, duplicados, cabecera };
}

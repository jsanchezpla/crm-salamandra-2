/**
 * lib/correo/listas.js — qué es una lista de destinatarios válida.
 *
 * (Fichero en /lib, regla #2: lo comparten el POST y el PUT de
 * `/api/correo/listas`, y lo prueba `_smoke-correo-herramientas.mjs`.)
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MAX_NOMBRE_LISTA = 80;
// El mismo tope que un envío admite de una tacada más margen: una lista es un
// almacén, no un envío, pero sin tope alguien pega un CSV de 40.000 filas y el
// JSONB de una fila se come la tabla.
export const MAX_DESTINATARIOS_LISTA = 1000;

/** Valida el nombre. Devuelve el nombre limpio o `{ error }`. */
export function normalizarNombreLista(bruto) {
  const nombre = String(bruto ?? "").trim();
  if (!nombre) return { error: "La lista necesita un nombre" };
  if (nombre.length > MAX_NOMBRE_LISTA) {
    return { error: `El nombre no puede pasar de ${MAX_NOMBRE_LISTA} caracteres` };
  }
  return { nombre };
}

/**
 * Valida y limpia los destinatarios de una lista: correos válidos, sin
 * duplicados, con los campos acotados. Lo que no es un correo se descarta y se
 * devuelve aparte, para que la pantalla lo diga en vez de tragárselo.
 */
export function normalizarListaDestinatarios(brutos) {
  if (!Array.isArray(brutos)) return { error: "«destinatarios» tiene que ser una lista" };
  if (brutos.length > MAX_DESTINATARIOS_LISTA) {
    return { error: `Una lista no puede pasar de ${MAX_DESTINATARIOS_LISTA} destinatarios` };
  }

  const vistos = new Set();
  const destinatarios = [];
  const descartados = [];
  for (const bruto of brutos) {
    const email = String(typeof bruto === "string" ? bruto : (bruto?.email ?? "")).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      if (email) descartados.push(email);
      continue;
    }
    if (vistos.has(email)) continue;
    vistos.add(email);
    const obj = typeof bruto === "object" && bruto ? bruto : {};
    destinatarios.push({
      email,
      nombre: obj.nombre ? String(obj.nombre).slice(0, 200) : null,
      detalle: obj.detalle ? String(obj.detalle).slice(0, 200) : null,
      fuente: obj.fuente ? String(obj.fuente).slice(0, 40) : null,
    });
  }

  if (!destinatarios.length) return { error: "La lista no tiene ni un correo válido" };
  return { destinatarios, descartados };
}

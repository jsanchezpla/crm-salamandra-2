/**
 * lib/clinica/diagnosticosAjustes.js — los productos de diagnóstico tal como
 * se EDITAN en Configuración → Módulos → «Diagnósticos» (12/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo leen la tarjeta de Configuración —para
 * avisar antes de guardar— y el PATCH de `/api/tenant/settings` —para decidir
 * qué se guarda—. Escrito en cada lado, la tarjeta podría dar por bueno lo
 * que el servidor va a descartar en silencio, y dirección vería «guardado»
 * con un producto de 0 h que nunca llegó a la base. PURO: sin ORM.)
 *
 * Lo que un producto ES —clave, nombre, horas, concepto y precio de caída— y
 * cómo se lee desde `settings.clinica.diagnosticos` vive en
 * `lib/clinica/diagnostico.js` (`productosDe`). Aquí solo se decide qué
 * hacer con lo que llega del formulario:
 *
 *   · `[]`            → volver a los de fábrica (se BORRA la lista guardada);
 *   · lista con algo  → se guardan los válidos, tal como los deja `productosDe`;
 *   · nada válido     → error con la frase, no se guarda nada.
 *
 * Y cómo se cuenta el cambio en la auditoría («simple: 10 h · completo: 20 h»),
 * que es lo que lee dirección en el registro, no el JSON entero.
 */

import { PRODUCTOS_DE_FABRICA, productosDe, HORAS_MAX_TOPE } from "./diagnostico.js";

export const PROBLEMA_SIN_PRODUCTOS =
  `Ningún producto válido: cada uno necesita una clave (letras, números, - o _), un nombre y sus horas (de 0,5 a ${HORAS_MAX_TOPE})`;

/** Un producto, como objeto plano (sin `Object.freeze`) para guardarlo en el JSONB. */
const plano = (p) => ({ key: p.key, nombre: p.nombre, horas: p.horas, conceptId: p.conceptId, precioEuros: p.precioEuros });

/**
 * Qué guardar en `settings.clinica.diagnosticos` a partir de lo que manda la
 * tarjeta. Devuelve `{ valor, problema }`, como `limpiarBono`:
 *
 *   · `valor: null`      → quitar la lista: el centro vuelve a los de fábrica
 *   · `valor: [ … ]`     → la lista limpia (claves repetidas: la primera)
 *   · `problema: "…"`    → no se guarda nada; `valor` viene `undefined`
 */
export function productosParaGuardar(lista) {
  if (!Array.isArray(lista)) return { valor: undefined, problema: "«diagnosticos» tiene que ser una lista" };
  if (lista.length === 0) return { valor: null, problema: null };
  const validos = productosDe({ settings: { clinica: { diagnosticos: lista } } });
  // `productosDe` devuelve LA MISMA lista de fábrica (misma referencia) solo
  // cuando no había ninguna entrada válida: es la señal de que todo venía mal.
  if (validos === PRODUCTOS_DE_FABRICA) return { valor: undefined, problema: PROBLEMA_SIN_PRODUCTOS };
  return { valor: validos.map(plano), problema: null };
}

/** «simple: 10 h · completo: 20 h», o «(de fábrica)» cuando no hay lista guardada. */
export function resumenDeProductos(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return "(de fábrica)";
  return productosDe({ settings: { clinica: { diagnosticos: lista } } })
    .map((p) => `${p.key}: ${String(p.horas).replace(".", ",")} h${p.precioEuros !== null ? ` · ${p.precioEuros} €` : ""}`)
    .join(" · ");
}

/** Una clave a partir del nombre («Diagnóstico TDAH» → «diagnostico-tdah»), para un producto nuevo. */
export function claveDesdeNombre(nombre) {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Qué le pasa a cada fila del formulario, para decirlo ANTES de guardar.
 * Devuelve una lista paralela: `null` en las filas que están bien.
 */
export function problemasDeProductos(filas) {
  const vistas = new Set();
  return (Array.isArray(filas) ? filas : []).map((f) => {
    const key = String(f?.key ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(key)) return "La clave solo admite letras, números, - o _";
    if (vistas.has(key)) return `La clave «${key}» está repetida`;
    vistas.add(key);
    if (!String(f?.nombre ?? "").trim()) return "Falta el nombre";
    const horas = Number(String(f?.horas ?? "").replace(",", "."));
    if (!Number.isFinite(horas) || horas <= 0 || horas > HORAS_MAX_TOPE) return `Las horas van de 0,5 a ${HORAS_MAX_TOPE}`;
    if (Math.round(horas * 2) !== horas * 2) return "Las horas van de media en media";
    const precio = String(f?.precioEuros ?? "").trim();
    if (precio !== "" && !(Number.isFinite(Number(precio.replace(",", "."))) && Number(precio.replace(",", ".")) >= 0)) {
      return "El precio tiene que ser un importe en euros, o vacío";
    }
    return null;
  });
}

/**
 * Las filas del formulario (todo texto) → lo que se manda al PATCH.
 *
 * Un precio en blanco NO viaja como `null`: `productosDe` lee `Number(null)`
 * como 0 € (un producto regalado), y lo que quiere decir la casilla vacía es
 * «el de fábrica si lo hay; si no, ninguno». Sin la clave, `productosDe` cae
 * justo a eso.
 */
export function productosDesdeFormulario(filas) {
  return (Array.isArray(filas) ? filas : []).map((f) => {
    const precio = String(f?.precioEuros ?? "").trim().replace(",", ".");
    return {
      key: String(f?.key ?? "").trim().toLowerCase(),
      nombre: String(f?.nombre ?? "").trim(),
      horas: Number(String(f?.horas ?? "").replace(",", ".")),
      conceptId: f?.conceptId ? String(f.conceptId) : null,
      ...(precio === "" ? {} : { precioEuros: Number(precio) }),
    };
  });
}

/** Los productos del centro → filas del formulario (todo texto, para los inputs). */
export function formularioDeProductos(productos) {
  return (Array.isArray(productos) ? productos : []).map((p) => ({
    key: p.key ?? "",
    nombre: p.nombre ?? "",
    horas: p.horas === null || p.horas === undefined ? "" : String(p.horas).replace(".", ","),
    conceptId: p.conceptId ?? "",
    precioEuros: p.precioEuros === null || p.precioEuros === undefined ? "" : String(p.precioEuros).replace(".", ","),
  }));
}

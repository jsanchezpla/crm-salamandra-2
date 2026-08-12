/**
 * lib/provisioning/paquetes.js — qué es un paquete válido.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint que los guarda, el
 * que los sirve al alta y su prueba de humo. Son funciones PURAS, sin base de
 * datos, para que `scripts/_smoke-paquetes.mjs` pueda fijarlas sin levantar
 * nada.)
 *
 * ── LO QUE ESTE FICHERO PROTEGE ─────────────────────────────────────────────
 * Los paquetes vivían escritos en `catalogo.js`, y su comentario decía por qué:
 * «solo se escribe aquí un paquete cuando está DECIDIDO qué lleva; media
 * definición en el código es peor que ninguna: se acaba vendiendo lo que
 * alguien marcó un martes». El freno era que pasaba por un diff.
 *
 * Al poder crearlos desde una pantalla ese freno desaparece, así que se
 * reconstruye aquí: un paquete no se guarda si lleva módulos que no existen o
 * si sus dependencias no se sostienen. Lo que un paquete lleva acaba en la
 * factura de un cliente.
 *
 * ⚠️ Lo que NO se hace es COMPLETAR la selección por su cuenta. Es la misma
 * decisión del 10/08/2026 en el alta: lo que entra en la lista entra en lo que
 * paga el cliente, así que no puede entrar sin que nadie lo haya marcado. El
 * endpoint devuelve qué falta y la pantalla ofrece añadirlo; nunca lo añade
 * sola.
 */

import { CLAVES_VALIDAS, moduloPorClave } from "./catalogo.js";
import { validarSeleccion, fraseDeExigencia, completarSeleccion } from "./dependencias.js";

export const MAX_NOMBRE = 120;
export const MAX_DESCRIPCION = 500;
const MAX_CLAVE = 60;

/**
 * Nombre → slug estable.
 *
 * No se reutiliza `claveDeTarea()` de `lib/tablero/estado.js` aunque la idea sea
 * la misma: aquella normaliza el TÍTULO de una tarea del Registro y puede
 * cambiar cuando cambien las suyas. Compartirla ataría dos cosas que no tienen
 * por qué evolucionar juntas.
 */
export function claveDePaquete(nombre) {
  return String(nombre ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CLAVE);
}

/**
 * Dos nombres «iguales» para una persona: sin acentos, sin mayúsculas y sin
 * dobles espacios. Dos botones con el mismo rótulo en el alta es un fallo de
 * producto, no un choque de datos.
 */
export function nombreComparable(nombre) {
  return String(nombre ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/** Quita duplicados y deja el orden del catálogo, que es el que se ve. */
export function ordenarModulos(modulos) {
  const pedidos = new Set(Array.isArray(modulos) ? modulos : []);
  return [...CLAVES_VALIDAS].filter((k) => pedidos.has(k));
}

/**
 * ¿Se puede guardar este paquete?
 *
 * @param {object} entrada  { nombre, descripcion, modulos, orden, activo }
 * @param {object} opciones
 * @param {string[]} [opciones.nombresOcupados]  nombres de OTROS paquetes
 * @param {string[]} [opciones.clavesOcupadas]   claves de OTROS paquetes
 * @returns {{ok:true, limpio:object}|{ok:false, error:string, status:number}}
 */
export function validarPaquete(entrada = {}, { nombresOcupados = [], clavesOcupadas = [] } = {}) {
  const nombre = String(entrada.nombre ?? "").trim();
  if (nombre.length < 3) return { ok: false, error: "El nombre tiene que tener al menos 3 letras", status: 422 };
  if (nombre.length > MAX_NOMBRE) return { ok: false, error: `El nombre no puede pasar de ${MAX_NOMBRE} caracteres`, status: 422 };

  const yaEsta = nombresOcupados.some((n) => nombreComparable(n) === nombreComparable(nombre));
  if (yaEsta) return { ok: false, error: `Ya hay un paquete que se llama «${nombre}»`, status: 409 };

  const clave = claveDePaquete(nombre);
  if (!clave) return { ok: false, error: "Ese nombre no deja ninguna clave utilizable", status: 422 };
  if (clavesOcupadas.includes(clave)) {
    return { ok: false, error: `Ya hay un paquete con la clave «${clave}»`, status: 409 };
  }

  const pedidos = Array.isArray(entrada.modulos) ? entrada.modulos.map((m) => String(m)) : [];
  if (!pedidos.length) return { ok: false, error: "Un paquete sin módulos no sirve para nada", status: 422 };

  const desconocidos = [...new Set(pedidos.filter((k) => !CLAVES_VALIDAS.has(k)))];
  if (desconocidos.length) {
    return { ok: false, error: `Módulos que no existen: ${desconocidos.join(", ")}`, status: 422 };
  }

  const modulos = ordenarModulos(pedidos);

  // El mismo freno que el alta: nada de vender un módulo que sin otro da 403 en
  // su propia pantalla.
  const { problemas } = validarSeleccion(modulos);
  if (problemas.length) {
    const nombreDe = (k) => moduloPorClave(k)?.nombre ?? k;
    return { ok: false, error: problemas.map((p) => fraseDeExigencia(p, nombreDe)).join(" "), status: 422 };
  }

  const descripcion = entrada.descripcion ? String(entrada.descripcion).trim().slice(0, MAX_DESCRIPCION) : null;
  const orden = Number.isInteger(entrada.orden) ? entrada.orden : 0;
  const activo = entrada.activo === undefined ? true : !!entrada.activo;

  return { ok: true, limpio: { clave, nombre, descripcion, modulos, orden, activo } };
}

/**
 * Qué habría que añadir para que una selección se sostenga. Se le da a la
 * pantalla junto al error, para poder ofrecer «añadir también …» en vez de
 * dejar a alguien adivinando. NO se aplica sola.
 */
export function loQueFalta(modulos) {
  // `completarSeleccion` ya devuelve lo que tuvo que añadir en `anadidos`; no
  // hay que volver a restarlo, y hacerlo a mano se desincronizaría el día que
  // esa función cambie de criterio.
  return completarSeleccion(Array.isArray(modulos) ? modulos : []).anadidos;
}

/**
 * Fila de la base → lo que consume el alta.
 *
 * `desc` y no `descripcion` porque es el nombre que ya usaban los paquetes
 * escritos en el código, y la pantalla del alta lee esa clave. Cambiarlo
 * obligaría a tocar el alta sin ganar nada.
 */
export function serializarPaquete(fila) {
  return {
    id: fila.id ?? null,
    key: fila.clave,
    nombre: fila.nombre,
    desc: fila.descripcion ?? "",
    modulos: Array.isArray(fila.modulos) ? fila.modulos : [],
    orden: fila.orden ?? 0,
    activo: fila.activo !== false,
    tocadoPor: fila.tocadoPor ?? null,
  };
}

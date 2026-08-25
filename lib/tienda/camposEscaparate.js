/**
 * lib/tienda/camposEscaparate.js — leer y validar lo que hace vendible a un
 * producto, sin repetirlo en el alta y en la edición.
 *
 * (Fichero nuevo en /lib, regla #2: `POST /api/inventory/products` y su `PATCH`
 * aceptan los mismos campos, y el slug tiene reglas —único, sin tildes, sin
 * espacios— que escritas dos veces divergen a la primera prisa.)
 */

const MAX_IMAGENES = 12;

/** Un slug de URL: minúsculas, sin tildes, con guiones. */
export function slugDesde(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

/**
 * Las imágenes, limpias. Cada una `{url, alt}`.
 *
 * Se aceptan rutas relativas Y absolutas a propósito: las fotos pueden estar
 * en el WordPress del cliente, en un CDN o subidas al CRM, y decidir eso por
 * él sería obligarle a mover ficheros que ya tiene en su sitio.
 */
export function normalizarImagenes(valor) {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((i) => {
      const url = String(typeof i === "string" ? i : (i?.url ?? "")).trim();
      if (!url || url.length > 500) return null;
      // `javascript:` y `data:` fuera: esto acaba en un `src` de la tienda.
      if (/^\s*(javascript|data|vbscript):/i.test(url)) return null;
      return { url, alt: String(i?.alt ?? "").trim().slice(0, 200) || null };
    })
    .filter(Boolean)
    .slice(0, MAX_IMAGENES);
}

/**
 * Los campos de escaparate que llegan en el body, ya validados.
 *
 * Devuelve `{ campos, error }`. Solo incluye lo que venga: un `PATCH` que solo
 * cambia el precio no debe borrar la descripción por no mandarla.
 */
export function camposEscaparateDe(body, { nombre } = {}) {
  const campos = {};

  if (body.slug !== undefined || (body.publicado === true && nombre)) {
    // Un producto que se publica SIN slug se lo gana solo desde su nombre: pedir
    // que lo escriba a mano es un paso que nadie entiende y que bloquea la venta.
    const s = slugDesde(body.slug || nombre || "");
    campos.slug = s || null;
  }
  if (body.description !== undefined) {
    campos.description = String(body.description ?? "").trim().slice(0, 8000) || null;
  }
  if (body.images !== undefined) {
    campos.images = normalizarImagenes(body.images);
  }
  if (body.publicado !== undefined) {
    campos.publicado = !!body.publicado;
  }
  if (body.taxRate !== undefined) {
    const t = body.taxRate === "" || body.taxRate === null ? null : Number(body.taxRate);
    if (t !== null && (!Number.isFinite(t) || t < 0 || t > 100)) {
      return { error: "El IVA tiene que ser un porcentaje entre 0 y 100" };
    }
    campos.taxRate = t;
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    campos.sortOrder = Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  return { campos };
}

/**
 * ¿Se puede publicar? Publicar sin precio deja un producto en el escaparate que
 * nadie puede comprar, y el fallo se ve en la web y no en el CRM.
 */
export function estorbaParaPublicar(producto) {
  const precio = Number(producto?.salePrice);
  if (!Number.isFinite(precio) || precio <= 0) return "Ponle un precio de venta antes de publicarlo.";
  return null;
}

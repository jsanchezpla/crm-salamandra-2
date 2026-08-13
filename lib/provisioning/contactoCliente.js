/**
 * lib/provisioning/contactoCliente.js — A QUIÉN se le escribe a un cliente.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el alta, la edición y Custodia.
 * Es un dato de tres campos, pero la razón de que exista es una confusión que ya
 * costó una tarea del backlog, y esa explicación tiene que vivir en un sitio.)
 *
 * ── EL `adminEmail` DEL ALTA NO ES ESTO (13/08/2026, recado de Jorge) ───────
 * El alta pide un `adminEmail`, y parece el correo del cliente. No lo es: es el
 * NOMBRE DE USUARIO con el que entra al CRM. De hecho ni siquiera tiene que ser
 * un correo —las terapeutas de Aumenta entran con `nombre_aumenta`— y si se deja
 * vacío el alta se inventa `admin_{slug}`, que no es la dirección de nadie.
 *
 * Así que no había dónde apuntar a quién se le escribe cuando hay que pedirle
 * algo, que es justo lo que hace falta cuando Custodia dice que a un cliente le
 * faltan cuatro credenciales. Se anotaba en la cabeza de alguien.
 *
 * ── POR QUÉ EN `settings` Y NO EN UNA COLUMNA ──────────────────────────────
 * `master.tenants.settings` es JSONB y ya guarda la marca y los ajustes del
 * cliente; añadir tres columnas a `tenants` obliga a una migración en todos los
 * entornos para un dato que no se consulta ni se filtra nunca. Si algún día hay
 * que buscar por él, entonces sí toca columna.
 *
 * ⚠️ Es un dato PERSONAL de una persona de contacto, no una credencial: NO se
 * cifra (haría falta descifrarlo para poder pintarlo, que es para lo único que
 * sirve) y por eso tampoco se mete aquí nada que no sea una forma de contactar.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Limpia y valida lo que llega de un formulario.
 *
 * Semántica de cada campo, la misma que usa la Configuración con las claves:
 *   undefined → no se toca
 *   "" / null → se borra
 *   texto     → se fija
 *
 * @returns {{contacto: object|null}|{error: string}} `contacto: null` si el
 *          resultado queda vacío, para no dejar un `{}` en el JSONB.
 */
export function normalizarContacto(entrada, anterior = {}) {
  if (!entrada || typeof entrada !== "object") return { contacto: anterior ?? null };

  const out = { ...(anterior ?? {}) };

  if ("email" in entrada) {
    const v = String(entrada.email ?? "").trim().toLowerCase();
    if (!v) delete out.email;
    else if (!EMAIL_RE.test(v)) {
      return { error: "El correo de contacto no tiene forma de correo (algo@dominio.com)." };
    } else if (v.length > 190) {
      return { error: "El correo de contacto es demasiado largo." };
    } else out.email = v;
  }

  if ("nombre" in entrada) {
    const v = String(entrada.nombre ?? "").trim().slice(0, 120);
    if (!v) delete out.nombre;
    else out.nombre = v;
  }

  if ("telefono" in entrada) {
    const v = String(entrada.telefono ?? "").trim().slice(0, 40);
    if (!v) delete out.telefono;
    // Sin validar la FORMA a propósito: entran fijos, móviles, extensiones,
    // prefijos internacionales y «662 11 22 33 (mañanas)». Una validación de
    // teléfonos en España rechaza la mitad de lo que la gente escribe de verdad,
    // y esto es una nota para llamar, no un campo con el que se marque.
    else out.telefono = v;
  }

  return { contacto: Object.keys(out).length ? out : null };
}

/** Lo que hay guardado, siempre en la misma forma. */
export function leerContacto(tenant) {
  const c = tenant?.settings?.contacto ?? {};
  return {
    email: c.email ?? null,
    nombre: c.nombre ?? null,
    telefono: c.telefono ?? null,
  };
}

/** ¿Se le puede escribir a este cliente? Lo pregunta Custodia antes de ofrecerlo. */
export function tieneContacto(tenant) {
  return !!tenant?.settings?.contacto?.email;
}

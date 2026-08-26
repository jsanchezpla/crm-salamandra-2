/**
 * lib/auth/correoCuenta.js — el CORREO de una cuenta, que no es su usuario.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el login, las tres puertas por
 * las que nace un usuario, el modelo que las vigila a todas y el relleno de las
 * cuentas viejas. Resolver «¿cuál es el correo de esta cuenta?» en cada sitio es
 * como se acaba con media aplicación mirando una columna y la otra media otra.)
 *
 * ── LA CONFUSIÓN QUE ESTO DESHACE ──────────────────────────────────────────
 * `master.users.email` se llama email y NO es un email: es el IDENTIFICADOR con
 * el que se entra. Las 13 terapeutas de Aumenta entran con `nombre_aumenta`, sin
 * arroba. Medido el 26/08/2026 en producción: de 30 cuentas, 18 tienen ahí un
 * nombre de usuario y solo 12 un correo de verdad.
 *
 * Esa columna hace dos trabajos a la vez y por eso no servía para escribirle a
 * nadie. La misma confusión ya costó una tarea del backlog un nivel más arriba,
 * con el cliente en vez de con la cuenta, y se resolvió igual: separándolo (ver
 * `lib/provisioning/contactoCliente.js`).
 *
 *   `email`          → CON QUÉ SE ENTRA. Puede no llevar arroba. No se toca:
 *                      cambiarlo le cambia el login a una persona que trabaja.
 *   `emailContacto`  → A DÓNDE SE LE ESCRIBE. Un correo de verdad, siempre.
 *
 * ── Y ADEMÁS SIRVE PARA ENTRAR (Jorge, 26/08/2026) ─────────────────────────
 * «además de utilizar el usuario para entrar puedan utilizar su correo». O sea
 * que una cuenta tiene DOS identificadores válidos y los dos van a la misma
 * persona. Eso obliga a dos cosas que aquí se dan por sentadas:
 *
 *   1. El correo es ÚNICO, y único contra las DOS columnas: si
 *      `admin@aumenta.es` es el `email` de alguien, no puede ser el
 *      `emailContacto` de otro. Si no, teclearlo señalaría a dos cuentas.
 *   2. Cuando algo empata, MANDA `email`. Es la regla de `elegirCuenta` y no es
 *      cosmética: mientras el identificador gane siempre, ni un dato mal metido
 *      puede desviar el login de alguien hacia otra cuenta.
 *
 * ── POR QUÉ HAY UNA CAÍDA A `email` ────────────────────────────────────────
 * `correoDeCuenta` devuelve `emailContacto` y, si está vacío, `email` cuando
 * este SÍ tiene forma de correo. Con eso las 12 cuentas que ya entran con su
 * correo funcionan sin tocarles una fila, y el relleno solo tiene que ocuparse
 * de las que de verdad no tienen dirección en ninguna parte.
 *
 * ── SIN NI UN IMPORT, COMO `contrasena.js` ─────────────────────────────────
 * Este fichero lo usa también el navegador (el formulario de Equipo comprueba
 * el correo antes de mandarlo), así que no puede arrastrar Sequelize al bundle.
 * Lo que necesita la base de datos —las consultas— vive al lado, en
 * `correoCuentaDb.js`. Aquí solo está la REGLA, y por eso se puede probar con
 * `node:test` sin levantar nada.
 */

/** Tope de la columna. Los correos de verdad no llegan ni de lejos. */
export const MAX_LARGO = 190;

/*
 * La MISMA expresión que usa `lib/provisioning/contactoCliente.js` para el
 * correo del cliente. Comprueba la FORMA, no que exista el buzón: eso solo lo
 * sabe el correo cuando rebota.
 */
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** ¿Esto tiene forma de correo? Lo único que distingue un correo de un usuario. */
export function esCorreo(valor) {
  return typeof valor === "string" && CORREO_RE.test(valor.trim());
}

/**
 * Deja el correo como se guarda y como se busca: sin espacios y en minúsculas.
 * Es la misma normalización que hace el login con lo que se teclea, y tienen que
 * seguir siendo la misma o un correo guardado con mayúsculas dejaría de entrar.
 */
export function normalizarCorreo(valor) {
  return String(valor ?? "").trim().toLowerCase();
}

/**
 * ¿Vale este correo para una cuenta? Devuelve la frase del problema, o `null`
 * si está bien. Es lo que contestan las tres puertas de alta, tal cual.
 *
 * Obligatorio a propósito (Jorge, 26/08/2026): sin correo la cuenta no puede
 * recuperar su contraseña, y quien se queda fuera no tiene forma de volver a
 * entrar salvo que alguien con SSH esté delante de un ordenador.
 */
export function revisarCorreoCuenta(valor) {
  const correo = normalizarCorreo(valor);
  if (!correo) return "Escribe el correo de esta cuenta: es a donde se le manda el enlace si pierde la contraseña.";
  if (correo.length > MAX_LARGO) return "El correo es demasiado largo.";
  if (!esCorreo(correo)) return "Ese correo no tiene forma de correo (algo@dominio.com).";
  return null;
}

/**
 * A dónde se le escribe a esta cuenta, o `null` si no hay a dónde.
 *
 * Acepta tanto una fila de Sequelize como un objeto pelado, para que las
 * pruebas no necesiten base de datos.
 */
export function correoDeCuenta(usuario) {
  if (!usuario) return null;
  const contacto = normalizarCorreo(usuario.emailContacto);
  if (esCorreo(contacto)) return contacto;
  const identificador = normalizarCorreo(usuario.email);
  return esCorreo(identificador) ? identificador : null;
}

/**
 * Los dos identificadores con los que se puede entrar en esta cuenta. Sirve para
 * enseñarlos y para que las pruebas comprueben que no se solapan.
 */
export function identificadoresDe(usuario) {
  if (!usuario) return [];
  const email = normalizarCorreo(usuario.email);
  const contacto = normalizarCorreo(usuario.emailContacto);
  const fuera = [email];
  if (contacto && contacto !== email) fuera.push(contacto);
  return fuera.filter(Boolean);
}

/**
 * De las cuentas que ha traído `whereDelLogin`, cuál es LA cuenta.
 *
 * En condiciones normales viene una sola. Puede venir más de una si alguna vez
 * se coló un correo repetido —el índice único y `correoLibre` están para que no
 * pase, pero esto es el último cinturón—: entonces gana la que tiene ese texto
 * como IDENTIFICADOR. Así un `emailContacto` mal metido nunca puede llevarse por
 * delante el login de otra persona.
 */
export function elegirCuenta(usuarios, identificador) {
  const lista = Array.isArray(usuarios) ? usuarios.filter(Boolean) : [];
  if (lista.length <= 1) return lista[0] ?? null;
  const id = normalizarCorreo(identificador);
  return lista.find((u) => normalizarCorreo(u.email) === id) ?? lista[0];
}

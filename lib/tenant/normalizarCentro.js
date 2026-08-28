/**
 * lib/tenant/normalizarCentro.js — lo que se GUARDA en `settings.centro`.
 *
 * (Fichero nuevo en /lib, regla #2. El motivo: la ruta que guarda los ajustes
 * no se puede probar —pide sesión, tenant y base de datos— y justo lo que hay
 * que fijar aquí es qué se recorta, qué se tira y qué ni siquiera entra. Una
 * función pura en /lib sí tiene prueba: `scripts/_smoke-datos-centro.mjs`.)
 *
 * ── QUÉ ES `settings.centro` (28/08/2026) ───────────────────────────────────
 * Los datos del CENTRO que salen impresos en el informe clínico: el que la
 * familia presenta en el colegio o para la beca del Ministerio. Hasta hoy el
 * CRM no los guardaba en ninguna parte, así que el PDF no podía imprimirlos.
 *
 *   { razonSocial, cif, telefonos: [], proteccionDatos, sedes: [ … ] }
 *
 * Cada sede: `{ nombre, direccion, cp, ciudad, registroSanitario, telefono }`.
 * El nº de Registro Sanitario es POR SEDE, no del centro: un centro con dos
 * locales tiene dos números distintos y el informe imprime el de la sede donde
 * se atendió.
 *
 * ── POR QUÉ AQUÍ Y NO EN FACTURACIÓN ────────────────────────────────────────
 * La razón social y el CIF ya existen en `TenantBillingSettings`, y aun así se
 * vuelven a pedir aquí a propósito. Colgar de allí el informe clínico ataría un
 * documento sanitario al módulo `billing`:
 *
 *   · la tarjeta se esconde sola en quien no tiene Facturación (su GET responde
 *     403), o sea que el centro no podría ni rellenarla;
 *   · el alta de un cliente no siembra esa fila, así que el dato no existe
 *     hasta que alguien entra en Facturación;
 *   · `PUT /api/billing/settings` no comprueba rol ni deja rastro: las 13
 *     personas con rol `user` de Aumenta podrían reescribir el CIF de un
 *     documento sanitario sin que quedara una línea en ningún sitio.
 *
 * Y la regla #14 de CLAUDE.md: la Configuración es UNIVERSAL. Estos datos los
 * quiere cualquiera que imprima un documento con membrete, tenga o no módulos.
 *
 * ── REGLA DE ORO: TODO ES OPCIONAL ──────────────────────────────────────────
 * Hoy en producción falta TODO (el `settings` de aumenta solo tiene `brand`).
 * El informe se genera igual, sin la línea que falte. Por eso aquí no se
 * inventa nada: un campo vacío se queda en `""`, una sede sin un solo dato se
 * TIRA, y nunca se rellena con un «—» ni con un valor por defecto. Lo que no
 * está, no se imprime.
 */

/**
 * Los topes. Están aquí y no en el JSX ni en la ruta para que el `maxLength`
 * de la pantalla y el recorte del servidor no puedan discrepar: la pantalla
 * frena, el servidor decide.
 */
export const LIMITES = Object.freeze({
  razonSocial: 200,
  cif: 24,
  proteccionDatos: 2000,
  telefono: 32,
  telefonos: 6,
  sedes: 6,
  nombre: 120,
  direccion: 200,
  cp: 12,
  ciudad: 120,
  registroSanitario: 60,
});

/** Los campos de una sede, EN EL ORDEN en que se guardan. */
const CAMPOS_SEDE = Object.freeze([
  ["nombre", LIMITES.nombre],
  ["direccion", LIMITES.direccion],
  ["cp", LIMITES.cp],
  ["ciudad", LIMITES.ciudad],
  ["registroSanitario", LIMITES.registroSanitario],
  ["telefono", LIMITES.telefono],
]);

/**
 * Un texto que llega del formulario, listo para guardar.
 *
 * Lo que NO es un string se convierte en vacío, no se pasa por `String()`: un
 * número, un objeto o un `true` colados en el JSON acabarían impresos en la
 * portada de un informe como «[object Object]». Un dato que no es texto no es
 * un dato.
 *
 * El segundo `trim()` es por el recorte: cortar a 200 puede dejar un espacio
 * suelto al final.
 */
function texto(valor, tope) {
  if (typeof valor !== "string") return "";
  return valor.trim().slice(0, tope).trim();
}

/**
 * Una sede limpia, o `null` si no tiene ni un dato.
 *
 * Devolver `null` en vez de la fila vacía es lo que permite que la pantalla
 * tenga siempre una fila en blanco para escribir sin que eso ensucie el JSON
 * guardado (ni el informe, que imprimiría un renglón hueco).
 */
export function normalizarSede(bruta) {
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return null;
  const sede = {};
  for (const [campo, tope] of CAMPOS_SEDE) sede[campo] = texto(bruta[campo], tope);
  return CAMPOS_SEDE.some(([campo]) => sede[campo] !== "") ? sede : null;
}

/**
 * Lo que llega del formulario → lo que se guarda en `settings.centro`.
 *
 * Devuelve SIEMPRE la forma entera (las cinco claves), venga lo que venga:
 * `null`, `undefined`, un string, una lista. Así ni la pantalla ni el generador
 * del PDF tienen que preguntar si existe cada trozo, y volver a pasar por aquí
 * lo ya guardado no lo cambia (es idempotente).
 */
export function normalizarCentro(bruto) {
  const c = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};

  // El primero es el principal, así que el orden que teclearon se respeta: no
  // se ordena ni se deduplica, solo se quita lo vacío y lo que no es texto.
  const telefonos = (Array.isArray(c.telefonos) ? c.telefonos : [])
    .map((t) => texto(t, LIMITES.telefono))
    .filter((t) => t !== "")
    .slice(0, LIMITES.telefonos);

  const sedes = (Array.isArray(c.sedes) ? c.sedes : [])
    .map(normalizarSede)
    .filter((s) => s !== null)
    .slice(0, LIMITES.sedes);

  return {
    razonSocial: texto(c.razonSocial, LIMITES.razonSocial),
    cif: texto(c.cif, LIMITES.cif),
    telefonos,
    proteccionDatos: texto(c.proteccionDatos, LIMITES.proteccionDatos),
    sedes,
  };
}

/**
 * ¿No queda nada? Entonces la ruta BORRA `settings.centro` en vez de guardar un
 * objeto con cinco huecos: un `centro` presente y vacío haría creer al lector
 * del PDF que el centro tiene datos puestos y todos en blanco.
 *
 * Acepta lo crudo o lo ya normalizado: normaliza por dentro.
 */
export function centroVacio(centro) {
  const c = normalizarCentro(centro);
  return (
    c.razonSocial === "" &&
    c.cif === "" &&
    c.proteccionDatos === "" &&
    c.telefonos.length === 0 &&
    c.sedes.length === 0
  );
}

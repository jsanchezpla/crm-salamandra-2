/**
 * lib/clinica/rotuloContactoExterno.js — cómo se lee un contacto de la agenda
 * del paciente cuando no tiene nombre (18/09/2026).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * AV-0102 (Silvia, Aumenta): «en el apartado coordinaciones, donde pone
 * "contactos", me pone cosas sin sentido». Al mirarlo salieron 311 contactos
 * mal formados del volcado de Organízate, y de ellos **104 no tienen nombre
 * ninguno**. Pero ninguno de esos 104 está vacío de verdad: todos llevan su
 * PAPEL («PT», «Tutora», «Padre») y la mitad además su CENTRO («IES África»).
 *
 * El dato estaba bien; lo que fallaba era la pantalla, que pintaba
 * `{c.name} · {c.role}` a pelo. Sin nombre, la línea empezaba por un punto
 * medio suelto —« · Tutora»— o se quedaba en blanco, y un contacto que en
 * realidad dice «la PT del IES África» parecía un registro roto.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * Se enseña lo más concreto que se sepa, en este orden: el nombre, y si no lo
 * hay, el papel; y si tampoco, el centro. Lo que ya se haya usado como título
 * no se repite debajo. Y cuando no se sabe nada, se dice en voz alta
 * («Contacto sin nombre») en vez de dejar un hueco que parece un fallo.
 *
 * Vive en `lib/` y no dentro del JSX porque lo necesitan la ficha del paciente
 * y el acta de coordinación, y dos copias de la misma regla acaban enseñando
 * cosas distintas — que es exactamente lo que pasó con la tarjeta del acta
 * (`817dc1cb`, el mismo aviso).
 */

const texto = (v) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s || null;
};

/** Lo que se dice de alguien que no dejó ni nombre, ni papel, ni centro. */
export const SIN_NOMBRE = "Contacto sin nombre";

/**
 * Cómo se pinta un contacto externo: `{ titulo, detalle, anonimo }`.
 *
 * `titulo` es la línea de arriba (nunca vacía), `detalle` lo que va al lado en
 * gris (o `null`), y `anonimo` dice si se está tirando del papel o del centro
 * porque no había nombre — la pantalla lo usa para pintarlo en cursiva y que se
 * note que es un hueco por rellenar, no el nombre de una persona.
 */
export function rotuloDeContactoExterno(contacto) {
  const name = texto(contacto?.name);
  const role = texto(contacto?.role);
  const entity = texto(contacto?.entity);

  if (name) return { titulo: name, detalle: role, anonimo: false };
  if (role) return { titulo: role, detalle: null, anonimo: true };
  if (entity) return { titulo: entity, detalle: null, anonimo: true };
  return { titulo: SIN_NOMBRE, detalle: null, anonimo: true };
}

/**
 * ¿Se puede guardar este contacto? La regla es la del modelo desde el
 * 02/08/2026: **nombre y papel no pueden faltar los dos a la vez**. «Tutora»
 * sin nombre es alguien; un contacto sin nombre y sin papel no es nadie.
 *
 * Hasta hoy los dos endpoints exigían el nombre y punto, con lo que los 104 de
 * arriba no se podían ni corregir: abrir uno para ponerle el teléfono obligaba
 * a inventarle un nombre. Devuelve `null` si vale, o la frase del error.
 */
export function vetoDeContactoExterno({ name, role } = {}) {
  if (texto(name) || texto(role)) return null;
  return "Pon al menos el nombre o el papel (por ejemplo, «Tutora» o «PT»)";
}

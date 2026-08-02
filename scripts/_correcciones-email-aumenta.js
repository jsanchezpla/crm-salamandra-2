/**
 * Correos mal tecleados en Organízate, corregidos A MANO por Rodrigo (02/08/2026).
 *
 * El importador NO adivina correos: descarta el que no valida y lo lista al
 * final. De los cinco que salieron, tres se pudieron corregir preguntando; los
 * otros dos eran literalmente «no facilitado» y se resuelven por teléfono.
 *
 * Viven en un módulo aparte, y no como un UPDATE suelto en la base de datos,
 * porque los usan DOS sitios y no pueden divergir:
 *   · `import-aumenta.js`            → para que una importación nueva salga bien
 *   · `corregir-emails-importados.js` → para arreglar lo que ya se importó mal
 *
 * `de` indica a QUIÉN pertenece de verdad la dirección cuando Organízate la
 * guardó en la fila del otro tutor. Importa: el portal identifica al tutor por
 * su correo, así que dejarla en la persona equivocada haría que la madre
 * entrase al portal como el padre, y le atribuyera a él su firma del contrato.
 *
 * La clave es el texto EXACTO tal como está en Organízate, espacios incluidos.
 */
export const CORRECCIONES_EMAIL = {
  // Dominio pegado dos veces. Una sola lectura posible.
  "veronikagavrylyuk731@gmail.com@gmail.com": { email: "veronikagavrylyuk731@gmail.com" },

  // Un espacio detrás de la arroba. Una sola lectura posible.
  "yasin1104198988@ gmail.com": { email: "yasin1104198988@gmail.com" },

  // Espacio en medio: podía ser nada o un punto. Rodrigo lo confirmó: sin punto.
  // En Organízate estaba en la ficha del padre, pero la dirección es de la madre
  // —que además es la pagadora, y por tanto la titular de la ficha—.
  "silvia cascogarcia@gmail.com": { email: "silviacascogarcia@gmail.com", de: "Silvia Casco García" },
};

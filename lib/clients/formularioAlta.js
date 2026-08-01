/**
 * lib/clients/formularioAlta.js — qué se pregunta al dar de alta un cliente.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten la pantalla de Clientes y el
 * endpoint que crea el alta. Si la lista de campos viviera solo en el JSX, el
 * servidor no sabría qué guardar y acabaríamos con campos que se escriben en
 * pantalla y se pierden al llegar.)
 *
 * ── POR QUÉ HAY PERFILES ────────────────────────────────────────────────────
 * El formulario era uno solo y estaba escrito para Spain Enzymes: preguntaba
 * «Tema de interés» y «Producto de interés» con ejemplos de enzimas para
 * panadería. En el mostrador de un centro clínico eso no se pregunta nunca, y
 * en cambio faltaba el código postal, que se pregunta siempre.
 *
 * Así que el formulario se adapta a lo que el cliente tiene contratado:
 *   SALUD     (pacientes | clinica | nutricion) → sin campos comerciales.
 *   COMERCIAL (el resto)                        → como estaba, más el CP.
 *
 * Se decide por MÓDULOS y no por slug de tenant a propósito: un centro nuevo
 * que compre el paquete Clínica tiene que salir bien de fábrica, sin que nadie
 * se acuerde de añadirlo a una lista.
 */

export const PERFIL_SALUD = "salud";
export const PERFIL_COMERCIAL = "comercial";

/** `tieneModulo` es `hasModule` del contexto (servidor) o un Set.has (cliente). */
export function perfilDeAlta(tieneModulo) {
  const tiene = (k) => !!tieneModulo(k);
  return tiene("pacientes") || tiene("clinica") || tiene("nutricion") ? PERFIL_SALUD : PERFIL_COMERCIAL;
}

/**
 * Campos del cliente, en el orden en que se preguntan en el mostrador.
 * `key` es la clave que viaja en el JSON; el endpoint sabe cuáles son columnas
 * y cuáles van a `customFields`.
 */
export function camposCliente(perfil) {
  const salud = perfil === PERFIL_SALUD;
  return [
    { label: "Nombre *", key: "name", type: "text", placeholder: salud ? "Ana Ruiz Pérez" : "María García" },
    ...(salud ? [] : [{ label: "Empresa", key: "company", type: "text", placeholder: "Acme Foods S.L." }]),
    { label: "Email", key: "email", type: "email", placeholder: salud ? "ana.ruiz@email.com" : "maria@acme.com" },
    { label: "Teléfono", key: "phone", type: "tel", placeholder: "+34 612 345 678" },
    { label: "Dirección", key: "address", type: "text", placeholder: "Calle Mayor 12, 3º B" },
    { label: "Código postal", key: "postalCode", type: "text", placeholder: "28013" },
    { label: "Ciudad", key: "city", type: "text", placeholder: "Madrid" },
    { label: "País", key: "country", type: "text", placeholder: "España" },
    ...(salud
      ? []
      : [
          { label: "Tema de interés", key: "topic", type: "text", placeholder: "Enzimas industriales para panadería" },
          { label: "Producto de interés", key: "interestedProduct", type: "text", placeholder: "Amilasa SE-200" },
        ]),
  ];
}

/**
 * Un cliente de un centro de salud es una FAMILIA, no una empresa. El alta
 * manual creaba `company` siempre, mientras que la lista de espera y los
 * formularios web creaban `individual`: la misma familia quedaba de un tipo o
 * de otro según por dónde hubiera entrado.
 */
export function tipoPorDefecto(perfil) {
  return perfil === PERFIL_SALUD ? "individual" : "company";
}

/** Parentesco con quien paga. Texto libre por debajo, esto es solo la ayuda. */
export const PARENTESCOS = ["Hijo/a", "El propio cliente", "Tutor legal", "Cónyuge", "Hermano/a", "Otro"];

export const PARENTESCO_ES_EL_CLIENTE = "El propio cliente";

/** Campos de cada paciente en el alta. Los clínicos se completan en su ficha. */
export const CAMPOS_PACIENTE = [
  { label: "Nombre *", key: "firstName", type: "text", placeholder: "Lucía" },
  { label: "Apellidos *", key: "lastName", type: "text", placeholder: "Ruiz Pérez" },
  { label: "Fecha de nacimiento", key: "birthDate", type: "date" },
  { label: "Centro educativo", key: "educationCenter", type: "text", placeholder: "CEIP Miguel Hernández" },
  { label: "Curso", key: "educationLevel", type: "text", placeholder: "3º de Primaria" },
];

/** Edad a partir de la fecha de nacimiento, en años cumplidos. */
export function edadDesde(birthDate) {
  if (!birthDate) return null;
  const nac = new Date(`${String(birthDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(nac.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad >= 0 && edad <= 120 ? edad : null;
}

const limpio = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Valida y normaliza los pacientes que llegan del alta. Devuelve
 * `{ pacientes }` o `{ error }` con un mensaje para el mostrador.
 *
 * Se descartan en silencio las filas COMPLETAMENTE vacías: quien pulsa «añadir
 * otro paciente» y se arrepiente no debería tener que buscar la papelera.
 */
export function normalizarPacientes(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return { pacientes: [] };
  if (lista.length > 20) return { error: "Demasiados pacientes en un solo alta (máximo 20)" };

  const pacientes = [];
  for (const [i, p] of lista.entries()) {
    if (!p || typeof p !== "object") continue;
    const firstName = limpio(p.firstName, 120);
    const lastName = limpio(p.lastName, 120);
    const resto = [p.birthDate, p.educationCenter, p.educationLevel, p.relationship].some(
      (v) => limpio(v, 300)
    );
    if (!firstName && !lastName && !resto) continue;
    if (!firstName || !lastName) {
      return { error: `Al paciente ${i + 1} le falta el nombre o los apellidos` };
    }

    const birthDate = limpio(p.birthDate, 10);
    pacientes.push({
      firstName,
      lastName,
      birthDate,
      // La edad se DERIVA de la fecha: guardar las dos a mano es garantizar que
      // dentro de un año una de ellas mienta.
      age: edadDesde(birthDate),
      educationCenter: limpio(p.educationCenter, 200),
      educationLevel: limpio(p.educationLevel, 80),
      relationship: limpio(p.relationship, 60),
    });
  }
  return { pacientes };
}

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
 * panadería, y no preguntaba el código postal, que se pregunta siempre.
 *
 * Esos dos campos se han QUITADO de todos los formularios (01/08/2026, decisión
 * de Rodrigo): no había un solo cliente con ellos rellenos en producción, y
 * para lo que hiciera falta ya están las notas internas de la ficha. El código
 * postal, al revés, entra en todos.
 *
 * Lo que sigue dependiendo del perfil es más pequeño de lo que era, pero
 * importa: una empresa tiene razón social y una familia no.
 *   SALUD     (pacientes | clinica | nutricion) → sin Empresa, tipo `individual`.
 *   COMERCIAL (el resto)                        → con Empresa, tipo `company`.
 *
 * Se decide por MÓDULOS y no por slug de tenant a propósito: un centro nuevo
 * que compre el paquete Clínica tiene que salir bien de fábrica, sin que nadie
 * se acuerde de añadirlo a una lista.
 */

export const PERFIL_SALUD = "salud";
export const PERFIL_COMERCIAL = "comercial";

// ⚠️ NADA de un campo «Dirección» de texto atado a `Client.address`: esa columna
// es JSONB, no una cadena. Al pintarla como texto en la ficha, el `{}` por
// defecto se colaba como hijo de React y tumbaba la pantalla entera. Si algún
// día se pide la dirección estructurada, hay que tratarla como el objeto que es.
//
// El «Domicilio» que se añadió el 04/08/2026 NO es esa columna: es una línea de
// texto en `customFields.domicilio`, al lado del código postal y la ciudad, que
// ya viven ahí por la misma razón. Es lo que pide el contrato («Domicilio:
// ____»), una línea tal cual la escribe la paciente.

/** `tieneModulo` es `hasModule` del contexto (servidor) o un Set.has (cliente). */
export function perfilDeAlta(tieneModulo) {
  const tiene = (k) => !!tieneModulo(k);
  return tiene("pacientes") || tiene("clinica") || tiene("nutricion") ? PERFIL_SALUD : PERFIL_COMERCIAL;
}

/**
 * Qué es el titular de la ficha respecto del paciente (08/08/2026, petición
 * del Centro Aumenta). En un centro infantil el titular es normalmente uno de
 * los progenitores: preguntarlo aquí es lo que convierte «Ana Ruiz» en «la
 * madre de Lucía» sin teclear a la misma persona dos veces.
 *
 * Las cuatro primeras son las mismas relaciones que guarda `Client.guardians`
 * (ver lib/clients/guardians.js) para que digan lo mismo en los dos sitios.
 */
export const PARENTESCOS_TITULAR = [
  // Vacío el PRIMERO y por defecto: dejarlo sin decir tiene que ser lo que pasa
  // si nadie toca el desplegable. Si el primero fuera «Madre», cada ficha en la
  // que recepción no se fije afirmaría algo que nadie ha dicho.
  { valor: "", label: "Sin especificar" },
  { valor: "madre", label: "Madre" },
  { valor: "padre", label: "Padre" },
  { valor: "tutor", label: "Tutor/a legal" },
  { valor: "otro", label: "Otro (abuela, hermano…)" },
];

/**
 * Campos del cliente, en el orden en que se preguntan en el mostrador.
 * `key` es la clave que viaja en el JSON; el endpoint sabe cuáles son columnas
 * y cuáles van a `customFields`.
 *
 * `conPacientes` = el cliente tiene el módulo `pacientes`, o sea que el titular
 * de la ficha y el paciente son personas DISTINTAS (una familia y sus hijos).
 * Se pasa como opción y no se deduce del perfil porque el perfil `salud` cubre
 * también la consulta donde el paciente ES el cliente (nutrición), y allí
 * preguntar «¿qué eres del paciente?» no significa nada.
 */
export function camposCliente(perfil, { conPacientes = false } = {}) {
  const salud = perfil === PERFIL_SALUD;
  return [
    { label: "Nombre *", key: "name", type: "text", placeholder: salud ? "Ana Ruiz Pérez" : "María García" },
    ...(salud ? [] : [{ label: "Empresa", key: "company", type: "text", placeholder: "Acme Foods S.L." }]),
    // Quién es esta persona para el paciente. Con esto, el titular ya cuenta
    // como el primer progenitor (su nombre, su DNI y su teléfono son los de la
    // ficha) y solo hace falta teclear al segundo.
    ...(conPacientes
      ? [{
          label: "Parentesco con el paciente",
          key: "parentescoTitular",
          type: "select",
          opciones: PARENTESCOS_TITULAR,
          ayuda: "Con esto, esta persona ya queda registrada como progenitor o tutor.",
        }]
      : []),
    // DNI/NIE y fecha de nacimiento solo en salud (04/08/2026): son lo que pide
    // el contrato que se firma en el área privada, y lo que decide si hace falta
    // el consentimiento del tutor legal. A un cliente comercial no le hacen
    // falta —para facturar ya está el CIF de los datos fiscales—.
    ...(salud
      ? [
          { label: "DNI / NIE", key: "taxId", type: "text", placeholder: "12345678Z" },
          { label: "Fecha de nacimiento", key: "birthDate", type: "date" },
        ]
      : []),
    { label: "Email", key: "email", type: "email", placeholder: salud ? "ana.ruiz@email.com" : "maria@acme.com" },
    { label: "Teléfono", key: "phone", type: "tel", placeholder: "+34 612 345 678" },
    ...(salud
      ? [{ label: "Domicilio", key: "domicilio", type: "text", placeholder: "C/ Mallorca 210, 3º 2ª" }]
      : []),
    { label: "Código postal", key: "postalCode", type: "text", placeholder: "28013" },
    { label: "Ciudad", key: "city", type: "text", placeholder: "Madrid" },
    { label: "País", key: "country", type: "text", placeholder: "España" },
    /*
     * Motivo de consulta (08/08/2026, petición del centro: «generalmente lo
     * dicen al solicitar info»).
     *
     * A nivel de FICHA y no solo por paciente, aunque haya módulo `pacientes`:
     * quien llama pidiendo información cuenta el motivo ANTES de que haya
     * ninguna ficha de paciente abierta —a veces antes de decir el nombre del
     * peque—, y si el único hueco donde escribirlo estuviera dentro del bloque
     * del paciente, en la llamada típica no habría dónde ponerlo. Cada paciente
     * tiene además el suyo (`referralReason`), para los hermanos.
     */
    ...(salud
      ? [{
          label: "Motivo de consulta",
          key: "motivo",
          type: "textarea",
          placeholder: "Lo que nos cuenta por teléfono: qué le preocupa, quién le ha derivado…",
        }]
      : []),
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
  // El motivo de ESTE paciente, cuando hay varios hermanos y no es el mismo.
  // El de la familia va en la ficha; este lo refina.
  {
    label: "Motivo de consulta",
    key: "referralReason",
    type: "textarea",
    placeholder: "Si hay varios hermanos y el motivo no es el mismo",
  },
];

/**
 * El OTRO progenitor o tutor (08/08/2026, petición del Centro Aumenta: «nombre
 * y apellidos, DNI y teléfono de ambos progenitores»).
 *
 * ⚠️ Solo el OTRO. El primero es el titular de la ficha: su nombre, su DNI, su
 * teléfono y su correo son los del cliente, y lo que le faltaba era decir QUÉ
 * es del paciente — eso lo resuelve `parentescoTitular`. Pedir aquí también al
 * primero significaría teclear a la misma persona dos veces en dos sitios que
 * después no se hablan: corregir el teléfono en la ficha no tocaría el del
 * tutor, y acabarían divergiendo.
 */
export const CAMPOS_PROGENITOR = [
  { label: "Nombre y apellidos", key: "name", type: "text", placeholder: "Javier Pérez Ruiz" },
  { label: "DNI / NIE", key: "dni", type: "text", placeholder: "12345678Z" },
  { label: "Teléfono", key: "phone", type: "tel", placeholder: "+34 612 345 678" },
  {
    label: "Email",
    key: "email",
    type: "email",
    placeholder: "javier@email.com",
    ayuda: "Ojo: este correo le da acceso al área privada de la familia.",
  },
];

/** Tope de tutores por ficha. El mismo que aplica el endpoint de la ficha. */
export const MAX_PROGENITORES = 6;

const RE_EMAIL_SIMPLE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Valida y normaliza los progenitores/tutores que llegan del alta. Devuelve
 * `{ progenitores }` o `{ error }` con un mensaje para el mostrador.
 *
 * ⚠️ Esto NO delega la validación en `normalizeGuardians` (lib/clients/guardians.js)
 * aunque la forma final sea la suya. Ese helper DESCARTA EN SILENCIO toda
 * entrada sin nombre, que es razonable cuando se edita la lista desde la ficha
 * —con la lista delante— pero no en un alta: alguien que teclea el DNI y el
 * teléfono del padre y se deja el nombre vería «cliente creado» y el padre no
 * estaría. Aquí se avisa, igual que hace `normalizarPacientes`.
 *
 * `signer: false` SIEMPRE, y es deliberado: en cuanto un tutor está marcado
 * como firmante, el contrato del área privada deja de firmarlo el titular y
 * pasa a exigir la firma de TODOS los tutores marcados
 * (lib/clients/clientContract.js). Dar de alta a una familia no puede cambiar
 * quién firma su contrato sin que nadie lo haya decidido; eso se marca a mano
 * en la ficha, que es donde se ve el efecto.
 */
export function normalizarProgenitores(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return { progenitores: [] };
  if (lista.length > MAX_PROGENITORES) {
    return { error: `Demasiados progenitores o tutores (máximo ${MAX_PROGENITORES})` };
  }

  const progenitores = [];
  const correosVistos = new Set();

  for (const [i, g] of lista.entries()) {
    if (!g || typeof g !== "object") continue;
    const name = limpio(g.name, 200);
    const dni = limpio(g.dni, 20);
    const phone = limpio(g.phone, 50);
    const email = limpio(g.email, 255)?.toLowerCase() ?? null;

    // Fila entera en blanco: quien pulsa «añadir» y se arrepiente no debería
    // tener que buscar la papelera.
    if (!name && !dni && !phone && !email) continue;

    if (!name) {
      return { error: `Al progenitor ${i + 1} le falta el nombre y los apellidos` };
    }
    if (email && !RE_EMAIL_SIMPLE.test(email)) {
      return { error: `El email de ${name} no tiene un formato válido` };
    }
    if (email && correosVistos.has(email)) {
      // La misma regla que el endpoint de tutores de la ficha: el correo es la
      // llave del portal y dos personas no pueden compartir llave.
      return { error: `Hay dos progenitores con el mismo correo (${email}). Cada uno necesita el suyo para entrar al área privada.` };
    }
    if (email) correosVistos.add(email);

    const relacion = GUARDIAN_RELATIONSHIPS_ALTA.includes(g.relationship) ? g.relationship : "tutor";
    progenitores.push({ name, relationship: relacion, dni, phone, email, signer: false });
  }

  return { progenitores };
}

/** Las mismas relaciones que acepta `Client.guardians`, sin importar el módulo. */
const GUARDIAN_RELATIONSHIPS_ALTA = ["madre", "padre", "tutor", "otro"];

/**
 * Normaliza una fecha `YYYY-MM-DD` para una columna DATEONLY.
 *
 * Devuelve `null` ante cualquier cosa que no sea una fecha válida: un
 * `""` que llegue del formulario reventaría el INSERT, y una fecha inventada
 * («2026-02-31») entraría corrida sin que nadie se entere.
 */
export function fechaONull(valor) {
  const s = typeof valor === "string" ? valor.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // `new Date` corrige en silencio los días que no existen. Si al volver a
  // formatear no sale lo mismo, es que la fecha no era real.
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * Parte "Ana Ruiz Pérez" en nombre + apellidos. Recepción lo corrige si falla.
 *
 * Vivía dentro de PacientesDelAlta.jsx. Sube aquí (regla #2) porque desde el
 * 08/08/2026 la misma decisión la toman DOS sitios: la pantalla, al marcar «el
 * paciente es el propio cliente», y el servidor, al convertir en paciente el
 * nombre del peque que escribió la familia en el formulario de la web.
 * Duplicada, es cuestión de tiempo que una diverja de la otra y que la misma
 * niña salga como «Lucía Ruiz» en un sitio y «Lucía» en otro.
 */
export function partirNombre(completo) {
  const trozos = String(completo || "").trim().split(/\s+/).filter(Boolean);
  if (trozos.length === 0) return { firstName: "", lastName: "" };
  return { firstName: trozos[0], lastName: trozos.slice(1).join(" ") };
}

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
    const resto = [p.birthDate, p.educationCenter, p.educationLevel, p.relationship, p.referralReason].some(
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
      // ⚠️ Sin esta línea el motivo se teclea, se manda y no se guarda: el
      // endpoint crea el paciente con EXACTAMENTE lo que devuelve este push.
      referralReason: limpio(p.referralReason, 5000),
    });
  }
  return { pacientes };
}

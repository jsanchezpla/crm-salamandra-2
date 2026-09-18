/**
 * Padres/tutores estructurados del cliente (sprint Aumenta 2026-07-28).
 *
 * Viven en `Client.guardians` (JSONB): ambos progenitores SIEMPRE dentro del
 * mismo cliente (misma familia con un paciente común), también con padres
 * separados — decisión de la reunión del 28/07. Cada entrada lleva un `id`
 * estable que usan las firmas del contrato (ContractSignature.guardianId).
 *
 * Forma: { id, name, relationship, dni, phone, email, signer }
 *   - relationship ∈ madre | padre | tutor | otro
 *   - signer: debe firmar el Contrato del Centro en el portal.
 */

import { randomUUID } from "crypto";

export const GUARDIAN_RELATIONSHIPS = ["madre", "padre", "tutor", "otro"];
export const GUARDIAN_RELATIONSHIP_LABEL = {
  madre: "Madre",
  padre: "Padre",
  tutor: "Tutor/a legal",
  otro: "Otro",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanStr(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// Normaliza el array que llega del formulario. Conserva los `id` existentes
// (las firmas apuntan a ellos) y genera uno para las entradas nuevas.
export function normalizeGuardians(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((g) => g && typeof g === "object")
    .map((g) => ({
      id: UUID_RE.test(String(g.id ?? "")) ? String(g.id).toLowerCase() : randomUUID(),
      name: cleanStr(g.name) ?? "",
      relationship: GUARDIAN_RELATIONSHIPS.includes(g.relationship) ? g.relationship : "tutor",
      dni: cleanStr(g.dni, 20),
      phone: cleanStr(g.phone, 50),
      email: cleanStr(g.email, 255),
      signer: g.signer !== false, // por defecto todo tutor firma
    }))
    .filter((g) => g.name);
}

/**
 * Los tutores como los ve la FICHA DEL PACIENTE (02/09/2026, AV-0023 y AV-0024
 * de Aumenta): nombre, parentesco, teléfono y correo, y nada más.
 *
 * Nace de una queja real: en Organízate cada paciente tenía su apartado de
 * tutores y en el CRM «solo aparece un cliente por paciente y desaparecen el
 * resto de datos». Los datos estaban (1.846 tutores en 813 familias con dos o
 * más), pero solo se enseñaban en la ficha de la familia, a la que las
 * terapeutas no entran. Esta función es lo que viaja a quien mira un paciente:
 *
 *   · sin `dni`: quien llama a una familia necesita el teléfono, no el DNI, y
 *     el listado de pacientes ya se molestaba en no mandarlo al navegador;
 *   · sin `signer`: quién firma el contrato es cosa de la ficha de la familia;
 *   · con `relationshipLabel` resuelto aquí, para que la pantalla no tenga su
 *     propia tabla de parentescos que se separe de esta.
 *
 * Una entrada sin nombre no es nadie: se descarta, igual que al normalizar.
 */
export function tutoresParaFicha(guardians) {
  return crudosConNombre(guardians).map(recorteDeTutor);
}

/** Los tutores tal cual están guardados, sin los que no son nadie. */
function crudosConNombre(guardians) {
  if (!Array.isArray(guardians)) return [];
  return guardians.filter((g) => g && typeof g === "object" && cleanStr(g.name));
}

/** El recorte que ve la ficha del paciente. Uno solo, para que no se separen. */
function recorteDeTutor(g) {
  const relationship = GUARDIAN_RELATIONSHIPS.includes(g.relationship) ? g.relationship : "tutor";
  return {
    id: g.id ?? null,
    name: cleanStr(g.name),
    relationship,
    relationshipLabel: GUARDIAN_RELATIONSHIP_LABEL[relationship],
    phone: cleanStr(g.phone, 50),
    email: cleanStr(g.email, 255),
  };
}

const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
const claveNombre = (s) => sinTildes(s).trim().toLowerCase().replace(/\s+/g, " ");
const claveDni = (s) => String(s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * TODOS los padres y tutores de la familia, con el TITULAR de la ficha dentro
 * (18/09/2026, ficha «Datos tutor» de Aumenta).
 *
 * ── POR QUÉ HACÍA FALTA ─────────────────────────────────────────────────────
 * El diseño del 28/07 decía que el titular de la ficha ES el primer progenitor
 * y que por eso no se duplica dentro de `guardians`: su nombre, su DNI y su
 * teléfono ya son los del cliente, y lo único que faltaba —qué es del
 * paciente— se preguntaba aparte, en `customFields.parentescoTitular`.
 *
 * La realidad de producción dice que ese reparto no se sostuvo. En Aumenta,
 * sobre 1.106 familias con pacientes:
 *   · 814 tienen al titular DUPLICADO dentro de `guardians` (lo metió la
 *     importación de Organízate, que no conocía la regla);
 *   · solo 14 tienen `parentescoTitular` puesto — el mecanismo que evitaba el
 *     duplicado no lo usa nadie;
 *   · 104 tienen `guardians` VACÍO, así que su ficha de paciente decía «La
 *     familia no tiene padres ni tutores apuntados» teniendo delante el
 *     nombre, el teléfono y el correo de la madre o del padre.
 *
 * Así que la lista se resuelve AL LEER y no se migra nada: 1.109 fichas reales
 * y una regla que ya falló una vez no se arreglan reescribiendo la columna.
 *
 * El titular abre la lista y va marcado con `titular: true`. Si ya estaba
 * dentro de `guardians` se usa ESA entrada —tiene el parentesco que alguien
 * tecleó y el `id` al que apuntan las firmas del contrato— y no se pinta dos
 * veces. Se reconocen la misma persona por DNI cuando los dos lo tienen, y por
 * nombre (sin tildes ni mayúsculas) cuando no.
 *
 * Sale RECORTADO, igual que `tutoresParaFicha`: sin DNI y sin quién firma. El
 * DNI del titular entra aquí solo para no duplicarlo, y no sale.
 */
export function tutoresDeLaFamilia(client) {
  const crudos = crudosConNombre(client?.guardians);
  const nombreTitular = cleanStr(client?.name);
  if (!nombreTitular) return crudos.map((g) => ({ ...recorteDeTutor(g), titular: false }));

  const dniTitular = claveDni(client?.taxId);
  const nombre = claveNombre(nombreTitular);
  const i = crudos.findIndex((g) => {
    const dni = claveDni(g.dni);
    // Dos DNI puestos y distintos son dos personas, aunque se llamen igual.
    if (dniTitular && dni) return dni === dniTitular;
    return claveNombre(g.name) === nombre;
  });

  if (i >= 0) {
    const lista = crudos.map((g) => ({ ...recorteDeTutor(g), titular: false }));
    const [t] = lista.splice(i, 1);
    return [{ ...t, titular: true }, ...lista];
  }

  // El parentesco del titular solo se afirma si alguien lo dijo: en blanco
  // antes que inventarle «Tutor/a legal» a una madre (misma razón por la que
  // PARENTESCOS_TITULAR abre con «Sin especificar»).
  const rel = client?.customFields?.parentescoTitular;
  const relationship = GUARDIAN_RELATIONSHIPS.includes(rel) ? rel : null;
  return [
    {
      id: null,
      name: nombreTitular,
      relationship,
      relationshipLabel: relationship ? GUARDIAN_RELATIONSHIP_LABEL[relationship] : null,
      phone: cleanStr(client?.phone, 50),
      email: cleanStr(client?.email, 255),
      titular: true,
    },
    ...crudos.map((g) => ({ ...recorteDeTutor(g), titular: false })),
  ];
}

// Tutores que deben firmar el contrato. Si no hay ninguno marcado, no se
// puede exigir firma (el gate del portal lo trata como "sin firmantes").
export function signersOf(guardians) {
  return (Array.isArray(guardians) ? guardians : []).filter((g) => g && g.signer && g.id);
}

// ¿Está el contrato completamente firmado? `signatures` = filas de
// ContractSignature del cliente. Exige la firma de TODOS los firmantes
// (con padres separados serán dos).
export function contractFullySigned(guardians, signatures) {
  const signers = signersOf(guardians);
  if (signers.length === 0) return false;
  const signed = new Set((signatures ?? []).map((s) => String(s.guardianId ?? s.guardian_id).toLowerCase()));
  return signers.every((g) => signed.has(String(g.id).toLowerCase()));
}

/** Tope de tutores por ficha. El mismo que aplica el alta y la ficha de la familia. */
export const MAX_TUTORES = 6;

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Fusiona los tutores que manda la FICHA DEL PACIENTE sobre los que ya están
 * guardados (18/09/2026, ficha «Datos tutor» de Aumenta: «que desde pacientes
 * en la ficha de pacientes se le pueda añadir el tutor/tutores»).
 *
 * ── POR QUÉ FUSIONA Y NO REEMPLAZA ──────────────────────────────────────────
 * El endpoint de la ficha de la FAMILIA hace `normalizeGuardians(body)` y pisa
 * la lista entera, y puede: quien entra ahí tiene el módulo Clientes y está
 * viendo el DNI y las casillas de firma delante. La ficha del paciente la
 * abren las 13 terapeutas de Aumenta, que a propósito NO ven ni el DNI ni
 * quién firma (`tutoresParaFicha`, 02/09/2026). Si lo que mandan reemplazara
 * la lista, cada vez que una terapeuta corrigiera un teléfono borraría los
 * 1.621 DNI de tutores que hay en producción y desharía quién firma el
 * contrato del centro — sin verlo y sin quererlo.
 *
 * Así que de aquí solo entran los CUATRO campos que esa pantalla enseña, y el
 * resto de cada tutor se conserva tal cual estaba:
 *   · `dni` y `signer` se heredan de la entrada que ya existía;
 *   · un tutor nuevo nace con `signer: false` y sin DNI, igual que en el alta
 *     (dar de alta a alguien no puede cambiar quién firma el contrato);
 *   · a un FIRMANTE no se le quita desde aquí: sus firmas apuntan a su `id` y
 *     quitarlo dejaría el contrato de la familia sin poder completarse nunca.
 *     Se dice y se manda a Clientes, que es donde se ve el efecto.
 *
 * `actuales` son los `guardians` tal cual están en la fila; `entrantes`, lo
 * que manda la pantalla: `{ id?, name, relationship, phone, email }`.
 * Devuelve `{ guardians }` o `{ error }` con una frase para la pantalla.
 */
export function fusionarTutoresDeFicha(actuales, entrantes) {
  if (!Array.isArray(entrantes)) return { error: "Se requiere una lista de tutores" };
  if (entrantes.length > MAX_TUTORES) {
    return { error: `Demasiados tutores (máximo ${MAX_TUTORES})` };
  }

  const previos = Array.isArray(actuales) ? actuales : [];
  const porId = new Map(previos.filter((g) => g?.id).map((g) => [String(g.id).toLowerCase(), g]));

  const guardians = [];
  const correosVistos = new Set();
  const conservados = new Set();

  for (const [i, e] of entrantes.entries()) {
    if (!e || typeof e !== "object") continue;
    const name = cleanStr(e.name);
    const phone = cleanStr(e.phone, 50);
    const email = cleanStr(e.email, 255)?.toLowerCase() ?? null;

    // Fila entera en blanco: quien pulsa «añadir» y se arrepiente no debería
    // tener que buscar la papelera. Misma regla que el alta.
    if (!name && !phone && !email) continue;
    if (!name) return { error: `Al tutor ${i + 1} le falta el nombre y los apellidos` };
    if (email && !RE_EMAIL.test(email)) return { error: `El email de ${name} no tiene un formato válido` };
    if (email && correosVistos.has(email)) {
      return {
        error: `Hay dos tutores con el mismo correo (${email}). Cada uno necesita el suyo para entrar al área privada.`,
      };
    }
    if (email) correosVistos.add(email);

    const clave = e.id ? String(e.id).toLowerCase() : null;
    const previo = clave ? porId.get(clave) : null;
    if (previo) conservados.add(clave);

    guardians.push({
      id: previo?.id ?? randomUUID(),
      name,
      relationship: GUARDIAN_RELATIONSHIPS.includes(e.relationship) ? e.relationship : "tutor",
      // Heredados: esta pantalla no los enseña, así que no puede cambiarlos.
      dni: previo?.dni ?? null,
      phone,
      email,
      signer: previo?.signer === true,
    });
  }

  const firmanteQuitado = previos.find(
    (g) => g?.signer === true && g?.id && !conservados.has(String(g.id).toLowerCase())
  );
  if (firmanteQuitado) {
    return {
      error:
        `${firmanteQuitado.name} firma el contrato del centro, así que no se puede quitar desde la ficha del paciente. ` +
        `Se hace en su ficha de la familia, en Clientes.`,
    };
  }

  return { guardians };
}

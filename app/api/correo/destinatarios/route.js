import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { rotuloCategoria } from "../../../../lib/booking/categorias.js";
import { clienteEsPaciente } from "../../../../lib/clients/vocabulario.js";
import { GUARDIAN_RELATIONSHIP_LABEL } from "../../../../lib/clients/guardians.js";
import { SPECIALTY_KEYS } from "../../../../lib/clinica/specialties.js";

/**
 * GET /api/correo/destinatarios?fuente=…&q=…&profesional=…&terapia=…
 *
 * De dónde salen los correos a los que se puede escribir. Devuelve
 * `[{ email, nombre, detalle }]`, ya sin duplicados y sin filas sin correo.
 *
 * ── POR QUÉ HAY VARIAS FUENTES Y NO UNA ────────────────────────────────────
 * Porque en el CRM «un correo» vive en varios sitios que NO son lo mismo y no
 * se deben mezclar por defecto:
 *
 *   contratantes → `clients`: la ficha (el contratante, el cliente, la familia
 *                  con sus pacientes… según el centro). A estos se les escribe
 *                  con nombre y apellidos, y son los que más duele equivocarse.
 *   contactos    → `contacts`: la persona concreta dentro de esa cuenta —el de
 *                  Cultura, el técnico—, que casi nunca es la dirección
 *                  genérica de la ficha.
 *   propuestas   → `leads`: una oportunidad abierta. Se escribe para insistir.
 *
 * (La clave `contratantes` es HISTÓRICA —la pantalla nació para booking el
 * 24/08/2026— y se queda como identificador interno; lo que ve la gente lo
 * rotula la pantalla con `lib/clients/vocabulario.js`. Renombrarla rompería
 * las listas guardadas, que recuerdan de qué fuente salió cada dirección.)
 *
 * ── CENTROS CON PACIENTES (26/08/2026, Rodrigo) ────────────────────────────
 * Donde hay módulo `pacientes`, la ficha es una FAMILIA: su correo y el de
 * cada tutor son destinatarios distintos, y al lado de cada uno se dice de qué
 * paciente(s) es. Además se puede filtrar por profesional (`mainTherapistId`
 * del paciente) y por tipo de terapia (`Patient.specialties`) — así «todas las
 * familias de logopedia» o «las familias de María» salen en dos clics.
 *
 * Quien quiera mandar a varias fuentes a la vez las pide una por una y las
 * junta en la pantalla. Aquí no se juntan solas: una fuente por petición, para
 * que en pantalla siempre se vea de dónde salió cada dirección.
 */

// `captacion` salió el 24/08/2026 (Rodrigo: «elimina Captación del flujo, todo
// lo vamos a hacer con la pestaña de correo»).
const FUENTES = new Set(["contratantes", "contactos", "propuestas"]);
const LIMITE = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filas → destinatarios, sin correos vacíos ni repetidos (gana el primero). */
function aDestinatarios(filas, hacer) {
  const vistos = new Set();
  const salida = [];
  for (const f of filas) {
    const d = hacer(f);
    const email = String(d.email ?? "").trim().toLowerCase();
    if (!email || vistos.has(email)) continue;
    vistos.add(email);
    salida.push({ ...d, email });
    if (salida.length >= LIMITE) break;
  }
  return salida;
}

/** Nombres de pacientes para el `detalle`, acotados: tres y «y N más». */
function nombresPacientes(pacientes) {
  if (!pacientes?.length) return null;
  const nombres = pacientes.map((p) => `${p.firstName} ${p.lastName}`.trim());
  if (nombres.length <= 3) return nombres.join(", ");
  return `${nombres.slice(0, 3).join(", ")} y ${nombres.length - 3} más`;
}

/**
 * La fuente de fichas en un centro CON pacientes: cada familia sale con su
 * correo Y el de cada tutor, y el nombre del paciente al lado. El filtrado y la
 * búsqueda van en JS y no en SQL a propósito: los tutores viven en un JSONB
 * (`clients.guardians`) y los pacientes en su propia tabla, y son unas 1.100
 * filas de cuatro columnas — traerlas y mirar cuesta menos que tres consultas
 * con joins sobre JSON.
 */
async function destinatariosFamilias(ctx, { q, profesional, terapia }) {
  const { Client, Patient } = ctx.tenantModels;

  const wherePacientes = { status: { [Op.ne]: "discharged" } };
  if (profesional) wherePacientes.mainTherapistId = profesional;
  if (terapia) wherePacientes.specialties = { [Op.contains]: [terapia] };

  const pacientes = await Patient.findAll({
    where: wherePacientes,
    attributes: ["id", "firstName", "lastName", "clientId"],
  });
  const porFamilia = new Map();
  for (const p of pacientes) {
    if (!p.clientId) continue;
    if (!porFamilia.has(p.clientId)) porFamilia.set(p.clientId, []);
    porFamilia.get(p.clientId).push(p);
  }

  // Con filtro puesto, solo las familias con algún paciente que lo cumpla. Sin
  // filtro, todas: una ficha sin paciente enlazado sigue siendo alguien con
  // correo al que se le puede escribir.
  const soloEstas = profesional || terapia ? new Set(porFamilia.keys()) : null;

  const clientes = await Client.findAll({
    attributes: ["id", "name", "email", "guardians"],
    order: [["name", "ASC"]],
  });

  const busca = q ? q.toLowerCase() : null;
  const candidatos = [];
  for (const c of clientes) {
    if (soloEstas && !soloEstas.has(c.id)) continue;

    const tutores = (Array.isArray(c.guardians) ? c.guardians : []).filter((g) => g?.email);
    const pacs = porFamilia.get(c.id) ?? [];

    if (busca) {
      const pajar = [
        c.name,
        c.email,
        ...tutores.flatMap((g) => [g.name, g.email]),
        ...pacs.map((p) => `${p.firstName} ${p.lastName}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!pajar.includes(busca)) continue;
    }

    const dePacientes = nombresPacientes(pacs);
    if (c.email) {
      candidatos.push({ email: c.email, nombre: c.name, detalle: dePacientes });
    }
    for (const g of tutores) {
      candidatos.push({
        email: g.email,
        nombre: g.name,
        detalle: [GUARDIAN_RELATIONSHIP_LABEL[g.relationship] ?? "Tutor/a", dePacientes ?? c.name]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }
  return aDestinatarios(candidatos, (d) => d);
}

export const GET = withTenant(async (request, _ctxRuta, ctx) => {
  const sp = new URL(request.url).searchParams;
  const fuente = (sp.get("fuente") || "contratantes").trim();
  if (!FUENTES.has(fuente)) {
    throw new ValidationError(`Fuente desconocida. Vale una de: ${[...FUENTES].join(", ")}`);
  }

  // Cada fuente exige SU módulo. Sin esto, un tenant sin Leads podría leer la
  // lista de propuestas pidiéndola por la URL.
  const MODULO = {
    contratantes: "clients",
    contactos: "clients",
    propuestas: "leads",
  }[fuente];
  if (!ctx.hasModule(MODULO)) throw new ForbiddenError();

  const q = (sp.get("q") || "").trim();
  const like = q ? { [Op.iLike]: `%${q}%` } : null;
  const { Client, Contact, Lead } = ctx.tenantModels;

  // `email: { [Op.ne]: null }` no basta: en estas tablas el correo vacío se
  // guarda a veces como cadena vacía, y una fila sin correo en la lista es una
  // casilla que se puede marcar y no manda nada.
  const conCorreo = { email: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } };
  const buscar = (campos) => (like ? { [Op.or]: campos.map((c) => ({ [c]: like })) } : {});

  if (fuente === "contratantes") {
    // Centro con pacientes: la familia entera — su correo, sus tutores y el
    // nombre de sus pacientes — y los filtros por profesional y terapia.
    if (ctx.hasModule("pacientes")) {
      const profesional = (sp.get("profesional") || "").trim();
      const terapia = (sp.get("terapia") || "").trim();
      if (profesional && !UUID_RE.test(profesional)) throw new ValidationError("Profesional inválido");
      if (terapia && !SPECIALTY_KEYS.includes(terapia)) throw new ValidationError("Tipo de terapia desconocido");
      return ok({
        fuente,
        destinatarios: await destinatariosFamilias(ctx, {
          q,
          profesional: profesional || null,
          terapia: terapia || null,
        }),
      });
    }

    const filas = await Client.findAll({
      where: { ...conCorreo, ...buscar(["name", "email"]) },
      attributes: ["id", "name", "email", "type", "customFields"],
      order: [["name", "ASC"]],
      limit: LIMITE,
    });
    // El `detalle` habla el idioma del centro: con `booking`, la categoría del
    // contratante (ayuntamiento, sala, revista…); donde el cliente ES el
    // paciente (consulta de nutrición), nada — «Particular» al lado de cada
    // paciente no separa nada; en el resto, Empresa/Particular.
    const conBooking = ctx.hasModule("booking");
    const esPaciente = clienteEsPaciente(ctx.hasModule);
    return ok({
      fuente,
      destinatarios: aDestinatarios(filas, (c) => ({
        email: c.email,
        nombre: c.name,
        detalle: conBooking
          ? rotuloCategoria(c.customFields?.categoria) || (c.type === "company" ? "Empresa" : "Particular")
          : esPaciente
            ? null
            : c.type === "company"
              ? "Empresa"
              : "Particular",
      })),
    });
  }

  if (fuente === "contactos") {
    const filas = await Contact.findAll({
      where: { ...conCorreo, ...buscar(["name", "email"]) },
      attributes: ["id", "name", "email", "role", "clientId"],
      // El alias es `client` (lib/db/tenantDb.js): sin él Sequelize no sabe por
      // qué asociación entrar y revienta la consulta entera.
      include: [{ model: Client, as: "client", attributes: ["name"], required: false }],
      order: [["name", "ASC"]],
      limit: LIMITE,
    });
    return ok({
      fuente,
      destinatarios: aDestinatarios(filas, (c) => ({
        email: c.email,
        nombre: c.name,
        // El cargo es lo que distingue al de Cultura del técnico dentro del
        // mismo sitio: sin él, dos filas de la misma cuenta son indistinguibles.
        detalle: [c.role, c.client?.name].filter(Boolean).join(" · ") || null,
      })),
    });
  }

  if (fuente === "propuestas") {
    const filas = await Lead.findAll({
      where: { ...conCorreo, ...buscar(["name", "email", "title"]) },
      attributes: ["id", "name", "email", "title", "stage"],
      order: [["createdAt", "DESC"]],
      limit: LIMITE,
    });
    return ok({
      fuente,
      destinatarios: aDestinatarios(filas, (l) => ({
        email: l.email,
        nombre: l.name,
        detalle: l.title || null,
      })),
    });
  }

  throw new ValidationError("Fuente desconocida");
});

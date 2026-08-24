import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { rotuloCategoria } from "../../../../lib/booking/categorias.js";

/**
 * GET /api/correo/destinatarios?fuente=…&q=…
 *
 * De dónde salen los correos a los que se puede escribir. Devuelve
 * `[{ email, nombre, detalle }]`, ya sin duplicados y sin filas sin correo.
 *
 * ── POR QUÉ HAY VARIAS FUENTES Y NO UNA ────────────────────────────────────
 * Porque en el CRM «un correo» vive en cuatro sitios que NO son lo mismo y no
 * se deben mezclar por defecto (ver la sección «Dónde acaba cada correo» del
 * análisis del 24/08/2026):
 *
 *   contratantes → `clients`: quien ya es alguien. A estos se les escribe con
 *                  nombre y apellidos, y son los que más duele equivocarse.
 *   contactos    → `contacts`: la persona concreta dentro de esa cuenta —el de
 *                  Cultura, el técnico—, que casi nunca es la dirección
 *                  genérica de la ficha.
 *   propuestas   → `leads`: una oportunidad abierta. Se escribe para insistir.
 *   captacion    → `outreach_leads`: quien AÚN NO se ha contactado. Correo en
 *                  frío, y por eso va en su propia fuente: mandar a esta lista
 *                  no es lo mismo que mandar a la de arriba, ni legalmente.
 *
 * Quien quiera mandar a varias a la vez las pide una por una y las junta en la
 * pantalla, que es justo lo que pidió Rodrigo («poder unir la cantidad de
 * correos que quiera»). Aquí no se juntan solas: una fuente por petición, para
 * que en pantalla siempre se vea de dónde salió cada dirección.
 */

// `captacion` salió el 24/08/2026 (Rodrigo: «elimina Captación del flujo, todo
// lo vamos a hacer con la pestaña de correo»). Los 210 contactos que vivían
// allí son ahora fichas de Contratante, así que la fuente sobraba: seguiría
// enseñando una copia vieja de lo mismo.
const FUENTES = new Set(["contratantes", "contactos", "propuestas"]);
const LIMITE = 500;

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
  }
  return salida;
}

export const GET = withTenant(async (request, _ctxRuta, ctx) => {
  const sp = new URL(request.url).searchParams;
  const fuente = (sp.get("fuente") || "contratantes").trim();
  if (!FUENTES.has(fuente)) {
    throw new ValidationError(`Fuente desconocida. Vale una de: ${[...FUENTES].join(", ")}`);
  }

  // Cada fuente exige SU módulo. Sin esto, un tenant sin Captación podría leer
  // la lista de captación pidiéndola por la URL.
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
    const filas = await Client.findAll({
      where: { ...conCorreo, ...buscar(["name", "email"]) },
      attributes: ["id", "name", "email", "type", "customFields"],
      order: [["name", "ASC"]],
      limit: LIMITE,
    });
    return ok({
      fuente,
      destinatarios: aDestinatarios(filas, (c) => ({
        email: c.email,
        nombre: c.name,
        // La CATEGORÍA en vez de «Empresa / Particular» (24/08/2026): en una
        // lista de contratantes todos son empresas, así que decirlo no separa
        // nada. Lo que separa es si es un ayuntamiento o una revista, que es
        // justo lo que decide qué se le escribe.
        detalle: rotuloCategoria(c.customFields?.categoria) || (c.type === "company" ? "Empresa" : "Particular"),
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
        // El rol es lo que distingue al de Cultura del técnico dentro del mismo
        // ayuntamiento: sin él, dos filas del mismo sitio son indistinguibles.
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

import bcrypt from "bcrypt";

import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";
import { esSlugDemo } from "../../../../../../lib/demo/demos.js";
import { normalizeUsername } from "../../../../../../lib/team/access.js";
import { revisarContrasena } from "../../../../../../lib/auth/contrasena.js";
import { revisarCorreoCuenta, normalizarCorreo, correoDeCuenta } from "../../../../../../lib/auth/correoCuenta.js";
import { correoLibre } from "../../../../../../lib/auth/correoCuentaDb.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Las cuentas de ADMINISTRADOR de un cliente, desde el back-office.
 *
 *   GET  → quiénes son hoy (sin secretos): usuario, correo y última entrada.
 *   POST → dar de alta una más { usuario, correo, password }.
 *
 * ── POR QUÉ EXISTE, SIENDO QUE EL CLIENTE YA PUEDE HACERLO (27/08/2026) ────
 * Desde hoy un admin se crea su segunda cuenta de dirección desde Equipo, y esa
 * es la vía normal (Rodrigo: «la dos, y la uno como red»). Esto es la RED, para
 * los dos casos en que aquella no sirve:
 *
 *   · El cliente tiene UN SOLO admin y esa persona no puede entrar. Once
 *     clientes están así; sin esta pantalla, volvemos al SSH del 26/08.
 *   · Un alta que hacemos nosotros al montar el centro, antes de que exista
 *     nadie dentro que pueda darla.
 *
 * ── LO QUE NO HACE, Y ES DELIBERADO ────────────────────────────────────────
 * No lee ni cambia contraseñas de cuentas que ya existen, ni las borra. Poder
 * CREAR una cuenta y poder ENTRAR en la de otro son permisos distintos, y este
 * panel solo tiene el primero — igual que `credencialesCliente.js` escribe
 * claves pero no las lee nunca. Si una directora pierde la suya, la recupera
 * ella por su correo (`lib/auth/recuperacion.js`); si eso tampoco vale, el
 * script de siempre por SSH, mirando lo que se hace.
 *
 * Tres candados, los mismos que el resto del back-office: módulo
 * `provisioning` (que solo tiene nuestro tenant), rol admin leído FRESCO de la
 * base, y nunca desde la demo. Y uno más propio: no se crean admins EN una
 * demo, que son públicas y ya le dan sesión de admin a cualquiera.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

async function clienteDe(slug) {
  const { Tenant } = getMasterModels();
  return Tenant.findOne({ where: { slug } });
}

export const GET = withTenant(async (_request, { params }, ctx) => {
  try {
    const blocked = candado(ctx);
    if (blocked) return blocked;

    const { slug } = await params;
    const cliente = await clienteDe(slug);
    if (!cliente) return notFound("Ese cliente no existe");

    const { User } = getMasterModels();
    const admins = await User.findAll({
      where: { tenantId: cliente.id, role: "admin" },
      attributes: ["id", "email", "emailContacto", "lastLoginAt"],
      order: [["email", "ASC"]],
    });

    return ok({
      slug,
      admins: admins.map((u) => ({
        usuario: u.email,
        // El correo se enseña porque una cuenta sin él no puede recuperarse
        // sola, y eso es exactamente lo que hay que poder ver desde aquí.
        correo: correoDeCuenta(u),
        ultimaEntrada: u.lastLoginAt,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const blocked = candado(ctx);
    if (blocked) return blocked;

    const { slug } = await params;
    if (esSlugDemo(slug)) {
      return forbidden("Las demos son públicas y ya entran como admin: no se les crean cuentas.");
    }

    const cliente = await clienteDe(slug);
    if (!cliente) return notFound("Ese cliente no existe");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const norm = normalizeUsername(body.usuario, slug);
    if (norm.error) return error(norm.error, 422);
    const usuario = norm.username;

    const { User } = getMasterModels();
    if (await User.findOne({ where: { email: usuario }, attributes: ["id"] })) {
      return error(`El usuario «${usuario}» ya existe. Elige otro.`, 409);
    }

    const correo = normalizarCorreo(body.correo);
    const malCorreo = revisarCorreoCuenta(correo);
    if (malCorreo) return error(malCorreo, 422);
    const ocupado = await correoLibre(User, correo);
    if (ocupado) return error(ocupado, 409);

    const password = typeof body.password === "string" ? body.password : "";
    if (!password) return error("Escribe la contraseña con la que va a entrar", 422);
    const mal = revisarContrasena(password, null, { email: usuario, slug });
    if (mal) return error(mal, 422);

    // validate:false y moduleAccess ["all"]: el MISMO patrón con el que nace el
    // administrador en el alta de cliente (lib/provisioning/altaTenant.js). Un
    // admin creado por dos caminos distintos tiene que quedar idéntico.
    const nuevo = await User.create(
      {
        email: usuario,
        emailContacto: correo,
        passwordHash: await bcrypt.hash(password, 12),
        role: "admin",
        tenantId: cliente.id,
        moduleAccess: ["all"],
      },
      { validate: false }
    );

    await auditar({
      ...datosPeticion(request),
      tenantId: cliente.id,
      action: "provisioning.admin_created",
      entity: "User",
      entityId: nuevo.id,
      after: { usuario, correo, slug }, // JAMÁS la contraseña
    });

    // La contraseña no vuelve: quien la ha escrito la tiene delante.
    return created({ usuario, correo, slug });
  } catch (err) {
    return serverError(err);
  }
});

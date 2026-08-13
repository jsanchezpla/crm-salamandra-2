import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { signAccessToken, signRefreshToken, setAuthCookies } from "../../../../lib/auth/jwt.js";
import { enforceRateLimit } from "../../../../lib/utils/rateLimit.js";
import { DEMOS, DEMO_POR_DEFECTO, esSlugDemo } from "../../../../lib/demo/demos.js";

/**
 * POST /api/auth/demo — entra en una demo pública sin credenciales.
 *
 * Inicia sesión con la cuenta de administración de una demo para que cualquiera
 * pueda probar el CRM con datos falsos.
 *
 * ── EL SLUG ES UNA LISTA BLANCA, NUNCA EL PARÁMETRO (13/08/2026) ────────────
 * Este endpoint firma un token de ADMIN a un visitante anónimo. Hasta hoy el
 * destino estaba escrito en el código (`DEMO_SLUG = "demo"`) y no admitía
 * parámetros, que es lo que lo hacía seguro. Al abrirlo para elegir oficio, lo
 * único que se acepta es un slug que esté en `lib/demo/demos.js`: coger el que
 * llegue en el cuerpo sería una puerta para entrar como administrador en el CRM
 * de cualquier cliente escribiendo su nombre.
 *
 * Un slug desconocido NO cae a la demo por defecto: responde 404. Caer de vuelta
 * escondería un intento de entrar en otro sitio detrás de una pantalla normal, y
 * eso es justo lo que hay que poder ver.
 */
export async function POST(request) {
  // Endpoint público (sin JWT): rate-limit por IP para que nadie martillee el
  // login demo (firma de JWT + UPDATE de lastLoginAt sobre master.users).
  const limited = enforceRateLimit(request, { key: "auth-demo", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  // Sin cuerpo (el botón de siempre) → la demo general.
  let pedido = null;
  try {
    const body = await request.json();
    if (body && typeof body.slug === "string") pedido = body.slug.trim();
  } catch {
    /* sin cuerpo: es lo normal */
  }

  const slug = pedido || DEMO_POR_DEFECTO;
  if (!esSlugDemo(slug)) {
    return NextResponse.json({ ok: false, error: "Esa demo no existe" }, { status: 404 });
  }

  const { User, Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug, status: "active" } });
  if (!tenant) return NextResponse.json({ ok: false, error: "La demo no está disponible" }, { status: 404 });

  // Cuenta de la demo: primero admin@{slug}.salamandra; si no, cualquier admin
  // del tenant (así una demo sembrada a mano tampoco se queda sin puerta).
  let user = await User.findOne({ where: { email: `admin@${slug}.salamandra`, tenantId: tenant.id } });
  if (!user) {
    user = await User.findOne({
      where: { tenantId: tenant.id, role: { [Op.in]: ["admin", "superadmin"] } },
      order: [["createdAt", "ASC"]],
    });
  }
  if (!user) return NextResponse.json({ ok: false, error: "La demo no está disponible" }, { status: 404 });

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId: user.id, email: user.email, role: user.role, tenantSlug: tenant.slug }),
    signRefreshToken({ userId: user.id, tenantSlug: tenant.slug, tokenVersion: user.tokenVersion }),
  ]);

  await user.update({ lastLoginAt: new Date() });

  const response = NextResponse.json({
    ok: true,
    data: { id: user.id, email: user.email, role: user.role, slug: tenant.slug },
  });
  setAuthCookies(response, { accessToken, refreshToken });
  return response;
}

/**
 * GET /api/auth/demo — qué demos hay.
 *
 * Lo piden las pestañas del dashboard para pintarse. No dice nada que no sea
 * público (rótulo y descripción de cada escaparate) y no toca la base de datos.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      porDefecto: DEMO_POR_DEFECTO,
      demos: DEMOS.map((d) => ({ slug: d.slug, rotulo: d.rotulo, titulo: d.titulo, desc: d.desc })),
    },
  });
}

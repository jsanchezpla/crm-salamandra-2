import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { signAccessToken, signRefreshToken, setAuthCookies } from "../../../../lib/auth/jwt.js";

// POST /api/auth/demo — entra en el tenant DEMO sin credenciales (demo pública).
// SOLO el tenant "demo": inicia sesión con su cuenta de administración para que
// cualquiera pueda probar el CRM con datos falsos. No expone ningún otro tenant.
const DEMO_SLUG = "demo";
const DEMO_EMAIL = "admin@demo.salamandra";

export async function POST() {
  const { User, Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: DEMO_SLUG, status: "active" } });
  if (!tenant) return NextResponse.json({ ok: false, error: "La demo no está disponible" }, { status: 404 });

  // Cuenta de la demo: primero admin@demo.salamandra; si no, cualquier admin del tenant.
  let user = await User.findOne({ where: { email: DEMO_EMAIL, tenantId: tenant.id } });
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

  const response = NextResponse.json({ ok: true, data: { id: user.id, email: user.email, role: user.role } });
  setAuthCookies(response, { accessToken, refreshToken });
  return response;
}

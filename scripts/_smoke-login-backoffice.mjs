/**
 * _smoke-login-backoffice.mjs — las cuentas del panel interno no valen en el CRM,
 * y las del CRM no valen en el panel interno.
 *
 * El panel de admin.salamandrasolutions.com guarda la ficha de TODOS los
 * clientes. Antes lo abría la misma cuenta que el CRM de Salamandra: una sola
 * contraseña robada daba las dos cosas. Esta prueba fija que ya no.
 *
 * Cubre las cuatro combinaciones, que es lo que importa — un candado que solo
 * cierra en un sentido no es un candado:
 *
 *              | host del CRM | host del back-office
 *   cuenta CRM |      SÍ      |         NO
 *   cuenta BO  |      NO      |         SÍ
 *
 * Y comprueba que el rechazo por host se responde EXACTAMENTE igual que una
 * contraseña mala: si se distinguieran, cualquiera podría averiguar qué cuentas
 * abren el panel probando emails.
 *
 * Crea sus dos usuarios de prueba y los borra al terminar.
 * Requiere el servidor de desarrollo levantado.
 *
 * Uso: node --env-file=.env.local scripts/_smoke-login-backoffice.mjs
 */

import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const CRM = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const ADMIN = `http://${process.env.ADMIN_HOST || "admin.localhost:3000"}`;
const CLAVE = "prueba-de-login-larga-2026";
const EMAIL_CRM = "smoke-crm@example.com";
const EMAIL_BO = "smoke-backoffice@example.com";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

/** Intenta entrar y devuelve el estado y el mensaje tal cual. */
async function entrar(base, email, password = CLAVE) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let j = null;
  try { j = await r.json(); } catch { /* sin json */ }
  return { status: r.status, error: j?.error ?? null, ok: j?.ok === true };
}

/** Entra y devuelve los valores CRUDOS de las cookies, como haría curl. */
async function entrarConCookies(base, email) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  // getSetCookie() devuelve las cabeceras por separado; sin él, varias cookies
  // llegan concatenadas y el recorte se lleva la mitad del token.
  const crudas = r.headers.getSetCookie?.() ?? [r.headers.get("set-cookie") ?? ""];
  const sacar = (nombre) => {
    for (const c of crudas) {
      const m = new RegExp(`${nombre}=([^;]+)`).exec(c);
      if (m) return m[1];
    }
    return null;
  };
  return { access: sacar("access_token"), refresh: sacar("refresh_token") };
}

/** Pide una ruta llevando una cookie de sesión a mano. Devuelve el código. */
async function conCookie(base, ruta, access) {
  const r = await fetch(`${base}${ruta}`, {
    headers: { Cookie: `access_token=${access}` },
    redirect: "manual",
  });
  return r.status;
}

async function main() {
  process.stdout.write("\n═══ Smoke: el panel interno tiene sus propias cuentas ═══\n");
  process.stdout.write(`  CRM:         ${CRM}\n  Back-office: ${ADMIN}\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: "salamandra_solutions" } })
    ?? await Tenant.findOne({ where: { status: "active" } });
  if (!tenant) { process.stderr.write("\n✗ No hay ningún tenant activo.\n\n"); process.exit(1); }

  await User.destroy({ where: { email: [EMAIL_CRM, EMAIL_BO] } });
  const hash = await bcrypt.hash(CLAVE, 12);
  await User.create({
    email: EMAIL_CRM, passwordHash: hash, role: "admin",
    tenantId: tenant.id, moduleAccess: ["all"], soloBackoffice: false,
  });
  await User.create({
    email: EMAIL_BO, passwordHash: hash, role: "admin",
    tenantId: tenant.id, moduleAccess: ["all"], soloBackoffice: true,
  });
  ok(`dos cuentas de prueba en "${tenant.slug}"`);

  try {
    paso("1. La cuenta del CRM, por el host del CRM");
    const a = await entrar(CRM, EMAIL_CRM);
    esperar(a.status === 200 && a.ok, `entra (HTTP ${a.status})`);

    paso("2. La MISMA cuenta, por el back-office");
    const b = await entrar(ADMIN, EMAIL_CRM);
    esperar(b.status === 401, `NO entra (HTTP ${b.status})`);

    paso("3. La cuenta del back-office, por el back-office");
    const c = await entrar(ADMIN, EMAIL_BO);
    esperar(c.status === 200 && c.ok, `entra (HTTP ${c.status})`);

    paso("4. La MISMA cuenta, por el host del CRM");
    const d = await entrar(CRM, EMAIL_BO);
    esperar(d.status === 401, `NO entra (HTTP ${d.status})`);

    paso("5. El rechazo por host no se distingue de una contraseña mala");
    const malaClave = await entrar(CRM, EMAIL_CRM, "esta-no-es-la-buena-0000");
    esperar(malaClave.status === d.status,
      `mismo código (${malaClave.status} vs ${d.status})`);
    esperar(malaClave.error === d.error,
      `mismo mensaje ("${d.error}")`);
    process.stdout.write("      si difirieran, se podría averiguar qué cuentas abren el panel\n");

    paso("6. Un email que no existe tampoco se distingue");
    const inexistente = await entrar(ADMIN, "no-existe-nadie@example.com");
    esperar(inexistente.status === b.status && inexistente.error === b.error,
      `mismo trato que la cuenta rechazada por host (${inexistente.status})`);

    // ── LO QUE DE VERDAD IMPORTA ─────────────────────────────────────────────
    // Todo lo anterior lo cumplía también la primera versión de esto, y aun así
    // el panel quedaba abierto: la separación vivía SOLO en el instante del
    // login. Quien tiene la contraseña no usa un navegador, usa curl — y
    // httpOnly no le impide nada porque él ES el cliente. Estos dos pasos son
    // los que cierran el agujero de verdad.
    paso("7. Copiar la cookie del CRM al panel NO abre nada");
    const sesionCrm = await entrarConCookies(CRM, EMAIL_CRM);
    esperar(!!sesionCrm.access, "se obtiene una sesión válida del CRM");

    const enCrm = await conCookie(CRM, "/api/clients?limit=1", sesionCrm.access);
    esperar(enCrm !== 401, `esa sesión sirve en el CRM (HTTP ${enCrm})`);

    const replay = await conCookie(ADMIN, "/api/admin/configuraciones", sesionCrm.access);
    esperar(replay === 401, `pero en el panel NO (HTTP ${replay}) — sin esto, el panel estaba abierto`);

    paso("8. Canjear el refresh del CRM contra el panel tampoco");
    const r = await fetch(`${ADMIN}/api/auth/refresh`, {
      method: "POST",
      headers: { Cookie: `refresh_token=${sesionCrm.refresh}` },
    });
    esperar(r.status === 401, `el refresh del CRM no vale en el panel (HTTP ${r.status})`);
    const cookiesDevueltas = r.headers.get("set-cookie") ?? "";
    esperar(!/access_token=[^;]{20,}/.test(cookiesDevueltas),
      "y no devuelve ninguna sesión nueva");
  } finally {
    paso("Limpieza");
    const n = await User.destroy({ where: { email: [EMAIL_CRM, EMAIL_BO] } });
    process.stdout.write(`  · ${n} cuenta(s) de prueba borradas\n`);
  }

  process.stdout.write(
    fallos === 0
      ? "\n✓ TODO CORRECTO — cada cuenta entra solo por su puerta\n\n"
      : `\n✗ ${fallos} comprobaciones fallidas\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n${e?.stack ?? ""}\n\n`);
  process.exit(1);
});

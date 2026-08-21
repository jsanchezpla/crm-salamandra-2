/**
 * _outreach-ui-check.mjs — las tres pantallas de Captación se pintan.
 *
 * Abre lista, ficha y configuración con una sesión de admin inyectada como
 * cookie, y comprueba lo que un 200 no dice: que hay contenido de verdad
 * (título y filas) y que la consola del navegador no ha escupido ni un error.
 * Una pantalla puede responder 200 y estar en blanco.
 *
 * ── `puppeteer` NO ENTRA EN EL REPO (Jorge, 20/08/2026) ─────────────────────
 * Decisión tomada, no olvido: son ~300 MB de Chromium en el `npm ci` de cada
 * despliegue largo, y lo que esto comprueba —que tres pantallas se pintan sin
 * errores de consola— no lo justifica. Consecuencias, para que nadie las
 * redescubra:
 *
 *   · Esto es HERRAMIENTA DE MANO, no prueba del runner. Por eso se llama
 *     `_outreach-ui-check` y no `_smoke-*`: con ese prefijo entraría en
 *     `npm run test:todo` y, sin puppeteer instalado, saldría VERDE sin haber
 *     mirado ni una pantalla. Ya pasó el 20/08/2026 y se deshizo el mismo día.
 *   · Sin puppeteer instalado comprueba lo que puede sin navegador —que la
 *     sesión vale y que hay una empresa que abrir— y lo dice en voz alta.
 *   · El día que alguien quiera verlas de verdad, se instala SUELTO y sin
 *     tocar `package.json`:  npm i puppeteer --no-save
 *
 * Requiere el servidor de desarrollo levantado. Va contra `demo` salvo que se
 * le pase otro slug: es el tenant que tiene empresas sembradas, y sin una
 * empresa no hay ficha que abrir.
 *
 * Uso: node --env-file=.env.local scripts/_outreach-ui-check.mjs [slug]
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "demo";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const CAPTURAS = join(tmpdir(), "smoke-outreach-ui");

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  process.stdout.write(`\n═══ UI: pantallas de Captación (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);
  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  if (!admin) throw new Error(`el tenant ${SLUG} no tiene ningún usuario admin`);

  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  process.stdout.write(`  · sesión firmada para ${admin.email} (rol ${admin.role})\n`);

  paso("Una empresa que abrir en la ficha");
  const res = await fetch(`${BASE}/api/outreach/leads`, { headers: { Cookie: `access_token=${token}` } });
  const leadId = (await res.json())?.data?.items?.[0]?.id ?? null;
  esperar(res.status === 200, "el listado contesta con la sesión firmada", String(res.status));
  esperar(Boolean(leadId), "hay al menos una empresa sembrada");
  if (!leadId) {
    process.stdout.write(`\n═══ ${fallos} fallo(s) ═══\n\n`);
    process.exit(1);
  }

  let puppeteer;
  try {
    ({ default: puppeteer } = await import("puppeteer"));
  } catch {
    process.stdout.write(
      "\n  · puppeteer no está instalado: no se miran las pantallas.\n" +
        "    Decidido el 20/08/2026 que NO entra en package.json (~300 MB de Chromium\n" +
        "    en cada despliegue). Para verlas hoy, instalándolo suelto:\n" +
        "      npm i puppeteer --no-save\n" +
        "      node --env-file=.env.local scripts/_outreach-ui-check.mjs\n\n"
    );
    process.exit(fallos ? 1 : 0);
  }

  mkdirSync(CAPTURAS, { recursive: true });
  const navegador = await puppeteer.launch({ args: ["--no-sandbox"] });
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await pagina.setCookie({ name: "access_token", value: token, domain: "localhost", path: "/" });

  const errores = [];
  pagina.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  pagina.on("pageerror", (e) => errores.push("pageerror: " + e.message));

  const pantallas = [
    ["lista", "/outreach"],
    ["ficha", `/outreach/${leadId}`],
    ["configuracion", "/outreach/configuracion"],
  ];

  try {
    paso("Las tres pantallas");
    for (const [nombre, ruta] of pantallas) {
      const resp = await pagina.goto(BASE + ruta, { waitUntil: "networkidle0", timeout: 45000 });
      await pagina.evaluateHandle("document.fonts.ready");
      await dormir(1200);
      const caja = await pagina.evaluate(() => {
        const el = document.querySelector("main");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      });
      await pagina.screenshot({
        path: join(CAPTURAS, `${nombre}.png`),
        clip: caja
          ? { x: caja.x, y: caja.y, width: Math.min(caja.width, 1440 - caja.x), height: Math.min(caja.height, 900 - caja.y) }
          : undefined,
      });
      const info = await pagina.evaluate(() => ({
        filas: document.querySelectorAll("tbody tr").length,
        h1: document.querySelector("h1")?.textContent ?? "",
        secciones: document.querySelectorAll("section").length,
      }));
      esperar(
        resp.status() < 400 && info.h1.trim().length > 0,
        `${ruta} → ${resp.status()} · h1="${info.h1}" · filas=${info.filas} · secciones=${info.secciones}`,
        String(resp.status())
      );
    }

    esperar(errores.length === 0, "ni un error en la consola del navegador", errores.slice(0, 8).map((e) => e.slice(0, 200)).join(" | "));
  } finally {
    await navegador.close();
  }

  process.stdout.write(`  · capturas en ${CAPTURAS}\n`);
  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n\n` : "\n═══ Todo en orden ═══\n\n");
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n\n`);
  process.exit(1);
});

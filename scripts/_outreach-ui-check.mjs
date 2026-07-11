// Verificación end-to-end de la UI de Outreach.
// Inyecta un JWT firmado como cookie (no necesita la contraseña del admin).
// Uso: node --env-file=.env.local scripts/_outreach-ui-check.mjs
import puppeteer from "puppeteer";
import { SignJWT } from "jose";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const BASE = "http://localhost:3000";
const OUT = "C:/Users/jorge/AppData/Local/Temp/claude/C--dev-salamandra-crm-salamandra-2/172dfe3e-dfc3-4598-aa5b-eb425c093156/scratchpad/outreach";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

getMasterDb();
const { User } = getMasterModels();
const user = await User.findOne({ where: { email: "admin@sandbox.local" } });
const token = await new SignJWT({ userId: user.id, email: user.email, role: user.role, tenantSlug: "sandbox" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(new TextEncoder().encode(process.env.JWT_SECRET));

// Un lead cualquiera para la ficha
const leadRes = await fetch(`http://127.0.0.1:3000/api/outreach/leads?q=dental`, {
  headers: { cookie: `access_token=${token}` },
});
const leadId = (await leadRes.json())?.data?.items?.[0]?.id;
if (!leadId) { console.error("✗ No se pudo obtener un lead para la ficha"); process.exit(1); }

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.setCookie({ name: "access_token", value: token, domain: "localhost", path: "/" });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const shots = [
  ["lista", "/outreach"],
  ["ficha", `/outreach/${leadId}`],
  ["configuracion", "/outreach/configuracion"],
];

for (const [file, path] of shots) {
  const resp = await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 45000 });
  await page.evaluateHandle("document.fonts.ready");
  await sleep(1200);
  const box = await page.evaluate(() => {
    const el = document.querySelector("main");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  await page.screenshot({
    path: `${OUT}/${file}.png`,
    clip: box ? { x: box.x, y: box.y, width: Math.min(box.width, 1440 - box.x), height: Math.min(box.height, 900 - box.y) } : undefined,
  });
  // Cuenta de filas / paneles para comprobar que hay contenido real
  const info = await page.evaluate(() => ({
    rows: document.querySelectorAll("tbody tr").length,
    h1: document.querySelector("h1")?.textContent ?? "",
    sections: document.querySelectorAll("section").length,
  }));
  console.log(`${resp.status() < 400 ? "✓" : "✗"} ${path} → ${resp.status()} · h1="${info.h1}" · filas=${info.rows} · secciones=${info.sections}`);
}

console.log(errors.length === 0 ? "\n✓ Sin errores de consola" : `\n✗ ${errors.length} errores de consola:`);
errors.slice(0, 8).forEach((e) => console.log("  -", e.slice(0, 200)));

await browser.close();
process.exit(0);

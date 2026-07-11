// Captura la primera pantalla de cada módulo del CRM (tenant sandbox) para el dossier.
// Recorta al <main> para EXCLUIR el sidebar y que el módulo ocupe más.
// Requiere el dev server en localhost:3000 y el admin del sandbox con pw conocida.
// Uso: node scripts/_dossier-shots.mjs
import puppeteer from "puppeteer";

const BASE = "http://localhost:3000";
const OUT = "C:/Users/jorge/AppData/Local/Temp/claude/C--dev-salamandra-crm-salamandra-2/172dfe3e-dfc3-4598-aa5b-eb425c093156/scratchpad/dossier/shots";
const EMAIL = "admin@sandbox.local";
const PW = "dossier2026";

// [archivo, ruta de entrada del módulo]
const SHOTS = [
  ["clientes", "/clientes"],
  ["leads", "/leads"],
  ["calendario", "/calendario"],
  ["citas", "/citas"],
  ["proyectos", "/proyectos"],
  ["pedidos", "/pedidos"],
  ["inventario", "/inventario"],
  ["facturacion", "/facturacion"],
  ["equipo", "/equipo"],
  ["formacion", "/formacion"],
  ["nutricion", "/nutricion/alimentos"],
  ["clinica", "/clinica"],
  ["pacientes", "/pacientes"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
const login = await page.evaluate(async (email, pw) => {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  return { status: r.status };
}, EMAIL, PW);
console.log("LOGIN:", login.status);
if (login.status !== 200) { await browser.close(); process.exit(1); }

for (const [file, path] of SHOTS) {
  try {
    const resp = await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 45000 });
    await page.evaluateHandle("document.fonts.ready");
    await sleep(1200);
    // Cerrar avisos de "vista previa" si los hay (clínica/pacientes)
    await page.evaluate(() => {
      document.querySelectorAll('[aria-label="Cerrar aviso"]').forEach((b) => b.click());
    });
    await sleep(500);
    // Medir el <main> (excluye el sidebar) y recortar a él
    const box = await page.evaluate(() => {
      const el = document.querySelector("main");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    });
    if (!box) { console.log("ERR no-main", file); continue; }
    const clip = {
      x: box.x,
      y: box.y,
      width: Math.min(box.width, 1440 - box.x),
      height: Math.min(box.height, 900 - box.y),
    };
    await page.screenshot({ path: `${OUT}/${file}.png`, clip });
    console.log("OK", file, resp.status(), `clip ${clip.width}x${clip.height} (aspect ${(clip.width / clip.height).toFixed(3)})`);
  } catch (e) {
    console.log("ERR", file, path, e.message);
  }
}

await browser.close();
console.log("DONE");
process.exit(0);

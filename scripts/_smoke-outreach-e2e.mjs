/**
 * _smoke-outreach-e2e.mjs — lo que Captación hace cuando cuesta dinero.
 *
 * Tres endpoints del módulo gastan de verdad: `analizar` (Claude), `enviar-
 * correo` (Resend) y `buscar-nuevos` (Google Places / n8n). Esta prueba los
 * ejercita de punta a punta, y hace dos recorridos distintos según el tenant
 * porque el producto se comporta distinto:
 *
 *   TENANT DEMO (el de por defecto) — las demos son públicas y dan sesión de
 *   admin a cualquiera, así que los tres están CORTADOS por
 *   `lib/demo/isDemo.js`. Lo que se fija aquí es ese corte: 403 antes de
 *   validar nada, sin tocar la ficha y sin llamar a ningún proveedor. Si un día
 *   alguien quita el guard, la demo se convierte en un relé de spam y en una
 *   forma gratis de quemar la cuota de otro; esto lo pilla.
 *
 *   CUALQUIER OTRO TENANT — el flujo entero: análisis con IA (que persiste un
 *   análisis por línea de negocio activa, con score, correo modelo y sin
 *   marcar como enviado), envío en dry-run (que NO miente marcando `sentAt`) y
 *   scraping vía n8n (dedupe al reinsertar y firma HMAC en el webhook).
 *
 * Requiere el servidor de desarrollo levantado. El recorrido completo pide
 * además `OUTREACH_FAKE_AI=1`, la clave de Resend del tenant puesta a
 * `dry-run` y un lead sin analizar cuyo nombre contenga «Ledesma».
 *
 * El n8n falso ya NO hay que acordarse de levantarlo: esta prueba arranca
 * `scripts/_fake-n8n.mjs` cuando llega al paso de scraping y lo mata al salir
 * (le hereda su entorno, que es de donde saca el secreto para verificar la
 * firma). Lo que sí tiene que traer el `npm run dev` en su propio `.env.local`,
 * porque es el CRM quien llama al webhook:
 *
 *   OUTREACH_SCRAPING_WEBHOOK_URL=http://127.0.0.1:5999/webhook/scraping
 *   OUTREACH_WEBHOOK_SECRET=<cualquier cosa, la misma que vea esta prueba>
 *
 * Sin ellas `buscar-nuevos` contesta 503 («no está configurado») y el paso
 * falla diciéndolo.
 *
 * Uso: node --env-file=.env.local scripts/_smoke-outreach-e2e.mjs [slug]
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";
import { esSlugDemo } from "../lib/demo/isDemo.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SLUG = process.argv[2] || "demo";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const N8N_FALSO = process.env.SMOKE_N8N_FALSO || "http://127.0.0.1:5999";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// `buscar-nuevos` no devuelve un `duplicates`: parte «ya lo teníamos» en tres
// según lo que se hizo con la fila vieja (`lib/outreach/persistLeads.js`), y
// cuál toca depende de si el lead que ya estaba se había analizado o convertido.
const yaLoTeniamos = (d) => (d?.refreshed ?? 0) + (d?.keptAnalyzed ?? 0) + (d?.keptClient ?? 0);

let cabeceras = {};

// ── El n8n falso, arrancado y parado por la propia prueba ───────────────────
// Antes había que levantarlo a mano y, como no existía en el repo, la rama de
// scraping no la podía pasar nadie. Ahora es `scripts/_fake-n8n.mjs` y lo
// levanta esto: hereda el entorno (de ahí saca `OUTREACH_WEBHOOK_SECRET`, sin
// el cual se niega a arrancar) y muere con la prueba.

async function n8nResponde() {
  try {
    return (await fetch(`${N8N_FALSO}/last`)).ok;
  } catch {
    return false; // el puerto está libre
  }
}

function matar(hijo) {
  try {
    hijo.kill();
  } catch { /* ya estaba muerto */ }
}

/** Devuelve `{ listo, motivo, parar }`. Si ya había uno escuchando, lo reutiliza y NO lo mata. */
async function arrancarN8nFalso() {
  if (await n8nResponde()) return { listo: true, motivo: "ya estaba levantado", parar: async () => {} };

  const hijo = spawn(process.execPath, [join(AQUI, "_fake-n8n.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  let muerto = false;
  hijo.stdout.on("data", (d) => (salida += d));
  hijo.stderr.on("data", (d) => (salida += d));
  hijo.on("exit", () => (muerto = true));

  const parar = async () => {
    matar(hijo);
    await dormir(200);
  };

  const limite = Date.now() + 10_000;
  while (Date.now() < limite) {
    // Si se ha muerto (falta el secreto, puerto ocupado…) lo dice él mismo por
    // stderr: se devuelve tal cual en vez de un «no contesta» que no explica nada.
    if (muerto) return { listo: false, motivo: salida.trim() || `salió con código ${hijo.exitCode}`, parar: async () => {} };
    if (await n8nResponde()) return { listo: true, motivo: "", parar };
    await dormir(200);
  }
  await parar();
  return { listo: false, motivo: `no llegó a escuchar en 10 s. ${salida.trim()}`.trim(), parar: async () => {} };
}

async function pedir(ruta, opts = {}) {
  const r = await fetch(BASE + ruta, { ...opts, headers: { ...cabeceras, ...(opts.headers || {}) } });
  let body = null;
  try { body = await r.json(); } catch { /* 204 y demás sin cuerpo */ }
  return { status: r.status, body };
}

/** El recorrido de una demo pública: lo que se puede mirar y lo que está cortado. */
async function enLaDemo() {
  paso("Leer sigue abierto: la demo es un escaparate");
  const listado = await pedir("/api/outreach/leads");
  const lead = listado.body?.data?.items?.[0];
  esperar(listado.status === 200 && Boolean(lead), `listado → 200 (${listado.body?.data?.total} empresas)`, String(listado.status));
  if (!lead) return;

  const antes = (await pedir(`/api/outreach/leads/${lead.id}`)).body?.data?.lead;
  esperar(Boolean(antes), "la ficha de una empresa se abre");

  paso("Lo que cuesta dinero está cortado");
  const analisis = await pedir(`/api/outreach/leads/${lead.id}/analizar`, { method: "POST" });
  esperar(analisis.status === 403, "analizar con IA → 403", `${analisis.status} ${JSON.stringify(analisis.body)}`);

  const linea = antes?.analyses?.[0]?.businessLineId;
  const correo = await pedir(`/api/outreach/leads/${lead.id}/enviar-correo`, {
    method: "POST",
    body: JSON.stringify({ businessLineId: linea, to: "prueba@example.com", subject: "Hola", body: "Cuerpo" }),
  });
  esperar(correo.status === 403, "enviar el correo → 403, antes de mirar el cuerpo", `${correo.status} ${JSON.stringify(correo.body)}`);

  const buscar = await pedir("/api/outreach/leads/buscar-nuevos", {
    method: "POST",
    body: JSON.stringify({ sector: "Ópticas", location: "Salamanca", sources: ["paginas_amarillas"] }),
  });
  esperar(buscar.status === 403, "buscar empresas nuevas → 403", `${buscar.status} ${JSON.stringify(buscar.body)}`);

  paso("Y el corte no deja rastro en la ficha");
  const despues = (await pedir(`/api/outreach/leads/${lead.id}`)).body?.data?.lead;
  esperar(despues?.analyzed === antes?.analyzed, "la empresa no ha cambiado de estado", `${antes?.analyzed} → ${despues?.analyzed}`);
  esperar(
    despues?.analyses?.length === antes?.analyses?.length,
    "no se ha guardado ningún análisis nuevo",
    `${antes?.analyses?.length} → ${despues?.analyses?.length}`
  );
}

/** El recorrido de un tenant normal: análisis, correo y scraping de verdad. */
async function elFlujoCompleto() {
  paso("Análisis con IA (proveedor simulado)");
  const listado = await pedir("/api/outreach/leads?q=Ledesma");
  const lead = listado.body?.data?.items?.[0];
  esperar(Boolean(lead) && lead.analyzed === false, "hay un lead de prueba y está SIN analizar", JSON.stringify(lead?.analyzed));
  if (!lead) return;

  const an = await pedir(`/api/outreach/leads/${lead.id}/analizar`, { method: "POST" });
  esperar(an.status === 200, "analizar → 200", JSON.stringify(an.body));
  esperar(an.body?.data?.model === "fake", "el modelo persistido es 'fake', no uno real", an.body?.data?.model);

  const ficha = await pedir(`/api/outreach/leads/${lead.id}`);
  const L = ficha.body?.data?.lead;
  esperar(L?.analyzed === true, "el lead queda marcado como analizado");
  esperar(L?.analyses?.length === 2, "hay un análisis por línea de negocio activa", `${L?.analyses?.length}`);
  const a0 = L?.analyses?.[0];
  esperar(Number.isInteger(a0?.score) && a0.score >= 0 && a0.score <= 100, "cada análisis trae score 0-100", `${a0?.score}`);
  esperar(Boolean(a0?.emailDraft?.subject && a0?.emailDraft?.body), "cada análisis trae correo modelo {subject, body}");
  esperar(!a0?.sentAt, "el análisis nace sin enviar", String(a0?.sentAt));
  esperar(a0?.model === "fake", "el análisis guarda model='fake'", a0?.model);

  await pedir(`/api/outreach/leads/${lead.id}/analizar`, { method: "POST" });
  const ficha2 = await pedir(`/api/outreach/leads/${lead.id}`);
  esperar(ficha2.body?.data?.lead?.analyses?.length === 2, "re-analizar hace upsert, no duplica filas");

  paso("Envío del correo (Resend en dry-run)");
  const lineId = a0?.businessLineId;
  const mal1 = await pedir(`/api/outreach/leads/${lead.id}/enviar-correo`, {
    method: "POST",
    body: JSON.stringify({ businessLineId: lineId, to: "no-es-email", subject: "x", body: "y" }),
  });
  esperar(mal1.status === 422, "destinatario inválido → 422", String(mal1.status));
  const mal2 = await pedir(`/api/outreach/leads/${lead.id}/enviar-correo`, {
    method: "POST",
    body: JSON.stringify({ businessLineId: lineId, to: "a@b.com", subject: "", body: "y" }),
  });
  esperar(mal2.status === 422, "asunto vacío → 422", String(mal2.status));

  const enviado = await pedir(`/api/outreach/leads/${lead.id}/enviar-correo`, {
    method: "POST",
    body: JSON.stringify({ businessLineId: lineId, to: "prueba@example.com", subject: "Hola", body: "Cuerpo" }),
  });
  esperar(enviado.status === 200, "envío en dry-run → 200", JSON.stringify(enviado.body));
  esperar(enviado.body?.data?.dryRun === true && enviado.body?.data?.sent === false, "el dry-run informa de que NO se envió");

  const ficha3 = await pedir(`/api/outreach/leads/${lead.id}`);
  const a0b = ficha3.body?.data?.lead?.analyses?.find((x) => x.businessLineId === lineId);
  esperar(!a0b?.sentAt, "el dry-run NO marca sentAt (no miente al comercial)", String(a0b?.sentAt));

  paso("Scraping vía n8n (webhook falso)");
  const sinFuente = await pedir("/api/outreach/leads/buscar-nuevos", {
    method: "POST",
    body: JSON.stringify({ sector: "Ópticas", sources: [] }),
  });
  esperar(sinFuente.status === 422, "sin fuentes → 422", String(sinFuente.status));
  const sinQuery = await pedir("/api/outreach/leads/buscar-nuevos", {
    method: "POST",
    body: JSON.stringify({ sources: ["google_maps"] }),
  });
  esperar(sinQuery.status === 422, "sin sector ni ubicación → 422", String(sinQuery.status));

  const n8n = await arrancarN8nFalso();
  if (!n8n.listo) {
    mal(`no hay n8n falso en ${N8N_FALSO}, así que la firma no la comprueba nadie: ${n8n.motivo}`);
    return;
  }
  if (n8n.motivo) ok(`n8n falso: ${n8n.motivo}`);

  try {
    const cuerpo = JSON.stringify({ sector: "Ópticas", location: "Salamanca", sources: ["paginas_amarillas"] });
    const scr = await pedir("/api/outreach/leads/buscar-nuevos", { method: "POST", body: cuerpo });
    esperar(scr.status === 200, "buscar nuevos → 200", JSON.stringify(scr.body));
    const d = scr.body?.data;
    esperar(d?.inserted === 1, "inserta la empresa nueva", `inserted=${d?.inserted}`);
    esperar(yaLoTeniamos(d) === 1, "detecta el duplicado que ya teníamos", JSON.stringify(d));
    esperar(d?.ignored === 1, "descarta la empresa sin nombre", `ignored=${d?.ignored}`);

    const otraVez = await pedir("/api/outreach/leads/buscar-nuevos", { method: "POST", body: cuerpo });
    const d2 = otraVez.body?.data;
    esperar(
      d2?.inserted === 0 && yaLoTeniamos(d2) === 2,
      "re-scrapear no duplica nada",
      JSON.stringify(d2)
    );

    // El falso ya rechaza (401) lo que llega sin firma o con una que no cuadra,
    // así que un 200 arriba ya dice que la firma iba bien; esto lo deja escrito.
    let recibido = null;
    try {
      recibido = await (await fetch(`${N8N_FALSO}/last`)).json();
    } catch {
      mal(`el n8n falso ha dejado de contestar en ${N8N_FALSO}`);
    }
    if (recibido) {
      esperar(recibido.recibido === true, "n8n recibió la llamada del CRM");
      esperar(recibido.hadSignature === true, "n8n recibió la firma HMAC");
      esperar(recibido.signatureOk === true, "la firma HMAC es correcta");
      esperar(
        recibido.payload?.sector === "Ópticas" &&
          recibido.payload?.location === "Salamanca" &&
          recibido.payload?.sources?.[0] === "paginas_amarillas",
        "n8n recibió sector, ubicación y fuentes"
      );
    }
  } finally {
    await n8n.parar();
  }

  const insertada = (await pedir("/api/outreach/leads?q=Mirador")).body?.data?.items?.[0];
  if (insertada) await pedir(`/api/outreach/leads/${insertada.id}`, { method: "DELETE" });
}

async function main() {
  const demo = esSlugDemo(SLUG);
  process.stdout.write(`\n═══ E2E: Captación (${SLUG}${demo ? ", tenant de demostración" : ""}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);
  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  if (!admin) throw new Error(`el tenant ${SLUG} no tiene ningún usuario admin`);

  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  cabeceras = { "Content-Type": "application/json", Cookie: `access_token=${token}` };
  process.stdout.write(`  · sesión firmada para ${admin.email} (rol ${admin.role})\n`);

  if (demo) await enLaDemo();
  else await elFlujoCompleto();

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n\n` : "\n═══ Todo en orden ═══\n\n");
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n\n`);
  process.exit(1);
});

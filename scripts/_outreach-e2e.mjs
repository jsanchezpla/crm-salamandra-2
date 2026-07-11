// E2E de las fases 2 y 3 contra el dev server (con OUTREACH_FAKE_AI=1 y n8n falso).
// Uso: node --env-file=.env.local scripts/_outreach-e2e.mjs
import { SignJWT } from "jose";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const BASE = "http://127.0.0.1:3000";
let fails = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name} ${extra}`); }
}

getMasterDb();
const { User } = getMasterModels();
const u = await User.findOne({ where: { email: "admin@sandbox.local" } });
const token = await new SignJWT({ userId: u.id, email: u.email, role: u.role, tenantSlug: "sandbox" })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("15m")
  .sign(new TextEncoder().encode(process.env.JWT_SECRET));
const cookie = `access_token=${token}`;

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", cookie, ...(opts.headers || {}) } });
  let body = null;
  try { body = await r.json(); } catch { /* 204 */ }
  return { status: r.status, body };
}

// ── FASE 2: análisis con IA ───────────────────────────────────────────────
console.log("\n── Fase 2: análisis con IA (proveedor simulado) ──");
const list = await req("/api/outreach/leads?q=Ledesma");
const lead = list.body?.data?.items?.[0];
check("lead de prueba localizado y SIN analizar", lead && lead.analyzed === false, JSON.stringify(lead?.analyzed));

const an = await req(`/api/outreach/leads/${lead.id}/analizar`, { method: "POST" });
check("POST /analizar → 200", an.status === 200, JSON.stringify(an.body));
check("el modelo persistido es 'fake', no uno real", an.body?.data?.model === "fake", an.body?.data?.model);

const ficha = await req(`/api/outreach/leads/${lead.id}`);
const L = ficha.body?.data?.lead;
check("el lead queda marcado como analizado", L?.analyzed === true);
check("hay un análisis por línea de negocio activa", L?.analyses?.length === 2, `${L?.analyses?.length}`);
const a0 = L?.analyses?.[0];
check("cada análisis trae score 0-100", Number.isInteger(a0?.score) && a0.score >= 0 && a0.score <= 100, `${a0?.score}`);
check("cada análisis trae correo modelo {subject, body}", Boolean(a0?.emailDraft?.subject && a0?.emailDraft?.body));
check("el análisis nace sin enviar (sentAt null)", a0?.sentAt === null || a0?.sentAt === undefined);
check("el análisis guarda model='fake'", a0?.model === "fake", a0?.model);

// Re-analizar es idempotente en nº de filas (upsert, no duplica)
await req(`/api/outreach/leads/${lead.id}/analizar`, { method: "POST" });
const ficha2 = await req(`/api/outreach/leads/${lead.id}`);
check("re-analizar hace upsert, no duplica filas", ficha2.body?.data?.lead?.analyses?.length === 2);

// ── FASE 3: envío del correo ──────────────────────────────────────────────
console.log("\n── Fase 3: envío del correo (Resend en dry-run) ──");
const lineId = a0.businessLineId;
const bad1 = await req(`/api/outreach/leads/${lead.id}/enviar-correo`, { method: "POST", body: JSON.stringify({ businessLineId: lineId, to: "no-es-email", subject: "x", body: "y" }) });
check("destinatario inválido → 422", bad1.status === 422);
const bad2 = await req(`/api/outreach/leads/${lead.id}/enviar-correo`, { method: "POST", body: JSON.stringify({ businessLineId: lineId, to: "a@b.com", subject: "", body: "y" }) });
check("asunto vacío → 422", bad2.status === 422);

const sent = await req(`/api/outreach/leads/${lead.id}/enviar-correo`, { method: "POST", body: JSON.stringify({ businessLineId: lineId, to: "prueba@example.com", subject: "Hola", body: "Cuerpo" }) });
check("envío en dry-run → 200", sent.status === 200, JSON.stringify(sent.body));
check("dry-run informa de que NO se envió", sent.body?.data?.dryRun === true && sent.body?.data?.sent === false);

const ficha3 = await req(`/api/outreach/leads/${lead.id}`);
const a0b = ficha3.body?.data?.lead?.analyses?.find((x) => x.businessLineId === lineId);
check("dry-run NO marca sentAt (no miente al comercial)", !a0b?.sentAt, String(a0b?.sentAt));

// ── FASE 3: scraping ──────────────────────────────────────────────────────
console.log("\n── Fase 3: scraping vía n8n (webhook falso) ──");
const noSrc = await req("/api/outreach/leads/buscar-nuevos", { method: "POST", body: JSON.stringify({ sector: "Ópticas", sources: [] }) });
check("sin fuentes → 422", noSrc.status === 422);
const noQuery = await req("/api/outreach/leads/buscar-nuevos", { method: "POST", body: JSON.stringify({ sources: ["google_maps"] }) });
check("sin sector ni ubicación → 422", noQuery.status === 422);

const scr = await req("/api/outreach/leads/buscar-nuevos", { method: "POST", body: JSON.stringify({ sector: "Ópticas", location: "Salamanca", sources: ["paginas_amarillas"] }) });
check("POST /buscar-nuevos → 200", scr.status === 200, JSON.stringify(scr.body));
const d = scr.body?.data;
check("inserta la empresa nueva", d?.inserted === 1, `inserted=${d?.inserted}`);
check("detecta el duplicado que ya teníamos", d?.duplicates === 1, `duplicates=${d?.duplicates}`);
check("descarta la empresa sin nombre", d?.ignored === 1, `ignored=${d?.ignored}`);

const again = await req("/api/outreach/leads/buscar-nuevos", { method: "POST", body: JSON.stringify({ sector: "Ópticas", location: "Salamanca", sources: ["paginas_amarillas"] }) });
check("re-scrapear no duplica nada", again.body?.data?.inserted === 0 && again.body?.data?.duplicates === 2, JSON.stringify(again.body?.data));

const hook = await (await fetch("http://127.0.0.1:5999/last")).json();
check("n8n recibió la firma HMAC", hook?.hadSignature === true);
check("la firma HMAC es correcta", hook?.signatureOk === true);
check("n8n recibió sector, ubicación y fuentes", hook?.payload?.sector === "Ópticas" && hook?.payload?.location === "Salamanca" && hook?.payload?.sources?.[0] === "paginas_amarillas");

// Limpieza del lead insertado por el scraping
const optica = (await req("/api/outreach/leads?q=Mirador")).body?.data?.items?.[0];
if (optica) await req(`/api/outreach/leads/${optica.id}`, { method: "DELETE" });

console.log(fails === 0 ? `\n✓ Todas las comprobaciones E2E pasan` : `\n✗ ${fails} fallos`);
process.exit(fails === 0 ? 0 : 1);

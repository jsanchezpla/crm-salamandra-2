// Smoke test de los endpoints de Outreach contra el dev server.
// Firma su propio JWT con JWT_SECRET (no necesita la contraseña del admin).
// Uso: node --env-file=.env.local scripts/_outreach-smoke.mjs
import { SignJWT } from "jose";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const BASE = "http://127.0.0.1:3000";
const EMAIL = "admin@sandbox.local";

getMasterDb();
const { User } = getMasterModels();
const user = await User.findOne({ where: { email: EMAIL } });
if (!user) { console.error("✗ No existe", EMAIL); process.exit(1); }

const token = await new SignJWT({ userId: user.id, email: user.email, role: user.role, tenantSlug: "sandbox" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.JWT_SECRET));

const cookie = `access_token=${token}`;
console.log(`✓ JWT firmado para ${user.email} (role ${user.role}, tenant sandbox)\n`);

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", cookie, ...(opts.headers || {}) },
  });
  let body;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}

function show(label, res, pick) {
  const flag = res.status < 400 ? "✓" : "✗";
  console.log(`${flag} ${label} → ${res.status} ${pick ? pick(res.body) : ""}`);
  if (res.status >= 400) console.log("   ", JSON.stringify(res.body));
}

const lines = await req("/api/outreach/business-lines");
show("GET  /api/outreach/business-lines", lines, (b) => `${b?.data?.items?.length} líneas: ${b?.data?.items?.map((l) => l.key).join(", ")}`);

const settings = await req("/api/outreach/settings");
show("GET  /api/outreach/settings", settings, (b) => `modelo=${b?.data?.settings?.aiModel} · admitidos=${b?.data?.allowedModels?.length}`);

const list = await req("/api/outreach/leads");
show("GET  /api/outreach/leads", list, (b) => `${b?.data?.total} leads`);

const first = list.body?.data?.items?.[0];
if (first) {
  const detail = await req(`/api/outreach/leads/${first.id}`);
  show(`GET  /api/outreach/leads/:id`, detail, (b) => {
    const l = b?.data?.lead;
    return `${l?.name} · ${l?.contacts?.length} contactos · ${l?.analyses?.length} análisis · ${b?.data?.businessLines?.length} líneas`;
  });
}

// Filtro por score en una línea concreta
const filtered = await req("/api/outreach/leads?minScore=80&line=agencia");
show("GET  /api/outreach/leads?minScore=80&line=agencia", filtered, (b) => `${b?.data?.total} leads: ${b?.data?.items?.map((i) => i.name).join(", ")}`);

const byAnalyzed = await req("/api/outreach/leads?analyzed=false");
show("GET  /api/outreach/leads?analyzed=false", byAnalyzed, (b) => `${b?.data?.total} sin analizar`);

const search = await req("/api/outreach/leads?q=dental");
show("GET  /api/outreach/leads?q=dental", search, (b) => `${b?.data?.total} → ${b?.data?.items?.map((i) => i.name).join(", ")}`);

// Alta manual + duplicado (debe fallar con 422)
const create = await req("/api/outreach/leads", { method: "POST", body: JSON.stringify({ name: "Prueba Smoke SL", location: "Salamanca", sector: "Consultoras" }) });
show("POST /api/outreach/leads (alta)", create, (b) => b?.data?.name);
const dup = await req("/api/outreach/leads", { method: "POST", body: JSON.stringify({ name: "Prueba Smoke SL", location: "Salamanca" }) });
console.log(`${dup.status === 422 ? "✓" : "✗"} POST duplicado → ${dup.status} (esperado 422) ${dup.body?.error ?? ""}`);

if (create.body?.data?.id) {
  const del = await req(`/api/outreach/leads/${create.body.data.id}`, { method: "DELETE" });
  console.log(`${del.status === 204 ? "✓" : "✗"} DELETE lead de prueba → ${del.status} (esperado 204)`);
}

// Validación de modelo IA no admitido
const badModel = await req("/api/outreach/settings", { method: "PATCH", body: JSON.stringify({ aiModel: "gpt-4o" }) });
console.log(`${badModel.status === 422 ? "✓" : "✗"} PATCH settings modelo inválido → ${badModel.status} (esperado 422)`);

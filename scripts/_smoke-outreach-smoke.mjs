/**
 * _smoke-outreach-smoke.mjs — las puertas de Captación contestan y validan.
 *
 * Recorre la API del módulo como la usa la pantalla: líneas de negocio,
 * ajustes, listado con sus filtros, ficha, alta manual y borrado. No juzga la
 * calidad de lo que devuelve —para eso está el E2E—, sino que ninguna de esas
 * puertas se haya caído: un 500 en el listado deja la pantalla en blanco y no
 * lo cuenta nadie.
 *
 * Además fija dos reglas que no son cortesías:
 *   · dar de alta dos veces la misma empresa (nombre + ubicación + fuente)
 *     responde 422 — es lo único que evita la lista llena de duplicados;
 *   · un modelo de IA que no está admitido responde 422 y NO se guarda.
 *
 * Requiere el servidor de desarrollo levantado. Va contra `demo` salvo que se
 * le pase otro slug: es el tenant al que `scripts/seed-outreach.js` deja
 * líneas de negocio y empresas con las que hay algo que listar.
 *
 * Uso: node --env-file=.env.local scripts/_smoke-outreach-smoke.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "demo";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
// Único por ejecución: con un nombre fijo, una tanda que se corte a la mitad
// deja el alta puesta y la siguiente da el 422 del duplicado por su cuenta.
const EMPRESA = `Prueba Smoke ${Date.now()}`;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));

async function main() {
  process.stdout.write(`\n═══ Smoke: endpoints de Captación (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);
  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  if (!admin) throw new Error(`el tenant ${SLUG} no tiene ningún usuario admin`);

  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  const cabeceras = { "Content-Type": "application/json", Cookie: `access_token=${token}` };
  process.stdout.write(`  · sesión firmada para ${admin.email} (rol ${admin.role})\n`);

  async function pedir(ruta, opts = {}) {
    const r = await fetch(BASE + ruta, { ...opts, headers: { ...cabeceras, ...(opts.headers || {}) } });
    let body = null;
    try { body = await r.json(); } catch { /* 204 y demás sin cuerpo */ }
    return { status: r.status, body };
  }

  paso("Lo que la pantalla pide nada más abrirse");

  const lineas = await pedir("/api/outreach/business-lines");
  esperar(
    lineas.status === 200,
    `líneas de negocio → 200 (${lineas.body?.data?.items?.map((l) => l.key).join(", ") || "ninguna"})`,
    `${lineas.status} ${JSON.stringify(lineas.body)}`
  );

  const ajustes = await pedir("/api/outreach/settings");
  esperar(
    ajustes.status === 200,
    `ajustes → 200 (modelo ${ajustes.body?.data?.settings?.aiModel}, ${ajustes.body?.data?.allowedModels?.length} admitidos)`,
    `${ajustes.status} ${JSON.stringify(ajustes.body)}`
  );

  const listado = await pedir("/api/outreach/leads");
  esperar(listado.status === 200, `listado → 200 (${listado.body?.data?.total} empresas)`, String(listado.status));

  const primera = listado.body?.data?.items?.[0];
  if (primera) {
    const ficha = await pedir(`/api/outreach/leads/${primera.id}`);
    const l = ficha.body?.data?.lead;
    esperar(
      ficha.status === 200 && l?.id === primera.id,
      `ficha → 200 (${l?.name}: ${l?.contacts?.length} contactos, ${l?.analyses?.length} análisis)`,
      String(ficha.status)
    );
    esperar(
      Array.isArray(ficha.body?.data?.businessLines),
      "la ficha trae las líneas de negocio con las que analizar"
    );
  } else {
    process.stdout.write("  · sin empresas sembradas: se salta la ficha\n");
  }

  paso("Los filtros del listado");
  for (const [etiqueta, query] of [
    ["por puntuación y línea", "?minScore=80&line=agencia"],
    ["sin analizar", "?analyzed=false"],
    ["por texto", "?q=dental"],
  ]) {
    const r = await pedir(`/api/outreach/leads${query}`);
    esperar(r.status === 200, `${etiqueta} → 200 (${r.body?.data?.total})`, `${r.status} ${JSON.stringify(r.body)}`);
  }

  paso("Alta manual, duplicado y borrado");
  let creada = null;
  try {
    const alta = await pedir("/api/outreach/leads", {
      method: "POST",
      body: JSON.stringify({ name: EMPRESA, location: "Salamanca", sector: "Consultoras" }),
    });
    creada = alta.body?.data?.id ?? null;
    esperar(alta.status < 400 && creada, `alta manual → ${alta.status}`, JSON.stringify(alta.body));

    const duplicada = await pedir("/api/outreach/leads", {
      method: "POST",
      body: JSON.stringify({ name: EMPRESA, location: "Salamanca" }),
    });
    esperar(duplicada.status === 422, "la misma empresa otra vez → 422", `${duplicada.status} ${duplicada.body?.error ?? ""}`);
  } finally {
    if (creada) {
      const borrado = await pedir(`/api/outreach/leads/${creada}`, { method: "DELETE" });
      esperar(borrado.status === 204, "borrado → 204", String(borrado.status));
    }
  }

  paso("Los ajustes no se tragan cualquier modelo");
  const modeloMalo = await pedir("/api/outreach/settings", {
    method: "PATCH",
    body: JSON.stringify({ aiModel: "gpt-4o" }),
  });
  esperar(modeloMalo.status === 422, "un modelo que no es de Claude → 422", String(modeloMalo.status));

  const despues = await pedir("/api/outreach/settings");
  esperar(
    despues.body?.data?.settings?.aiModel === ajustes.body?.data?.settings?.aiModel,
    "y el modelo guardado sigue siendo el de antes",
    `${ajustes.body?.data?.settings?.aiModel} → ${despues.body?.data?.settings?.aiModel}`
  );

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n\n` : "\n═══ Todo en orden ═══\n\n");
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n\n`);
  process.exit(1);
});

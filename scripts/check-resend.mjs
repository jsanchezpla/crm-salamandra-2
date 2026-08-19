// @vivo — Diagnóstico de la cuenta de plataforma (RESEND_API_KEY / OUTREACH_RESEND_API_KEY del entorno) con envío de prueba opcional; esa clave la sigue… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * check-resend.mjs — Diagnóstico de la cuenta de Resend.
 *
 * Solo lectura: lista los dominios de la cuenta y su estado de verificación,
 * para saber qué falta antes de enviar correo real. Usa la clave de
 * RESEND_API_KEY, que TÚ configuras en .env.local — nunca se pide por chat.
 *
 * Opcional: pásale un email para enviarte un correo de PRUEBA real y confirmar
 * de punta a punta que el envío funciona.
 *
 * Uso:
 *   node --env-file=.env.local scripts/check-resend.mjs
 *   node --env-file=.env.local scripts/check-resend.mjs tu-email@donde-sea.com
 */

// Prefiere la key propia del outreach; si no, la global del CRM.
const key = process.env.OUTREACH_RESEND_API_KEY || process.env.RESEND_API_KEY;
const keySource = process.env.OUTREACH_RESEND_API_KEY ? "OUTREACH_RESEND_API_KEY" : "RESEND_API_KEY";
const testTo = process.argv[2];

if (!key || key === "dry-run") {
  console.error(
    "\n✗ No hay API key de Resend en .env.local (ni OUTREACH_RESEND_API_KEY ni RESEND_API_KEY).\n" +
      "  Añade una y vuelve a ejecutar. Formato: OUTREACH_RESEND_API_KEY=re_xxxxx\n"
  );
  process.exit(1);
}
console.log(`  (usando ${keySource})`);

async function api(path, opts = {}) {
  const r = await fetch("https://api.resend.com" + path, {
    ...opts,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: r.status, body };
}

// ── 1. Dominios (best-effort: una key de solo envío no puede listarlos) ─────
console.log("\n▶ Consultando dominios de la cuenta...");
const dom = await api("/domains");
let domains = [];
if (dom.status === 200) {
  domains = dom.body?.data ?? [];
  if (domains.length === 0) {
    console.log("  (ninguno) — hay que añadir y verificar un dominio antes de enviar.");
  } else {
    const ICON = { verified: "✓", pending: "…", not_started: "·", failed: "✗", temporary_failure: "…" };
    for (const d of domains) {
      console.log(`  ${ICON[d.status] ?? "?"} ${d.name.padEnd(38)} ${d.status}   (${d.region ?? "—"})`);
    }
  }
} else if (dom.status === 401 || dom.status === 403) {
  console.log("  (esta key no puede listar dominios — normal en una key con permiso 'Sending access'. Se salta.)");
} else {
  console.log(`  ⚠ Resend respondió ${dom.status} al listar dominios: ${JSON.stringify(dom.body)}`);
}

// ── 2. FROM configurado en el CRM ──────────────────────────────────────────
const from = process.env.OUTREACH_FROM_EMAIL || process.env.RESEND_FROM_EMAIL;
console.log(`\n▶ Remitente que usaría Outreach: ${from || "(sin configurar — pon OUTREACH_FROM_EMAIL)"}`);
if (from && domains.length) {
  const dpart = from.split("@")[1]?.replace(/>.*$/, "").trim();
  const ok = domains.some((d) => d.status === "verified" && dpart === d.name);
  console.log(ok ? "  ✓ Su dominio está verificado." : `  ⚠ El dominio "${dpart}" no consta verificado en esta cuenta.`);
}

// ── 3. Envío de prueba (opcional) ──────────────────────────────────────────
if (testTo) {
  if (!from) {
    console.error("\n✗ No hay remitente configurado. Añade OUTREACH_FROM_EMAIL a .env.local y reintenta.\n");
    process.exit(1);
  }
  console.log(`\n▶ Enviando correo de PRUEBA a ${testTo}...`);
  const send = await api("/emails", {
    method: "POST",
    body: JSON.stringify({
      from,
      to: testTo,
      subject: "Prueba de envío — Outreach CRM",
      text: "Si lees esto, el envío de correo del módulo Outreach funciona de punta a punta.\n\n— CRM Salamandra",
    }),
  });
  if (send.status === 200 || send.status === 201) {
    console.log(`  ✓ Enviado (id ${send.body?.id ?? "?"}). Revisa el inbox (y la carpeta de spam).\n`);
  } else {
    console.error(`  ✗ Falló (${send.status}): ${send.body?.message || JSON.stringify(send.body)}\n`);
    process.exit(1);
  }
}

process.exit(0);

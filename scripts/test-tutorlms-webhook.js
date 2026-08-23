// @vivo — «Verificación funcional del helper de HMAC en /api/webhooks/tutorlms/*. (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * test-tutorlms-webhook.js
 *
 * Verificación funcional del helper de HMAC en /api/webhooks/tutorlms/*.
 * Lanza tres casos contra /course (sin firma, firma falsa, firma válida)
 * y un smoke test sobre los 4 webhooks restantes (sin firma → 401).
 *
 * Uso:
 *   node --env-file=.env.local scripts/test-tutorlms-webhook.js
 *
 * Pre-requisitos:
 *   - Dev server corriendo en localhost:3000.
 *   - RETORIKA_WEBHOOK_SECRET configurado en el server (mismo valor).
 *   - Tenant `demo` con módulo `training` activo.
 */

import { createHmac } from "crypto";

const BASE = "http://localhost:3000";
const TENANT = "demo";

function hmac(body, secret) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function call(path, body, signatureHeader) {
  const headers = { "Content-Type": "application/json", "x-tenant": TENANT };
  if (signatureHeader !== undefined) headers["X-Retorika-Signature"] = signatureHeader;

  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = { _raw: "<no-json>" };
  }
  return { status: res.status, body: parsed };
}

function line(label, result, expectStatus) {
  const ok = result.status === expectStatus ? "✓" : "✗";
  const msg = result.body?.error ?? JSON.stringify(result.body);
  process.stdout.write(`  ${ok} ${label} → ${result.status} ${msg}\n`);
}

async function main() {
  const secret = process.env.CRM_WEBHOOK_SECRET || process.env.RETORIKA_WEBHOOK_SECRET;
  if (!secret) {
    process.stderr.write("✗ CRM_WEBHOOK_SECRET (o el legacy RETORIKA_WEBHOOK_SECRET) no está en el entorno del script\n");
    process.exit(1);
  }
  process.stdout.write(`Secret cargado: ${secret.slice(0, 8)}…${secret.slice(-4)}\n\n`);

  // ── Paso 2: tres casos contra /course ───────────────────────────────
  const courseBody = JSON.stringify({
    action: "publish",
    course_id: 99999,
    course_title: "Test webhook firma",
    wp_course_id: 99999,
  });

  process.stdout.write("▶ Paso 2 — /api/webhooks/tutorlms/course\n");

  const a = await call("/api/webhooks/tutorlms/course", courseBody, undefined);
  line("CASO A (sin firma)", a, 401);

  const b = await call("/api/webhooks/tutorlms/course", courseBody, "sha256=deadbeef");
  line("CASO B (firma falsa)", b, 401);

  const correct = `sha256=${hmac(courseBody, secret)}`;
  const c = await call("/api/webhooks/tutorlms/course", courseBody, correct);
  // 200 si demo tiene training; 403 si no
  const expectC = c.status === 200 ? 200 : 403;
  line(`CASO C (firma válida, esperado ${c.status === 200 ? "200" : "403"})`, c, expectC);

  // ── Paso 4: smoke test sin firma en los 4 restantes ────────────────
  process.stdout.write("\n▶ Paso 4 — Smoke test sin firma en otros 4 webhooks\n");

  const tests = [
    ["/api/webhooks/tutorlms/enrollment",   JSON.stringify({ course_id: 1, user_email: "test@test.com" })],
    ["/api/webhooks/tutorlms/quiz-attempt", JSON.stringify({ attempt_id: 1 })],
    ["/api/webhooks/tutorlms/sync",         "[]"],
    ["/api/webhooks/tutorlms/sync-courses", "[]"],
  ];

  for (const [path, body] of tests) {
    const r = await call(path, body, undefined);
    line(path, r, 401);
  }

  process.stdout.write("\nDone.\n");
}

main().catch((err) => {
  process.stderr.write(`✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});

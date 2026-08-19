/**
 * check-anthropic.mjs — Diagnóstico de la API de Claude (Anthropic) para Outreach.
 *
 * Confirma que ANTHROPIC_API_KEY se carga bien y avisa de las dos trampas
 * típicas (OUTREACH_FAKE_AI=1 y no haber reiniciado). La clave la configuras TÚ
 * en .env.local — nunca se pide ni se imprime por chat (regla #14).
 *
 * Uso:
 *   # Solo comprobar config (offline, sin gastar nada):
 *   node --env-file=.env.local scripts/check-anthropic.mjs
 *
 *   # Además, hacer una llamada real mínima a Haiku para confirmar que la
 *   # clave es válida (coste ínfimo, ~1 token):
 *   node --env-file=.env.local scripts/check-anthropic.mjs ping
 */

const key = process.env.ANTHROPIC_API_KEY;
const doPing = process.argv[2] === "ping";

console.log("\n▶ Configuración de análisis IA (Outreach)");

// ── 1. ¿Está la clave? (sin imprimirla nunca entera) ────────────────────────
if (!key) {
  console.error(
    "  ✗ ANTHROPIC_API_KEY no está definida.\n" +
      "    Añádela a .env.local:  ANTHROPIC_API_KEY=sk-ant-...\n" +
      "    y REINICIA el servidor (Next.js solo lee el env al arrancar).\n"
  );
  process.exit(1);
}
const masked = key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : "(demasiado corta)";
console.log(`  ✓ ANTHROPIC_API_KEY presente  (${masked}, ${key.length} chars)`);
if (!key.startsWith("sk-ant-")) {
  console.log("  ⚠ No empieza por 'sk-ant-'. Revisa que hayas copiado la clave correcta.");
}

// ── 2. Trampas: modo simulado y entorno ─────────────────────────────────────
const fake = process.env.OUTREACH_FAKE_AI === "1" && process.env.NODE_ENV !== "production";
if (fake) {
  console.log(
    "\n  ⚠ OUTREACH_FAKE_AI=1 → el análisis usará el proveedor SIMULADO y NO llamará a Claude.\n" +
      "    Verás marcadores [SIMULADO] y model='fake'. Quita esa línea (o ponla a 0)\n" +
      "    en .env.local para usar la IA real, y reinicia."
  );
} else {
  console.log("  ✓ Modo real activo (OUTREACH_FAKE_AI no está a 1): se usará Claude de verdad.");
}
console.log(`  · NODE_ENV = ${process.env.NODE_ENV || "(sin definir → development)"}`);

// ── 3. Ping real opcional (Haiku, coste ínfimo) ─────────────────────────────
if (!doPing) {
  console.log("\n  (Para confirmar que la clave es VÁLIDA con una llamada real mínima:  … check-anthropic.mjs ping)\n");
  process.exit(0);
}

console.log("\n▶ Llamando a Claude (Haiku, 1 token) para validar la clave...");
try {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 5,
    messages: [{ role: "user", content: "Responde solo: ok" }],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  console.log(`  ✓ La API respondió correctamente: "${text}". La clave es válida.\n`);
  process.exit(0);
} catch (err) {
  const status = err?.status ? ` (HTTP ${err.status})` : "";
  console.error(`  ✗ Falló la llamada${status}: ${err?.message || err}`);
  if (err?.status === 401) console.error("    → 401 = clave inválida o revocada.");
  if (err?.status === 400) console.error("    → 400 = revisa el ID de modelo o el crédito de la cuenta.");
  console.error("");
  process.exit(1);
}

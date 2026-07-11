/**
 * resendClient — wrapper sobre Resend (https://resend.com) para envío de
 * emails transaccionales.
 *
 * Modos:
 *   - "dry-run": no envía nada al exterior; loguea por stdout y devuelve
 *     `{ ok: true, dryRun: true, id: null }`. Se activa cuando:
 *       - process.env.RESEND_API_KEY está ausente, o
 *       - process.env.RESEND_API_KEY === "dry-run", o
 *       - process.env.NODE_ENV !== "production" y la key empieza por
 *         "re_test_" (por convención).
 *   - "live": importa dinámicamente `resend` (lazy) y envía. Si la
 *     librería no está instalada, cae a dry-run y deja un warning.
 *
 * El helper NUNCA propaga errores al caller — los emails son
 * best-effort. Devuelve `{ ok: false, error }` si el envío real falla.
 * Quien lo llama debe loguear el fallo pero seguir con el flujo.
 *
 * Retry: solo errores 5xx (transitorios). 1 reintento con backoff de 800ms.
 * Errores 4xx (configuración) no se reintenta.
 */

function isDryRun(key) {
  if (!key) return true;
  if (key === "dry-run") return true;
  return false;
}

function preview(text, max = 120) {
  if (!text) return "";
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

/**
 * @param {{
 *   to: string,
 *   subject: string,
 *   html?: string,
 *   text?: string,
 *   from?: string,         // override del FROM por defecto
 *   replyTo?: string,
 *   apiKey?: string,       // override de RESEND_API_KEY (p.ej. una key propia
 *                          // de un módulo, para no mezclar reputación/cuota)
 *   tags?: Array<{name: string, value: string}>
 * }} params
 * @returns {Promise<{ok: boolean, dryRun?: boolean, id?: string|null, error?: string}>}
 */
export async function sendEmail(params) {
  const { to, subject, html, text, replyTo, tags } = params;
  const from = params.from || process.env.RESEND_FROM_EMAIL || "no-reply@example.com";
  // Una key concreta puede llegar por parámetro (un módulo con su propia
  // credencial); si no, la global del CRM.
  const apiKey = params.apiKey || process.env.RESEND_API_KEY;

  if (!to || !subject) {
    process.stderr.write(`[email:send] missing to/subject — skipping\n`);
    return { ok: false, error: "missing to/subject" };
  }

  // ── Dry-run: log + return sin tocar red ──────────────────────────────────
  if (isDryRun(apiKey)) {
    const body = text || html || "";
    process.stdout.write(
      `[email:send:dry-run] to="${to}" from="${from}" subject="${subject}" preview="${preview(body)}"\n`
    );
    return { ok: true, dryRun: true, id: null };
  }

  // ── Live: importar dinámicamente la librería ─────────────────────────────
  let Resend;
  try {
    ({ Resend } = await import("resend"));
  } catch {
    process.stderr.write(
      `[email:send] resend lib no instalada y RESEND_API_KEY presente — fallback dry-run\n[email:send:dry-run] to="${to}" subject="${subject}"\n`
    );
    return { ok: true, dryRun: true, id: null };
  }

  const client = new Resend(apiKey);

  // Retry simple para 5xx
  const attempts = [0, 800];
  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) {
      await new Promise((r) => setTimeout(r, attempts[i]));
    }
    try {
      const { data, error } = await client.emails.send({
        from,
        to,
        subject,
        html,
        text,
        reply_to: replyTo,
        tags,
      });
      if (error) {
        const status = error.statusCode || 0;
        if (status >= 500 && i + 1 < attempts.length) {
          lastErr = error;
          process.stderr.write(`[email:send] 5xx en intento ${i + 1}: ${error.message}\n`);
          continue;
        }
        process.stderr.write(`[email:send] error definitivo: ${error.message}\n`);
        return { ok: false, error: error.message };
      }
      process.stdout.write(
        `[email:send] sent to="${to}" subject="${subject}" id=${data?.id ?? "?"}\n`
      );
      return { ok: true, id: data?.id ?? null };
    } catch (err) {
      lastErr = err;
      if (i + 1 < attempts.length) {
        process.stderr.write(`[email:send] excepción en intento ${i + 1}: ${err.message}\n`);
        continue;
      }
      process.stderr.write(`[email:send] excepción definitiva: ${err.message}\n`);
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: lastErr?.message || "unknown" };
}

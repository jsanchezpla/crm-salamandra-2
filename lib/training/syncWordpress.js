/**
 * lib/training/syncWordpress.js — pedirle a WordPress que lo mande todo
 * (05/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el botón de Formación y el
 * repaso nocturno. Son dos disparadores del MISMO trabajo, y duplicarlo sería
 * garantizar que un día hagan cosas distintas.)
 *
 * ── QUÉ ERA AUTOMÁTICO Y QUÉ NO ─────────────────────────────────────────────
 * El puente TutorLMS → CRM ya avisaba solo al publicar un curso y al
 * matricularse una alumna. Lo que no había forma de hacer sin una persona
 * delante era PONERSE AL DÍA: recuperar lo que se perdió mientras el puente
 * estuvo roto (pasó en julio, cuando faltaba el secreto en wp-config).
 *
 * Para eso existían dos URLs manuales en WordPress, pero exigen sesión de
 * administrador EN ESA WEB, así que el CRM no podía llamarlas: solo podía
 * enlazarlas para que las abriera la profesional. De ahí este canal firmado.
 *
 * ── LA FIRMA ────────────────────────────────────────────────────────────────
 * Mismo esquema que `lib/formularios/portalUser.js`: HMAC sobre el cuerpo con
 * una subclave derivada del secreto del widget y etiqueta de propósito propia
 * (`crm-sync-v1`), para que un token de este canal no valga en el otro.
 *
 * ⚠️ NO se usa el secreto de los WEBHOOKS. Son direcciones distintas: aquel
 * autoriza a WordPress a mandarle cosas al CRM; este autoriza al CRM a pedirle
 * cosas a WordPress.
 */

import crypto from "node:crypto";
import { getWidgetSsoSecret } from "../citas/ssoToken.js";
import { resolverUrlWordpress } from "../formularios/portalUser.js";

const ETIQUETA = "crm-sync-v1";

/**
 * Timeout largo A PROPÓSITO: esto recorre todos los cursos y todas las
 * matrículas de la web y las manda en lotes. Con el timeout de 8 s del resto de
 * llamadas, una academia con cientos de alumnos daría siempre «no respondió a
 * tiempo» aunque el trabajo se estuviera haciendo bien al otro lado.
 */
const TIMEOUT_MS = 120_000;

function derivarClave(secreto) {
  return crypto.createHmac("sha256", secreto).update(ETIQUETA).digest("hex");
}

/**
 * Lanza la sincronización completa contra el WordPress del tenant.
 *
 * Nunca lanza: devuelve siempre un objeto que se puede enseñar o registrar.
 *   { ok:true,  cursos:{...}, matriculas:{...} }
 *   { ok:false, motivo, mensaje }
 */
export async function sincronizarDesdeWordpress(tenant, tenantModels) {
  const wordpressUrl = await resolverUrlWordpress(tenant, tenantModels);
  if (!wordpressUrl) {
    return {
      ok: false,
      motivo: "sin_url",
      mensaje: "No sé cuál es la web de este cliente. Configúrala antes de sincronizar.",
    };
  }

  const secreto = getWidgetSsoSecret(tenant?.slug);
  if (!secreto) {
    return {
      ok: false,
      motivo: "sin_secreto",
      mensaje: "Falta el secreto compartido con la web (WIDGET_SSO_SECRETS).",
    };
  }

  const cuerpo = JSON.stringify({ ts: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID() });
  const firma = crypto.createHmac("sha256", derivarClave(secreto)).update(cuerpo).digest("hex");

  const destino = `${String(wordpressUrl).replace(/\/+$/, "")}/wp-json/crm/v1/sync`;
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(destino, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CRM-Signature": firma },
      body: cuerpo,
      signal: controlador.signal,
    });
    const json = await res.json().catch(() => ({}));

    if (res.status === 404) {
      return {
        ok: false,
        motivo: "sin_soporte",
        mensaje: "La web todavía no tiene la versión del tema que permite sincronizar desde aquí.",
      };
    }
    if (!res.ok && !json?.cursos) {
      return { ok: false, motivo: `http_${res.status}`, mensaje: json?.message || `La web respondió ${res.status}.` };
    }

    return {
      ok: json?.ok === true,
      cursos: json?.cursos ?? null,
      matriculas: json?.matriculas ?? null,
      mensaje: resumir(json),
    };
  } catch (err) {
    const abortado = err?.name === "AbortError";
    return {
      ok: false,
      motivo: abortado ? "timeout" : "red",
      mensaje: abortado
        ? "La web tardó demasiado. Si tiene muchos alumnos, puede haber terminado igualmente: vuelve a mirar en un minuto."
        : `No se ha podido contactar con la web: ${err?.message || "error de red"}`,
    };
  } finally {
    clearTimeout(reloj);
  }
}

/** Una frase para la pantalla, con los números que de verdad importan. */
function resumir(json) {
  const c = json?.cursos;
  const m = json?.matriculas;
  if (!c && !m) return "La web no ha devuelto detalle.";

  const partes = [];
  if (c) partes.push(`${c.encontrados ?? 0} curso(s)`);
  if (m) {
    partes.push(`${m.enviadas ?? 0} matrícula(s)`);
    if (m.saltadas) partes.push(`${m.saltadas} saltada(s) por alumno inexistente`);
  }
  const fallos = [c?.ok === false ? `cursos: ${c.detalle}` : null, m?.ok === false ? `matrículas: ${m.detalle}` : null]
    .filter(Boolean)
    .join(" · ");

  return fallos ? `${partes.join(", ")}. Con errores — ${fallos}` : `${partes.join(", ")}.`;
}

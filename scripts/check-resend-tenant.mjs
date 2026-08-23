// @vivo — Diagnóstico genérico y de solo lectura del correo BYOK de cada cliente (descifra la clave en memoria, lista dominios y estado, nunca la imprime)… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * check-resend-tenant.mjs — ¿el correo de este cliente está de verdad montado?
 *
 * SOLO LECTURA. Coge la clave de Resend que el cliente pegó en Configuración
 * (cifrada en la base de datos), la descifra en memoria y le pregunta a Resend
 * qué dominios tiene y en qué estado. **La clave no se imprime nunca**, ni
 * entera ni en trozos: lo único que sale por pantalla son nombres de dominio y
 * estados (regla #15).
 *
 * Por qué hacía falta otro: `check-resend.mjs` mira la clave del ENTORNO
 * (`RESEND_API_KEY`), y en producción está vacía a propósito — cada cliente
 * manda con la suya (BYOK, `lib/outreach/resendConfig.js`). Ese script no puede
 * ver lo que tiene un cliente concreto, que es justo lo que se pregunta cuando
 * alguien dice «no me llegan los correos».
 *
 * Y de paso mira el CORREO ENTRANTE del módulo Soporte, que es de otra cuenta
 * (la nuestra) y de otro sitio (dos variables del `.env`): dice si están, si el
 * dominio de captura existe en la cuenta y si tiene la recepción encendida.
 *
 * Uso:
 *   node --env-file=.env.local scripts/check-resend-tenant.mjs           (todos)
 *   node --env-file=.env.local scripts/check-resend-tenant.mjs aumenta
 *   node --env-file=.env.production scripts/check-resend-tenant.mjs aumenta
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { decryptSecret } from "../lib/crypto/secretBox.js";

const soloSlug = process.argv[2] || null;

const ICONO = {
  verified: "✓",
  pending: "…",
  not_started: "·",
  failed: "✗",
  temporary_failure: "…",
};

async function resend(key, path) {
  try {
    const r = await fetch("https://api.resend.com" + path, {
      headers: { Authorization: `Bearer ${key}` },
    });
    let body = null;
    try {
      body = await r.json();
    } catch {
      /* sin cuerpo */
    }
    return { status: r.status, body };
  } catch (err) {
    return { status: 0, body: { message: err.message } };
  }
}

/** Los dominios de una cuenta, o null si la clave no puede listarlos. */
async function dominiosDe(key) {
  const r = await resend(key, "/domains");
  if (r.status === 200) return r.body?.data ?? [];
  if (r.status === 401 || r.status === 403) return null; // key de solo envío
  console.log(`    ⚠ Resend respondió ${r.status}: ${r.body?.message ?? JSON.stringify(r.body)}`);
  return null;
}

const db = getMasterDb();
const { Tenant } = getMasterModels();

const donde = soloSlug ? { where: { slug: soloSlug } } : {};
const tenants = await Tenant.findAll({ ...donde, order: [["slug", "ASC"]] });
if (tenants.length === 0) {
  console.error(`\n✗ No hay tenant "${soloSlug}".\n`);
  await db.close();
  process.exit(1);
}

console.log("\n══ SALIDA: cada cliente manda con SU cuenta de Resend ══════════════\n");

// El dominio de captura del entrante se busca en las cuentas de todos, porque
// puede vivir en la nuestra o en la del cliente; se apunta según se recorren.
const dominioCaptura = (process.env.RESEND_INBOUND_DOMAIN || "").trim().toLowerCase();
let capturaEncontradaEn = null;
let capturaEstado = null;

for (const t of tenants) {
  const integ = t.settings?.integrations ?? {};
  const guardada = typeof integ.resendApiKey === "string" ? integ.resendApiKey.trim() : "";
  const from = (integ.resendFromEmail || "").trim();

  if (!guardada) {
    // Sin clave no manda NADA por su cuenta. No es un fallo si no la necesita.
    console.log(`· ${t.slug.padEnd(22)} sin clave de Resend (no manda correo propio)`);
    continue;
  }

  let key = null;
  try {
    key = decryptSecret(guardada).trim();
  } catch (err) {
    console.log(`✗ ${t.slug.padEnd(22)} la clave guardada NO se puede descifrar: ${err.message}`);
    continue;
  }
  if (!key) {
    console.log(`✗ ${t.slug.padEnd(22)} la clave guardada se descifra vacía`);
    continue;
  }

  console.log(`▶ ${t.slug}`);
  console.log(`    remitente: ${from || "(sin poner — el correo saldrá del valor por defecto del .env)"}`);

  const dominios = await dominiosDe(key);
  if (dominios === null) {
    console.log("    dominios: la clave no puede listarlos (permiso 'Sending access'). No se puede comprobar más.");
    continue;
  }
  if (dominios.length === 0) {
    console.log("    ✗ la cuenta no tiene NINGÚN dominio: no puede mandar correo.");
    continue;
  }
  for (const d of dominios) {
    const nombre = String(d.name || "").toLowerCase();
    // Resend marca la recepción en el propio dominio; el nombre del campo ha
    // cambiado entre versiones, así que se miran los que ha usado.
    const recibe = d.inbound ?? d.receiving ?? d.inbound_enabled ?? null;
    const marcaRecepcion = recibe === true ? "  [recibe correo]" : "";
    console.log(`    ${ICONO[d.status] ?? "?"} ${nombre.padEnd(38)} ${d.status}${marcaRecepcion}`);
    if (dominioCaptura && nombre === dominioCaptura) {
      capturaEncontradaEn = t.slug;
      capturaEstado = { estado: d.status, recibe };
    }
  }

  const dominioDelFrom = from.split("@")[1]?.replace(/>.*$/, "").trim().toLowerCase();
  if (dominioDelFrom) {
    const vale = dominios.some((d) => d.status === "verified" && String(d.name).toLowerCase() === dominioDelFrom);
    console.log(
      vale
        ? `    ✓ el remitente sale de un dominio verificado.`
        : `    ⚠ "${dominioDelFrom}" no consta VERIFICADO en esta cuenta: el envío fallará.`
    );
  }
}

console.log("\n══ ENTRADA: el correo que abre tickets (módulo Soporte) ════════════\n");

const secretoWebhook = (process.env.RESEND_WEBHOOK_SECRET || "").trim();
console.log(`  RESEND_INBOUND_DOMAIN  ${dominioCaptura || "✗ SIN PONER"}`);
console.log(`  RESEND_WEBHOOK_SECRET  ${secretoWebhook ? "✓ puesta" : "✗ SIN PONER"}`);

if (!dominioCaptura || !secretoWebhook) {
  console.log(
    "\n  ⚠ SIN LAS DOS NO HAY ENTRADA DE CORREO. Un cliente que escriba a\n" +
      "    soporte-{slug}@… no abre ticket y nadie se entera: el webhook\n" +
      "    responde 503 y Resend no tiene dónde entregar. Los pasos para\n" +
      "    montarlo están en .env.production.example.\n"
  );
} else if (!capturaEncontradaEn) {
  console.log(
    `\n  ⚠ "${dominioCaptura}" NO aparece en ninguna de las cuentas de Resend\n` +
      "    que se han podido mirar. O está en una cuenta distinta, o no se ha\n" +
      "    dado de alta todavía.\n"
  );
} else {
  const { estado, recibe } = capturaEstado;
  console.log(`\n  El dominio de captura está en la cuenta de "${capturaEncontradaEn}": ${estado}`);
  if (estado !== "verified") console.log("  ⚠ sin verificar: Resend aún no entrega nada ahí.");
  if (recibe === false) console.log("  ⚠ tiene la RECEPCIÓN apagada: falta el registro MX.");
  console.log("");
}

// Quién recibiría hoy, para poder probarlo a mano.
const [conSoporte] = await db.query(
  `SELECT t.slug FROM master.tenant_modules tm
     JOIN master.tenants t ON t.id = tm.tenant_id
    WHERE tm.module_key = 'support' AND tm.enabled = true
    ORDER BY t.slug`
);
const slugs = conSoporte.map((r) => r.slug);
if (slugs.length) {
  console.log("  Direcciones de captura de quien tiene Soporte encendido:");
  for (const s of slugs) {
    console.log(`    soporte-${s}@${dominioCaptura || "{RESEND_INBOUND_DOMAIN}"}`);
  }
  console.log("");
}

await db.close();
process.exit(0);

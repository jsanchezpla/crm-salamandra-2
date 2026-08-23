#!/usr/bin/env node
/**
 * scripts/avisar-copia.mjs — el correo de la copia de seguridad.
 *
 * POR QUÉ EXISTE. Hasta el 20/08/2026, si la copia diaria fallaba, el aviso se
 * quedaba en `/var/log/crm-backup.log` y no lo leía nadie. Una copia que falla
 * en silencio es peor que no tener copias: además da tranquilidad.
 *
 * DOS CORREOS, Y EL SEGUNDO NO ES ADORNO. Uno cuando algo falla, y otro los
 * lunes aunque vaya todo bien. Si el servidor muere del todo tampoco llega el
 * de fallo, así que el silencio solo significa algo si se espera un correo cada
 * semana. Lo pidió Jorge el 20/08/2026 con esas palabras.
 *
 * DE QUIÉN SALE. De las credenciales de Resend del tenant `salamandra_solutions`,
 * el mismo camino que ya usa el buzón (`lib/buzon/avisarPorCorreo.js`). NO se usa
 * `RESEND_API_KEY` del entorno: en producción está vacía y `sendEmail` entraría
 * en modo simulacro, devolvería `{ok:true}` y no mandaría nada — que es
 * exactamente el fallo que esto viene a tapar.
 *
 * NUNCA PUEDE TUMBAR LA COPIA. Quien lo llama lo hace con `|| true` y aquí se
 * captura todo: si no hay credenciales, si Resend no contesta o si el tenant no
 * existe, se dice por la salida de error y se acabó. Una copia buena sin correo
 * sigue siendo una copia buena.
 *
 * USO (desde el host del VPS, con la app levantada):
 *   echo "cuerpo" | docker exec -i crm-salamandra-app-1 \
 *     node scripts/avisar-copia.mjs --asunto "..." [--tipo fallo|resumen]
 *
 * El cuerpo llega por la entrada estándar y se lee COMO FLUJO, no de una vez:
 * `docker exec -i` da una tubería no bloqueante y `readFileSync(0)` revienta con
 * EAGAIN en cuanto el texto crece (pasó el 19/08/2026 al subir el Registro).
 */

import { getMasterModels } from "../lib/db/masterDb.js";
import { sendEmail, envioRealizado } from "../lib/email/resendClient.js";
import { getTenantResendConfig } from "../lib/outreach/resendConfig.js";
import { renderLayout, escapeHtml } from "../lib/email/templates/layout.js";

/** Desde cuya cuenta de Resend sale el correo. */
const EMISOR = "salamandra_solutions";
/** A dónde nos llega. Misma variable que usa el buzón. */
const DESTINO = process.env.SOPORTE_EMAIL || "info@salamandrasolutions.com";

function argumento(nombre, pordefecto = "") {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : pordefecto;
}

async function leerCuerpo() {
  const trozos = [];
  for await (const t of process.stdin) trozos.push(t);
  return Buffer.concat(trozos).toString("utf8").trim();
}

const asunto = argumento("asunto", "Copia de seguridad del CRM");
const tipo = argumento("tipo", "resumen") === "fallo" ? "fallo" : "resumen";
const cuerpo = await leerCuerpo();

if (!cuerpo) {
  process.stderr.write("[copia:aviso] sin cuerpo por la entrada estándar: no se manda nada\n");
  process.exit(1);
}

const { Tenant } = await getMasterModels();
const emisor = await Tenant.findOne({ where: { slug: EMISOR } });
if (!emisor) {
  process.stderr.write(`[copia:aviso] no existe el tenant "${EMISOR}": no se puede avisar\n`);
  process.exit(1);
}

const { apiKey, fromEmail, replyTo } = getTenantResendConfig({ tenant: emisor });
if (!apiKey || !fromEmail) {
  process.stderr.write(
    `[copia:aviso] CORREO NO ENVIADO: a "${EMISOR}" le falta ` +
      `${!apiKey ? "la clave de Resend" : "el remitente (from)"}. ` +
      "La copia en sí NO depende de esto: mira el log para saber cómo fue.\n"
  );
  process.exit(1);
}

// El cuerpo es texto plano del script de bash: se escapa entero y solo se
// respetan los saltos de línea. Nada de HTML que venga de fuera.
const html = renderLayout({
  tenantName: "Salamandra Solutions",
  preheader: tipo === "fallo" ? "La copia de esta noche NO se ha hecho" : "La copia diaria sigue en pie",
  title: tipo === "fallo" ? "La copia de seguridad ha fallado" : "Copia de seguridad: parte semanal",
  intro:
    tipo === "fallo"
      ? "Los datos de hoy pueden no estar respaldados. Esto es lo que dice el registro:"
      : "Ningún fallo esta semana. El detalle, por si el tamaño o el número de copias no cuadra:",
  bodyHtml: `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;margin:0">${escapeHtml(cuerpo)}</pre>`,
  footer:
    "Lo manda solo el servidor, desde scripts/backup-db.sh. Si este correo deja " +
    "de llegar los lunes, es que algo va mal aunque nadie avise.",
});

try {
  const res = await sendEmail({
    to: DESTINO,
    subject: asunto,
    html,
    text: cuerpo,
    from: fromEmail,
    replyTo: replyTo || undefined,
    apiKey,
    tags: [{ name: "tipo", value: tipo === "fallo" ? "copia-fallo" : "copia-resumen" }],
  });
  const { salio, motivo } = envioRealizado(res, `copia:${tipo}`);
  process.stdout.write(salio ? `[copia:aviso] correo enviado a ${DESTINO}\n` : `[copia:aviso] no salió: ${motivo}\n`);
  process.exit(salio ? 0 : 1);
} catch (err) {
  process.stderr.write(`[copia:aviso] fallo al enviar: ${err.message}\n`);
  process.exit(1);
}

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
 * Y UN TERCERO, EL AVISO, QUE NO ES UN FALLO (02/09/2026). El chivato del disco
 * y los frenos de la caducidad externa salían con la plantilla de FALLO —«La
 * copia de seguridad ha fallado», «los datos de hoy pueden no estar
 * respaldados»— cuando la copia había salido bien y lo único que pasaba es que
 * el disco andaba justo. Rodrigo leyó dos mañanas seguidas que la copia
 * fallaba, y no fallaba. Un aviso que grita más de lo que pasa se acaba
 * ignorando, y el día que sea de verdad nadie lo mira. Ahora `--tipo aviso`
 * dice lo que es: la copia está hecha, y hay algo que mirar.
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
 *     node scripts/avisar-copia.mjs --asunto "..." [--tipo fallo|aviso|resumen]
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
const TIPOS = ["fallo", "aviso", "resumen"];
const tipoPedido = argumento("tipo", "resumen");
const tipo = TIPOS.includes(tipoPedido) ? tipoPedido : "resumen";
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

// Lo que dice cada tipo. El titular tiene que ser VERDAD: «ha fallado» solo
// cuando la copia no se ha hecho (ver la cabecera, 02/09/2026).
const TEXTOS = {
  fallo: {
    preheader: "La copia de esta noche NO se ha hecho",
    title: "La copia de seguridad ha fallado",
    intro: "Los datos de hoy pueden no estar respaldados. Esto es lo que dice el registro:",
  },
  aviso: {
    preheader: "La copia se ha hecho, pero hay algo que mirar",
    title: "Aviso de la copia de seguridad",
    intro:
      "La copia de esta noche SÍ se ha hecho. Esto no es un fallo, pero conviene " +
      "mirarlo antes de que lo sea:",
  },
  resumen: {
    preheader: "La copia diaria sigue en pie",
    title: "Copia de seguridad: parte semanal",
    intro: "Ningún fallo esta semana. El detalle, por si el tamaño o el número de copias no cuadra:",
  },
};

// El cuerpo es texto plano del script de bash: se escapa entero y solo se
// respetan los saltos de línea. Nada de HTML que venga de fuera.
const html = renderLayout({
  tenantName: "Salamandra Solutions",
  preheader: TEXTOS[tipo].preheader,
  title: TEXTOS[tipo].title,
  intro: TEXTOS[tipo].intro,
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
    tags: [{ name: "tipo", value: `copia-${tipo}` }],
  });
  const { salio, motivo } = envioRealizado(res, `copia:${tipo}`);
  process.stdout.write(salio ? `[copia:aviso] correo enviado a ${DESTINO}\n` : `[copia:aviso] no salió: ${motivo}\n`);
  process.exit(salio ? 0 : 1);
} catch (err) {
  process.stderr.write(`[copia:aviso] fallo al enviar: ${err.message}\n`);
  process.exit(1);
}

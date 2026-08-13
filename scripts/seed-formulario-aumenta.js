/**
 * seed-formulario-aumenta.js — el formulario de FAMILIAS de Aumenta.
 *
 *   node scripts/seed-formulario-aumenta.js <slug>
 *
 * El slug del cliente es OBLIGATORIO, sin valor por defecto. El script hermano
 * de nutri_laura sí lo tiene («nutri_laura» si no pasas nada) y eso es una
 * trampa: como al encontrar el formulario hace `update()` —que REEMPLAZA la
 * lista de preguntas entera, no la fusiona—, una copia lanzada con prisa y sin
 * argumento reescribe la definición viva de otro cliente. Su web, que tiene los
 * nombres de campo escritos a mano, empezaría a devolver «X es obligatorio» en
 * cada envío y su único canal de captación se caería sin que nadie se enterara.
 *
 * Uso VPS: docker compose exec -T app node scripts/seed-formulario-aumenta.js aumenta
 *
 * ── SOLO HAY UN FORMULARIO AQUÍ, Y ES A PROPÓSITO ──────────────────────────
 * El de PROFESIONALES no necesita ninguna fila: no va al módulo Formularios,
 * va al embudo por `/api/public/leads`, y sus preguntas viven en el tema de
 * WordPress. Es exactamente el reparto que tiene tunutrilaura.
 *
 * ── DE DÓNDE SALEN ESTAS PREGUNTAS ─────────────────────────────────────────
 * Son las de tunutrilaura, adaptadas a un centro INFANTIL. Lo que he cambiado,
 * y por qué, para que se pueda revertir en una línea:
 *
 *   · La edad. En el de Laura el mínimo es 14 (la edad legal para consentir el
 *     tratamiento de datos por medios electrónicos), porque su paciente es
 *     quien rellena. Aquí quien rellena es la madre o el padre y la edad que se
 *     pregunta es la del PACIENTE: copiando el 14 tal cual, el CRM rechazaría
 *     con un error casi todos los envíos reales de un centro de atención
 *     infantil.
 *   · Quién rellena y su parentesco. En el formulario de Laura existen en la
 *     web pero NO en su definición del CRM, así que hoy se envían y se tiran
 *     sin dejar rastro. Aquí van declarados, que es lo único que hace que se
 *     guarden.
 *   · La edad del paciente NO sube al campo `age` de la ficha. Ese es el de la
 *     persona titular —la madre o el padre—, y meter ahí los años del paciente
 *     sería un dato falso en la ficha de un adulto. Va a `patientAge`, que es
 *     del paciente.
 *
 * ── SE DICE «PACIENTE», NO «PEQUE» (13/08/2026, Rodrigo) ───────────────────
 * El centro no es solo infantil: los talleres de estimulación cognitiva y la
 * neuropsicología son de adultos, y la propia pregunta 2 ofrece «Soy yo quien
 * necesita ayuda». Llamarle «el peque» a quien viene dejaba fuera a la mitad
 * de la gente a la que atienden.
 *
 * ⚠️ Cambian los ENUNCIADOS; las `key` siguen siendo `nombrePeque` y
 * `edadPeque` y no se tocan. Dos motivos: el `name` de cada campo de la web
 * tiene que coincidir con la `key` o el CRM la descarta en silencio (ver más
 * abajo), y el CRM se siembra desde aquí en el acto mientras que el tema de
 * WordPress lo sube Rodrigo cuando puede — con las claves cambiadas, todo lo
 * que entrara entre un momento y el otro perdería el nombre y la edad sin que
 * saltara ningún error. Las `key` no las ve nadie; los enunciados sí.
 *
 * ── LOS TRES DESTINOS NUEVOS (08/08/2026) ──────────────────────────────────
 * `mapTo` admitía seis valores, todos de la ficha del cliente, así que el
 * parentesco, el nombre del peque y su edad se quedaban en null y aceptar la
 * solicitud creaba una ficha sin paciente y sin tutor: había que teclearlos
 * otra vez a mano. Ahora hay tres destinos más —`relationship`, `patientName`
 * y `patientAge`— que el aceptar convierte en el tutor y el paciente, y solo
 * en clientes con el módulo `pacientes`.
 *
 * ⚠️ Donde NO hay módulo `pacientes` no se pierde nada: los tres siguen
 * apareciendo en «lo que nos contó» (ver `infoAdicional` en
 * lib/formularios/fields.js, que excluye solo los destinos de FICHA).
 *
 * ⚠️ Cualquier valor de `mapTo` fuera de la lista de `DESTINOS` hace que la
 * respuesta se caiga de los dos sitios. O está declarado allí, o va a null.
 */

import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { RELACION_ES_EL_PACIENTE } from "../lib/formularios/fields.js";

const SLUG_TENANT = process.argv[2];
const SLUG_FORM = "familias";

if (!SLUG_TENANT || SLUG_TENANT.startsWith("--")) {
  process.stderr.write("\n✗ Falta el slug del cliente (obligatorio, sin valor por defecto).\n");
  process.stderr.write("  Uso: node scripts/seed-formulario-aumenta.js aumenta\n\n");
  process.exit(1);
}

const CAMPOS = [
  {
    key: "nombre",
    label: "¿Cómo te llamas?",
    type: "text",
    required: true,
    order: 1,
    placeholder: "Tu nombre y apellidos",
    help: "El de la persona adulta que rellena este formulario.",
    maxLength: 120,
    mapTo: "name",
  },
  {
    key: "parentesco",
    label: "¿Quién eres?",
    type: "select",
    required: true,
    order: 2,
    options: ["Madre", "Padre", "Tutor o tutora legal", RELACION_ES_EL_PACIENTE, "Otro"],
    // Se convierte en el TUTOR de la ficha al aceptar. La opción
    // RELACION_ES_EL_PACIENTE significa que no hay ningún menor y corta la
    // creación tanto del tutor como del paciente.
    mapTo: "relationship",
  },
  {
    key: "nombrePeque",
    label: "¿Cómo se llama el paciente?",
    type: "text",
    required: false,
    order: 3,
    placeholder: "Nombre y apellidos",
    help: "Si vienes para ti, puedes dejarlo en blanco.",
    maxLength: 120,
    mapTo: "patientName",
  },
  {
    key: "edadPeque",
    label: "¿Cuántos años tiene?",
    type: "number",
    required: false,
    order: 4,
    placeholder: "Por ejemplo, 6",
    min: 0,
    max: 99,
    mapTo: "patientAge",
  },
  {
    key: "motivo",
    label: "¿Qué os preocupa?",
    type: "textarea",
    required: true,
    order: 5,
    placeholder: "Cuéntanoslo con tus palabras, no hace falta que sepas ponerle nombre.",
    help: "Con lo esencial nos vale. Lo demás lo vemos en la primera cita.",
    maxLength: 2000,
    mapTo: "reason",
  },
  {
    key: "telefono",
    label: "Teléfono",
    type: "tel",
    required: true,
    order: 6,
    placeholder: "600 000 000",
    maxLength: 30,
    mapTo: "phone",
  },
  {
    key: "email",
    label: "Correo electrónico",
    type: "email",
    required: true,
    order: 7,
    placeholder: "tunombre@correo.com",
    help: "Aquí te mandaremos el acceso a tu espacio privado.",
    maxLength: 160,
    mapTo: "email",
  },
  {
    key: "consentimiento",
    label: "He leído y acepto la política de privacidad.",
    type: "consent",
    required: true,
    order: 8,
    linkUrl: "https://aumentafuenlabrada.com/politica-de-privacidad/",
    linkLabel: "política de privacidad",
    help: "Si escribes sobre un menor, hazlo solo si eres su madre, padre o tutor legal.",
    mapTo: null,
  },
];

const DEFINICION = {
  slug: SLUG_FORM,
  title: "Cuéntanos qué necesitáis",
  introText:
    "No hace falta que lo tengas todo claro ni que sepas explicarlo perfectamente. " +
    "Con que nos cuentes lo esencial, del resto nos encargamos nosotras.",
  fields: CAMPOS,
  submitLabel: "Enviar",
  thankYouMessage:
    "Gracias por confiar en nosotras. Hemos recibido lo que nos cuentas y " +
    "nos pondremos en contacto contigo lo antes posible.",
  settings: {
    notifyEmails: ["info@aumentafuenlabrada.com"],
    privacyUrl: "https://aumentafuenlabrada.com/politica-de-privacidad/",
    privacyVersion: "2026-08",
    // Las DESCARTADAS se purgan pasado el plazo; las aceptadas no se tocan
    // nunca, porque ya son familias del centro.
    retentionDays: 365,
    // A dónde le pide el CRM a WordPress que cree la cuenta del área privada
    // cuando se acepta una solicitud.
    wordpressUrl: "https://aumentafuenlabrada.com",
  },
  active: true,
  sortOrder: 0,
};

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(` Formulario de familias — cliente «${SLUG_TENANT}»\n`);
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const { models } = getTenantDb(SLUG_TENANT);
  const { Form } = models;

  const existente = await Form.findOne({ where: { slug: SLUG_FORM } });

  if (existente) {
    // Reemplaza la definición entera, igual que su hermano. Es lo que se
    // quiere al reeditar preguntas, pero conviene saberlo: lo que no esté en
    // CAMPOS desaparece.
    await existente.update(DEFINICION);
    process.stdout.write(`  ✓ Actualizado (${CAMPOS.length} preguntas)\n`);
  } else {
    await Form.create(DEFINICION);
    process.stdout.write(`  ✓ Creado (${CAMPOS.length} preguntas)\n`);
  }

  process.stdout.write(`\n  Dirección pública del formulario:\n`);
  process.stdout.write(`    /api/public/c/${SLUG_TENANT}/formularios/${SLUG_FORM}\n`);
  process.stdout.write(`\n  Las respuestas caen en Interesados → Comerciales.\n\n`);

  await closeAllConnections();
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try { await closeAllConnections(); } catch { /* ya nos vamos */ }
  process.exit(1);
});

/**
 * seed-formulario-nutri-laura.js
 *
 * Siembra (o actualiza) el formulario público de tunutrilaura:
 * «Cuéntame cómo puedo ayudarte».
 *
 * Este script SÍ puede nombrar al tenant: no es una migración de estructura,
 * es un alta de datos, igual que scripts/add-*-module-nutri-laura.js. Las
 * migraciones son las que nunca pueden hardcodear slugs.
 *
 * ORDEN CORRECTO de puesta en marcha:
 *   1. node scripts/enable-module.js nutri_laura formularios   ← activa Y migra
 *   2. node scripts/seed-formulario-nutri-laura.js             ← este
 *
 * Idempotente: si el formulario ya existe se actualiza; nunca se duplica.
 * Cambiar una pregunta es editar este fichero y volver a lanzarlo — sin tocar
 * la web y sin desplegar el CRM.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-formulario-nutri-laura.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/seed-formulario-nutri-laura.js
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

// Por defecto el tenant de Laura. Se puede pasar otro como argumento para
// ensayar el formulario en un tenant de pruebas antes de tocar el suyo:
//   node scripts/seed-formulario-nutri-laura.js demo
const SLUG_TENANT = process.argv[2] || "nutri_laura";
const SLUG_FORM = "consulta";

const CAMPOS = [
  {
    key: "nombre",
    label: "¿Cómo te llamas?",
    type: "text",
    required: true,
    order: 1,
    placeholder: "Tu nombre",
    maxLength: 120,
    mapTo: "name",
  },
  {
    key: "edad",
    label: "¿Cuántos años tienes?",
    type: "number",
    required: true,
    order: 2,
    placeholder: "Por ejemplo, 32",
    // 14 es el mínimo legal para consentir el tratamiento de datos por medios
    // electrónicos en España (art. 7 LOPDGDD). Por debajo, lo rellena un tutor.
    min: 14,
    max: 120,
    help: "Si tienes menos de 14 años, pide a tu madre, padre o tutor que rellene el formulario.",
    mapTo: "age",
  },
  {
    key: "motivo",
    label: "Motivo breve de consulta",
    type: "textarea",
    required: true,
    order: 3,
    placeholder: "Cuéntame en pocas palabras qué te trae por aquí",
    help: "Con una o dos frases me vale. Ya profundizamos cuando hablemos.",
    maxLength: 1000,
    mapTo: "reason",
  },
  {
    key: "motivacion",
    label: "¿Por qué crees que puede ayudarte mi acompañamiento?",
    type: "textarea",
    required: false,
    order: 4,
    placeholder: "Lo que esperas de este proceso",
    maxLength: 1000,
    mapTo: null,
  },
  {
    key: "telefono",
    label: "Déjame tu número de teléfono para contactar contigo cuanto antes",
    type: "tel",
    required: true,
    order: 5,
    placeholder: "600 000 000",
    maxLength: 30,
    mapTo: "phone",
  },
  {
    key: "email",
    label: "Y tu correo electrónico",
    type: "email",
    required: true,
    order: 6,
    placeholder: "tunombre@correo.com",
    help: "Lo necesito para darte acceso a tu área de citas y enviarte tu plan.",
    maxLength: 160,
    mapTo: "email",
  },
  {
    key: "consentimiento",
    label:
      "He leído y acepto la política de privacidad, y doy mi consentimiento expreso para que " +
      "Laura Barbero Mora trate los datos que facilito —incluida la información sobre mi salud— " +
      "con el fin de valorar mi solicitud y ponerse en contacto conmigo.",
    type: "consent",
    required: true,
    order: 7,
    linkUrl: "https://tunutrilaura.com/politica-de-privacidad/",
    linkLabel: "política de privacidad",
    mapTo: null,
  },
];

const DEFINICION = {
  slug: SLUG_FORM,
  title: "Cuéntame cómo puedo ayudarte",
  introText:
    "No hace falta que lo tengas todo claro ni que sepas explicarlo perfectamente. " +
    "Con que me cuentes lo esencial, yo me encargo del resto.",
  fields: CAMPOS,
  submitLabel: "Enviar mi solicitud",
  thankYouMessage:
    "Gracias por interesarte y confiar en mí para este proceso. " +
    "Me pondré en contacto contigo lo antes posible ❤",
  settings: {
    notifyEmails: ["info@tunutrilaura.com"],
    privacyUrl: "https://tunutrilaura.com/politica-de-privacidad/",
    privacyVersion: "2026-07",
    // Las solicitudes DESCARTADAS se purgan pasado este plazo (decisión de
    // Rodrigo, 2026-07-22). Las aceptadas no se tocan: ya son pacientes.
    retentionDays: 365,
    // A dónde pide el CRM que se cree el usuario al aceptar una solicitud.
    wordpressUrl: "https://tunutrilaura.com",
  },
  active: true,
  sortOrder: 0,
};

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Seed: formulario público de tunutrilaura\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const { models } = getTenantDb(SLUG_TENANT);
  const { Form } = models;

  const existente = await Form.findOne({ where: { slug: SLUG_FORM } });

  if (existente) {
    await existente.update(DEFINICION);
    process.stdout.write(`  ✓ Formulario "${SLUG_FORM}" actualizado (${CAMPOS.length} preguntas)\n`);
  } else {
    await Form.create(DEFINICION);
    process.stdout.write(`  ✓ Formulario "${SLUG_FORM}" creado (${CAMPOS.length} preguntas)\n`);
  }

  process.stdout.write("\n  Preguntas:\n");
  for (const c of CAMPOS) {
    const marca = c.required ? "obligatoria" : "opcional  ";
    const destino = c.mapTo ? ` → ficha.${c.mapTo}` : "";
    process.stdout.write(`    ${c.order}. [${marca}] ${c.label.slice(0, 58)}${destino}\n`);
  }

  process.stdout.write(
    `\n  URL pública:\n    /api/public/c/${SLUG_TENANT}/formularios/${SLUG_FORM}\n`
  );
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Listo\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});

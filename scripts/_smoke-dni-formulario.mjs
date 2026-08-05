/**
 * _smoke-dni-formulario.mjs — el DNI se pide una vez y llega hasta la ficha.
 *
 * El DNI del formulario existe para UNA cosa: que cuando llegue el momento de
 * firmar el contrato no haya que volver a pedirlo. Eso solo se cumple si el
 * dato recorre entero el camino formulario → solicitud → ficha → `taxId`, y ese
 * camino cruza tres ficheros. Aquí se recorre de verdad, por HTTP.
 *
 * Es el DNI de QUIEN FIRMA, no el del paciente: en esta consulta el paciente
 * puede ser un menor y quien se identifica es el adulto responsable.
 *
 * Lo que se fija:
 *   · una letra que no corresponde se rechaza (que es el 90% de las erratas);
 *   · un pasaporte o documento extranjero PASA: rechazarlo dejaría fuera a una
 *     paciente extranjera antes de poder contar lo que le pasa;
 *   · se puede enviar SIN DNI — es la puerta de entrada, no un trámite;
 *   · se guarda normalizado (mayúsculas, sin espacios ni guiones);
 *   · al aceptar, aterriza en `Client.taxId`;
 *   · y NO pisa el DNI que ya tuviera una ficha existente.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-dni-formulario.mjs [slug]
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const MARCA = "smoke-dni";
const IP_PRUEBA = `203.0.113.${20 + Math.floor(Math.random() * 200)}`;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

const correo = (q) => `${MARCA}-${q}@example.com`;

let nTelefono = 0;
const telefonoUnico = () => `6001${String(11220 + ++nTelefono).slice(-5)}`;

async function main() {
  process.stdout.write(`\n═══ Smoke: el DNI llega del formulario a la ficha (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { Form, FormSubmission, Client } = models;

  const form = await Form.findOne({ order: [["createdAt", "ASC"]] });
  if (!form) throw new Error("este cliente no tiene formularios");

  const campoDni = (form.fields || []).find((c) => c.type === "dni");
  if (!campoDni) {
    throw new Error(
      "el formulario no tiene campo DNI: pasa antes scripts/add-dni-formulario-nutri-laura.js"
    );
  }

  // Un admin del tenant para poder ACEPTAR la solicitud, que es la mitad de lo
  // que se está probando.
  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  if (!admin) throw new Error("no hay ningún admin en este cliente");
  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });

  /** Envía el formulario con las respuestas obligatorias + el DNI que se le pase. */
  async function enviar(email, dni) {
    // El cuerpo va PLANO —{ clave: valor }—, que es como lo manda el formulario
    // público. Se construye leyendo los campos reales del tenant en vez de
    // escribirlos a mano: así la prueba no se rompe si Laura reordena o
    // renombra una pregunta, que es cosa suya y no un fallo del CRM.
    const cuerpo = {};
    for (const c of form.fields || []) {
      if (c.type === "dni") { if (dni !== undefined) cuerpo[c.key] = dni; continue; }
      if (!c.required) continue;
      if (c.mapTo === "email") cuerpo[c.key] = email;
      else if (c.mapTo === "name") cuerpo[c.key] = "Smoke DNI";
      // Teléfono distinto en cada caso: el endpoint descarta como «doble clic»
      // lo que llega con el mismo teléfono o correo poco después, así que uno
      // fijo haría que del segundo envío en adelante NO se guardara nada — y la
      // prueba buscaría una solicitud que nunca existió.
      else if (c.mapTo === "phone") cuerpo[c.key] = telefonoUnico();
      else if (c.type === "number") cuerpo[c.key] = 30;
      else if (c.type === "consent") cuerpo[c.key] = true;
      else cuerpo[c.key] = "Prueba automática";
    }

    const r = await fetch(`${BASE}/api/public/c/${SLUG}/formularios/${form.slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
      body: JSON.stringify(cuerpo),
    });
    return { status: r.status, cuerpo: await r.json().catch(() => null) };
  }

  /** Acepta la solicitud desde el CRM, como haría la nutricionista. */
  async function aceptar(submissionId, clientId = null) {
    const r = await fetch(`${BASE}/api/formularios/${submissionId}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant": SLUG,
        Cookie: `access_token=${token}`,
      },
      // Sin alta en WordPress: aquí se mide el DNI, no el portal.
      body: JSON.stringify({ crearAcceso: false, ...(clientId ? { clientId } : {}) }),
    });
    return { status: r.status, cuerpo: await r.json().catch(() => null) };
  }

  try {
    paso("Lo que NO se acepta");
    const malo = await enviar(correo("malo"), "12345678A"); // la letra de 12345678 es Z
    esperar(malo.status === 422, `una letra que no corresponde se rechaza (HTTP ${malo.status})`);
    esperar(
      JSON.stringify(malo.cuerpo || {}).toLowerCase().includes("dni"),
      "y se le dice que revise el DNI, no un error genérico"
    );

    paso("Lo que SÍ se acepta");
    const extranjero = await enviar(correo("pasaporte"), "AB-123456");
    esperar(
      extranjero.status === 201 || extranjero.status === 200,
      `un pasaporte o documento extranjero pasa (HTTP ${extranjero.status})`
    );

    const sinDni = await enviar(correo("sin"), undefined);
    esperar(
      sinDni.status === 201 || sinDni.status === 200,
      `se puede enviar SIN DNI: es la puerta de entrada, no un trámite (HTTP ${sinDni.status})`
    );

    paso("Del formulario a la ficha");
    const bueno = await enviar(correo("bueno"), " 12345678-z ");
    esperar(bueno.status === 201 || bueno.status === 200, `envío con DNI correcto (HTTP ${bueno.status})`);

    const sub = await FormSubmission.findOne({
      where: { email: correo("bueno") },
      order: [["createdAt", "DESC"]],
    });
    const guardado = (sub?.answers || []).find((a) => a.key === campoDni.key)?.value;
    esperar(
      guardado === "12345678Z",
      `se guarda normalizado, sin espacios ni guiones y en mayúsculas (es '${guardado}')`
    );

    const acept = await aceptar(sub.id);
    esperar(acept.status === 200, `la nutricionista lo acepta (HTTP ${acept.status})`);

    const ficha = await Client.findByPk(acept.cuerpo?.client?.id);
    esperar(
      ficha?.taxId === "12345678Z",
      `y el DNI aterriza en la ficha, listo para firmar (es '${ficha?.taxId ?? "vacío"}')`
    );

    paso("Lo que no debe pisar");
    const previa = await Client.create({
      type: "individual",
      name: "Smoke DNI Previa",
      email: correo("previa"),
      taxId: "00000001R",
      status: "active",
    });
    const otra = await enviar(correo("previa"), "12345678Z");
    esperar(otra.status === 201 || otra.status === 200, "llega otra solicitud de alguien que ya tiene ficha");
    const sub2 = await FormSubmission.findOne({
      where: { email: correo("previa") },
      order: [["createdAt", "DESC"]],
    });
    await aceptar(sub2.id, previa.id);
    await previa.reload();
    esperar(
      previa.taxId === "00000001R",
      `no se pisa el DNI que ya tenía la ficha (sigue '${previa.taxId}')`
    );
  } finally {
    await FormSubmission.destroy({ where: { email: { [Op.iLike]: `${MARCA}-%` } }, force: true });
    await Client.destroy({ where: { email: { [Op.iLike]: `${MARCA}-%` } }, force: true });
  }

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});

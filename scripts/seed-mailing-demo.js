/**
 * seed-mailing-demo.js — siembra el módulo Mailing en una DEMO: unos correos
 * sueltos, dos segmentos, una firma guardada, una campaña YA ENVIADA con sus
 * métricas (para que se vea cómo queda) y un borrador a medias.
 *
 * Solo opera sobre slugs de `lib/demo/demos.js`: pedirle un cliente real no
 * hace nada. Idempotente por nombre: la segunda vez no duplica.
 *
 * Después de sembrar hay que REHACER la foto dorada de esa demo
 * (`node scripts/demo-golden-snapshot.js <slug>`): si no, la recarga del
 * dashboard vacía las tablas nuevas (lib/demo/resetDemo.js, TRUNCATE CASCADE).
 *
 * Uso:
 *   node --env-file=.env.local scripts/seed-mailing-demo.js demo
 *   docker exec crm-salamandra-app-1 node scripts/seed-mailing-demo.js demo
 */

import { randomUUID } from "node:crypto";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { esSlugDemo } from "../lib/demo/demos.js";

const slug = process.argv[2];
function log(msg) { process.stdout.write(`  ${msg}\n`); }

if (!slug || !esSlugDemo(slug)) {
  process.stderr.write(`\n✗ Solo se siembra en una demo. Uso: node scripts/seed-mailing-demo.js <demo|demo_clinica|demo_nutricion|demo_agencia>\n\n`);
  process.exit(1);
}

const hace = (dias, horas = 0) => new Date(Date.now() - dias * 86400000 - horas * 3600000);
const b = (tipo, campos) => ({ id: randomUUID(), tipo, ...campos });

async function main() {
  const { models } = getTenantDb(slug);
  const { MailingContact, MailingSegment, MailingCampaign, MailingSend, MailingEvent, MailingTemplate, MailingSuppression } = models;

  process.stdout.write(`\n▶ Sembrando Mailing en crm_${slug}\n`);

  // ── Correos sueltos ────────────────────────────────────────────────────────
  const contactos = [
    ["marta.ruiz@ejemplo.com", "Marta Ruiz", "activo", "csv", "Hoja de inscripción de la charla del 12/05/2026"],
    ["pablo.serrano@ejemplo.com", "Pablo Serrano", "activo", "manual", "Lo pidió por teléfono el 20/05/2026"],
    ["laura.gomez@ejemplo.com", "Laura Gómez", "activo", "manual", "Formulario de la web · confirmado por correo"],
    ["ines.castro@ejemplo.com", "Inés Castro", "pendiente", "manual", "pendiente de confirmación por correo"],
    ["jorge.molina@ejemplo.com", "Jorge Molina", "baja", "csv", "Hoja de inscripción de la charla del 12/05/2026"],
  ];
  let nuevos = 0;
  for (const [email, nombre, estado, origen, prueba] of contactos) {
    const [, creado] = await MailingContact.findOrCreate({
      where: { email },
      defaults: {
        email,
        nombre,
        origen,
        estado,
        consentimiento: estado === "pendiente"
          ? { granted: false, at: null, ip: null, userAgent: null, by: null, origen: prueba }
          : { granted: true, at: hace(60).toISOString(), ip: null, userAgent: null, by: origen === "csv" ? "csv" : "equipo", origen: prueba },
        confirmadoAt: estado === "activo" && email.startsWith("laura") ? hace(58) : null,
        confirmacionEnviadaAt: estado === "pendiente" ? hace(3) : null,
        createdBy: "demo@salamandra",
      },
    });
    if (creado) nuevos++;
  }
  await MailingSuppression.findOrCreate({ where: { email: "jorge.molina@ejemplo.com" }, defaults: { email: "jorge.molina@ejemplo.com", motivo: "baja", detalle: "enlace de baja del correo" } });
  await MailingSuppression.findOrCreate({ where: { email: "buzon.inexistente@ejemplo.com" }, defaults: { email: "buzon.inexistente@ejemplo.com", motivo: "rebote", detalle: "Permanent · General · 550 5.1.1 user unknown" } });
  log(`✓ ${nuevos} correos sueltos nuevos, 2 supresiones`);

  // ── Segmentos ──────────────────────────────────────────────────────────────
  const segmentos = [
    ["Familias activas", "Las que vienen hoy: estado Activo.", { fuentes: ["clientes"], modulos: [], estados: ["active"], ultimaCita: null }],
    ["Hace más de 6 meses que no vienen", "Para el correo de «te echamos de menos».", { fuentes: ["clientes"], modulos: [], estados: [], ultimaCita: { tipo: "hace_mas", dias: 180 } }],
    ["Suscriptores sueltos", "Solo los correos que no son de ninguna ficha.", { fuentes: ["contactos"], modulos: [], estados: [], ultimaCita: null }],
  ];
  const segPorNombre = {};
  for (const [nombre, descripcion, reglas] of segmentos) {
    const [seg] = await MailingSegment.findOrCreate({ where: { nombre }, defaults: { nombre, descripcion, reglas, createdBy: "demo@salamandra" } });
    segPorNombre[nombre] = seg;
  }
  log(`✓ ${segmentos.length} segmentos`);

  // ── Firma guardada ─────────────────────────────────────────────────────────
  await MailingTemplate.findOrCreate({
    where: { nombre: "Firma del centro", tipo: "firma" },
    defaults: {
      nombre: "Firma del centro",
      tipo: "firma",
      bloques: [b("firma", { nombre: "Equipo del centro", cargo: "Atención a las familias", empresa: "", telefono: "912 345 678", email: "hola@ejemplo.com", web: "https://ejemplo.com", imagenUrl: "" })],
      createdBy: "demo@salamandra",
    },
  });
  log("✓ firma guardada");

  // ── Campaña enviada, con métricas ──────────────────────────────────────────
  const [enviada, nuevaEnviada] = await MailingCampaign.findOrCreate({
    where: { nombre: "Taller de gestión emocional — septiembre" },
    defaults: {
      nombre: "Taller de gestión emocional — septiembre",
      asunto: "Abrimos plazas para el taller de gestión emocional",
      preheader: "Cuatro sesiones los martes por la tarde. Plazas limitadas.",
      bloques: [
        b("titulo", { texto: "Hola {{nombre}}, volvemos con talleres", nivel: 1, alineacion: "izquierda" }),
        b("texto", { html: "<p>Este mes arrancamos el <strong>taller de gestión emocional</strong> para familias: cuatro sesiones de hora y media, los martes a las 18:00.</p><p>Trabajaremos cómo acompañar las rabietas, los miedos y las frustraciones sin perder la calma (ni la paciencia).</p>" }),
        b("boton", { texto: "Reservar mi plaza", url: "https://ejemplo.com/talleres/gestion-emocional", alineacion: "centro" }),
        b("separador", {}),
        b("texto", { html: "<p>Si tienes dudas, contesta a este correo o llámanos: te contamos cómo va.</p>" }),
        b("firma", { nombre: "Equipo del centro", cargo: "Atención a las familias", empresa: "", telefono: "912 345 678", email: "hola@ejemplo.com", web: "https://ejemplo.com", imagenUrl: "" }),
      ],
      audiencia: "segmento",
      segmentId: segPorNombre["Familias activas"].id,
      estado: "enviada",
      empezadaAt: hace(12, 3),
      terminadaAt: hace(12, 2),
      createdBy: "demo@salamandra",
      createdAt: hace(14),
      updatedAt: hace(12, 2),
    },
  });
  if (nuevaEnviada) {
    const destinatarios = [];
    for (let i = 1; i <= 42; i++) destinatarios.push({ email: `familia${String(i).padStart(2, "0")}@ejemplo.com`, nombre: `Familia ${i}` });
    const filas = destinatarios.map((d, i) => {
      const estado = i === 5 ? "rebotado" : i === 17 ? "fallido" : "enviado";
      const abrio = estado === "enviado" && i % 3 !== 0;
      const clico = abrio && i % 4 === 0;
      return {
        campaignId: enviada.id,
        email: d.email,
        nombre: d.nombre,
        origen: "cliente",
        estado,
        intentos: 1,
        sesMessageId: `demo-${randomUUID()}`,
        error: estado === "rebotado" ? "Permanent · General · 550 user unknown" : estado === "fallido" ? "MessageRejected: Email address is not verified" : null,
        enviadoAt: hace(12, 3 - (i % 60) / 60),
        abiertoAt: abrio ? hace(11, 20 - (i % 10)) : null,
        primerClicAt: clico ? hace(11, 19 - (i % 10)) : null,
        aperturas: abrio ? 1 + (i % 2) : 0,
        clics: clico ? 1 : 0,
      };
    });
    const creadas = await MailingSend.bulkCreate(filas, { ignoreDuplicates: true, returning: true });
    const eventos = [];
    for (const s of creadas) {
      if (s.aperturas > 0) eventos.push({ sendId: s.id, campaignId: enviada.id, tipo: "apertura", createdAt: s.abiertoAt });
      if (s.clics > 0) eventos.push({ sendId: s.id, campaignId: enviada.id, tipo: "clic", url: "https://ejemplo.com/talleres/gestion-emocional", indice: 0, createdAt: s.primerClicAt });
    }
    await MailingEvent.bulkCreate(eventos);
    await enviada.update({ totalDestinatarios: filas.length, enviados: filas.filter((f) => f.estado !== "fallido").length, fallidos: 1, suprimidos: 0 });
    log(`✓ campaña enviada con ${filas.length} destinatarios y ${eventos.length} eventos`);
  } else {
    log("· campaña enviada ya existía");
  }

  // ── Borrador ───────────────────────────────────────────────────────────────
  const [, nuevoBorrador] = await MailingCampaign.findOrCreate({
    where: { nombre: "Newsletter de octubre" },
    defaults: {
      nombre: "Newsletter de octubre",
      asunto: "Lo que llega en octubre al centro",
      preheader: "",
      bloques: [
        b("titulo", { texto: "Octubre en el centro", nivel: 1, alineacion: "izquierda" }),
        b("texto", { html: "<p>Un repaso rápido a lo que viene: nuevos horarios de tarde, la charla para familias del día 15 y el grupo de adolescentes que abre plazas.</p>" }),
        b("imagen", { url: "", alt: "Cartel de octubre", enlace: "", ancho: "completa" }),
      ],
      audiencia: "todos",
      estado: "borrador",
      createdBy: "demo@salamandra",
    },
  });
  log(nuevoBorrador ? "✓ borrador creado" : "· borrador ya existía");

  process.stdout.write(`\n✓ Listo. Recuerda rehacer la foto dorada: node scripts/demo-golden-snapshot.js ${slug}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});

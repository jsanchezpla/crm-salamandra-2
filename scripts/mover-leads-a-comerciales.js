/**
 * mover-leads-a-comerciales.js — pasa los leads de FAMILIAS a la bandeja de
 * Comerciales, que es donde tienen que estar desde que el formulario se partió
 * en dos (08/08/2026, decisión de Rodrigo).
 *
 *   node scripts/mover-leads-a-comerciales.js <slug> <slug-formulario> [--confirm]
 *
 * SIN `--confirm` no escribe NADA: enseña uno a uno qué haría y se va. Es la
 * regla de la casa para todo lo que toca datos, y aquí más: son personas que
 * escribieron pidiendo ayuda para sus hijos.
 *
 * ── QUÉ HACE, EN CRISTIANO ─────────────────────────────────────────────────
 * «Profesionales» y «Comerciales» NO son la misma tabla: la primera son leads
 * de un embudo y la segunda solicitudes de formulario. Así que mover uno no es
 * cambiarle una etiqueta: hay que CREAR la solicitud a partir del lead y
 * retirar el original. Por eso esto es un script y no un botón.
 *
 * Se mueven solo los de `tipo_usuario = 'ciudadano'`. Los profesionales se
 * quedan en el embudo, que es su sitio.
 *
 * ── EL CONSENTIMIENTO SE QUEDA VACÍO, Y ES A PROPÓSITO ─────────────────────
 * Una solicitud guarda cuándo y qué consintió la persona. Estas rellenaron el
 * formulario viejo, que NO tenía casilla de consentimiento: nunca lo dieron en
 * esos términos. Así que `consentAt` se queda a null y en las notas internas se
 * escribe por qué. Rellenarlo con la fecha de hoy sería fabricar una prueba de
 * algo que no ocurrió — y una prueba de consentimiento inventada es peor que no
 * tener ninguna.
 *
 * ── LO QUE SE CONSERVA ─────────────────────────────────────────────────────
 * Nombre, correo y teléfono van a sus columnas. Todo lo demás —motivo, servicio,
 * curso, taller y el mensaje— se guarda como respuestas, con su etiqueta, para
 * que se lea igual que una solicitud normal. Y en las notas queda de dónde
 * viene y cuándo entró de verdad.
 *
 * Idempotente: un lead ya movido se reconoce por su id en las notas y se salta.
 *
 * Uso VPS: docker compose exec -T app node scripts/mover-leads-a-comerciales.js aumenta familias
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const sueltos = args.filter((a) => !a.startsWith("--"));
const [slugTenant, slugForm] = sueltos;
const confirmar = args.includes("--confirm");

if (!slugTenant || !slugForm) {
  process.stderr.write("\n✗ Faltan argumentos.\n");
  process.stderr.write("  Uso: node scripts/mover-leads-a-comerciales.js <slug> <slug-formulario> [--confirm]\n\n");
  process.exit(1);
}

/** Etiquetas legibles para lo que el lead guardaba en columnas sueltas. */
const ETIQUETAS = {
  motivo: "Motivo de consulta",
  servicio: "Servicio de interés",
  curso: "Cursos de interés",
  taller: "Talleres de interés",
  mensaje: "Lo que nos contó",
};

function respuestasDe(lead) {
  const out = [];
  for (const [clave, etiqueta] of Object.entries(ETIQUETAS)) {
    const v = lead[clave];
    if (v == null || String(v).trim() === "") continue;
    out.push({ key: clave, label: etiqueta, type: "textarea", value: String(v) });
  }
  return out;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(`  Leads de familias → Comerciales · cliente «${slugTenant}»`);
  process.stdout.write(confirmar ? "\n" : "   (SIMULACRO)\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n");

  await getMasterDb();
  const { models } = getTenantDb(slugTenant);
  const { Lead, Form, FormSubmission } = models;

  const form = await Form.findOne({ where: { slug: slugForm } });
  if (!form) {
    process.stderr.write(`\n  ✗ No existe el formulario «${slugForm}» en «${slugTenant}».\n`);
    process.stderr.write(`    Créalo antes con seed-formulario-aumenta.js.\n\n`);
    process.exit(1);
  }

  const candidatos = await Lead.findAll({
    where: { tipo_usuario: "ciudadano" },
    order: [["createdAt", "ASC"]],
  });

  process.stdout.write(`\n  Formulario destino: «${form.title}» (${form.slug})\n`);
  process.stdout.write(`  Leads de tipo ciudadano: ${candidatos.length}\n\n`);

  if (candidatos.length === 0) {
    process.stdout.write("  No hay nada que mover.\n\n");
    await closeAllConnections();
    return;
  }

  // Los que ya se movieron en una pasada anterior. La marca va en las notas
  // internas porque es el único campo libre que sobrevive a todo.
  const yaMovidos = await FormSubmission.findAll({ attributes: ["internalNotes"] });
  const vistos = new Set();
  for (const s of yaMovidos) {
    const m = /lead:([0-9a-f-]{36})/i.exec(s.internalNotes || "");
    if (m) vistos.add(m[1]);
  }

  let movidos = 0;
  let saltados = 0;

  for (const lead of candidatos) {
    const l = lead.get({ plain: true });
    const fecha = new Date(l.createdAt).toISOString().slice(0, 10);

    if (vistos.has(l.id)) {
      process.stdout.write(`  ·  ya movido      ${fecha}  ${String(l.name ?? "(sin nombre)").slice(0, 34)}\n`);
      saltados += 1;
      continue;
    }

    const respuestas = respuestasDe(l);
    const notas =
      `Traído del embudo de Profesionales el ${new Date().toISOString().slice(0, 10)} (lead:${l.id}).\n` +
      `Entró por la web el ${fecha}, con el formulario antiguo.\n` +
      `SIN PRUEBA DE CONSENTIMIENTO: aquel formulario no tenía casilla, así que ` +
      `esta persona nunca lo dio en estos términos. No se rellena con una fecha inventada.`;

    process.stdout.write(
      `  ${confirmar ? "→" : "·"}  ${fecha}  ${String(l.name ?? "(sin nombre)").slice(0, 30).padEnd(30)} ` +
      `${respuestas.length} respuesta(s)\n`
    );

    if (!confirmar) {
      movidos += 1;
      continue;
    }

    // La solicitud primero y el lead después: si algo falla entre medias,
    // prefiero una solicitud duplicada (que se ve y se borra) antes que un
    // lead borrado cuya solicitud nunca llegó a crearse.
    await FormSubmission.create({
      formId: form.id,
      formSlug: form.slug,
      formTitle: form.title,
      name: l.name ?? null,
      email: l.email ?? null,
      phone: l.phone ?? null,
      answers: respuestas,
      status: "pending",
      sourceUrl: null,
      spamScore: 0,
      consentAt: null,       // nunca lo dieron: ver la cabecera
      consentText: null,
      consentVersion: null,
      internalNotes: notas,
      createdAt: l.createdAt, // se conserva CUÁNDO escribió de verdad
    });

    await lead.destroy();
    movidos += 1;
  }

  process.stdout.write(`\n  ${confirmar ? "Movidos" : "Se moverían"}: ${movidos}`);
  if (saltados) process.stdout.write(`  ·  ya estaban: ${saltados}`);
  process.stdout.write(`\n`);

  const quedan = await Lead.count();
  process.stdout.write(`  Quedan en el embudo: ${confirmar ? quedan : quedan - movidos} (los profesionales)\n`);

  if (!confirmar) {
    process.stdout.write(`\n  · Simulacro: no se ha escrito nada. Repite con --confirm.\n`);
  }
  process.stdout.write("\n");

  await closeAllConnections();
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try { await closeAllConnections(); } catch { /* ya nos vamos */ }
  process.exit(1);
});

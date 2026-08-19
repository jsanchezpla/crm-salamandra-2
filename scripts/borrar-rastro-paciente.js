// @vivo — Herramienta genérica de mantenimiento: recibe --email y --tenant, descubre las tablas en information_schema cada vez («una lista escrita a mano… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * borrar-rastro-paciente.js — quitar de un cliente todo rastro de un paciente.
 *
 * PARA QUÉ
 * Las pruebas dejan restos. Antes de que un centro empiece a usar el CRM de
 * verdad hay que sacar los pacientes de prueba de su base de datos, y hacerlo a
 * mano es justo como se olvida una tabla: el rastro de una persona no está solo
 * en `clients`, está repartido por veinte tablas del schema.
 *
 * CÓMO ENCUENTRA LAS COSAS
 * No lleva la lista de tablas escrita dentro. La descubre en `information_schema`
 * cada vez que se ejecuta: cualquier tabla del schema con una columna de correo
 * o con `client_id`. Una lista escrita a mano envejece —llega un módulo nuevo,
 * nadie se acuerda de este fichero— y el día que envejezca dejaría restos sin
 * que nadie se entere, que es exactamente lo que se quiere evitar.
 *
 * LO QUE NO TOCA, A PROPÓSITO
 *   · `master.users` — las cuentas de acceso al CRM. El correo de un paciente
 *     puede ser también el de alguien del equipo (pasa con las direcciones de
 *     prueba de la propia casa): borrar ahí dejaría a esa persona sin entrar.
 *   · `master.audit_log` — regla del proyecto: los registros de auditoría no se
 *     borran nunca. Son el rastro de QUIÉN hizo qué, no datos del paciente.
 *   · El WordPress del centro. Si se le creó acceso al portal, se quita allí.
 *
 * SEGURIDAD
 *   · Sin `--borrar` NO escribe nada: enseña el inventario y se va.
 *   · Con `--borrar` vuelca antes un respaldo JSON con las filas exactas que va
 *     a quitar, y borra dentro de UNA transacción: o se va todo, o no se va nada.
 *
 * Uso:
 *   node --env-file=.env.local scripts/borrar-rastro-paciente.js --email a@b.com [--tenant nutri_laura]
 *   node --env-file=.env.local scripts/borrar-rastro-paciente.js --email a@b.com --borrar
 *
 * En producción (desde el VPS). Mirar primero, borrar después, y sacar el
 * respaldo del contenedor —dentro se pierde en el siguiente despliegue—:
 *   docker exec -it crm-salamandra-app-1 node scripts/borrar-rastro-paciente.js --email a@b.com
 *   docker exec -it crm-salamandra-app-1 node scripts/borrar-rastro-paciente.js --email a@b.com --borrar --respaldo /tmp/rastro.json
 *   docker cp crm-salamandra-app-1:/tmp/rastro.json ./rastro-a-b-com.json
 */

import { writeFileSync } from "node:fs";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const valorDe = (bandera) => {
  const i = args.indexOf(bandera);
  return i >= 0 ? args[i + 1] : null;
};

const EMAIL = (valorDe("--email") || "").trim().toLowerCase();
const SLUG = valorDe("--tenant") || "nutri_laura";
const BORRAR = args.includes("--borrar");

if (!EMAIL || !EMAIL.includes("@")) {
  process.stderr.write("\nFalta --email. Ejemplo:\n  node scripts/borrar-rastro-paciente.js --email persona@ejemplo.com\n\n");
  process.exit(1);
}

const SCHEMA = `crm_${SLUG}`;
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

async function main() {
  process.stdout.write(`\n═══ Rastro de ${EMAIL} en ${SCHEMA}${BORRAR ? "" : " · SOLO MIRAR"} ═══\n`);

  const { sequelize } = getTenantDb(SLUG);

  // ── 1. Qué tablas pueden guardar rastro, según la BD de hoy ───────────────
  const [columnas] = await sequelize.query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = :s
        AND t.table_type = 'BASE TABLE'
        AND (c.column_name ILIKE '%email%' OR c.column_name = 'client_id')`,
    { replacements: { s: SCHEMA } }
  );

  // `email_status` lleva "email" en el nombre pero es el estado de un envío, no
  // una dirección. Se descarta por tipo, no por nombre, para no tener que ir
  // añadiendo excepciones cada vez que aparezca una columna parecida.
  const [tiposTexto] = await sequelize.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = :s AND data_type IN ('text','character varying','citext')`,
    { replacements: { s: SCHEMA } }
  );
  const esTexto = new Set(tiposTexto.map((r) => `${r.table_name}.${r.column_name}`));

  const porEmail = {};
  const porCliente = new Set();
  for (const c of columnas) {
    if (c.column_name === "client_id") { porCliente.add(c.table_name); continue; }
    if (!/email/i.test(c.column_name)) continue;
    if (/status|estado/i.test(c.column_name)) continue;
    if (!esTexto.has(`${c.table_name}.${c.column_name}`)) continue;
    (porEmail[c.table_name] ??= []).push(c.column_name);
  }

  // ── 2. ¿Qué fichas tiene esa persona? ────────────────────────────────────
  const colsCliente = porEmail["clients"] || ["email"];
  const dondeCliente = colsCliente.map((c) => `${q(c)} ILIKE :e`).join(" OR ");
  const [fichas] = await sequelize.query(
    `SELECT id, name, email, created_at FROM ${q(SCHEMA)}.${q("clients")} WHERE ${dondeCliente}`,
    { replacements: { e: EMAIL } }
  );
  const idsCliente = fichas.map((f) => f.id);

  if (fichas.length) {
    process.stdout.write(`\n  Fichas de cliente: ${fichas.length}\n`);
    for (const f of fichas) process.stdout.write(`    · ${f.name} — ${f.email} (alta ${String(f.created_at).slice(0, 10)})\n`);
  } else {
    process.stdout.write(`\n  No tiene ficha de cliente.\n`);
  }

  // ── 3. Inventario tabla por tabla ────────────────────────────────────────
  const inventario = [];
  const tablas = new Set([...Object.keys(porEmail), ...porCliente]);

  for (const tabla of [...tablas].sort()) {
    const trozos = [];
    const repl = {};
    for (const col of porEmail[tabla] || []) {
      trozos.push(`${q(col)} ILIKE :e`);
      repl.e = EMAIL;
    }
    if (porCliente.has(tabla) && idsCliente.length) {
      trozos.push(`${q("client_id")} IN (:ids)`);
      repl.ids = idsCliente;
    }
    if (!trozos.length) continue;

    const [filas] = await sequelize.query(
      `SELECT * FROM ${q(SCHEMA)}.${q(tabla)} WHERE ${trozos.join(" OR ")}`,
      { replacements: repl }
    );
    if (filas.length) inventario.push({ tabla, filas });
  }

  // ── 4. Lo que cuelga de sus citas y no lleva su correo ───────────────────
  // Las sesiones de pago se enlazan por entidad, no por persona: sin este paso
  // quedarían apuntando a una cita que ya no existe.
  const citas = inventario.find((i) => i.tabla === "bookings");
  if (citas) {
    const idsCita = citas.filas.map((f) => f.id);
    const [existe] = await sequelize.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = :s AND table_name = 'payment_sessions'`,
      { replacements: { s: SCHEMA } }
    );
    if (existe.length && idsCita.length) {
      const [pagos] = await sequelize.query(
        `SELECT * FROM ${q(SCHEMA)}.${q("payment_sessions")}
          WHERE ${q("entity_type")} = 'booking' AND ${q("entity_id")} IN (:ids)`,
        { replacements: { ids: idsCita } }
      );
      if (pagos.length) inventario.push({ tabla: "payment_sessions", filas: pagos });
    }
  }

  if (!inventario.length) {
    process.stdout.write(`\n  Ni un rastro. Nada que borrar.\n\n`);
    return;
  }

  process.stdout.write(`\n  Rastro encontrado:\n`);
  let total = 0;
  for (const { tabla, filas } of inventario) {
    total += filas.length;
    process.stdout.write(`    ${String(filas.length).padStart(4)} × ${tabla}\n`);
    for (const f of filas.slice(0, 3)) {
      const pista = f.name || f.client_name || f.title || f.subject || f.scheduled_at || f.created_at || f.id;
      process.stdout.write(`           ${String(pista).slice(0, 70)}\n`);
    }
    if (filas.length > 3) process.stdout.write(`           … y ${filas.length - 3} más\n`);
  }
  process.stdout.write(`\n  Total: ${total} filas en ${inventario.length} tablas.\n`);

  if (!BORRAR) {
    process.stdout.write(`\n  No se ha borrado nada. Para borrarlo de verdad, repite con --borrar\n\n`);
    return;
  }

  // ── 5. Respaldo antes de tocar nada ──────────────────────────────────────
  // Por defecto cae en el directorio de trabajo. En producción eso es DENTRO
  // del contenedor, así que se va con él en el siguiente despliegue: para
  // guardarlo de verdad hay que sacarlo con `docker cp` (ver la cabecera) o
  // indicar una ruta montada con --respaldo.
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const respaldo =
    valorDe("--respaldo") || `rastro-${SLUG}-${EMAIL.replace(/[^a-z0-9]/gi, "_")}-${sello}.json`;
  writeFileSync(respaldo, JSON.stringify({ schema: SCHEMA, email: EMAIL, inventario }, null, 2), "utf8");
  process.stdout.write(`\n  Respaldo escrito en ${respaldo}\n`);

  // ── 6. Borrado, todo o nada ──────────────────────────────────────────────
  // `clients` va la ÚLTIMA: el resto de tablas la referencian y borrarla antes
  // dejaría a las demás apuntando al vacío (o las arrastraría en cascada sin
  // que quedaran en el respaldo).
  const orden = [
    ...inventario.filter((i) => i.tabla !== "clients"),
    ...inventario.filter((i) => i.tabla === "clients"),
  ];

  const t = await sequelize.transaction();
  try {
    for (const { tabla, filas } of orden) {
      const ids = filas.map((f) => f.id).filter(Boolean);
      if (!ids.length) continue;
      const [, meta] = await sequelize.query(
        `DELETE FROM ${q(SCHEMA)}.${q(tabla)} WHERE id IN (:ids)`,
        { replacements: { ids }, transaction: t }
      );
      process.stdout.write(`    borradas ${String(meta?.rowCount ?? ids.length).padStart(4)} de ${tabla}\n`);
    }
    await t.commit();
    process.stdout.write(`\n═══ Hecho. ${total} filas fuera de ${SCHEMA}. ═══\n`);
    process.stdout.write(`  Recuerda: su acceso al portal (WordPress) se quita aparte.\n\n`);
  } catch (err) {
    await t.rollback();
    process.stderr.write(`\n✗ Nada borrado (se ha deshecho todo): ${err.message}\n\n`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
    process.exit(1);
  });

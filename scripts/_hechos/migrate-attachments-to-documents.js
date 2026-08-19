/**
 * migrate-attachments-to-documents.js
 *
 * Migra los adjuntos viejos (tabla client_attachments) al ARCHIVO CENTRAL
 * (tabla documents, source='ficha'). Parte del sprint que unifica los dos
 * silos de ficheros (2026-07-23).
 *
 * Por cada client_attachment:
 *   1. Crea una fila en documents con clientId, source='ficha',
 *      visibility='shared', el mismo nombre/tamaño/MIME y un id nuevo.
 *   2. MUEVE el fichero de  uploads/{slug}/clients/{clientId}/{stored}
 *      a  uploads/documents/{slug}/shared/{docId}.{ext}
 *   3. Borra la fila vieja de client_attachments.
 *
 * IDEMPOTENTE por marca: si un client_attachment ya tiene su gemelo en
 * documents (se detecta por un doc con misma clientId + fileName + fileSize +
 * source='ficha'), no se duplica.
 *
 * SEGURO: si el fichero físico no está, se registra y se salta (no se pierde
 * la fila vieja). Solo borra el original DESPUÉS de copiarlo con éxito.
 *
 * Lee la lista de schemas de master.tenants (nunca hardcodea slugs).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-attachments-to-documents.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-attachments-to-documents.js
 */

import { Sequelize } from "sequelize";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

function uploadsRoot() {
  if (process.env.UPLOADS_ROOT) return process.env.UPLOADS_ROOT;
  if (process.env.NODE_ENV === "production") return "/app/uploads";
  return path.join(process.cwd(), "uploads");
}

function extFromName(name) {
  const m = typeof name === "string" ? name.match(/\.([A-Za-z0-9]{1,10})$/) : null;
  return m ? m[1].toLowerCase() : "pdf"; // los viejos son PDF
}

async function schemasConTabla(s, tabla) {
  const [rows] = await s.query(
    `SELECT table_schema FROM information_schema.tables
      WHERE table_name = :tabla AND table_schema LIKE 'crm_%' ORDER BY table_schema`,
    { replacements: { tabla } }
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSchemas(rows.map((r) => r.table_schema));
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: adjuntos de ficha → archivo central\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const ROOT = uploadsRoot();

  const schemas = await schemasConTabla(s, "client_attachments");
  if (schemas.length === 0) log("· Ningún schema con client_attachments.");

  let migrados = 0;
  let saltados = 0;

  for (const schema of schemas) {
    const slug = schema.replace(/^crm_/, "");
    // ¿Existe documents en este schema? (debería, tras el transversal.)
    const [[{ hayDocs }]] = await s.query(
      `SELECT to_regclass('"${schema}"."documents"') IS NOT NULL AS "hayDocs"`
    );
    if (!hayDocs) { log(`· ${schema}: sin tabla documents (¿falta el transversal?), se salta`); continue; }

    const [adjuntos] = await s.query(
      `SELECT id, client_id, original_name, stored_filename, mime_type, file_size, uploaded_by
         FROM "${schema}"."client_attachments" ORDER BY created_at ASC`
    );

    for (const a of adjuntos) {
      let destAbs = null;
      try {
        // Idempotencia por BORRADO (arreglo 2026-07-23): NO se compara por
        // nombre+tamaño (no son únicos: dos adjuntos iguales colapsaban en uno
        // y se perdía el segundo). Cada fila de client_attachments que SIGA
        // existiendo es, por definición, una que aún no se migró — la
        // transacción borra la vieja al migrar. Así re-ejecutar solo ve las
        // pendientes y nunca duplica ni pierde.
        const origen = path.join(ROOT, slug, "clients", a.client_id, a.stored_filename);
        try {
          await fs.access(origen);
        } catch {
          log(`· ${schema}: fichero ausente para "${a.original_name}" — se deja la fila vieja intacta`);
          saltados++;
          continue;
        }

        const docId = randomUUID();
        const ext = extFromName(a.original_name);
        const destDir = path.join(ROOT, "documents", slug, "shared");
        const destRel = `documents/${slug}/shared/${docId}.${ext}`;
        destAbs = path.join(destDir, `${docId}.${ext}`);
        await fs.mkdir(destDir, { recursive: true });
        // Copiar primero (no mover) para no perder el original si algo falla.
        await fs.copyFile(origen, destAbs);

        // owner_user_id (NOT NULL, sin FK): el uploaded_by si es UUID; si es un
        // email o falta, un UUID de sistema.
        const SYSTEM_UUID = "00000000-0000-0000-0000-000000000000";
        const owner = /^[0-9a-f-]{36}$/i.test(a.uploaded_by || "") ? a.uploaded_by : SYSTEM_UUID;

        await s.transaction(async (t) => {
          await s.query(
            `INSERT INTO "${schema}"."documents"
               (id, folder_id, visibility, owner_user_id, file_name, storage_path,
                file_size, mime_type, client_id, source, created_at, updated_at)
             VALUES (:id, NULL, 'shared', :owner, :fn, :sp, :fs, :mt, :cid, 'ficha', NOW(), NOW())`,
            {
              replacements: {
                id: docId, owner, fn: a.original_name, sp: destRel,
                fs: a.file_size, mt: a.mime_type, cid: a.client_id,
              },
              transaction: t,
            }
          );
          await s.query(`DELETE FROM "${schema}"."client_attachments" WHERE id = :id`, {
            replacements: { id: a.id }, transaction: t,
          });
        });

        // Ya en documents y borrada la fila vieja: quitar el fichero original.
        await fs.unlink(origen).catch(() => {});
        migrados++;
        log(`✓ ${schema}: "${a.original_name}" → archivo central`);
      } catch (err) {
        // Si la transacción falló tras copiar, borrar el destino huérfano para
        // no dejar basura que además se re-copiaría en el siguiente intento.
        if (destAbs) await fs.unlink(destAbs).catch(() => {});
        log(`✗ ${schema}: "${a.original_name}" — ${err.message}`);
        saltados++;
      }
    }
  }

  process.stdout.write(`\n──────────────────────────────────────────────────\n`);
  log(`Migrados: ${migrados} · saltados/ya migrados: ${saltados}`);
  process.stdout.write(`──────────────────────────────────────────────────\n\n`);

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});

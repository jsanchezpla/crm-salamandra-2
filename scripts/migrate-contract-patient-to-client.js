/**
 * migrate-contract-patient-to-client.js — mueve el CONTRATO del paciente a la
 * familia (sprint Aumenta 2026-07, punto 1.1). ONE_OFF.
 *
 * QUÉ CAMBIA: el contrato vivía en `patients.contract_file` (JSONB) con el PDF
 * en {uploads}/{slug}/patients/{id}/. Pasa a ser una fila de `documents`
 * (source='contrato', client_id del pagador) apuntada por
 * `clients.contract_document_id`. Motivo: quien firma y quien paga son los
 * padres, y con dos hermanos en el centro había DOS contratos para UNA familia.
 *
 * NO BASTA CON CAMBIAR DÓNDE SE GUARDA: hay contratos ya subidos. Este script
 * los mueve. Sin él, un centro con contratos cargados los vería desaparecer de
 * la ficha el día del despliegue.
 *
 * CRITERIO (determinista, sin adivinar):
 *   - Solo se mueve el contrato de un paciente que YA tiene cliente pagador
 *     (`patients.client_id`). Sin pagador no hay a quién atribuirlo: se lista y
 *     se queda donde está (el endpoint viejo sigue sirviendo su descarga).
 *   - Si dos hermanos de la MISMA familia tienen contrato, se mueve el más
 *     reciente y el otro se lista y se deja intacto. Elegir por nombre o al azar
 *     sería peor que no hacer nada.
 *   - Nunca se pisa un `contract_document_id` que ya esté puesto.
 *
 * SEGURIDAD DE LA OPERACIÓN:
 *   - DRY RUN por defecto: sin `--confirm` solo cuenta lo que haría.
 *   - El PDF se COPIA, no se mueve: el original sigue en su sitio, así que el
 *     rollback no depende de restaurar ficheros.
 *   - Genera un .rollback.sql con las filas exactas que tocó.
 *
 * Uso:
 *   node --env-file=.env.local scripts/migrate-contract-patient-to-client.js
 *   node --env-file=.env.local scripts/migrate-contract-patient-to-client.js --confirm
 *   docker exec crm-salamandra-app-1 node scripts/migrate-contract-patient-to-client.js --confirm
 */

import { Sequelize } from "sequelize";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CONFIRM = process.argv.includes("--confirm");
const SOURCE = "contrato";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// Misma raíz que lib/documents/documentStorage.js y lib/clients/attachmentStorage.js.
function uploadsRoot() {
  if (process.env.UPLOADS_ROOT) return process.env.UPLOADS_ROOT;
  if (process.env.NODE_ENV === "production") return "/app/uploads";
  return join(process.cwd(), "uploads");
}

function rutaRollback(nombre) {
  const dir = process.env.ROLLBACK_DIR || tmpdir();
  try { mkdirSync(dir, { recursive: true }); } catch { /* ya existe */ }
  return join(dir, nombre);
}

/** Schemas que tienen las tres piezas: pacientes, archivo central y el puntero. */
async function schemasAptos(s) {
  const only = (process.env.ONLY_SCHEMAS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const [rows] = await s.query(`
    SELECT t.table_schema AS schema
      FROM information_schema.tables t
     WHERE t.table_name = 'patients' AND t.table_schema LIKE 'crm_%'
       AND EXISTS (SELECT 1 FROM information_schema.tables d
                    WHERE d.table_schema = t.table_schema AND d.table_name = 'documents')
       AND EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = t.table_schema AND c.table_name = 'clients'
                      AND c.column_name = 'contract_document_id')
     ORDER BY t.table_schema
  `);
  const todos = rows.map((r) => r.schema);
  return only.length ? todos.filter((x) => only.includes(x)) : todos;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  header(CONFIRM ? "CONTRATO paciente → cliente (ESCRIBIENDO)" : "CONTRATO paciente → cliente (SIMULACIÓN, usa --confirm para aplicar)");
  const raiz = uploadsRoot();
  log(`Volumen de ficheros: ${raiz}`);

  const schemas = await schemasAptos(s);
  log(`Schemas con pacientes + archivo de documentos: ${schemas.join(", ") || "(ninguno)"}`);

  for (const schema of schemas) {
    header(schema);
    const slug = schema.replace(/^crm_/, "");

    // Contratos pendientes de mover, el más reciente primero DENTRO de cada
    // familia: así, con dos hermanos, el que gana es el último subido.
    const [filas] = await s.query(`
      SELECT p.id AS patient_id, p.client_id, p.contract_file, p.updated_at,
             c.contract_document_id
        FROM "${schema}".patients p
        LEFT JOIN "${schema}".clients c ON c.id = p.client_id
       WHERE p.contract_file IS NOT NULL
         AND p.contract_file->>'storedFilename' IS NOT NULL
       ORDER BY p.client_id, p.updated_at DESC
    `);

    if (!filas.length) { log("Sin contratos que mover."); continue; }
    log(`Contratos guardados en pacientes: ${filas.length}`);

    const sinPagador = filas.filter((f) => !f.client_id);
    const yaTenia = filas.filter((f) => f.client_id && f.contract_document_id);

    // Un contrato por familia: el primero de cada client_id (ya vienen ordenadas).
    const vistos = new Set();
    const aMover = [];
    const hermanosDuplicados = [];
    for (const f of filas) {
      if (!f.client_id || f.contract_document_id) continue;
      if (vistos.has(f.client_id)) { hermanosDuplicados.push(f); continue; }
      vistos.add(f.client_id);
      aMover.push(f);
    }

    log(`→ se mueven: ${aMover.length}`);
    log(`→ sin cliente pagador (se quedan en el paciente): ${sinPagador.length}`);
    log(`→ la familia ya tenía contrato propio (se respeta): ${yaTenia.length}`);
    log(`→ hermanos con un segundo contrato (se dejan intactos): ${hermanosDuplicados.length}`);
    for (const f of [...sinPagador, ...hermanosDuplicados].slice(0, 10)) {
      log(`   revisar a mano: paciente ${f.patient_id}`);
    }

    if (!aMover.length || !CONFIRM) {
      if (!CONFIRM) log("(simulación: no se ha escrito nada)");
      continue;
    }

    const hechos = [];
    for (const f of aMover) {
      const cf = typeof f.contract_file === "string" ? JSON.parse(f.contract_file) : f.contract_file;
      const origen = join(raiz, slug, "patients", f.patient_id, cf.storedFilename);

      let bytes;
      try {
        bytes = statSync(origen).size;
      } catch {
        // El registro dice que hay PDF pero en disco no está. No se toca la BD:
        // borrar el JSONB dejaría al paciente sin ninguna pista de su contrato.
        log(`⚠ paciente ${f.patient_id}: falta el fichero (${origen}). Se deja como está.`);
        continue;
      }

      const documentId = randomUUID();
      const storagePath = `documents/${slug}/shared/${documentId}.pdf`;
      const destino = join(raiz, ...storagePath.split("/"));
      mkdirSync(dirname(destino), { recursive: true });
      copyFileSync(origen, destino); // COPIA: el original queda para el rollback

      const fileName = String(cf.originalName || "Contrato firmado.pdf").slice(0, 255);

      // Una transacción por contrato: si algo falla, esa familia se queda como
      // estaba y las demás siguen (no se aborta la migración entera).
      const t = await s.transaction();
      try {
        await s.query(
          `INSERT INTO "${schema}".documents
             (id, folder_id, visibility, owner_user_id, file_name, storage_path, file_size,
              mime_type, client_id, patient_id, source, client_visible, uploaded_by_client,
              created_at, updated_at)
           VALUES ($1, NULL, 'shared', NULL, $2, $3, $4, $5, $6, $7, $8, true, false, now(), now())`,
          { bind: [documentId, fileName, storagePath, bytes, cf.mime || "application/pdf", f.client_id, f.patient_id, SOURCE], transaction: t }
        );
        await s.query(
          `UPDATE "${schema}".clients SET contract_document_id = $1, updated_at = now()
            WHERE id = $2 AND contract_document_id IS NULL`,
          { bind: [documentId, f.client_id], transaction: t }
        );
        // Se vacía el JSONB del paciente: si se quedara, la ficha seguiría
        // enseñando el contrato viejo al lado del nuevo y nadie sabría cuál vale.
        await s.query(
          `UPDATE "${schema}".patients SET contract_file = NULL, updated_at = now() WHERE id = $1`,
          { bind: [f.patient_id], transaction: t }
        );
        await t.commit();
        hechos.push({ ...f, documentId, cf });
      } catch (err) {
        await t.rollback();
        log(`⚠ paciente ${f.patient_id}: ${err.message}. Se deja como estaba.`);
      }
    }

    log(`✓ Contratos movidos a la familia: ${hechos.length}`);
    if (!hechos.length) continue;

    const marca = new Date().toISOString().replace(/[:.]/g, "-");
    const sqlRollback =
      `-- Deshace el traslado del contrato paciente → cliente en ${schema} (${hechos.length}).\n` +
      `-- Los PDF originales NO se borraron: siguen en {uploads}/${slug}/patients/{id}/.\n` +
      hechos
        .map(
          (h) =>
            `UPDATE "${schema}".patients SET contract_file = '${JSON.stringify(h.cf).replace(/'/g, "''")}'::jsonb WHERE id = '${h.patient_id}';\n` +
            `UPDATE "${schema}".clients SET contract_document_id = NULL WHERE id = '${h.client_id}' AND contract_document_id = '${h.documentId}';\n` +
            `DELETE FROM "${schema}".documents WHERE id = '${h.documentId}';\n`
        )
        .join("");

    const fichero = rutaRollback(`migrate-contract-patient-to-client-${schema}-${marca}.rollback.sql`);
    try {
      writeFileSync(fichero, sqlRollback);
      log(`Rollback guardado en ${fichero}`);
    } catch (err) {
      log(`⚠ No se pudo guardar el rollback (${err.message}). CÓPIALO DE AQUÍ:`);
      process.stdout.write(`\n${sqlRollback}\n`);
    }
  }

  await s.close();
  header(CONFIRM ? "Hecho." : "Simulación terminada. Repite con --confirm para aplicar.");
}

main().catch((err) => { console.error(err); process.exit(1); });

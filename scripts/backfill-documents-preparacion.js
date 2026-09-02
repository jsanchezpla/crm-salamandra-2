/**
 * scripts/backfill-documents-preparacion.js — da de alta en `documents` los
 * adjuntos de preparación de sesión que YA existían antes del 02/09/2026
 * (AV-0027 de Aumenta). Desde ese día el POST de prep-files crea la fila él
 * mismo; esto es solo para lo anterior.
 *
 * Lee `clinic_sessions.prep_files` de cada schema que tenga las dos tablas y
 * la columna `documents.clinic_session_id` (migrate-documents-session-link), y
 * crea la MISMA fila que crea el POST (`documentoDePrepFile`, en
 * lib/clinica/prepFiles.js), sin tocar el disco: el fichero ya está donde está.
 * El dueño sale del correo que apuntó la subida (`uploadedBy`), buscado en
 * `master.users` dentro del tenant; si no está, la fila queda sin dueño (nadie
 * la borra desde el archivo, que es lo que toca con estos adjuntos).
 *
 * DATOS, no estructura: ensayo por defecto, `--confirm` escribe. Idempotente:
 * salta lo que ya tiene fila con el mismo `storage_path`.
 *
 *   local:  node --env-file=.env.local scripts/backfill-documents-preparacion.js [--confirm]
 *   VPS:    docker exec crm-salamandra-app-1 node scripts/backfill-documents-preparacion.js [--confirm]
 */

import { Sequelize, QueryTypes } from "sequelize";
import { byTable } from "./_schema-targets.js";
import { documentoDePrepFile, listaPrepFiles, SOURCE_PREPARACION } from "../lib/clinica/prepFiles.js";

const CONFIRM = process.argv.includes("--confirm");

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const q = (sql, replacements = {}) => s.query(sql, { type: QueryTypes.SELECT, replacements });

  process.stdout.write(`\n▶ Adjuntos de preparación → documents${CONFIRM ? "" : "  (ENSAYO: no se escribe nada)"}\n`);

  const { schemas } = await byTable(s, "clinic_sessions");
  let total = 0;
  let altas = 0;

  for (const schema of schemas) {
    const slug = schema.replace(/^crm_/, "");
    const [[hayDocs]] = await s.query(`SELECT to_regclass('"${schema}"."documents"') IS NOT NULL AS ok`);
    if (!hayDocs.ok) continue;
    const columna = await q(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = :schema AND table_name = 'documents' AND column_name = 'clinic_session_id'`,
      { schema }
    );
    if (!columna.length) {
      log(`· ${schema}: sin columna clinic_session_id (falta migrate-documents-session-link) — se salta`);
      continue;
    }

    const sesiones = await q(
      `SELECT id, client_id, patient_id, session_date, prep_files
         FROM "${schema}"."clinic_sessions"
        WHERE jsonb_typeof(prep_files) = 'array' AND jsonb_array_length(prep_files) > 0`
    );
    if (!sesiones.length) continue;

    const yaEstan = new Set(
      (await q(`SELECT storage_path FROM "${schema}"."documents" WHERE source = :source`, { source: SOURCE_PREPARACION })).map(
        (r) => r.storage_path
      )
    );
    const [tenant] = await q(`SELECT id FROM master.tenants WHERE slug = :slug`, { slug });
    const usuarios = tenant
      ? await q(`SELECT id, lower(email) AS email FROM master.users WHERE tenant_id = :tid`, { tid: tenant.id })
      : [];
    const idPorCorreo = new Map(usuarios.map((u) => [u.email, u.id]));

    let pendientes = 0;
    for (const fila of sesiones) {
      const sesion = {
        id: fila.id,
        clientId: fila.client_id,
        patientId: fila.patient_id,
        sessionDate: fila.session_date,
        prepFiles: fila.prep_files,
      };
      for (const adjunto of listaPrepFiles(sesion)) {
        total++;
        if (yaEstan.has(adjunto.storagePath)) continue;
        pendientes++;
        if (!CONFIRM) continue;
        const ownerUserId = idPorCorreo.get(String(adjunto.uploadedBy ?? "").toLowerCase()) ?? null;
        const d = documentoDePrepFile({ sesion, adjunto, ownerUserId });
        await s.query(
          `INSERT INTO "${schema}"."documents"
             (id, folder_id, visibility, owner_user_id, document_date, file_name, storage_path, file_size, mime_type,
              client_id, patient_id, clinic_session_id, source, client_visible, uploaded_by_client, created_at, updated_at)
           VALUES (gen_random_uuid(), NULL, :visibility, :ownerUserId, :documentDate, :fileName, :storagePath, :fileSize, :mimeType,
                   :clientId, :patientId, :clinicSessionId, :source, false, false, COALESCE(:subidoEl, now()), now())`,
          {
            replacements: {
              visibility: d.visibility,
              ownerUserId: d.ownerUserId,
              documentDate: d.documentDate,
              fileName: d.fileName,
              storagePath: d.storagePath,
              fileSize: d.fileSize,
              mimeType: d.mimeType,
              clientId: d.clientId,
              patientId: d.patientId,
              clinicSessionId: d.clinicSessionId,
              source: d.source,
              subidoEl: adjunto.uploadedAt ?? null,
            },
          }
        );
        altas++;
        yaEstan.add(adjunto.storagePath);
      }
    }
    log(`${CONFIRM ? "✓" : "·"} ${schema}: ${sesiones.length} sesión(es) con adjuntos · ${pendientes} sin fila${CONFIRM ? ", dadas de alta" : " (se darían de alta)"}`);
  }

  log(`${total} adjunto(s) en total · ${CONFIRM ? `${altas} fila(s) nuevas` : "sin escribir (repite con --confirm)"}`);
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  process.exit(1);
});

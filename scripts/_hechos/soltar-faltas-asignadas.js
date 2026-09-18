/**
 * soltar-faltas-asignadas.js — quitar de la bandeja de administración las
 * faltas que el CRM le había asignado solo (18/09/2026, AV-0197 de Aumenta).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Olga: «sigo viendo incidencias en las que no estoy etiquetada». Era esto: al
 * marcar una falta, la incidencia se le asignaba automáticamente por estar en
 * `settings.citas.incidenciaPorFalta`. Desde hoy nacen sin responsable
 * (`lib/citas/incidenciaPorFalta.js`), pero las que YA estaban seguirían en su
 * bandeja: 41 de las 128 que tenía a su nombre.
 *
 * ── QUÉ HACE, Y QUÉ NO ─────────────────────────────────────────────────────
 * Solo quita de las incidencias CON FALTA (`falta IS NOT NULL`) a las personas
 * que están en la lista del centro, y recalcula el espejo `assigned_to_id` con
 * el primer responsable que quede.
 *
 * **No toca ningún responsable puesto a mano**: si alguien se asignó una falta
 * él mismo, o se la asignó a una compañera, esa fila se queda. En Aumenta eran
 * dos (Elena y Laura), y borrarlas habría sido deshacer trabajo de una persona.
 * Tampoco borra ni cierra ninguna incidencia: siguen todas, en su pestaña.
 *
 * Antes de escribir deja un RESPALDO en JSON con el estado exacto de cada fila
 * que va a tocar, para poder devolverlo tal cual.
 *
 * Uso (ensayo):   node scripts/_hechos/soltar-faltas-asignadas.js
 * Uso (de verdad): node scripts/_hechos/soltar-faltas-asignadas.js --aplicar
 *   con `--respaldo <ruta>` se elige dónde se escribe (por defecto /tmp).
 */

import { writeFileSync } from "node:fs";
import { Sequelize } from "sequelize";

const APLICAR = process.argv.includes("--aplicar");
const RESPALDO = process.argv.includes("--respaldo")
  ? process.argv[process.argv.indexOf("--respaldo") + 1]
  : `/tmp/faltas-asignadas-respaldo-${new Date().toISOString().slice(0, 10)}.json`;

const log = (m) => process.stdout.write(`  ${m}\n`);

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  process.stdout.write(`\n Soltar faltas asignadas  ${APLICAR ? "(APLICANDO)" : "(ENSAYO: no escribe nada)"}\n\n`);

  // Los centros que tienen la función encendida, leídos en tiempo de ejecución
  // (regla #12): nunca una lista de slugs a mano.
  const [tenants] = await s.query(`
    SELECT slug, settings->'citas'->'incidenciaPorFalta' AS lista
      FROM master.tenants
     WHERE jsonb_array_length(COALESCE(settings->'citas'->'incidenciaPorFalta', '[]'::jsonb)) > 0
     ORDER BY slug`);

  if (!tenants.length) {
    log("· Ningún centro tiene la asignación automática de faltas encendida.");
    await s.close();
    process.exit(0);
  }

  const respaldo = { fecha: new Date().toISOString(), aplicado: APLICAR, centros: [] };
  let tocadasTotal = 0;

  for (const t of tenants) {
    const schema = `crm_${t.slug}`;
    const ids = Array.isArray(t.lista) ? t.lista : [];
    process.stdout.write(`\n▶ ${t.slug} (${ids.length} en la lista)\n`);

    // Lo que hay hoy: una fila por incidencia con falta que tenga a alguien de
    // la lista como responsable, con TODOS sus responsables para el respaldo.
    const [filas] = await s.query(
      `SELECT i.id,
              i.title,
              i.assigned_to_id,
              COALESCE(
                (SELECT json_agg(json_build_object('teamMemberId', a.team_member_id, 'assignedAt', a.assigned_at)
                                 ORDER BY a.assigned_at)
                   FROM "${schema}".incidencia_assignees a WHERE a.incidencia_id = i.id),
                '[]'::json) AS responsables
         FROM "${schema}".incidencias i
        WHERE i.falta IS NOT NULL
          AND (i.assigned_to_id IN (:ids)
               OR EXISTS (SELECT 1 FROM "${schema}".incidencia_assignees a
                           WHERE a.incidencia_id = i.id AND a.team_member_id IN (:ids)))
        ORDER BY i.created_at`,
      { replacements: { ids } }
    );

    log(`${filas.length} faltas asignadas a quien lleva la lista`);
    if (!filas.length) continue;

    // Cuáles se quedan con algún responsable puesto a mano (esos no se tocan).
    const conOtros = filas.filter((f) => (f.responsables ?? []).some((r) => !ids.includes(r.teamMemberId)));
    log(`de ellas, ${conOtros.length} tienen además alguien puesto a mano: ese se respeta`);

    respaldo.centros.push({ slug: t.slug, lista: ids, filas });
    tocadasTotal += filas.length;

    if (!APLICAR) continue;

    // El respaldo se escribe ANTES de tocar nada, y se reescribe con cada
    // centro: si esto se corta a la mitad, lo ya escrito tiene que estar en el
    // fichero — un respaldo que se guarda al final no es un respaldo.
    writeFileSync(RESPALDO, JSON.stringify(respaldo, null, 1), "utf8");

    for (const f of filas) {
      // Fuera de la pivote SOLO los de la lista.
      await s.query(
        `DELETE FROM "${schema}".incidencia_assignees
          WHERE incidencia_id = :id AND team_member_id IN (:ids)`,
        { replacements: { id: f.id, ids } }
      );
      // El espejo, al primero que quede (o a nadie).
      const quedan = (f.responsables ?? []).filter((r) => !ids.includes(r.teamMemberId));
      const espejo = quedan[0]?.teamMemberId ?? null;
      await s.query(
        `UPDATE "${schema}".incidencias SET assigned_to_id = :espejo, updated_at = NOW() WHERE id = :id`,
        { replacements: { espejo, id: f.id } }
      );
    }
    log(`✓ ${filas.length} soltadas`);
  }

  if (tocadasTotal) {
    // En ensayo también se deja, para poder mirar qué se iba a tocar.
    if (!APLICAR) writeFileSync(RESPALDO, JSON.stringify(respaldo, null, 1), "utf8");
    log(`\nRespaldo en ${RESPALDO}`);
  }
  process.stdout.write(
    APLICAR
      ? `\n✓ Hecho: ${tocadasTotal} faltas ya no están en la bandeja de nadie\n\n`
      : `\n· Ensayo: se tocarían ${tocadasTotal}. Repite con --aplicar\n\n`
  );
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});

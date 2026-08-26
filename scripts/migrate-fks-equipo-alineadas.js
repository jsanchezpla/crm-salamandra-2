/**
 * migrate-fks-equipo-alineadas.js — que borrar a una persona haga LO MISMO en
 * todos los clientes, y que nunca se lleve por delante un dato clínico
 * (26/08/2026).
 *
 *   node --env-file=.env.local scripts/migrate-fks-equipo-alineadas.js            (ensayo)
 *   node --env-file=.env.local scripts/migrate-fks-equipo-alineadas.js --confirm  (lo hace)
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * 37 columnas de 34 tablas apuntan a `team_members`, y el `ON DELETE` NO es el
 * mismo en cada cliente. La causa está en cómo nace un schema: el alta de tenant
 * lanza `sequelize.sync()` (lib/provisioning/altaTenant.js) ANTES de que corran
 * las migraciones, y las migraciones crean con `IF NOT EXISTS`. Así que la FK
 * que queda es la que Sequelize se inventa —nullable → SET NULL, NOT NULL →
 * CASCADE, porque las asociaciones de lib/db/tenantDb.js casi nunca declaran
 * `onDelete`— y no la que declara el SQL de la migración.
 *
 * Medido en producción el 26/08/2026: de las 37 columnas, 33 dicen lo mismo en
 * todos los schemas y CUATRO discrepan. Estas cuatro:
 *
 *   clinical_reports.therapist_id   RESTRICT en aumenta · CASCADE en 8
 *   clinic_sessions.therapist_id    RESTRICT en aumenta · CASCADE en 2 · SET NULL en 6
 *   coordinations.created_by_id     RESTRICT en aumenta · CASCADE en 2 · SET NULL en 6
 *   team_blocks.team_member_id      CASCADE  en aumenta · SET NULL en 6
 *
 * La peor con diferencia es la primera: `clinical_reports.therapist_id` es NOT
 * NULL, y con CASCADE borrar a un profesional BORRA SUS INFORMES CLÍNICOS. Dato
 * de salud, sin avisar y sin dejar rastro, porque la cascada la ejecuta
 * PostgreSQL y no pasa por ninguna auditoría. Hoy no ha explotado solo porque la
 * aplicación no borra fichas: `DELETE /api/team/[id]` es baja lógica. El día que
 * alguien borre por SQL —o el día que se ponga el botón de borrar— explota.
 *
 * La cuarta es distinta y también es mala: `team_blocks.team_member_id` con SET
 * NULL convierte las VACACIONES de una persona en un bloqueo sin persona, y un
 * bloqueo sin persona significa «cierra la agenda de TODO el centro» (lo cuenta
 * models/tenant/TeamBlock.model.js). Es el incidente que ya hubo que arreglar a
 * mano con scripts/reasignar-ausencias-sin-persona.js.
 *
 * ── QUÉ PONE, Y POR QUÉ ────────────────────────────────────────────────────
 *
 * RESTRICT en lo que es HISTORIA: una sesión, un informe o un acta llevan la
 * firma de quien los hizo, y esa firma no se borra ni se pone a NULL porque la
 * persona se vaya. Si hay historia, la ficha no se borra: se queda inactiva.
 *
 * CASCADE en lo que es LA PROPIA FICHA: los bloqueos de agenda de esa persona no
 * son historia de nadie más, y dejarlos sueltos es peor que quitarlos.
 *
 * ⚠️ Que `clinic_sessions.therapist_id` y `coordinations.created_by_id` admitan
 * NULL es a propósito y NO se toca: se hicieron opcionales para poder importar
 * las 4.045 sesiones y 171 actas que Aumenta traía sin firma. Poder NACER sin
 * autor no es lo mismo que poder QUEDARSE sin autor: lo primero se sigue
 * pudiendo, lo segundo se cierra aquí.
 *
 * ── LO QUE ESTE SCRIPT NO HACE ─────────────────────────────────────────────
 *
 * · No toca ninguna FILA. Solo cambia la regla de la FK, y solo cuando ya dice
 *   algo distinto de lo que debería. En un schema que ya está bien, no hace nada.
 * · No toca las otras 33 columnas, que ya son consistentes.
 * · No limpia las FK DUPLICADAS que hay en algunas tablas (`cash_closes`,
 *   `invoices`… tienen dos constraints para la misma columna en 5 schemas).
 *   Son inofensivas y limpiarlas es otra conversación; aquí se avisa y se
 *   alinean TODAS las que haya para esa columna.
 * · No arregla la causa (que `sync()` se adelante a las migraciones). Eso es
 *   trabajo aparte y está apuntado.
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

const CONFIRMAR = process.argv.includes("--confirm");

/** Lo que DEBE decir cada FK. `motivo` sale en el informe. */
const OBJETIVO = [
  {
    tabla: "clinical_reports",
    columna: "therapist_id",
    quiero: "RESTRICT",
    motivo: "un informe clínico lleva la firma de quien lo escribió; borrar a la persona no puede borrar el informe",
  },
  {
    tabla: "clinic_sessions",
    columna: "therapist_id",
    quiero: "RESTRICT",
    motivo: "una sesión clínica es historia del paciente; nacer sin autor sí, quedarse sin él no",
  },
  {
    tabla: "coordinations",
    columna: "created_by_id",
    quiero: "RESTRICT",
    motivo: "un acta de coordinación es historia; mismo caso que la sesión",
  },
  {
    tabla: "team_blocks",
    columna: "team_member_id",
    quiero: "CASCADE",
    motivo: "sus vacaciones se van con ella; a NULL significaría «cierra la agenda de todo el centro»",
  },
];

const LETRA = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

async function fksDe(s, schema, tabla, columna) {
  const [filas] = await s.query(
    `SELECT c.conname AS nombre, c.confdeltype AS al_borrar, c.confupdtype AS al_cambiar
       FROM pg_constraint c
       JOIN pg_class     cl ON cl.oid = c.conrelid
       JOIN pg_namespace n  ON n.oid  = cl.relnamespace
       JOIN pg_class     rf ON rf.oid = c.confrelid
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a  ON a.attrelid = cl.oid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND n.nspname = :schema AND cl.relname = :tabla
        AND a.attname = :columna AND rf.relname = 'team_members'`,
    { replacements: { schema, tabla, columna } }
  );
  return filas.map((f) => ({ ...f, al_borrar: LETRA[f.al_borrar] ?? f.al_borrar }));
}

async function main() {
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });
  await s.authenticate();

  const cambios = [];
  const yaBien = [];
  const duplicadas = [];

  for (const obj of OBJETIVO) {
    const { schemas } = await byTable(s, obj.tabla);
    for (const schema of schemas) {
      const fks = await fksDe(s, schema, obj.tabla, obj.columna);
      if (!fks.length) continue; // la columna no existe, o no tiene FK: no es cosa nuestra
      if (fks.length > 1) duplicadas.push(`${schema}.${obj.tabla}.${obj.columna} (${fks.length} constraints)`);
      for (const fk of fks) {
        if (fk.al_borrar === obj.quiero) { yaBien.push(`${schema}.${obj.tabla}.${obj.columna}`); continue; }
        cambios.push({ schema, ...obj, nombre: fk.nombre, ahora: fk.al_borrar });
      }
    }
  }

  console.log("\n═══ FKs de equipo: alinear el ON DELETE ═══\n");
  if (!cambios.length) {
    console.log("  ✓ Nada que cambiar: las cuatro columnas ya dicen lo mismo en todos los schemas.\n");
  } else {
    for (const c of cambios) {
      console.log(`  ${c.schema}.${c.tabla}.${c.columna}`);
      console.log(`      ${c.ahora}  →  ${c.quiero}     (${c.motivo})`);
    }
    console.log(`\n  ${cambios.length} constraint(s) a cambiar · ${yaBien.length} ya bien`);
  }
  if (duplicadas.length) {
    console.log(`\n  ⚠ ${duplicadas.length} columna(s) con FK DUPLICADA (se alinean todas, no se borra ninguna):`);
    for (const d of duplicadas) console.log(`      ${d}`);
  }

  if (!CONFIRMAR) {
    console.log("\n  (ensayo: sin --confirm no se toca nada)\n");
    await s.close();
    return;
  }

  console.log("\n  Aplicando...\n");
  let hechos = 0;
  for (const c of cambios) {
    // DROP + ADD en UNA transacción por constraint: si el ADD fallara, no se
    // queda la tabla sin FK ni un segundo.
    const t = await s.transaction();
    try {
      await s.query(`ALTER TABLE "${c.schema}"."${c.tabla}" DROP CONSTRAINT "${c.nombre}"`, { transaction: t });
      await s.query(
        `ALTER TABLE "${c.schema}"."${c.tabla}"
           ADD CONSTRAINT "${c.nombre}" FOREIGN KEY ("${c.columna}")
           REFERENCES "${c.schema}"."team_members" ("id")
           ON UPDATE CASCADE ON DELETE ${c.quiero}`,
        { transaction: t }
      );
      await t.commit();
      hechos++;
      console.log(`  ✓ ${c.schema}.${c.tabla}.${c.columna}  ${c.ahora} → ${c.quiero}`);
    } catch (err) {
      await t.rollback();
      console.log(`  ✗ ${c.schema}.${c.tabla}.${c.columna}: ${err.message}`);
      console.log("    Se para aquí. La FK vieja sigue en su sitio.");
      await s.close();
      process.exit(1);
    }
  }
  console.log(`\n  ${hechos} constraint(s) alineada(s).\n`);
  await s.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

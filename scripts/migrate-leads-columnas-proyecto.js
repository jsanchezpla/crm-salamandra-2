/**
 * migrate-leads-columnas-proyecto.js
 *
 * Le pone a la tabla `leads` las dos columnas que su modelo lleva pidiendo
 * desde mayo: `converted_project_id` y `converted_to_project_at`.
 *
 * QUÉ PASÓ, QUE ES LO QUE HAY QUE ENTENDER PARA NO REPETIRLO
 * El sprint de Proyectos (commit 88c4921, 05/05/2026) añadió esos dos campos al
 * modelo `Lead`, que es ÚNICO para todos los clientes. Las columnas las creaba
 * `migrate-projects-sprint-1.js`, y ese script filtra a propósito por los
 * clientes que tienen el módulo `projects` —lo dice su cabecera— para no
 * reventar los CREATE TABLE con FK a `projects.id` en quien no lo tiene.
 *
 * La decisión era correcta para las tablas de proyectos. Pero se llevó por
 * delante las dos columnas de `leads`, que no son de proyectos: son de LEADS, y
 * las lee Sequelize en TODA consulta de leads, tenga o no ese cliente el módulo.
 * Resultado: en los clientes con `leads` y sin `projects`, cualquier lectura o
 * escritura de leads muere con 42703 «column converted_project_id does not
 * exist».
 *
 * LO QUE COSTÓ (comprobado en producción el 10/08/2026)
 * `abarcaia` —programa de referidos con formulario público— lleva sin poder
 * registrar UN SOLO lead desde el 05/05. Su último lead es del 20/04. Todo lo
 * que ha entrado por ese formulario en tres meses se ha perdido: el endpoint
 * público hace `Lead.create(...)` y revienta antes de guardar nada.
 * `quality_energy` y `retorika` están igual (los dos suspendidos).
 * Lo encontró `check-module-tables.js` a los cinco minutos de desplegarse.
 *
 * POR QUÉ UN SCRIPT PROPIO Y NO `migrate-projects-sprint-1.js`
 * Porque ese, en estos clientes, haría MUCHO más de lo que hace falta: crea
 * phases, milestones, board_columns, project_members y project_templates, y
 * hace DROP+ADD sobre `tasks`. Todo eso para un cliente que no ha comprado
 * Proyectos. Además usa una transacción GLOBAL para todos los clientes —su
 * propia cabecera lo tiene apuntado como deuda—, así que un fallo en uno
 * revierte a todos. Aquí se hacen dos columnas anulables, una transacción POR
 * CLIENTE, y nada más.
 *
 * ES ADITIVO Y REPETIBLE: las dos columnas son anulables y sin valor por
 * defecto, así que no tocan una sola fila existente. Si ya están, no hace nada.
 *
 * USO
 *   node --env-file=.env.local scripts/migrate-leads-columnas-proyecto.js
 *   node --env-file=.env.local scripts/migrate-leads-columnas-proyecto.js --ensayo
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/migrate-leads-columnas-proyecto.js
 *   docker exec crm-salamandra-app-1 node scripts/migrate-leads-columnas-proyecto.js --ensayo
 *
 * ESCRIBE POR DEFECTO. Con `--ensayo` enseña lo que haría y se va sin tocar nada.
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { acotarSlugs } from "./_solo-este-tenant.js";

/**
 * ESCRIBE POR DEFECTO, y el cambio es deliberado (10/08/2026, al registrarla en
 * el mapa de scripts/_module-migrations.js).
 *
 * Nació con el ensayo por defecto, como los backfills de DATOS. Pero esta no es
 * un backfill: son dos columnas anulables, y desde hoy la ejecuta el disparador
 * `ensure-tenant-schema.js`, que lanza cada migración con `node <fichero>` y SIN
 * argumentos (ver su runMigration). Con el ensayo por defecto habría hecho el
 * simulacro, salido con código 0 y el disparador la habría dado por buena: un ✓
 * en pantalla y el schema exactamente igual de roto. Un no-op silencioso CON
 * marca de aprobado es peor que la huérfana que era — la huérfana al menos salía
 * en el aviso de «sin módulo asignado».
 *
 * Es la convención del resto: de los `migrate-*`, los únicos que escriben bajo
 * bandera son los marcados ONE_OFF, que se corren a mano.
 *
 * `--aplicar` se sigue aceptando y no hace nada: era lo que decía esta cabecera
 * hasta hoy y está escrito en el registro del 10/08.
 */
const ENSAYO = process.argv.includes("--ensayo") || process.argv.includes("--dry-run");
const APLICAR = !ENSAYO;

/**
 * Las dos columnas, con su tipo tal cual las declara el modelo y tal cual las
 * crea `migrate-projects-sprint-1.js`. Sin FK a `projects.id` A PROPÓSITO: en
 * estos clientes esa tabla puede no existir, y una FK a algo que no está es
 * justo el error que dejó el agujero. Cuando alguno contrate Proyectos, la
 * migración de ese módulo las encontrará ya creadas y seguirá su camino.
 */
const COLUMNAS = [
  { nombre: "converted_project_id", ddl: "UUID" },
  { nombre: "converted_to_project_at", ddl: "TIMESTAMPTZ" },
];

function log(m) {
  process.stdout.write(`  ${m}\n`);
}

const master = getMasterDb();

// Los clientes se leen de master EN CALIENTE, nunca de una lista escrita a mano:
// no es la misma en local que en producción (regla #12 del proyecto).
const [filas] = await master.query(`
  SELECT t.slug
  FROM master.tenants t
  JOIN master.tenant_modules m ON m.tenant_id = t.id
  WHERE m.module_key = 'leads' AND m.enabled = true
  ORDER BY t.slug
`);
// Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
// lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
const permitidos = new Set(acotarSlugs(filas.map((r) => r.slug)));
const clientes = filas.filter((r) => permitidos.has(r.slug));

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(" Columnas de proyecto en la tabla `leads`\n");
process.stdout.write("══════════════════════════════════════════════════════\n\n");

if (!APLICAR) log("(--ensayo: no se escribe nada)\n");

let arreglados = 0;
let yaEstaban = 0;

for (const { slug } of clientes) {
  const schema = `crm_${slug}`;

  const [existe] = await master.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = :schema AND table_name = 'leads'`,
    { replacements: { schema } }
  );
  if (!existe.length) {
    log(`▶ ${slug}: tiene el módulo pero no la tabla \`leads\` — no es cosa de este script`);
    continue;
  }

  const [cols] = await master.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = 'leads'`,
    { replacements: { schema } }
  );
  const tiene = new Set(cols.map((c) => c.column_name));
  const faltan = COLUMNAS.filter((c) => !tiene.has(c.nombre));

  if (!faltan.length) {
    yaEstaban++;
    continue;
  }

  log(`▶ ${slug}: le faltan ${faltan.map((c) => c.nombre).join(", ")}`);

  if (!APLICAR) {
    log(`    se añadirían anulables, sin tocar ninguna de sus filas`);
    continue;
  }

  // Transacción POR CLIENTE: si uno falla, los demás ya arreglados se quedan
  // arreglados. Es la deuda que `migrate-projects-sprint-1.js` dejó apuntada.
  const t = await master.transaction();
  try {
    for (const c of faltan) {
      await master.query(`ALTER TABLE "${schema}"."leads" ADD COLUMN "${c.nombre}" ${c.ddl}`, {
        transaction: t,
      });
    }
    await t.commit();
    log(`    ✓ añadidas`);
    arreglados++;
  } catch (e) {
    await t.rollback();
    log(`    ✗ ERROR, no se ha tocado nada en ${slug}: ${e.message}`);
  }
}

process.stdout.write("\n▶ Resumen\n");
log(`${yaEstaban} cliente(s) ya las tenían`);
if (APLICAR) log(`${arreglados} cliente(s) arreglados`);
else log(`ensayo: vuelve a lanzarlo SIN --ensayo para escribir`);
process.stdout.write("\n");

await master.close();
process.exit(0);

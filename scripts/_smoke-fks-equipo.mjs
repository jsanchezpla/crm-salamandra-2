/**
 * _smoke-fks-equipo.mjs — borrar a una persona no puede llevarse un dato clínico
 * (26/08/2026).
 *
 *   node scripts/_smoke-fks-equipo.mjs
 *
 * @prueba ligera
 *
 * Lee el CÓDIGO de `lib/db/tenantDb.js` y de la migración. Sin base, sin servidor.
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * 37 columnas apuntan a `team_members` y el `ON DELETE` no era el mismo en cada
 * cliente. La causa: el alta de un tenant lanza `sequelize.sync()` ANTES de las
 * migraciones (`lib/provisioning/altaTenant.js`), las migraciones crean con
 * `IF NOT EXISTS`, y las asociaciones no declaraban `onDelete` — así que la FK
 * que quedaba era la que Sequelize se inventa: nullable → SET NULL, NOT NULL →
 * CASCADE.
 *
 * Medido en producción el 26/08/2026: `clinical_reports.therapist_id` era
 * **CASCADE en 8 de los 9 schemas** con Clínica. Borrar a un profesional le
 * borraba sus informes clínicos —dato de salud— sin avisar y sin dejar rastro,
 * porque la cascada la ejecuta PostgreSQL y no pasa por ninguna auditoría. No
 * había explotado solo porque la aplicación nunca borra fichas: el DELETE de
 * `/api/team/[id]` es baja lógica.
 *
 * Y `team_blocks.team_member_id` era SET NULL en 6: un bloqueo de agenda sin
 * persona significa «cierra la agenda de TODO el centro»
 * (`models/tenant/TeamBlock.model.js`), así que borrar a alguien convertía sus
 * vacaciones en un cierre general. Es el incidente que ya hubo que arreglar a
 * mano con `scripts/reasignar-ausencias-sin-persona.js`.
 *
 * ── QUÉ VIGILA ─────────────────────────────────────────────────────────────
 *
 * Que las cuatro asociaciones sigan declarando su `onDelete` en LOS DOS LADOS
 * (los dos definen la misma FK y el último que procesa Sequelize manda), y que
 * la migración que alinea los schemas ya creados siga pidiendo lo mismo. Si las
 * dos fuentes se separan, un cliente nuevo nace distinto de los viejos y nadie
 * se entera hasta que alguien borra.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => {
  const abs = path.join(RAIZ, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};

const REL_DB = "lib/db/tenantDb.js";
const REL_MIG = "scripts/migrate-fks-equipo-alineadas.js";
const db = leer(REL_DB);
const mig = leer(REL_MIG);

/**
 * Lo que tiene que decir cada una. Es LA MISMA tabla que la migración: si se
 * separan, el cliente nuevo nace distinto del viejo.
 */
const ESPERADO = [
  { modelo: "ClinicSession", fk: "therapistId", regla: "RESTRICT", que: "una sesión clínica es historia del paciente" },
  { modelo: "ClinicalReport", fk: "therapistId", regla: "RESTRICT", que: "un informe lleva la firma de quien lo escribió" },
  { modelo: "Coordination", fk: "createdById", regla: "RESTRICT", que: "un acta de coordinación es historia" },
  { modelo: "TeamBlock", fk: "teamMemberId", regla: "CASCADE", que: "sus vacaciones se van con ella; a NULL cierra todo el centro" },
];

test("los dos ficheros siguen donde estaban", () => {
  assert.ok(db !== null, `no existe ${REL_DB}`);
  assert.ok(mig !== null, `no existe ${REL_MIG}: si se movió o se borró, los schemas nuevos se quedan sin alinear`);
});

test("las cuatro asociaciones declaran onDelete en los DOS lados", () => {
  for (const { modelo, fk, regla, que } of ESPERADO) {
    // belongsTo: la FK vive en este modelo.
    const belongs = new RegExp(`${modelo}\\.belongsTo\\(TeamMember, \\{[^}]*foreignKey: "${fk}"[^}]*onDelete: "${regla}"`);
    assert.ok(
      belongs.test(db),
      `${modelo}.belongsTo(TeamMember) ya no dice onDelete: "${regla}" — ${que}. Sin declararlo, Sequelize se lo inventa y el próximo cliente nace mal.`
    );
    // hasMany: el otro lado define la MISMA FK y puede pisarla.
    const has = new RegExp(`TeamMember\\.hasMany\\(${modelo}, \\{[^}]*foreignKey: "${fk}"[^}]*onDelete: "${regla}"`);
    assert.ok(
      has.test(db),
      `TeamMember.hasMany(${modelo}) ya no dice onDelete: "${regla}": los dos lados definen la misma FK y el último que procesa Sequelize manda`
    );
  }
});

test("la migración pide exactamente lo mismo", () => {
  // Si una de las dos fuentes cambia y la otra no, los schemas ya creados y los
  // que nazcan mañana dirían cosas distintas.
  const tablas = {
    ClinicSession: "clinic_sessions",
    ClinicalReport: "clinical_reports",
    Coordination: "coordinations",
    TeamBlock: "team_blocks",
  };
  const columnas = { therapistId: ["therapist_id"], createdById: ["created_by_id"], teamMemberId: ["team_member_id"] };
  for (const { modelo, fk, regla } of ESPERADO) {
    const bloque = new RegExp(
      `tabla: "${tablas[modelo]}",\\s*columna: "${columnas[fk][0]}",\\s*quiero: "${regla}"`
    );
    assert.ok(
      bloque.test(mig),
      `la migración no pide ${regla} para ${tablas[modelo]}.${columnas[fk][0]}: se ha separado de lib/db/tenantDb.js`
    );
  }
});

test("la migración no toca ni una fila", () => {
  // Solo ALTER de constraints. Un UPDATE/DELETE aquí sería otra cosa muy
  // distinta y tendría que pasar por la regla de datos del runbook.
  assert.ok(!/\bUPDATE\s+"/.test(mig), "la migración hace UPDATE: esto solo puede tocar constraints");
  assert.ok(!/\bDELETE\s+FROM\b/i.test(mig), "la migración hace DELETE");
  assert.ok(!/\bTRUNCATE\b/i.test(mig), "la migración hace TRUNCATE");
  assert.ok(mig.includes("DROP CONSTRAINT"), "ya no rehace las constraints: ¿qué hace entonces?");
});

test("la migración es un ensayo mientras no le digan que no", () => {
  assert.ok(
    mig.includes('const CONFIRMAR = process.argv.includes("--confirm")'),
    "sin --confirm tiene que ser un ensayo: es la convención de todos los scripts que tocan producción"
  );
  assert.ok(
    /if \(!CONFIRMAR\)/.test(mig),
    "no encuentro la salida del ensayo"
  );
});

test("elige los schemas mirando la base, no una lista a mano", () => {
  // Regla 12 de CLAUDE.md: los slugs se leen en tiempo de ejecución y NO se
  // filtra por estado (el estado decide quién entra, no qué forma tiene su schema).
  assert.ok(mig.includes('from "./_schema-targets.js"'), "la migración escribe su propia lista de schemas");
  assert.ok(mig.includes("byTable(s,"), "no usa byTable: una migración de FKs va por «¿existe la tabla?»");
  assert.ok(!/status\s*=\s*'active'/.test(mig), "filtra por status: un cliente suspendido también se migra");
});

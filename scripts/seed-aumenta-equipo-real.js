/**
 * seed-aumenta-equipo-real.js — da de alta el EQUIPO REAL de Aumenta.
 *
 * Crea (2026-07-24, listado de Rodrigo):
 *   - 15 fichas en crm_aumenta.team_members (con especialidad y departamento);
 *   - 13 usuarios de login en master.users — todas MENOS Dirección (Laura
 *     Barrionuevo e Isabel Alberca usan la cuenta admin@aumenta.es);
 *   - el enlace team_members.user_id → master.users.id (imprescindible para
 *     la bandeja, el calendario "solo lo mío" y las campanitas).
 *
 * Credenciales (decisión de Rodrigo — entorno de confianza, sin requisitos de
 * complejidad): usuario "Nombre_Aumenta", contraseña el nombre de pila.
 *   - El login guarda el usuario en master.users.email EN MINÚSCULAS y sin
 *     tildes (p. ej. "estefania_aumenta"); al entrar da igual cómo se escriba
 *     de mayúsculas (el backend lo normaliza), pero la CONTRASEÑA sí distingue
 *     mayúsculas: es el nombre con su inicial en mayúscula y sin tildes.
 *   - Hay dos Raquel → usuarios raquelm_aumenta (Mesones) y raquelt_aumenta
 *     (Torralbo); contraseña "Raquel" las dos.
 *
 * Accesos (master.users.module_access; el gate real es hasModule()):
 *   - Terapeutas:            calendar, citas, clinica, pacientes
 *   - Rosa y Olga (admón.):  lo anterior + billing + documents
 *   - "Mi desempeño", Dirección y Productividad son SOLO admin (gates aparte).
 *
 * Idempotente: busca por usuario/nombre antes de crear; re-ejecutarlo actualiza
 * accesos y contraseña a los valores canónicos de aquí.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-aumenta-equipo-real.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/seed-aumenta-equipo-real.js
 */

import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const SLUG = "aumenta";
const SCHEMA = `crm_${SLUG}`;

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const ACCESS = {
  therapist: ["calendar", "citas", "clinica", "pacientes"],
  admin_staff: ["calendar", "citas", "clinica", "pacientes", "billing", "documents"],
};

const TEAM = [
  // ── Dirección (SIN usuario propio: usan admin@aumenta.es) ────────────────
  { name: "Laura Barrionuevo Machota", department: "Dirección", position: "Dirección", specialties: [], user: null },
  { name: "Isabel Alberca Bolaños", department: "Dirección", position: "Dirección", specialties: [], user: null },
  // ── Administración ───────────────────────────────────────────────────────
  { name: "Rosa María Sánchez Velázquez", department: "Administración", position: "Contabilidad", specialties: [], user: { username: "rosa_aumenta", password: "Rosa", profile: "admin_staff" } },
  { name: "Olga García Arcones", department: "Administración", position: "Administración", specialties: [], user: { username: "olga_aumenta", password: "Olga", profile: "admin_staff" } },
  // ── Logopedia ────────────────────────────────────────────────────────────
  { name: "Arantxa Garrote", department: "Logopedia", position: "Logopeda", specialties: ["logopedia"], user: { username: "arantxa_aumenta", password: "Arantxa", profile: "therapist" } },
  { name: "Araceli Vigara Méndez", department: "Logopedia", position: "Logopeda", specialties: ["logopedia"], user: { username: "araceli_aumenta", password: "Araceli", profile: "therapist" } },
  { name: "Elena Gutiérrez García", department: "Logopedia", position: "Logopeda", specialties: ["logopedia"], user: { username: "elena_aumenta", password: "Elena", profile: "therapist" } },
  { name: "Isabel Vara Perea", department: "Logopedia", position: "Logopeda", specialties: ["logopedia"], user: { username: "isabel_aumenta", password: "Isabel", profile: "therapist" } },
  // ── Psicología ───────────────────────────────────────────────────────────
  { name: "Silvia Pérez Hernández", department: "Psicología", position: "Psicóloga", specialties: ["psicologia"], user: { username: "silvia_aumenta", password: "Silvia", profile: "therapist" } },
  // ── Neuropsicología ──────────────────────────────────────────────────────
  { name: "Laura Garrido Rascón", department: "Neuropsicología", position: "Neuropsicóloga", specialties: ["neuropsicologia"], user: { username: "laura_aumenta", password: "Laura", profile: "therapist" } },
  { name: "Raquel Mesones Bernal", department: "Neuropsicología", position: "Neuropsicóloga", specialties: ["neuropsicologia"], user: { username: "raquelm_aumenta", password: "Raquel", profile: "therapist" } },
  { name: "Estefanía Bermejo Blázquez", department: "Neuropsicología", position: "Neuropsicóloga", specialties: ["neuropsicologia"], user: { username: "estefania_aumenta", password: "Estefania", profile: "therapist" } },
  // ── Terapia ocupacional ──────────────────────────────────────────────────
  { name: "Raquel Torralbo", department: "Terapia ocupacional", position: "Terapeuta ocupacional", specialties: ["terapia_ocupacional"], user: { username: "raquelt_aumenta", password: "Raquel", profile: "therapist" } },
  // ── Pedagogía ────────────────────────────────────────────────────────────
  { name: "Daniela de la Cruz Esteban", department: "Pedagogía", position: "Pedagoga", specialties: ["pedagogia"], user: { username: "daniela_aumenta", password: "Daniela", profile: "therapist" } },
  { name: "Blanca Márquez Bascón", department: "Pedagogía", position: "Pedagoga", specialties: ["pedagogia"], user: { username: "blanca_aumenta", password: "Blanca", profile: "therapist" } },
];

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Alta del equipo real de Aumenta (15 personas)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG, status: "active" } });
  if (!tenant) {
    process.stderr.write("✗ Tenant 'aumenta' no existe o no está activo.\n");
    process.exit(1);
  }

  const { sequelize: tdb, models } = getTenantDb(SLUG);
  const { TeamMember } = models;

  header("Usuarios de login (master.users) + fichas de equipo");
  const summary = [];

  for (const person of TEAM) {
    // 1) Usuario de login (si le toca).
    let userId = null;
    if (person.user) {
      const { username, password, profile } = person.user;
      const passwordHash = await bcrypt.hash(password, 12);
      const moduleAccess = ACCESS[profile];

      let user = await User.scope("withPassword").findOne({ where: { email: username } });
      if (user) {
        // Re-ejecución: dejar accesos/rol/contraseña en el estado canónico.
        await user.update(
          { passwordHash, role: "user", tenantId: tenant.id, moduleAccess },
          { validate: false }
        );
        log(`· usuario ${username}: ya existía — accesos/contraseña actualizados`);
      } else {
        // validate:false a propósito: el campo email lleva validación isEmail y
        // aquí guardamos un NOMBRE DE USUARIO (decisión de producto, no un bug).
        user = await User.create(
          { email: username, passwordHash, role: "user", tenantId: tenant.id, moduleAccess },
          { validate: false }
        );
        log(`✓ usuario ${username}: creado (rol user, acceso: ${moduleAccess.join(", ")})`);
      }
      userId = user.id;
    }

    // 2) Ficha de equipo. Se busca PRIMERO por el vínculo estable (userId): el
    // displayName es editable en el CRM y, como team_members.user_id es UNIQUE,
    // un renombre + re-ejecución intentaría crear una ficha duplicada y
    // reventaría a mitad. Solo sin usuario (Dirección) se busca por nombre.
    let tm = null;
    if (userId) tm = await TeamMember.findOne({ where: { userId } });
    if (!tm) tm = await TeamMember.findOne({ where: { displayName: person.name } });

    const fields = {
      displayName: person.name,
      position: person.position,
      department: person.department,
      specialties: person.specialties,
      status: "active",
    };
    if (tm) {
      // userId solo se re-impone si esta persona TIENE usuario; para Dirección
      // (userId null) no se toca: podría haberse vinculado a mano después.
      if (userId) fields.userId = userId;
      await tm.update(fields);
      log(`· equipo ${person.name}: ya existía — actualizada`);
    } else {
      tm = await TeamMember.create({ ...fields, userId });
      log(`✓ equipo ${person.name}: creada (${person.position} · ${person.department})`);
    }

    summary.push({
      name: person.name,
      department: person.department,
      username: person.user ? `${person.user.username.replace("_aumenta", "")}_Aumenta`.replace(/^([a-z])/, (m) => m.toUpperCase()) : "— (admin de dirección)",
      password: person.user ? person.user.password : "—",
    });
  }

  header("Colores de avatar (mismo criterio determinista que la migración)");
  await tdb.query(
    `UPDATE "${SCHEMA}"."team_members"
        SET avatar_color = '#' || SUBSTR(MD5(id::text), 1, 6)
      WHERE avatar_color IS NULL`
  );
  log("✓ avatar_color rellenado donde faltaba");

  header("Resumen de credenciales");
  for (const r of summary) {
    log(`${r.name.padEnd(32)} ${String(r.username).padEnd(22)} ${r.password}`);
  }

  const [[{ n: tmCount }]] = await tdb.query(`SELECT count(*)::int AS n FROM "${SCHEMA}"."team_members"`);
  const users = await User.count({ where: { tenantId: tenant.id } });
  log(`\nTotales → team_members: ${tmCount} · usuarios del tenant: ${users}`);

  await tdb.close();
  await getMasterDb().close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});

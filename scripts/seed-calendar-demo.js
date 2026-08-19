// @vivo — Utilidad de desarrollo/demo para una función que sigue existiendo (lib/calendar/reorganizeWeek.js, /api/calendar/reorganize, botón «Reorganizar… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * seed-calendar-demo.js — Semana "saturada" de tareas de calendario para el
 * escaparate (demo). Sirve para probar la IA de "Reorganizar la semana": deja
 * el lunes y el martes cargados y el resto de días libres, con tareas repartidas
 * entre varios miembros del equipo (para ver "a quién afecta" cada movimiento).
 *
 * Idempotente: borra las tareas ya sembradas (notes = MARK) de la semana actual
 * y las vuelve a crear. No toca ninguna otra tarea.
 *
 * Uso local: node --env-file=.env.local scripts/seed-calendar-demo.js [slug]
 * Uso VPS:   docker exec crm-salamandra-app-1 node scripts/seed-calendar-demo.js demo
 */
import { Op } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";

const SLUG = process.argv[2] || "demo";

// Salvaguarda: este seed crea tareas FICTICIAS. Lanzarlo por error contra un
// tenant en uso real (aumenta, nutri_laura…) le contaminaría el calendario, así
// que fuera de `demo` hay que pedirlo a conciencia con --force.
if (SLUG !== "demo" && !process.argv.includes("--force")) {
  process.stderr.write(
    `\n✗ Este seed es de datos FALSOS y has apuntado a '${SLUG}'.\n` +
      `  Si de verdad quieres sembrar ahí, repite el comando con --force.\n\n`
  );
  process.exit(1);
}
const MARK = "seed-calendar-demo";

function log(m) { process.stdout.write(`  ${m}\n`); }

function mondayOfThisWeek() {
  const d = new Date();
  const day = d.getDay(); // 0=domingo..6=sábado
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  const p = (n) => String(n).padStart(2, "0");
  return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// [offsetDía desde el lunes, título, prioridad]. Lunes(0) y martes(1) saturados.
const TEMPLATE = [
  [0, "Revisar informes de la semana", "medium"],
  [0, "Preparar material de la sesión grupal", "high"],
  [0, "Llamar a las familias pendientes", "low"],
  [0, "Actualizar historias clínicas", "medium"],
  [0, "Pedido de material fungible", "low"],
  [1, "Reunión de coordinación del equipo", "high"],
  [1, "Cerrar la facturación del mes", "medium"],
  [1, "Preparar el taller de padres", "low"],
  [1, "Revisar la agenda de la semana", "low"],
  [2, "Sesión de supervisión", "medium"],
  [3, "Formación interna", "low"],
];

async function main() {
  const { models } = getTenantDb(SLUG);
  const { CalendarTask, TeamMember } = models;
  const monday = mondayOfThisWeek();
  const sunday = addDays(monday, 6);

  const team = await TeamMember.findAll({ attributes: ["id", "displayName"], limit: 6, order: [["created_at", "ASC"]] });
  log(`Tenant ${SLUG} · semana ${monday}…${sunday} · ${team.length} miembros de equipo`);

  const removed = await CalendarTask.destroy({
    where: { notes: MARK, startDate: { [Op.between]: [monday, sunday] } },
  });
  if (removed) log(`Limpiadas ${removed} tareas de seed anteriores.`);

  let created = 0;
  for (let i = 0; i < TEMPLATE.length; i++) {
    const [offset, title, priority] = TEMPLATE[i];
    const member = team.length ? team[i % team.length] : null;
    await CalendarTask.create({
      title,
      priority,
      status: "pending",
      startDate: addDays(monday, offset),
      allDay: true,
      notes: MARK,
      teamMemberId: member ? member.id : null,
    });
    created += 1;
  }
  log(`Creadas ${created} tareas (lunes 5 · martes 4 · miércoles 1 · jueves 1).`);
  log("Listo. Abre /calendario y pulsa «🦎 Reorganizar semana».");
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`Error: ${e.message}\n`);
  process.exit(1);
});

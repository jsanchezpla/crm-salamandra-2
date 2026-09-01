/**
 * seed-categorias-bloqueo.js — deja dadas de alta las categorías de bloqueo de
 * un centro clínico (01/09/2026, Aumenta por Rodrigo).
 *
 * Las seis del encargo: reunión de equipo, trabajo interno, gestión documental,
 * valoraciones, libre de pacientes y descanso, con un color cada una. Salen de
 * `lib/citas/categoriasBloqueo.js` (`CATEGORIAS_CLINICA_BASE`), que es la misma
 * lista que carga el botón «Empezar con las de un centro clínico» de
 * Configuración → Agenda: esto solo ahorra los clics.
 *
 * Se le pasa el SLUG — nada de clientes escritos a fuego (regla 12) — y solo
 * escribe con `--confirm`. **No pisa lo que ya haya**: si el centro ya tiene
 * categorías, se para y las enseña. Cambiar una lista que el centro ya ha
 * tocado no es sembrar, es borrarle el trabajo, y además cada bloqueo apunta a
 * una clave: reescribirlas por detrás dejaría bloqueos apuntando a categorías
 * que ya no existen.
 *
 * Como todo seed, mira el `status` del tenant: en un cliente apagado no se
 * siembra.
 *
 * ⚠️ La caché de tenant dura ~60 s y vive en el proceso de Next, no aquí: las
 * categorías aparecen en la pantalla al minuto siguiente, no al instante.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-categorias-bloqueo.js <slug> [--confirm]
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/seed-categorias-bloqueo.js <slug> --confirm
 */

import { Sequelize } from "sequelize";
import { CATEGORIAS_CLINICA_BASE, normalizarCategorias } from "../lib/citas/categoriasBloqueo.js";

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const slug = args.find((a) => !a.startsWith("--"));

  if (!slug) {
    process.stderr.write("\nUso: node scripts/seed-categorias-bloqueo.js <slug> [--confirm]\n\n");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const [filas] = await s.query(
    `SELECT id, slug, name, status, settings FROM master.tenants WHERE slug = :slug`,
    { replacements: { slug } }
  );
  if (!filas.length) {
    process.stderr.write(`✗ No existe el cliente «${slug}».\n`);
    await s.close();
    process.exit(1);
  }
  const t = filas[0];
  if (t.status !== "active") {
    process.stderr.write(`✗ «${slug}» está en estado «${t.status}»: en un cliente que no está activo no se siembra.\n`);
    await s.close();
    process.exit(1);
  }

  const settings = t.settings ?? {};
  const yaTiene = Array.isArray(settings?.citas?.categoriasBloqueo)
    ? settings.citas.categoriasBloqueo
    : [];

  process.stdout.write(`\n${t.name} (${slug})\n`);

  if (yaTiene.length) {
    process.stdout.write(`\n· Ya tiene ${yaTiene.length} categorías dadas de alta:\n`);
    for (const c of yaTiene) process.stdout.write(`    ${c.color}  ${c.label}  [${c.key}]\n`);
    process.stdout.write(
      "\n✗ No se toca nada. Cambiarlas desde aquí le borraría lo suyo y dejaría\n" +
      "  bloqueos apuntando a categorías que ya no existen. Se editan en\n" +
      "  Configuración → Agenda.\n\n"
    );
    await s.close();
    return;
  }

  const categorias = normalizarCategorias(CATEGORIAS_CLINICA_BASE);
  process.stdout.write(`\nEntrarían ${categorias.length} categorías:\n`);
  for (const c of categorias) process.stdout.write(`    ${c.color}  ${c.label}  [${c.key}]\n`);

  if (!confirm) {
    process.stdout.write("\n(EN SECO: nada escrito. Repite con --confirm.)\n\n");
    await s.close();
    return;
  }

  const nuevas = {
    ...settings,
    citas: { ...(settings.citas ?? {}), categoriasBloqueo: categorias },
  };
  await s.query(`UPDATE master.tenants SET settings = :settings WHERE id = :id`, {
    replacements: { settings: JSON.stringify(nuevas), id: t.id },
  });

  process.stdout.write(
    `\n✓ ${categorias.length} categorías dadas de alta en «${slug}».\n` +
    "  Tardan hasta un minuto en salir en la pantalla (caché de tenant).\n\n"
  );
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * calendario-global-vincular.js — qué calendarios ve una cuenta desde
 * calendar.salamandrasolutions.com (03/09/2026).
 *
 *   node --env-file=.env.local scripts/calendario-global-vincular.js <cuenta> <slug> [--usuario <cuenta-en-ese-tenant>] [--color #RRGGBB] [--orden N]
 *   node --env-file=.env.local scripts/calendario-global-vincular.js <cuenta> <slug> --quitar
 *   node --env-file=.env.local scripts/calendario-global-vincular.js <cuenta> --listar
 *
 * En producción, sin --env-file: docker exec crm-salamandra-app-1 node scripts/calendario-global-vincular.js …
 *
 * `<cuenta>` es el identificador de master.users (lo que se teclea al entrar)
 * de quien MIRA el calendario global. `--usuario` es la cuenta de ESE tenant
 * con la que se abre sesión al pulsar «Abrir en …»; sin ella el calendario
 * se ve y se mueve, pero no se salta. Idempotente: repetirlo corrige.
 */

import { getMasterModels } from "../lib/db/masterDb.js";
import { vinculosDe, vincular, desvincular } from "../lib/calendario-global/vinculos.js";

function log(m) { process.stdout.write(`  ${m}\n`); }
function salir(msg) { process.stderr.write(`\n✗ ${msg}\n\n`); process.exit(1); }

function leerArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quitar" || a === "--listar") opt[a.slice(2)] = true;
    else if (a === "--usuario" || a === "--color" || a === "--orden") opt[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  return { pos, opt };
}

async function main() {
  const { pos, opt } = leerArgs(process.argv.slice(2));
  const [cuenta, slug] = pos;
  if (!cuenta) salir("Falta la cuenta que mira el calendario global");
  if (!process.env.DATABASE_URL) salir("DATABASE_URL no configurada");

  const { User } = getMasterModels();
  const quien = await User.findOne({ where: { email: cuenta.trim().toLowerCase() }, attributes: ["id", "email", "tenantId", "soloBackoffice"] });
  if (!quien) salir(`No existe la cuenta '${cuenta}'`);
  if (quien.soloBackoffice) salir(`'${cuenta}' es de back-office: el calendario global es para cuentas del CRM`);

  process.stdout.write(`\n▶ Calendario global de ${quien.email}\n`);

  if (opt.listar || !slug) {
    const lista = await vinculosDe(quien.id);
    if (!lista.length) log("(sin calendarios vinculados)");
    for (const v of lista) {
      log(`${v.color}  ${v.slug.padEnd(22)} ${v.nombre}${v.calendario ? "" : "  [sin módulo calendar]"}${v.tenantUsuarioEmail ? `  salta con ${v.tenantUsuarioEmail}` : "  (sin cuenta de salto)"}`);
    }
    process.stdout.write("\n");
    return;
  }

  if (opt.quitar) {
    const n = await desvincular({ usuarioId: quien.id, slug });
    log(n ? `✓ quitado ${slug}` : `· ${slug} no estaba vinculado`);
  } else {
    const { creado } = await vincular({
      usuarioId: quien.id,
      slug,
      emailTenant: opt.usuario ?? null,
      color: opt.color ?? null,
      orden: opt.orden != null ? Number(opt.orden) : null,
    });
    log(`✓ ${creado ? "vinculado" : "actualizado"} ${slug}`);
  }

  // Lo que queda, comprobado leyendo, no dando por buena la escritura.
  const lista = await vinculosDe(quien.id);
  log(`· ${lista.length} calendario(s): ${lista.map((v) => v.slug).join(", ") || "ninguno"}`);
  process.stdout.write("\n");
}

main().catch((err) => salir(err.message)).finally(() => setTimeout(() => process.exit(0), 100));

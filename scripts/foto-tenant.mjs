// @vivo — Herramienta de inspección de solo lectura nacida el 17/08/2026 (¿existe el cliente?, módulos, usuarios, integraciones puestas sin enseñarlas,… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * foto-tenant.mjs — todo lo que se suele preguntar de un cliente, de un vistazo
 * y en SOLO LECTURA.
 *
 * POR QUÉ EXISTE (17/08/2026). Casi toda inspección de producción empieza por las
 * mismas cuatro preguntas —¿existe?, ¿qué módulos tiene?, ¿tiene datos dentro?,
 * ¿tiene puestas sus credenciales?— y cada una se resolvía con su propia consulta
 * a mano. Aquí van las cuatro juntas.
 *
 * NO sustituye a `inspect-tenant-modules.js`: ese cuenta el DETALLE de cada
 * módulo y sus overrides, y sigue siendo el sitio para eso. Este da la foto
 * ancha y apunta allí.
 *
 * ── LAS CREDENCIALES SE CUENTAN, NO SE ENSEÑAN ─────────────────────────────
 * De `settings.integrations` solo se dice qué claves están PUESTAS. Nunca su
 * valor, ni un trozo, ni su longitud. La regla #15 del proyecto dice que un
 * secreto visto en un chat está comprometido y hay que rotarlo, y esta pantalla
 * se pega en chats: si pudiera imprimirlos, algún día lo haría.
 *
 * Los recuentos por tabla son `count(*)` de verdad, no la estimación de
 * `pg_stat_user_tables`, que después de una carga grande y sin ANALYZE miente
 * por miles. Son decenas de consultas triviales; tardan menos que escribirlas.
 *
 * Uso local:      npm run foto aumenta
 *                 node --env-file=.env.local scripts/foto-tenant.mjs aumenta
 * Uso producción: docker exec crm-salamandra-app-1 node scripts/foto-tenant.mjs aumenta
 *   (dentro del contenedor las envs ya vienen por env_file; NO usar --env-file)
 *
 * El alias de `package.json` nació el 18/08/2026 y llegó tarde a propósito: se
 * escribió este fichero sin él porque `deploy.sh` compara `package.json` entero
 * y, si cambia, se va por la ruta larga (`npm ci` + `docker compose down`), que
 * tumba el stack. Un atajo de escritura no valía una parada del CRM. El día que
 * hubo que tocar el fichero de todas formas —para dar de alta `npm test`— se
 * metieron los tres de una vez, que es la forma barata de pagarlo: una sola
 * parada, elegida.
 *
 * Sin argumento lista los clientes que hay y para.
 *
 * Opciones:
 *   --todas   lista también las tablas vacías (por defecto solo se cuentan).
 */

import { QueryTypes } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const SLUG_RE = /^[a-z0-9_]+$/;

function out(msg = "") {
  process.stdout.write(`${msg}\n`);
}

function num(n) {
  return Number(n).toLocaleString("es-ES");
}

function fecha(d) {
  return d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "—";
}

/** ¿Está puesta? Vale un string con contenido o un objeto no vacío (secretBox). */
function estaPuesta(v) {
  if (!v) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

async function main() {
  const args = process.argv.slice(2);
  const todas = args.includes("--todas");
  const slug = args.find((a) => !a.startsWith("--"));

  const s = getMasterDb();
  // Los recuentos son una consulta por tabla: con el log puesto, la foto sale
  // sepultada bajo cincuenta líneas de «Executing (default): SELECT count(*)…».
  s.options.logging = false;
  const { Tenant, TenantModule, User } = getMasterModels();

  if (!slug) {
    const todos = await Tenant.findAll({ order: [["slug", "ASC"]] });
    out("");
    out("  Uso: node scripts/foto-tenant.mjs <cliente>");
    out("");
    out(`  Clientes en esta base de datos (${todos.length}):`);
    for (const t of todos) {
      out(`    ${t.slug.padEnd(24)} ${String(t.status).padEnd(12)} ${t.name}`);
    }
    out("");
    await s.close();
    process.exit(0);
  }

  if (!SLUG_RE.test(slug)) {
    process.stderr.write(`\n✗ Cliente '${slug}' inválido: solo se aceptan [a-z0-9_].\n`);
    process.exit(1);
  }

  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant) {
    process.stderr.write(`\n✗ Cliente '${slug}' no existe en master.tenants.\n`);
    process.stderr.write(`  Lánzalo sin argumentos para ver la lista.\n`);
    process.exit(1);
  }

  const schema = `crm_${slug}`;
  /*
   * El `::text AS tabla` NO es adorno y no se puede quitar. `table_name` es del
   * dominio `sql_identifier`, y para ese tipo el driver de Postgres devuelve la
   * fila como ARRAY (`["clients"]`) en vez de como objeto (`{table_name:"clients"}`).
   * Sin el casteo, `fila.table_name` sale `undefined` y los recuentos acaban
   * consultando la tabla «undefined». Se descubrió escribiendo este fichero.
   *
   * `_schema-targets.js` usa information_schema sin castear y no le pasa nada
   * porque hace `SELECT 1` y solo mira `rows.length`: nunca toca el valor.
   */
  const tablas = await s.query(
    `SELECT table_name::text AS tabla FROM information_schema.tables
      WHERE table_schema = :schema AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    { replacements: { schema }, type: QueryTypes.SELECT }
  );

  out("");
  out("═".repeat(68));
  out(`  Foto de '${slug}' — ${tenant.name}`);
  out("═".repeat(68));
  out(`  estado : ${tenant.status}   ·   plan: ${tenant.plan || "—"}`);
  out(`  creado : ${fecha(tenant.createdAt)}`);
  out(
    `  schema : ${schema} — ${tablas.length ? `${tablas.length} tablas` : "NO EXISTE (o está vacío)"}`
  );

  // ── Módulos ───────────────────────────────────────────────────────────────
  const modulos = await TenantModule.findAll({
    where: { tenantId: tenant.id },
    order: [["moduleKey", "ASC"]],
  });
  const activos = modulos.filter((m) => m.enabled).map((m) => m.moduleKey);
  const apagados = modulos.filter((m) => !m.enabled).map((m) => m.moduleKey);

  out("");
  out(`▶ MÓDULOS ACTIVOS (${activos.length})`);
  out(activos.length ? `   ${activos.join(", ")}` : "   (ninguno)");
  if (apagados.length) {
    out(`   apagados (${apagados.length}): ${apagados.join(", ")}`);
  }
  out(`   detalle y overrides → scripts/inspect-tenant-modules.js ${slug}`);

  // ── Usuarios ──────────────────────────────────────────────────────────────
  const usuarios = await User.findAll({
    where: { tenantId: tenant.id },
    attributes: ["role", "lastLoginAt", "moduleAccess"],
  });
  const porRol = {};
  for (const u of usuarios) porRol[u.role] = (porRol[u.role] || 0) + 1;
  const conLista = usuarios.filter(
    (u) => Array.isArray(u.moduleAccess) && u.moduleAccess.length > 0
  ).length;
  const ultimo = usuarios
    .map((u) => u.lastLoginAt)
    .filter(Boolean)
    .sort()
    .pop();

  out("");
  out(`▶ USUARIOS (${usuarios.length})`);
  out(
    `   ${Object.entries(porRol)
      .map(([r, c]) => `${r}: ${c}`)
      .join("  ·  ") || "(ninguno)"}`
  );
  out(`   último acceso: ${fecha(ultimo)}`);
  if (conLista) {
    // La segunda puerta de la que avisa CLAUDE.md: con lista explícita, activar
    // el módulo al cliente NO basta para que su gente lo vea.
    out(`   ⚠️ ${conLista} con lista explícita en module_access → npm run db:check-access`);
  }

  // ── Integraciones ─────────────────────────────────────────────────────────
  const integraciones = tenant.settings?.integrations ?? {};
  const claves = Object.keys(integraciones).sort();
  out("");
  out(`▶ INTEGRACIONES CONFIGURADAS (${claves.filter((k) => estaPuesta(integraciones[k])).length}/${claves.length})`);
  if (!claves.length) {
    out("   (ninguna)");
  } else {
    for (const k of claves) {
      out(`   ${estaPuesta(integraciones[k]) ? "✓" : "—"} ${k}`);
    }
  }
  const otrosAjustes = Object.keys(tenant.settings ?? {}).filter((k) => k !== "integrations");
  if (otrosAjustes.length) out(`   otros ajustes: ${otrosAjustes.sort().join(", ")}`);

  // ── Datos ─────────────────────────────────────────────────────────────────
  out("");
  out(`▶ DATOS`);
  if (!tablas.length) {
    out("   (el schema no tiene tablas)");
  } else {
    const conteos = [];
    for (const { tabla } of tablas) {
      const [fila] = await s.query(`SELECT count(*)::int AS n FROM "${schema}"."${tabla}"`, {
        type: QueryTypes.SELECT,
      });
      conteos.push({ tabla, n: fila.n });
    }
    const llenas = conteos.filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
    const vacias = conteos.filter((c) => c.n === 0);
    const total = conteos.reduce((a, c) => a + c.n, 0);

    if (!llenas.length) {
      out("   Sin un solo registro en ninguna tabla.");
    } else {
      const ancho = Math.max(...llenas.map((c) => c.tabla.length));
      for (const c of llenas) out(`   ${c.tabla.padEnd(ancho)}  ${num(c.n).padStart(9)}`);
      out(`   ${"".padEnd(ancho)}  ${"─".repeat(9)}`);
      out(`   ${"TOTAL".padEnd(ancho)}  ${num(total).padStart(9)}`);
    }

    if (vacias.length) {
      out("");
      if (todas) {
        out(`   ${vacias.length} tablas vacías: ${vacias.map((c) => c.tabla).join(", ")}`);
      } else {
        out(`   ${vacias.length} tablas vacías (--todas para listarlas)`);
      }
    }
  }

  out("");
  out("═".repeat(68));
  out("");

  await s.close();
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try {
    await getMasterDb().close();
  } catch {}
  process.exit(1);
});

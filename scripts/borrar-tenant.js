/**
 * borrar-tenant.js — dar de baja a un cliente, entero, sin poder arrepentirse
 * a destiempo.
 *
 * ── POR QUÉ EXISTE (11/08/2026) ─────────────────────────────────────────────
 * No había NINGUNA forma de dar de baja a un cliente. Ni endpoint, ni script.
 * `cicloVida.js` lo dice a propósito —«un botón que borra los datos de un
 * cliente es un accidente esperando su turno»— y sigue teniendo razón: esto no
 * es un botón. Pero la consecuencia era que un alta equivocada, o un cliente de
 * prueba, se limpiaba escribiendo SQL destructivo a mano contra producción, que
 * es MUCHO peor que un script pensado.
 *
 * ── LA IDEA: APARTAR, NO DESTRUIR ───────────────────────────────────────────
 * El schema NO se borra: se RENOMBRA a `zzz_baja_<slug>_<fecha>`. En un segundo
 * queda fuera de todo —nadie enumera schemas con ese prefijo, el resolutor de
 * tenants no lo encuentra, las migraciones no lo ven— y sigue estando entero
 * por si mañana resulta que había algo dentro. Eso convierte la operación
 * peligrosa en una reversible.
 *
 * Destruir de verdad es un SEGUNDO acto, deliberado y aparte, y va acotado al
 * mismo cliente y con los mismos frenos que el primero:
 *   node scripts/borrar-tenant.js <slug> --purgar                        (ensaya)
 *   node scripts/borrar-tenant.js <slug> --purgar --aplicar --confirmo=<slug>
 * Llevarse de golpe los apartados de TODOS los clientes hay que pedirlo aparte:
 *   node scripts/borrar-tenant.js --purgar --todos --aplicar --confirmo=todos
 *
 * Las filas de `master` (tenant, usuarios, módulos) sí se borran, porque un
 * tenant sin schema es justo el estado que envenena las altas. Pero antes se
 * escribe un `.rollback.sql` con los INSERT exactos para devolverlas.
 *
 * ── FRENOS ──────────────────────────────────────────────────────────────────
 *   · Ensaya por defecto. Sin `--aplicar` no escribe nada.
 *   · Hay que teclear el slug: `--confirmo=<slug>`. Copiar y pegar el comando
 *     de otro cliente no basta.
 *   · Si el cliente tiene DATOS, se planta y los enseña. Hace falta `--con-datos`.
 *   · A nosotros mismos (`salamandra_solutions`) no se le da de baja sin
 *     `--si-quiero-quedarme-sin-back-office`.
 *   · Deja rastro en `master.audit_logs`.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/borrar-tenant.js zzz_test_x
 *   node --env-file=.env.local scripts/borrar-tenant.js zzz_test_x --aplicar --confirmo=zzz_test_x
 *
 * En producción, dentro del contenedor:
 *   docker exec crm-salamandra-app-1 node scripts/borrar-tenant.js <slug>
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Sequelize } from "sequelize";

const APLICAR = process.argv.includes("--aplicar");
const CON_DATOS = process.argv.includes("--con-datos");
const PURGAR = process.argv.includes("--purgar");
const TODOS = process.argv.includes("--todos");
const SUICIDIO = process.argv.includes("--si-quiero-quedarme-sin-back-office");
const confirmoArg = process.argv.find((a) => a.startsWith("--confirmo="));
const CONFIRMO = confirmoArg ? confirmoArg.slice("--confirmo=".length) : null;
const SLUG = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? null;

const di = (s = "") => process.stdout.write(`${s}\n`);
const morir = (msg) => { process.stderr.write(`\n✗ ${msg}\n\n`); process.exit(1); };

/** Nuestro propio tenant: sin él no hay back-office. */
const NOSOTROS = "salamandra_solutions";
/** Prefijo de los schemas apartados. Nadie los enumera. */
const APARTADO = "zzz_baja_";

if (!process.env.DATABASE_URL) morir("DATABASE_URL no configurada.");

const db = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
const q = (sql, opts) => db.query(sql, opts);
const sello = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

/* ══════════════════════════════════════════════════════════════════════════
 * SEGUNDO ACTO: destruir de verdad lo ya apartado
 * ════════════════════════════════════════════════════════════════════════ */
async function purgar() {
  /* ⚠️ ESTA ES LA PARTE QUE NO TIENE VUELTA ATRÁS, y hasta el 11/08/2026 era la
   * PEOR protegida de las dos: `--purgar` ignoraba el slug, `--confirmo=` y
   * `--con-datos`, y hacía DROP de TODOS los `zzz_baja_*`. O sea que escribir
   *   borrar-tenant.js nutri_laura --purgar --aplicar
   * parecía tocar a un cliente y se llevaba por delante a todos los apartados,
   * incluido el que alguien dejó ayer precisamente para poder revisarlo.
   * Ahora la purga se acota al slug, y llevarse a todos hay que pedirlo. */
  if (!SLUG && !TODOS) {
    morir(
      `Falta el identificador del cliente a purgar.\n` +
        `  Uso:  node scripts/borrar-tenant.js <slug> --purgar --aplicar --confirmo=<slug>\n` +
        `  Si de verdad quieres destruir TODOS los apartados a la vez, añade --todos.`
    );
  }
  if (SLUG && !/^[a-z][a-z0-9_]{2,40}$/.test(SLUG)) morir(`"${SLUG}" no es un identificador válido.`);

  const [candidatos] = await q(
    `SELECT nspname FROM pg_namespace WHERE nspname LIKE '${APARTADO}%' ORDER BY 1`
  );
  // El filtro fino se hace aquí y no con un LIKE, porque un slug puede ser
  // PREFIJO de otro: `LIKE 'zzz_baja_demo_%'` se llevaría también los apartados
  // de `demo_golden`. El formato es <prefijo><slug>_<14 dígitos>, así que se
  // exige exactamente eso.
  const filas = SLUG
    ? candidatos.filter((f) => new RegExp(`^${APARTADO}${SLUG}_\\d{14}$`).test(f.nspname))
    : candidatos;

  di();
  if (SLUG) di(`  Apartados de «${SLUG}»: ${filas.length} de ${candidatos.length} en total`);
  else di(`  Schemas apartados (TODOS los clientes): ${filas.length}`);
  for (const f of filas) {
    const [[t]] = await q(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = '${f.nspname}'`
    );
    di(`     ${f.nspname}   ${t.n} tablas`);
  }
  if (!filas.length) { di("\n  Nada que purgar.\n"); return; }

  if (!APLICAR) {
    di("\n  ENSAYO. Nada se ha tocado.");
    di(`  Para hacerlo:  node scripts/borrar-tenant.js ${SLUG ?? ""}${SLUG ? " " : ""}--purgar --aplicar ` +
       `--confirmo=${SLUG ?? "todos"}${SLUG ? "" : " --todos"}\n`);
    return;
  }
  // El mismo freno que la baja: hay que TECLEAR a quién. Copiar y pegar el
  // comando de otro cliente no basta.
  const esperado = SLUG ?? "todos";
  if (CONFIRMO !== esperado) {
    morir(
      `Para purgar hay que teclear el identificador: --confirmo=${esperado}\n` +
        `  Se van a DESTRUIR ${filas.length} schema(s), y eso no tiene vuelta atrás.`
    );
  }

  for (const f of filas) {
    if (!f.nspname.startsWith(APARTADO)) throw new Error(`NEGADO: ${f.nspname}`);
    await q(`DROP SCHEMA "${f.nspname}" CASCADE`);
    di(`     destruido ${f.nspname}`);
  }
  di(`\n  ${filas.length} schemas destruidos. Esto ya no tiene vuelta atrás.\n`);
}

/* ══════════════════════════════════════════════════════════════════════════
 * PRIMER ACTO: apartar al cliente
 * ════════════════════════════════════════════════════════════════════════ */
async function baja() {
  if (!SLUG) morir("Falta el slug.\n  Uso: node scripts/borrar-tenant.js <slug> [--aplicar --confirmo=<slug>]");
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(SLUG)) morir(`"${SLUG}" no es un identificador válido.`);
  if (SLUG === NOSOTROS && !SUICIDIO) {
    morir(
      `"${NOSOTROS}" somos nosotros: es el único tenant con el módulo 'provisioning' y sin él\n` +
        `  no hay back-office (ni esta pantalla, ni el alta, ni el registro). Si de verdad es lo\n` +
        `  que quieres, añade --si-quiero-quedarme-sin-back-office.`
    );
  }

  const [[t]] = await q(
    `SELECT id, slug, name, plan, status, settings, created_at FROM master.tenants WHERE slug = :slug`,
    { replacements: { slug: SLUG }, type: undefined }
  ).then(([r]) => [r]);
  if (!t) morir(`No existe ningún cliente con el identificador "${SLUG}".`);

  const schema = `crm_${SLUG}`;
  const [[hay]] = await q(`SELECT to_regclass('${schema}.clients') IS NOT NULL AS x`).then(([r]) => [r]);
  const [[tablas]] = await q(
    `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = '${schema}'`
  ).then(([r]) => [r]);
  const [usuarios] = await q(
    `SELECT id, email, role FROM master.users WHERE tenant_id = :id ORDER BY email`,
    { replacements: { id: t.id } }
  );
  // El `id` va incluido a propósito: `master.tenant_modules.id` es NOT NULL y no
  // tiene valor por defecto en la base, así que un rollback que no lo traiga
  // falla con 23502 justo el día que hace falta. Lo descubrió la prueba de ida
  // y vuelta del 11/08, no un incidente.
  const [modulos] = await q(
    `SELECT id, module_key, enabled, version, schema_extensions, logic_overrides, ui_override, feature_flags
       FROM master.tenant_modules WHERE tenant_id = :id ORDER BY module_key`,
    { replacements: { id: t.id } }
  );

  /* ── Cuánta vida hay dentro ─────────────────────────────────────────────
   * Se cuentan TODAS las tablas del schema, no una lista escrita a mano.
   *
   * Había una lista de trece tablas «interesantes», y mentía: Retorika tiene
   * sus datos en `quiz_attempts` (212 filas en local, 526 en producción) y
   * `training_users`, que no estaban en ella. El script anunciaba «DATOS
   * DENTRO: ninguno», el freno de `--con-datos` no saltaba, y la baja pasaba
   * sola. Es el peor fallo posible en un freno: decir que no hay nada justo
   * en el momento en que alguien decide.
   *
   * Una lista a mano de tablas que crecen cada sprint solo puede ir a peor,
   * así que no hay lista. */
  // Se pregunta a `pg_catalog` y no a `information_schema.tables`: Sequelize
  // reconoce las consultas a esa vista como «listar tablas» y devuelve un array
  // plano de cadenas en vez de filas, así que `row.table_name` salía undefined
  // y la consulta siguiente iba contra `crm_x.undefined`. Lo cazó la prueba.
  const [tablasDelSchema] = await q(
    `SELECT c.relname AS tabla
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = :schema AND c.relkind = 'r'
      ORDER BY 1`,
    { replacements: { schema } }
  );
  const conDatos = [];
  for (const { tabla } of tablasDelSchema) {
    const [[c]] = await q(`SELECT count(*)::int n FROM "${schema}"."${tabla}"`).then(([r]) => [r]);
    if (c.n > 0) conDatos.push({ tabla, n: c.n });
  }
  conDatos.sort((a, b) => b.n - a.n);
  // Para no escupir cuarenta tablas: se enseñan las diez con más filas y se
  // dice cuántas quedan. El recuento total sí es el de verdad.
  const filasTotales = conDatos.reduce((s, x) => s + x.n, 0);
  const resumenDatos = conDatos.length
    ? conDatos.slice(0, 10).map((x) => `${x.tabla}=${x.n}`).join(", ") +
      (conDatos.length > 10 ? ` (y ${conDatos.length - 10} tablas más)` : "")
    : "ninguno";
  const cuantoHay = `${filasTotales} filas en ${conDatos.length} tabla${conDatos.length === 1 ? "" : "s"}`;

  di();
  di("  ══════════════════════════════════════════════════════════");
  di(`   BAJA DE «${t.name}»  (${SLUG})`);
  di("  ══════════════════════════════════════════════════════════");
  di(`     estado          ${t.status}`);
  di(`     alta            ${new Date(t.created_at).toISOString().slice(0, 10)}`);
  di(`     schema          ${schema}  ${tablas.n} tablas${hay.x ? "" : "  (⚠ sin tabla clients)"}`);
  di(`     usuarios        ${usuarios.length}${usuarios.length ? `  (${usuarios.map((u) => u.email).join(", ")})` : ""}`);
  di(`     módulos         ${modulos.length}`);
  di(`     DATOS DENTRO    ${resumenDatos}`);
  if (conDatos.length) di(`                     ${cuantoHay} con contenido`);
  di();
  di("     Qué va a pasar:");
  di(`       · el schema se RENOMBRA a ${APARTADO}${SLUG}_<fecha> (reversible, no se borra)`);
  di("       · se borran sus filas de master.tenants, users y tenant_modules");
  di("       · se escribe un .rollback.sql que devuelve esas filas Y la");
  di("         atribución de sus líneas de auditoría (el DELETE las deja a NULL)");
  di();

  if (conDatos.length && !CON_DATOS) {
    morir(
      `Este cliente TIENE DATOS: ${cuantoHay}.\n` +
        `  ${resumenDatos}\n` +
        `  Si de verdad va a la baja, añade --con-datos. Míralos antes.`
    );
  }

  if (!APLICAR) {
    di("  ENSAYO. Nada se ha tocado.");
    di(`  Para hacerlo:  node scripts/borrar-tenant.js ${SLUG} --aplicar --confirmo=${SLUG}` +
       `${conDatos.length ? " --con-datos" : ""}\n`);
    return;
  }
  if (CONFIRMO !== SLUG) {
    morir(`Para aplicar hay que teclear el identificador: --confirmo=${SLUG}`);
  }

  /* ── La red: cómo devolver las filas de master ──────────────────────── */
  const destino = `${APARTADO}${SLUG}_${sello()}`;
  const esc = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
  const json = (v) => (v === null || v === undefined ? "NULL" : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`);

  const lineas = [
    `-- Vuelta atrás de la baja de "${SLUG}" (${new Date().toISOString()}).`,
    `-- Devuelve las filas de master. El schema se recupera con:`,
    `--   ALTER SCHEMA "${destino}" RENAME TO "${schema}";`,
    ``,
    // Sin esto, `psql < fichero` sigue adelante tras un error y deja una
    // restauración A MEDIAS con pinta de correcta: fue exactamente lo que pasó
    // con las comillas de `version`. Si algo falla, que se pare y se vea.
    `\\set ON_ERROR_STOP on`,
    `BEGIN;`,
    ``,
    `ALTER SCHEMA "${destino}" RENAME TO "${schema}";`,
    ``,
    `INSERT INTO master.tenants (id, name, slug, db_name, plan, status, settings, created_at, updated_at)`,
    `VALUES (${esc(t.id)}, ${esc(t.name)}, ${esc(t.slug)}, 'salamandra', ${esc(t.plan)}, ${esc(t.status)}, ${json(t.settings)}, ${esc(t.created_at?.toISOString?.() ?? t.created_at)}, now());`,
    ``,
  ];
  for (const u of usuarios) {
    const [[full]] = await q(
      `SELECT id, email, password_hash, role, tenant_id, module_access, created_at FROM master.users WHERE id = :id`,
      { replacements: { id: u.id } }
    ).then(([r]) => [r]);
    lineas.push(
      `INSERT INTO master.users (id, email, password_hash, role, tenant_id, module_access, created_at, updated_at)`,
      `VALUES (${esc(full.id)}, ${esc(full.email)}, ${esc(full.password_hash)}, ${esc(full.role)}, ${esc(full.tenant_id)}, ${json(full.module_access)}, ${esc(full.created_at?.toISOString?.() ?? full.created_at)}, now());`
    );
  }
  lineas.push("");
  for (const m of modulos) {
    lineas.push(
      `INSERT INTO master.tenant_modules (id, tenant_id, module_key, enabled, version, schema_extensions, logic_overrides, ui_override, feature_flags, created_at, updated_at)`,
      // `version` va por `esc()` como todo lo demás: en la base es VARCHAR y su
      // valor real es '1.0.0', así que interpolarlo a pelo generaba
      // `VALUES (..., 1.0.0, ...)`, un error de sintaxis (42601). Y `psql` no
      // para en el primer fallo: entraban el tenant y los usuarios, y solo
      // reventaban los módulos, uno a uno. El cliente volvía sin un solo módulo
      // —sidebar vacío, 403 en todo— con apariencia de restauración correcta.
      `VALUES (${esc(m.id)}, ${esc(t.id)}, ${esc(m.module_key)}, ${m.enabled}, ${esc(m.version)}, ${json(m.schema_extensions)}, ${json(m.logic_overrides)}, ${esc(m.ui_override)}, ${json(m.feature_flags)}, now(), now());`
    );
  }

  /* ── La auditoría: devolver de quién era cada línea ──────────────────────
   * `master.audit_logs` apunta a tenants y a users con FK ON DELETE SET NULL.
   * O sea que los tres DELETE de aquí abajo, sin tocar la tabla de auditoría,
   * le vacían el `tenant_id` y el `user_id` a TODO el historial del cliente.
   * Y eso no lo devolvía nada: el rollback traía de vuelta al tenant y a sus
   * usuarios con los mismos UUID, pero las líneas de auditoría se quedaban a
   * NULL para siempre, sin ninguna columna de la que deducir de quién eran.
   * Deshacer la baja de Aumenta le habría dejado Equipo → Actividad en blanco.
   *
   * Aquí NO se modifica el contenido de ningún registro de auditoría —eso sí
   * lo prohíbe la regla del proyecto—: se guarda a quién pertenecía cada uno
   * para poder devolverle la atribución que el SET NULL le quita. */
  const [rastro] = await q(
    `SELECT id, tenant_id, user_id FROM master.audit_logs
      WHERE tenant_id = :id OR user_id IN (SELECT id FROM master.users WHERE tenant_id = :id)`,
    { replacements: { id: t.id } }
  );
  if (rastro.length) {
    // Se agrupa por el par (tenant_id, user_id) —que son un puñado: el tenant
    // y sus usuarios— y se emite un UPDATE por grupo, troceado, en vez de una
    // sentencia por fila. Con años de auditoría eso es la diferencia entre un
    // fichero manejable y uno de cientos de miles de líneas.
    const grupos = new Map();
    for (const r of rastro) {
      const clave = `${r.tenant_id ?? ""}|${r.user_id ?? ""}`;
      if (!grupos.has(clave)) grupos.set(clave, { tid: r.tenant_id, uid: r.user_id, ids: [] });
      grupos.get(clave).ids.push(r.id);
    }
    lineas.push("", `-- Atribución de ${rastro.length} líneas de auditoría (el DELETE las deja a NULL).`);
    for (const g of grupos.values()) {
      for (let i = 0; i < g.ids.length; i += 500) {
        const trozo = g.ids.slice(i, i + 500).map(esc).join(", ");
        lineas.push(
          `UPDATE master.audit_logs SET tenant_id = ${esc(g.tid)}, user_id = ${esc(g.uid)} WHERE id IN (${trozo});`
        );
      }
    }
  }

  lineas.push("", "COMMIT;");

  const carpeta = join(process.cwd(), "backups");
  mkdirSync(carpeta, { recursive: true });
  const fichero = join(carpeta, `baja-${SLUG}-${sello()}.rollback.sql`);
  writeFileSync(fichero, `${lineas.join("\n")}\n`, "utf8");
  di(`     red escrita en  ${fichero}`);

  /* ── Y ahora sí ─────────────────────────────────────────────────────── */
  if (tablas.n > 0) {
    await q(`ALTER SCHEMA "${schema}" RENAME TO "${destino}"`);
    di(`     apartado        ${schema} → ${destino}`);
  } else {
    di(`     sin schema      (no había nada que apartar)`);
  }

  await q(`DELETE FROM master.tenant_modules WHERE tenant_id = :id`, { replacements: { id: t.id } });
  await q(`DELETE FROM master.users WHERE tenant_id = :id`, { replacements: { id: t.id } });
  await q(`DELETE FROM master.tenants WHERE id = :id`, { replacements: { id: t.id } });
  di(`     borradas        ${modulos.length} módulos, ${usuarios.length} usuarios, 1 cliente`);

  // Rastro. Va a nombre de NOSOTROS porque el tenant al que se refiere ya no
  // existe, y una FK a una fila borrada no se puede guardar.
  try {
    const [[yo]] = await q(`SELECT id FROM master.tenants WHERE slug = '${NOSOTROS}'`).then(([r]) => [r]);
    if (yo) {
      // Sin `updated_at`: `master.audit_logs` no la tiene, porque un registro de
      // auditoría no se modifica nunca (regla del proyecto). Lo cazó la prueba
      // de ida y vuelta, no un incidente.
      await q(
        `INSERT INTO master.audit_logs (id, tenant_id, user_id, action, entity, entity_id, before, after, created_at)
         VALUES (gen_random_uuid(), :tid, NULL, 'provisioning.cliente_baja', 'Tenant', :eid, :antes::jsonb, NULL, now())`,
        {
          replacements: {
            tid: yo.id,
            eid: t.id,
            antes: JSON.stringify({
              slug: SLUG, nombre: t.name, modulos: modulos.map((m) => m.module_key),
              usuarios: usuarios.length, schemaApartado: destino, datos: conDatos,
            }),
          },
        }
      );
    }
  } catch (e) {
    di(`     (no se pudo auditar: ${e.message})`);
  }

  di();
  di(`  Hecho. El schema sigue entero en "${destino}".`);
  di(`  Para deshacerlo:  psql < ${fichero}`);
  di(`  Para destruirlo de verdad, más adelante:  node scripts/borrar-tenant.js ${SLUG} --purgar --aplicar --confirmo=${SLUG}`);
  di();
}

try {
  if (PURGAR) await purgar();
  else await baja();
} finally {
  await db.close();
}

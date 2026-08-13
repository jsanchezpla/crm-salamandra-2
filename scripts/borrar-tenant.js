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
 * ── LA BAJA YA NO VIVE AQUÍ (13/08/2026) ────────────────────────────────────
 * Está en `lib/provisioning/bajaTenant.js`, y este script es una de sus dos
 * puertas: la otra es el botón de `/admin/clientes`. Se movió porque el trabajo
 * de ponerla detrás de un botón era arreglar cuatro cosas —hacerla atómica,
 * invalidar la caché, llevarse los ficheros de `uploads/` y caducar la red de
 * rescate— y arreglarlas solo en un lado habría dejado dos bajas distintas
 * según por dónde entraras. Los frenos son los mismos por los dos caminos.
 *
 * ── LA IDEA: APARTAR, NO DESTRUIR ───────────────────────────────────────────
 * El schema NO se borra: se RENOMBRA a `zzz_baja_<slug>_<fecha>`, y sus ficheros
 * se mueven a `uploads/_bajas/<slug>_<fecha>/`. Todo sigue entero por si mañana
 * resulta que había algo dentro.
 *
 * Destruir de verdad es un SEGUNDO acto, deliberado y aparte, y **solo se puede
 * pedir desde aquí**: no hay botón para la purga ni lo va a haber.
 *   node scripts/borrar-tenant.js <slug> --purgar                        (ensaya)
 *   node scripts/borrar-tenant.js <slug> --purgar --aplicar --confirmo=<slug>
 * Llevarse de golpe los apartados de TODOS los clientes hay que pedirlo aparte:
 *   node scripts/borrar-tenant.js --purgar --todos --aplicar --confirmo=todos
 *
 * ⚠️ La purga destruye sus FACTURAS, que tienen obligación legal de conservarse
 * años. Apartar convive con esa obligación; purgar no. Por eso el reversible es
 * un botón y esto es una terminal, donde quien lo escribe mira lo que destruye.
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

import { getMasterDb } from "../lib/db/masterDb.js";
import {
  APARTADO,
  NOSOTROS,
  darDeBajaTenant,
  radiografiaParaBaja,
} from "../lib/provisioning/bajaTenant.js";
import { listarApartados, purgarFicherosApartados } from "../lib/provisioning/ficherosTenant.js";

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

const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`);

if (!process.env.DATABASE_URL) morir("DATABASE_URL no configurada.");

const db = getMasterDb();
const q = (sql, opts) => db.query(sql, opts);

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
  // de `demo_clinica`. El formato es <prefijo><slug>_<14 dígitos>, así que se
  // exige exactamente eso.
  const filas = SLUG
    ? candidatos.filter((f) => new RegExp(`^${APARTADO}${SLUG}_\\d{14}$`).test(f.nspname))
    : candidatos;

  // LO DE DISCO SE MIRA AQUÍ, ANTES DE DECIDIR SI HAY ALGO QUE HACER
  // (13/08/2026). Mirando solo los schemas, esto decía «nada que purgar» y se
  // iba — dejando los papeles del cliente y su `.rollback.sql` en disco para
  // siempre en cuanto el schema se hubiera purgado en otra pasada. Es
  // literalmente lo que quedó de las tres bajas del 12/08.
  const enDisco = SLUG ? await listarApartados(SLUG) : { carpetas: [], redes: [] };

  di();
  if (SLUG) di(`  Apartados de «${SLUG}»: ${filas.length} de ${candidatos.length} en total`);
  else di(`  Schemas apartados (TODOS los clientes): ${filas.length}`);
  for (const f of filas) {
    const [[t]] = await q(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = '${f.nspname}'`
    );
    di(`     ${f.nspname}   ${t.n} tablas`);
  }
  for (const c of enDisco.carpetas) di(`     uploads/_bajas/${c}/   sus ficheros`);
  for (const r of enDisco.redes) di(`     uploads/_bajas/${r}   red de rescate (lleva password_hash)`);

  if (!filas.length && !enDisco.carpetas.length && !enDisco.redes.length) {
    di("\n  Nada que purgar.\n");
    return;
  }

  if (!APLICAR) {
    di("\n  ENSAYO. Nada se ha tocado.");
    di("  ⚠ Destruye también sus FACTURAS, que hay obligación de conservar. Míralo antes.");
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
        `  Se van a DESTRUIR ${filas.length} schema(s)` +
        `${enDisco.carpetas.length ? `, sus ficheros` : ""}` +
        `${enDisco.redes.length ? ` y su red de rescate` : ""}, y eso no tiene vuelta atrás.`
    );
  }

  for (const f of filas) {
    if (!f.nspname.startsWith(APARTADO)) throw new Error(`NEGADO: ${f.nspname}`);
    await q(`DROP SCHEMA "${f.nspname}" CASCADE`);
    di(`     destruido ${f.nspname}`);
  }

  /* Y SUS PAPELES, Y SU RED (13/08/2026). Antes la purga solo miraba a
   * PostgreSQL, así que «destruido» dejaba en disco los documentos del cliente
   * —de salud incluidos— para siempre y sin nada que los apuntara; y dejaba
   * también el `.rollback.sql`, que sin su schema ya no restaura nada y lo único
   * que conserva son los `password_hash` de sus usuarios. Las tres bajas del
   * 12/08 acabaron exactamente así. Se van con el mismo comando o no se van
   * nunca: nadie iba a acordarse de un segundo paso. */
  if (SLUG) {
    const { borradas, redes } = await purgarFicherosApartados(SLUG);
    for (const c of borradas) di(`     destruidos sus ficheros de ${c}`);
    for (const r of redes) di(`     destruida su red de rescate ${r}`);
    if (!borradas.length && !redes.length) di("     (no tenía ficheros ni red apartados)");
  } else {
    di("     ⚠ Con --todos NO se tocan los ficheros ni las redes: púrgalos cliente a cliente.");
  }

  di(`\n  ${filas.length} schemas destruidos. Esto ya no tiene vuelta atrás.\n`);
}

/* ══════════════════════════════════════════════════════════════════════════
 * PRIMER ACTO: apartar al cliente
 * ════════════════════════════════════════════════════════════════════════ */
async function baja() {
  if (!SLUG) morir("Falta el slug.\n  Uso: node scripts/borrar-tenant.js <slug> [--aplicar --confirmo=<slug>]");

  const rx = await radiografiaParaBaja(SLUG);
  if (rx.error) morir(rx.error);

  if (rx.esNosotros && !SUICIDIO) {
    morir(
      `"${NOSOTROS}" somos nosotros: es el único tenant con el módulo 'provisioning' y sin él\n` +
        `  no hay back-office (ni esta pantalla, ni el alta, ni el registro). Si de verdad es lo\n` +
        `  que quieres, añade --si-quiero-quedarme-sin-back-office.`
    );
  }

  // Para no escupir cuarenta tablas: se enseñan las diez con más filas y se dice
  // cuántas quedan. El recuento total sí es el de verdad.
  const resumenDatos = rx.conDatos.length
    ? rx.conDatos.slice(0, 10).map((x) => `${x.tabla}=${x.n}`).join(", ") +
      (rx.conDatos.length > 10 ? ` (y ${rx.conDatos.length - 10} tablas más)` : "")
    : "ninguno";
  const cuantoHay = `${rx.filasTotales} filas en ${rx.conDatos.length} tabla${rx.conDatos.length === 1 ? "" : "s"}`;

  di();
  di("  ══════════════════════════════════════════════════════════");
  di(`   BAJA DE «${rx.tenant.nombre}»  (${SLUG})`);
  di("  ══════════════════════════════════════════════════════════");
  di(`     estado          ${rx.tenant.estado}`);
  di(`     alta            ${new Date(rx.tenant.alta).toISOString().slice(0, 10)}`);
  di(`     schema          ${rx.schema}  ${rx.tablas} tablas`);
  di(`     usuarios        ${rx.usuarios.length}${rx.usuarios.length ? `  (${rx.usuarios.map((u) => u.email).join(", ")})` : ""}`);
  di(`     módulos         ${rx.modulos.length}`);
  di(`     DATOS DENTRO    ${resumenDatos}`);
  if (rx.conDatos.length) di(`                     ${cuantoHay} con contenido`);
  di(`     FICHEROS        ${rx.ficheros.total.ficheros
    ? `${rx.ficheros.total.ficheros} (${kb(rx.ficheros.total.bytes)})`
    : "ninguno"}`);
  for (const r of rx.ficheros.rutas) {
    if (r.ficheros) di(`                     uploads/${r.rel}  ${r.ficheros} (${kb(r.bytes)})`);
  }
  di();
  di("     Qué va a pasar:");
  di(`       · el schema se RENOMBRA a ${APARTADO}${SLUG}_<fecha> (reversible, no se borra)`);
  di("       · sus ficheros se MUEVEN a uploads/_bajas/<slug>_<fecha>/");
  di("       · se borran sus filas de master.tenants, users y tenant_modules");
  di("       · se escribe un .rollback.sql que devuelve esas filas Y la");
  di("         atribución de sus líneas de auditoría (el DELETE las deja a NULL)");
  di();

  if (rx.conDatos.length && !CON_DATOS) {
    morir(
      `Este cliente TIENE DATOS: ${cuantoHay}.\n` +
        `  ${resumenDatos}\n` +
        `  Si de verdad va a la baja, añade --con-datos. Míralos antes.`
    );
  }

  if (!APLICAR) {
    di("  ENSAYO. Nada se ha tocado.");
    di(`  Para hacerlo:  node scripts/borrar-tenant.js ${SLUG} --aplicar --confirmo=${SLUG}` +
       `${rx.conDatos.length ? " --con-datos" : ""}\n`);
    return;
  }
  if (CONFIRMO !== SLUG) morir(`Para aplicar hay que teclear el identificador: --confirmo=${SLUG}`);

  const res = await darDeBajaTenant({
    slug: SLUG,
    confirmo: CONFIRMO,
    conDatos: CON_DATOS,
    permitirNosotros: SUICIDIO,
  });
  if (res.error) morir(res.error);

  di(`     red escrita en  ${res.rollback}`);
  if (res.schemaApartado) di(`     apartado        ${rx.schema} → ${res.schemaApartado}`);
  else di("     sin schema      (no había nada que apartar)");
  di(`     borradas        ${res.modulos} módulos, ${res.usuarios} usuarios, 1 cliente`);
  if (res.ficheros.movidos) di(`     ficheros        ${res.ficheros.movidos} movidos a ${res.ficheros.carpeta}`);
  for (const e of res.ficheros.errores) di(`     ⚠ ficheros      ${e}`);

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
            eid: res.tenantId,
            antes: JSON.stringify({
              slug: SLUG, nombre: rx.tenant.nombre, modulos: rx.modulos,
              usuarios: res.usuarios, schemaApartado: res.schemaApartado,
              datos: rx.conDatos, ficheros: res.ficheros.movidos, desde: "ssh",
            }),
          },
        }
      );
    } else {
      di(`     (sin auditar: no existe el tenant ${NOSOTROS} en esta base)`);
    }
  } catch (e) {
    di(`     (no se pudo auditar: ${e.message})`);
  }

  di();
  di(`  Hecho. ${res.schemaApartado ? `El schema sigue entero en "${res.schemaApartado}".` : ""}`);
  di(`  Para deshacerlo:  psql < ${res.rollback}`);
  if (res.ficheros.carpeta) di(`  (sus ficheros no vuelven solos: están en ${res.ficheros.carpeta})`);
  di(`  Para destruirlo de verdad, más adelante:  node scripts/borrar-tenant.js ${SLUG} --purgar --aplicar --confirmo=${SLUG}`);
  di();
}

try {
  if (PURGAR) await purgar();
  else await baja();
} finally {
  await db.close();
}

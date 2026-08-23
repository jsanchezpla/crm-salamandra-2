// @vivo — Herramienta de diagnóstico SOLO LECTURA, genérica por slug (o todos los tenants con la puerta encendida), que corre la lógica REAL de… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * comprobar-admision.js — ¿quién de los ACEPTADOS no puede reservar? (SOLO LECTURA)
 *
 * NO modifica nada. Seguro de ejecutar en producción.
 *
 * EL PROBLEMA QUE RESUELVE
 * La puerta de admisión (`lib/citas/puertaFormulario.js`) exige dos cosas para
 * dejar reservar: una solicitud ACEPTADA y una FICHA que se resuelva desde ese
 * mismo correo. Cuando falta la segunda, la agenda responde 403 y **no se entera
 * nadie**: ni la persona —que ya recibió el «ya puedes pedir cita»— ni la
 * profesional, que la dio por admitida hace semanas.
 *
 * Contar las que fallan con un `NOT EXISTS` sobre `clients.email` da un número
 * que NO es el de gente bloqueada, por dos motivos distintos:
 *
 *   · Se queda CORTO por arriba y por abajo a la vez. La puerta no busca por
 *     `clients.email`: usa `resolvePortalClient`, que además mira los TUTORES
 *     de `clients.guardians`. Una madre que se apuntó con su correo de tutora
 *     entra sin problema y aun así aparece en ese recuento.
 *   · Y sobre todo, no distingue los dos casos que hay debajo, que piden
 *     arreglos opuestos:
 *       — la ficha EXISTE y la puerta no la ve (se aceptó reutilizando una
 *         ficha encontrada por TELÉFONO, así que su correo es otro), o
 *       — la ficha no está (la borraron, que es justo lo que la puerta quiere
 *         detectar: ahí el 403 es correcto).
 *
 * Este script corre la lógica REAL, solicitud a solicitud, y las separa. La
 * columna que importa es «QUÉ PASA»: `bloqueada-con-ficha` es un fallo nuestro,
 * `bloqueada-sin-ficha` es la puerta funcionando.
 *
 * USO
 *   node --env-file=.env.local scripts/comprobar-admision.js <slug>
 *   docker exec crm-salamandra-app-1 node scripts/comprobar-admision.js <slug>
 *   ... sin slug: todos los tenants con la puerta encendida.
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { estadoDeAdmision, exigeFormularioAceptado } from "../lib/citas/puertaFormulario.js";
import { resolvePortalClient } from "../lib/citas/portalClient.js";

const SLUG = process.argv[2] || null;
const w = (s) => process.stdout.write(s);

/** ¿Existe esa tabla en el schema? Tener el módulo no garantiza tener la tabla. */
async function existeTabla(sequelize, esquema, tabla) {
  const [r] = await sequelize.query(`SELECT to_regclass(:ref) IS NOT NULL AS hay`, {
    replacements: { ref: `${esquema}.${tabla}` },
  });
  return r[0]?.hay === true;
}

/**
 * Correo tapado. Este script se lanza en producción, donde cada fila es una
 * familia real: basta con poder reconocerla para arreglarlo.
 */
function tapar(email) {
  if (!email) return "(sin correo)";
  const [antes, dominio] = String(email).split("@");
  if (!dominio) return "(correo torcido)";
  const visible = antes.slice(0, 2);
  return `${visible}${"·".repeat(Math.max(1, antes.length - 2))}@${dominio}`;
}

async function comprobarTenant(tenant, TenantModule) {
  const slug = tenant.slug;
  const esquema = `crm_${slug}`;

  const modulos = await TenantModule.findAll({
    where: { tenantId: tenant.id, enabled: true },
    attributes: ["moduleKey"],
  });
  const activos = new Set(modulos.map((m) => m.moduleKey));

  // La puerta solo tiene efecto con el módulo `formularios`: sin bandeja donde
  // aceptar a nadie no filtra, deja pasar.
  if (!exigeFormularioAceptado(tenant) || !activos.has("formularios")) return null;

  const { sequelize, models } = getTenantDb(slug);
  if (!(await existeTabla(sequelize, esquema, "form_submissions"))) {
    return { slug, sinTabla: true };
  }

  const aceptadas = await models.FormSubmission.findAll({
    where: { status: "accepted" },
    attributes: ["id", "name", "email", "phone", "clientId", "acceptedAt"],
    order: [["acceptedAt", "ASC"]],
  });

  const filas = [];
  for (const s of aceptadas) {
    // 1. Lo que ve la puerta HOY, con la misma llamada que hace la agenda.
    const estado = await estadoDeAdmision(models, s.email);

    // 2. ¿Y existe la ficha por el enlace que dejó escrito el propio aceptar?
    //    `clientId` es el guard de idempotencia: si tiene valor, esa aceptación
    //    creó o reutilizó ESA ficha. Es la prueba de que es paciente, aunque su
    //    correo de contacto haya acabado siendo otro.
    let fichaEnlazada = null;
    if (s.clientId) {
      fichaEnlazada = await models.Client.findByPk(s.clientId, {
        attributes: ["id", "name", "email", "status"],
      });
    }

    // 3. Y por si acaso: ¿la encuentra el buscador del portal? (email o tutor)
    const fichaPorCorreo = await resolvePortalClient(models, s.email);

    let quePasa;
    if (estado === "aceptada") quePasa = "puede reservar";
    else if (!s.email) quePasa = "bloqueada-sin-correo";
    else if (fichaEnlazada) quePasa = "bloqueada-con-ficha";
    else quePasa = "bloqueada-sin-ficha";

    filas.push({
      nombre: s.name || "(sin nombre)",
      email: tapar(s.email),
      estado,
      quePasa,
      fichaEnlazada: fichaEnlazada
        ? `${fichaEnlazada.name} <${tapar(fichaEnlazada.email)}>${fichaEnlazada.status ? ` [${fichaEnlazada.status}]` : ""}`
        : s.clientId
          ? "enlazada a una ficha que YA NO ESTÁ"
          : "sin enlace (client_id nulo)",
      mismoCorreo: fichaPorCorreo ? "sí" : "no",
    });
  }

  // El recuento del `NOT EXISTS` de siempre, para poder compararlo con la
  // realidad y dejar de citarlo como si fuera gente bloqueada.
  const [[naive]] = await sequelize.query(
    `SELECT count(*)::int AS n
       FROM ${esquema}.form_submissions f
      WHERE f.status = 'accepted'
        AND NOT EXISTS (
          SELECT 1 FROM ${esquema}.clients c
           WHERE lower(c.email) = lower(f.email))`
  );

  return { slug, filas, naive: naive?.n ?? 0 };
}

function pintar(res) {
  if (res.sinTabla) {
    w(`\n### ${res.slug}\n  ✗ puerta encendida y SIN tabla form_submissions: nadie puede reservar.\n`);
    return;
  }
  const { slug, filas, naive } = res;
  w(`\n### ${slug} — ${filas.length} solicitud(es) aceptada(s)\n\n`);

  if (!filas.length) {
    w("  (ninguna)\n");
    return;
  }

  const ancho = (k, min) => Math.max(min, ...filas.map((f) => String(f[k]).length));
  const aN = ancho("nombre", 6);
  const aE = ancho("email", 6);
  const aQ = ancho("quePasa", 7);
  const cab = `  ${"NOMBRE".padEnd(aN)}  ${"CORREO".padEnd(aE)}  ${"QUÉ PASA".padEnd(aQ)}  FICHA ENLAZADA`;
  w(`${cab}\n  ${"-".repeat(cab.length)}\n`);
  for (const f of filas) {
    const icono = f.quePasa === "puede reservar" ? "✓" : "✗";
    w(`  ${f.nombre.padEnd(aN)}  ${f.email.padEnd(aE)}  ${icono} ${f.quePasa.padEnd(aQ)}  ${f.fichaEnlazada}\n`);
  }

  const cuenta = (q) => filas.filter((f) => f.quePasa === q).length;
  const conFicha = cuenta("bloqueada-con-ficha");
  const sinFicha = cuenta("bloqueada-sin-ficha");
  const sinCorreo = cuenta("bloqueada-sin-correo");

  w(`\n  RESUMEN\n`);
  w(`    Pueden reservar ................................ ${cuenta("puede reservar")}\n`);
  w(`    Bloqueadas TENIENDO ficha (fallo nuestro) ...... ${conFicha}\n`);
  w(`    Bloqueadas sin ficha (la puerta acierta) ....... ${sinFicha}\n`);
  w(`    Bloqueadas sin correo (no se les puede citar) .. ${sinCorreo}\n`);
  w(`    El "NOT EXISTS" de siempre diría ............... ${naive}\n`);
  if (naive !== conFicha + sinFicha + sinCorreo) {
    w(`    ⚠️  Ese recuento NO coincide con la gente bloqueada de verdad.\n`);
  }
}

async function main() {
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  const where = SLUG ? { slug: SLUG } : { status: "active" };
  const tenants = await Tenant.findAll({ where, order: [["slug", "ASC"]] });
  if (!tenants.length) {
    process.stderr.write(`\n✗ No hay tenants que mirar${SLUG ? ` (¿existe '${SLUG}'?)` : ""}\n`);
    process.exit(1);
  }

  w("\n=== PUERTA DE ADMISIÓN · quién no puede reservar ===\n");

  let mirados = 0;
  for (const t of tenants) {
    let res = null;
    try {
      res = await comprobarTenant(t, TenantModule);
    } catch (err) {
      w(`\n### ${t.slug}\n  ✗ no se pudo comprobar: ${err.message}\n`);
      continue;
    }
    if (!res) continue;
    mirados += 1;
    pintar(res);
  }

  if (!mirados) w("\n(ningún tenant tiene la puerta encendida con el módulo formularios)\n");
  w("\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
    process.exit(1);
  });

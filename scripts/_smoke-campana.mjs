/**
 * _smoke-campana.mjs — que la profesional se entere de lo que pasa.
 *
 * La campana del CRM tenía siete tipos de aviso, y a nutri_laura solo le
 * llegaba uno: las cancelaciones. Lo que más necesita saber no avisaba:
 *
 *   · que ha entrado una SOLICITUD DE CITA en su lista de espera,
 *   · que ha llegado una SOLICITUD del formulario de la web,
 *   · que una familia ha FIRMADO el contrato.
 *
 * Lo de las solicitudes del formulario ya se avisaba por correo, pero a una
 * lista configurable que además dependía de que hubiera clave de Resend. En
 * producción faltaban las dos cosas y se acumularon seis solicitudes sin que
 * nadie supiera que existían. La campana no depende de terceros.
 *
 * Lo que se fija aquí:
 *   · los tres hechos crean su aviso y le llega a los ADMIN del tenant;
 *   · no le llega a quien no es admin (un aviso de gestión no es de todos);
 *   · el `dedupe` funciona: un reintento de webhook no duplica el aviso;
 *   · y si algo falla al avisar, la operación NO se rompe — la campana es
 *     best-effort y una notificación caída no puede impedir una reserva.
 *
 * Uso: node --env-file=.env.local scripts/_smoke-campana.mjs [slug]
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { notifyAdmins, notifyUsers } from "../lib/notifications/notifyUsers.js";

const SLUG = process.argv[2] || "nutri_laura";
const TIPOS = ["cita_solicitada", "formulario_recibido", "contrato_firmado"];

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

/** `entityId` es UUID en BD: una marca inventada no cuela, la rechaza Postgres. */
const MARCA = crypto.randomUUID();

async function main() {
  process.stdout.write(`\n═══ Smoke: la campana del CRM (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { Notification } = models;
  if (!Notification) throw new Error("este tenant no tiene tabla de notificaciones");

  const admins = await User.findAll({ where: { tenantId: tenant.id, role: "admin" }, attributes: ["id", "email"] });
  const otros = await User.findAll({ where: { tenantId: tenant.id, role: { [Op.ne]: "admin" } }, attributes: ["id"] });
  if (!admins.length) throw new Error("el tenant no tiene ningún admin");

  const idsAviso = [];
  const limpiar = async () =>
    Notification.destroy({ where: { entityId: { [Op.in]: [MARCA] } }, force: true }).catch(() => {});

  try {
    await limpiar();
    ok(`${admins.length} admin(s) y ${otros.length} usuario(s) normal(es)`);

    paso("Los tres avisos llegan a quien tiene que atenderlos");
    for (const tipo of TIPOS) {
      await notifyAdmins({
        tenantId: tenant.id,
        tenantModels: models,
        type: tipo,
        title: `Prueba ${tipo}`,
        body: "cuerpo de prueba",
        entityType: "Smoke",
        entityId: MARCA,
        dedupe: true,
      });
      const recibidas = await Notification.findAll({ where: { type: tipo, entityId: MARCA } });
      idsAviso.push(...recibidas.map((n) => n.id));
      esperar(
        recibidas.length === admins.length,
        `${tipo.padEnd(20)} → ${recibidas.length} aviso(s), uno por admin`
      );
      const paraAdmins = recibidas.every((n) => admins.some((a) => a.id === n.userId));
      esperar(paraAdmins, `${tipo.padEnd(20)} → y solo a los admin`);
    }

    if (otros.length) {
      const aOtros = await Notification.count({
        where: { entityId: MARCA, userId: { [Op.in]: otros.map((u) => u.id) } },
      });
      esperar(aOtros === 0, "a los usuarios normales NO les llega (no es su trabajo)");
    }

    paso("Un reintento del webhook no duplica el aviso");
    const antes = await Notification.count({ where: { type: "cita_solicitada", entityId: MARCA } });
    await notifyAdmins({
      tenantId: tenant.id, tenantModels: models, type: "cita_solicitada",
      title: "Prueba repetida", body: "otra vez", entityType: "Smoke", entityId: MARCA, dedupe: true,
    });
    const despues = await Notification.count({ where: { type: "cita_solicitada", entityId: MARCA } });
    esperar(despues === antes, `sigue habiendo ${antes} (dedupe)`);

    paso("Nacen SIN LEER, que es lo que hace que se vean");
    const sinLeer = await Notification.count({ where: { entityId: MARCA, read: false } });
    esperar(sinLeer > 0, `${sinLeer} sin leer`);

    paso("Si la campana falla, no se lleva por delante la operación");
    let rompio = false;
    try {
      // Sin modelo de notificaciones: es lo que pasa en un schema a medias.
      await notifyUsers({ tenantModels: {}, userIds: admins.map((a) => a.id), type: "x", title: "y" });
      await notifyAdmins({ tenantId: "no-existe", tenantModels: models, type: "x", title: "y" });
    } catch {
      rompio = true;
    }
    esperar(!rompio, "traga el fallo en silencio en vez de lanzar");
  } finally {
    if (idsAviso.length) await Notification.destroy({ where: { id: { [Op.in]: idsAviso } }, force: true }).catch(() => {});
    await limpiar();
  }

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});

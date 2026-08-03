/**
 * comprobar-citas.js — ¿le funcionarían HOY las citas a este cliente?
 *
 * SOLO LECTURA. No cambia nada.
 *
 * EL PROBLEMA QUE RESUELVE
 * Que las citas funcionen no depende de una cosa sino de ocho, repartidas entre
 * la base de datos, los ajustes del tenant y claves de terceros. Y casi todas
 * fallan EN SILENCIO: sin clave de Resend el CRM no da error, se pone en
 * dry-run y los correos no salen; sin `price` no se pide tarjeta; con el modo
 * de videollamada en automático y un enlace de mentira, el paciente recibe una
 * sala que no existe. Nadie se entera hasta que lo cuenta un paciente.
 *
 * Este script pregunta por todo a la vez y dice qué falta y QUIÉN lo pone: si
 * es una clave del cliente o algo nuestro. La idea es lanzarlo antes de dar por
 * bueno un despliegue y después de pegar las claves de un cliente nuevo.
 *
 * USO
 *   node --env-file=.env.local scripts/comprobar-citas.js <slug>
 *   docker exec crm-salamandra-app-1 node scripts/comprobar-citas.js <slug>
 *   ... sin slug: todos los tenants activos que tengan el módulo citas.
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getTenantStripeConfig } from "../lib/payments/stripeConfig.js";
import { getTenantResendConfig } from "../lib/outreach/resendConfig.js";
import { modoVideollamada } from "../lib/citas/videollamada.js";
import { exigeFormularioAceptado, urlDelFormulario } from "../lib/citas/puertaFormulario.js";

const SLUG = process.argv[2] || null;

const w = (s) => process.stdout.write(s);
/** Quién tiene que resolverlo. Es la columna que de verdad se mira. */
const CLIENTE = "clave del cliente";
const NOSOTROS = "lo ponemos nosotros";

function crearInforme() {
  const filas = [];
  return {
    bien: (q, d) => filas.push({ icono: "✓", q, d, nivel: 0 }),
    falta: (q, d, quien) => filas.push({ icono: "✗", q, d, quien, nivel: 2 }),
    ojo: (q, d, quien) => filas.push({ icono: "!", q, d, quien, nivel: 1 }),
    nota: (q, d) => filas.push({ icono: "·", q, d, nivel: 0 }),
    filas,
  };
}

/** ¿Existe esa tabla en el schema? Tener el módulo no garantiza tener la tabla. */
async function existeTabla(sequelize, esquema, tabla) {
  const [r] = await sequelize.query(
    `SELECT to_regclass(:ref) IS NOT NULL AS hay`,
    { replacements: { ref: `${esquema}.${tabla}` } }
  );
  return r[0]?.hay === true;
}

async function comprobarTenant(tenant, TenantModule) {
  const inf = crearInforme();
  const slug = tenant.slug;
  const esquema = `crm_${slug}`;

  const modulos = await TenantModule.findAll({
    where: { tenantId: tenant.id, enabled: true },
    attributes: ["moduleKey"],
  });
  const activos = new Set(modulos.map((m) => m.moduleKey));

  if (!activos.has("citas")) return null; // no es cliente de citas: no se le juzga

  const { sequelize, models } = getTenantDb(slug);
  const ctx = { slug, tenant, tenantModels: models };

  // ── 1. Los tipos de cita ──────────────────────────────────────────────────
  const tipos = await models.EventType.findAll({ where: { active: true } });
  if (!tipos.length) {
    inf.falta("Tipos de cita", "no hay ninguno activo: la agenda sale vacía", NOSOTROS);
  } else {
    inf.bien("Tipos de cita", `${tipos.length} activo(s): ${tipos.map((t) => t.name).join(", ")}`);
  }

  // ── 2. Los horarios ───────────────────────────────────────────────────────
  const horarios = await models.Availability.count();
  if (!horarios) {
    inf.falta("Horarios", "sin franjas: el widget no ofrece ni un hueco", NOSOTROS);
  } else {
    inf.bien("Horarios", `${horarios} franja(s) configuradas`);
  }

  // ── 3. Cobro ──────────────────────────────────────────────────────────────
  const conPrecio = tipos.filter((t) => Number.isInteger(t.price) && t.price > 0);
  const stripe = getTenantStripeConfig(ctx);

  if (!conPrecio.length) {
    inf.nota("Precios", "ningún tipo tiene precio: las citas no cobran nada (es una opción válida)");
    if (stripe.configured) {
      inf.ojo("Stripe", "configurado pero sin precios que cobrar", NOSOTROS);
    }
  } else {
    const lista = conPrecio.map((t) => `${t.name} ${(t.price / 100).toFixed(2)}€`).join(", ");
    inf.bien("Precios", lista);
    if (!stripe.secretKey) {
      inf.falta("Stripe · clave secreta", "hay precios pero no se puede cobrar: /book responde 503", CLIENTE);
    } else if (!stripe.webhookSecret) {
      inf.falta(
        "Stripe · secreto del webhook",
        "se retiene la tarjeta pero nadie confirma el resultado: la cita se queda colgada",
        CLIENTE
      );
    } else {
      inf.bien("Stripe", `conectado en modo ${stripe.liveMode ? "REAL" : "PRUEBAS"}`);
      if (!stripe.liveMode) {
        inf.ojo("Stripe · modo", "sigue en claves de PRUEBA: no cobra dinero de verdad", CLIENTE);
      }
    }
    if (!stripe.publishableKey) {
      inf.falta("Stripe · clave publicable", "sin ella el formulario de tarjeta no se pinta", CLIENTE);
    } else if (stripe.secretKey) {
      // Mezclar entornos falla en el navegador del paciente, no aquí: Stripe
      // rechaza el clientSecret de una cuenta con la clave de la otra y lo
      // único que se ve es un formulario que no carga.
      const pubEsReal = stripe.publishableKey.startsWith("pk_live_");
      if (pubEsReal !== stripe.liveMode) {
        inf.falta(
          "Stripe · claves mezcladas",
          `la secreta es ${stripe.liveMode ? "REAL" : "de PRUEBA"} y la publicable ${pubEsReal ? "REAL" : "de PRUEBA"}: no funcionan juntas`,
          CLIENTE
        );
      }
    }
  }

  // ── 4. Correo ─────────────────────────────────────────────────────────────
  // Es lo que más engaña: sin clave no hay error, hay silencio.
  const resend = getTenantResendConfig(ctx);
  if (!resend.apiKey) {
    inf.falta(
      "Correo · clave de Resend",
      "no sale NINGÚN correo (ni confirmación, ni recordatorio, ni aviso): el envío queda en simulacro y no avisa",
      CLIENTE
    );
  } else if (!resend.fromEmail) {
    inf.falta(
      "Correo · remitente",
      "hay clave pero no hay dirección desde la que enviar: el envío se aborta",
      CLIENTE
    );
  } else {
    inf.bien("Correo", `sale desde ${resend.fromEmail}`);
    inf.nota(
      "Correo · dominio",
      `el dominio de ${resend.fromEmail.split("@")[1] ?? "…"} tiene que estar verificado en Resend (DNS), o rebota`
    );
  }

  // ── 5. Recordatorios ──────────────────────────────────────────────────────
  if (tenant.settings?.citas?.recordatorios === true) {
    if (resend.apiKey) inf.bien("Recordatorios", "activados (la víspera de cada cita)");
    else inf.ojo("Recordatorios", "activados pero sin correo: no sale ninguno", CLIENTE);
  } else {
    inf.ojo("Recordatorios", "apagados: nadie recibe aviso la víspera", NOSOTROS);
  }

  // ── 6. Videollamada ───────────────────────────────────────────────────────
  const modo = modoVideollamada(tenant);
  const online = tipos.filter((t) => (t.modalities ?? []).includes("online"));
  if (modo === "automatico") {
    const sinSala = online.filter((t) => !t.meetUrl || !String(t.meetUrl).trim());
    if (sinSala.length) {
      inf.falta(
        "Videollamada · sala fija",
        `modo automático pero sin enlace en: ${sinSala.map((t) => t.name).join(", ")}`,
        CLIENTE
      );
    } else {
      inf.bien("Videollamada", `automática: cada cita online hereda la sala de su tipo`);
      inf.nota(
        "Videollamada · aviso",
        "el modo automático NO crea salas nuevas: reutiliza el enlace fijo, que tiene que ser real y estar abierto"
      );
    }
  } else {
    inf.nota("Videollamada", "manual: el enlace se pega a mano en cada cita y se envía con «Guardar y enviar»");
    // Un enlace guardado sin usarse hoy es una mina para el día que alguien
    // cambie el modo desde Configuración.
    const conSala = online.filter((t) => t.meetUrl && String(t.meetUrl).trim());
    if (conSala.length) {
      inf.ojo(
        "Videollamada · enlaces guardados",
        `${conSala.length} tipo(s) tienen sala guardada sin usarse (${conSala
          .map((t) => t.meetUrl)
          .join(", ")}). Si son de ejemplo, al pasar a automático se mandan enlaces muertos`,
        NOSOTROS
      );
    }
  }

  // ── 7. Puerta de admisión ─────────────────────────────────────────────────
  if (exigeFormularioAceptado(tenant)) {
    const url = urlDelFormulario(tenant);
    if (!activos.has("formularios")) {
      inf.falta(
        "Puerta de admisión",
        "encendida pero el cliente no tiene el módulo Formularios: no tiene efecto",
        NOSOTROS
      );
    } else if (!(await existeTabla(sequelize, esquema, "form_submissions"))) {
      inf.falta(
        "Puerta de admisión",
        "encendida y sin tabla de solicitudes: NADIE puede reservar. Ejecuta ensure-tenant-schema.js",
        NOSOTROS
      );
    } else {
      const aceptadas = await models.FormSubmission.count({ where: { status: "accepted" } });
      const pendientes = await models.FormSubmission.count({ where: { status: "pending" } });
      inf.bien("Puerta de admisión", `activa · ${aceptadas} aceptada(s), ${pendientes} sin revisar`);
      if (!url) {
        inf.falta(
          "Puerta · enlace al formulario",
          "sin dirección, el aviso no lleva a ningún sitio",
          NOSOTROS
        );
      } else {
        inf.bien("Puerta · enlace", url);
      }
      if (pendientes > 0) {
        inf.ojo("Puerta · bandeja", `${pendientes} solicitud(es) esperando revisión: esa gente no puede reservar`, CLIENTE);
      }
    }
  } else {
    inf.nota("Puerta de admisión", "apagada: cualquiera con el enlace de la agenda puede reservar");
  }

  // ── 8. Citas colgando ─────────────────────────────────────────────────────
  const pendientesCita = await models.Booking.count({ where: { status: "pending" } });
  if (pendientesCita) {
    inf.nota("Lista de espera", `${pendientesCita} solicitud(es) de cita sin confirmar`);
  }
  const conDinero = await models.Booking.count({
    where: { paymentStatus: { [Op.in]: ["authorized", "capturing", "failed"] } },
  });
  if (conDinero) {
    inf.ojo("Retenciones vivas", `${conDinero} cita(s) con dinero bloqueado en la tarjeta`, CLIENTE);
  }

  return inf;
}

function pintar(slug, nombre, inf) {
  w(`\n${"═".repeat(72)}\n  ${nombre}  ·  ${slug}\n${"═".repeat(72)}\n`);
  for (const f of inf.filas) {
    const quien = f.quien ? `  [${f.quien}]` : "";
    w(`  ${f.icono} ${f.q.padEnd(30)} ${f.d}${quien}\n`);
  }
  const faltan = inf.filas.filter((f) => f.nivel === 2);
  const avisos = inf.filas.filter((f) => f.nivel === 1);
  w("  " + "─".repeat(70) + "\n");
  if (!faltan.length) {
    w(`  ✓ Las citas funcionan${avisos.length ? ` (con ${avisos.length} aviso/s)` : ""}.\n`);
  } else {
    const deCliente = faltan.filter((f) => f.quien === CLIENTE).length;
    w(`  ✗ ${faltan.length} cosa(s) sin resolver`);
    w(deCliente ? `, ${deCliente} son claves del cliente.\n` : ".\n");
  }
  return faltan.length;
}

async function main() {
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  const donde = SLUG ? { slug: SLUG } : { status: "active" };
  const tenants = await Tenant.findAll({ where: donde, order: [["slug", "ASC"]] });
  if (!tenants.length) {
    w(`\nNo hay ningún tenant que encaje con ${SLUG ?? "los activos"}.\n`);
    process.exit(1);
  }

  let totalFaltas = 0;
  let mirados = 0;
  for (const t of tenants) {
    let inf;
    try {
      inf = await comprobarTenant(t, TenantModule);
    } catch (err) {
      w(`\n  ✗ ${t.slug}: no se ha podido comprobar — ${err.message}\n`);
      totalFaltas++;
      continue;
    }
    if (!inf) continue; // sin módulo citas
    mirados++;
    totalFaltas += pintar(t.slug, t.name, inf);
  }

  if (!mirados) w(`\nNingún tenant tiene el módulo citas activo.\n`);
  w("\n");
  process.exit(totalFaltas ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});

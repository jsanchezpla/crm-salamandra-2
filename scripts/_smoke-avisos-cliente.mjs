/**
 * _smoke-avisos-cliente.mjs — informar, modificar y que el cliente lo vea.
 *
 * Cubre las tres formas que tiene el centro de decirle algo a un paciente y,
 * sobre todo, que el paciente pueda VERLO desde su área privada del portal
 * (el iframe que va incrustado en el WordPress del cliente).
 *
 *   1. CANCELAR  — ya existía: la cita pasa a 'cancelled' y sale el correo.
 *   2. MODIFICAR — nuevo (03/08). Cambiar la hora no avisaba a NADIE: la cita
 *      cambiaba de día en el portal en silencio y la gente se presenta el día
 *      que le dijeron, no el que pone en una pantalla que no ha abierto.
 *   3. AVISAR    — nuevo. Un mensaje libre («tráete los análisis») que sale por
 *      correo Y queda publicado en el portal.
 *
 * Lo que se fija aquí:
 *   · el aviso se guarda AUNQUE el correo no salga —queda en el portal—, y se
 *     registra qué pasó con el correo en vez de dar por hecho que salió;
 *   · el portal solo enseña LO SUYO: con la sesión de otra persona no aparece;
 *   · «Entendido» marca leído, y no se re-marca (la primera vez es la buena);
 *   · marcar el aviso de OTRO no hace nada, aunque se mande su id;
 *   · el cambio de hora se refleja en el portal con la fecha nueva;
 *   · no se puede colgar un aviso de la cita de otra persona.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-avisos-cliente.mjs [slug]
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";
import { signPortalSession } from "../lib/citas/portalSession.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const YO = "smoke-aviso-yo@example.com";
const OTRO = "smoke-aviso-otro@example.com";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

async function main() {
  process.stdout.write(`\n═══ Smoke: avisos al cliente y lo que ve en su portal (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, ClientNotice } = models;
  if (!ClientNotice) throw new Error("falta el modelo ClientNotice");

  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  const jwt = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });
  const H = { "Content-Type": "application/json", Cookie: `access_token=${jwt}` };

  // El SSO exige que esté habilitado en los ajustes del tenant.
  const ajustesOriginales = JSON.parse(JSON.stringify(tenant.settings ?? {}));
  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });

  /** Cabecera del portal para un email, como la que da el SSO de WordPress. */
  const portal = async (email) => ({
    Authorization: `Bearer ${await signPortalSession({ email, tenant: SLUG })}`,
  });

  let cita;
  try {
    paso("Preparando");
    cita = await Booking.create({
      eventTypeId: eventType.id,
      scheduledAt: new Date(Date.now() + 6 * 86400000),
      duration: eventType.duration,
      modality: "online",
      status: "confirmed",
      clientName: "Smoke Aviso",
      clientEmail: YO,
      clientPhone: "+34600777888",
      paymentStatus: "none",
    });
    ok(`cita ${cita.id.slice(0, 8)}… el ${new Date(cita.scheduledAt).toISOString().slice(0, 10)}`);

    // ── 3. AVISAR ───────────────────────────────────────────────────────────
    paso("Laura escribe un aviso");
    const r = await fetch(`${BASE}/api/citas/avisos`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        email: YO, bookingId: cita.id, nombre: "Smoke Aviso",
        titulo: "Trae los análisis a la próxima",
        cuerpo: "Hola:\n\nAcuérdate de traer la analítica del mes pasado.\n\nGracias.",
      }),
    });
    const j = await r.json();
    esperar(r.status === 201, `se guarda (HTTP ${r.status})`);
    esperar(
      j.data?.correo === "sin_configurar" || j.data?.correo === "enviado",
      `y dice qué pasó con el correo ('${j.data?.correo}')`
    );
    const avisoId = j.data?.id;
    const enBd = avisoId ? await ClientNotice.findByPk(avisoId) : null;
    esperar(!!enBd, "el aviso queda guardado aunque el correo no salga (para eso está el portal)");

    paso("Validaciones del aviso");
    const vacio = await fetch(`${BASE}/api/citas/avisos`, {
      method: "POST", headers: H,
      body: JSON.stringify({ email: YO, titulo: "Solo asunto", cuerpo: "  " }),
    });
    esperar(vacio.status === 422, `un aviso vacío se rechaza (HTTP ${vacio.status})`);

    const ajena = await fetch(`${BASE}/api/citas/avisos`, {
      method: "POST", headers: H,
      body: JSON.stringify({ email: OTRO, bookingId: cita.id, titulo: "Hola", cuerpo: "Texto" }),
    });
    esperar(
      ajena.status === 422,
      `no se puede colgar un aviso de la cita de otra persona (HTTP ${ajena.status})`
    );

    // ── El portal ───────────────────────────────────────────────────────────
    paso("El cliente lo ve en su área privada");
    const mio = await (await fetch(`${BASE}/api/public/c/${SLUG}/citas-portal/avisos`, {
      headers: await portal(YO),
    })).json();
    const lista = mio?.data?.avisos ?? [];
    esperar(lista.length >= 1, `le aparece el aviso (${lista.length})`);
    esperar(lista[0]?.titulo === "Trae los análisis a la próxima", "con su asunto");
    esperar(lista[0]?.cuerpo?.includes("analítica"), "y su texto completo");
    esperar(lista[0]?.leido === false, "marcado como NO leído");
    esperar(mio?.data?.sinLeer === 1, "y el contador de nuevos dice 1");

    const deOtro = await (await fetch(`${BASE}/api/public/c/${SLUG}/citas-portal/avisos`, {
      headers: await portal(OTRO),
    })).json();
    esperar(
      (deOtro?.data?.avisos ?? []).length === 0,
      "y con la sesión de OTRA persona no se ve nada suyo"
    );

    paso("«Entendido» marca leído");
    const marcar = await (await fetch(`${BASE}/api/public/c/${SLUG}/citas-portal/avisos`, {
      method: "POST", headers: { ...(await portal(YO)), "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [avisoId] }),
    })).json();
    esperar(marcar?.data?.marcados === 1, "se marca (1)");

    const reMarcar = await (await fetch(`${BASE}/api/public/c/${SLUG}/citas-portal/avisos`, {
      method: "POST", headers: { ...(await portal(YO)), "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [avisoId] }),
    })).json();
    esperar(reMarcar?.data?.marcados === 0, "y no se vuelve a marcar: la primera vez es la buena");

    const intruso = await (await fetch(`${BASE}/api/public/c/${SLUG}/citas-portal/avisos`, {
      method: "POST", headers: { ...(await portal(OTRO)), "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [avisoId] }),
    })).json();
    esperar(intruso?.data?.marcados === 0, "marcar el aviso de otro no hace nada, aunque sepas su id");

    const sinSesion = await fetch(`${BASE}/api/public/c/${SLUG}/citas-portal/avisos`);
    esperar(sinSesion.status === 401, `sin sesión no se ve nada (HTTP ${sinSesion.status})`);

    // ── 2. MODIFICAR ────────────────────────────────────────────────────────
    paso("Laura mueve la cita de día");
    const nueva = new Date(Date.now() + 9 * 86400000);
    const rm = await fetch(`${BASE}/api/citas/bookings/${cita.id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ scheduledAt: nueva.toISOString(), motivoCambio: "Me surgió una urgencia" }),
    });
    esperar(rm.status === 200, `el cambio se guarda (HTTP ${rm.status})`);
    await cita.reload();
    esperar(
      new Date(cita.scheduledAt).toISOString().slice(0, 10) === nueva.toISOString().slice(0, 10),
      "la cita queda en la fecha nueva"
    );

    const citasPortal = await (await fetch(`${BASE}/api/public/c/${SLUG}/citas-portal/bookings`, {
      headers: await portal(YO),
    })).json();
    const suya = (citasPortal?.data?.upcoming ?? []).find((b) => b.id === cita.id);
    esperar(!!suya, "y el cliente la sigue viendo en su portal");
    esperar(
      suya && new Date(suya.scheduledAt).toISOString().slice(0, 10) === nueva.toISOString().slice(0, 10),
      "con la fecha NUEVA, que es lo que tiene que leer"
    );

    // ── 1. CANCELAR ─────────────────────────────────────────────────────────
    paso("Laura cancela la cita");
    const rc = await fetch(`${BASE}/api/citas/bookings/${cita.id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ status: "cancelled", cancellationReason: "Cierro esa semana" }),
    });
    esperar(rc.status === 200, `se cancela (HTTP ${rc.status})`);

    const trasCancelar = await (await fetch(`${BASE}/api/public/c/${SLUG}/citas-portal/bookings`, {
      headers: await portal(YO),
    })).json();
    const enHistorial = [
      ...(trasCancelar?.data?.upcoming ?? []),
      ...(trasCancelar?.data?.history ?? []),
    ].find((b) => b.id === cita.id);
    esperar(
      enHistorial?.status === "cancelled",
      `y el cliente ve que está cancelada ('${enHistorial?.status}')`
    );
  } finally {
    await ClientNotice.destroy({ where: { clientEmail: { [Op.iLike]: "smoke-aviso-%" } }, force: true });
    await Booking.destroy({ where: { clientEmail: { [Op.iLike]: "smoke-aviso-%" } }, force: true });
    await tenant.update({ settings: ajustesOriginales });
  }

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});

/**
 * _smoke-bloqueos-quien-ve.mjs — quién ve los bloqueos y a nombre de quién se
 * ponen.
 *
 * POR QUÉ EXISTE, que en este caso es la mitad del valor. Las dos reglas que
 * fija aquí se rompieron ya, las dos en silencio y las dos hacia el cliente:
 *
 *   1. **Quién los VE.** Hasta el 14/08/2026 el calendario enseñaba a cada cual
 *      solo los suyos, y ese recorte vivía SOLO en el navegador: el servidor
 *      mandaba los bloqueos correctos y la pantalla los tiraba uno a uno antes
 *      de dibujarlos. En nutri_laura eso dejó a Laura —que es dirección y la
 *      única otra profesional— abriendo un calendario limpio mientras las ocho
 *      ausencias de Rocío le salían enteras en la tabla de al lado. Ninguna
 *      prueba de API podía cazarlo, porque por dentro todo estaba bien.
 *   2. **A nombre de QUIÉN se ponen.** Cualquiera podía apuntar un bloqueo a
 *      nombre de cualquiera, incluido «todo el centro». En la consulta de Laura
 *      pasó SEIS veces: Rocío apuntaba lo suyo, se dejaba el desplegable en
 *      «Todo el centro» y cerraba también la agenda de Laura. Nadie se enteraba,
 *      porque una hora que no se ofrece se ve igual en los dos casos.
 *
 * Las dos viven en el mismo endpoint y se comprueban aquí a la vez, contra el
 * servidor de verdad y con dos sesiones distintas (dirección y una profesional),
 * que es lo único que las distingue.
 *
 * Requiere el servidor de desarrollo levantado y el tenant `sandbox`
 * (scripts/seed-sandbox.js). Crea lo que necesita y lo borra al terminar.
 *
 * Uso:  node --env-file=.env.local scripts/_smoke-bloqueos-quien-ve.mjs [slug]
 */

import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "sandbox";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const MARCA = `smoke-bloqueos-${Date.now()}`;
const EMAIL_ANA = `${MARCA}-ana@example.com`;
const EMAIL_ROCIO = `${MARCA}-rocio@example.com`;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));

const MAÑANA = Date.now() + 86_400_000;

async function main() {
  process.stdout.write(`\n═══ Smoke: los bloqueos de la agenda (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant "${SLUG}" (créalo con scripts/seed-sandbox.js)`);

  const { models } = getTenantDb(SLUG);
  const { TeamBlock, TeamMember } = models;
  if (!TeamBlock) throw new Error(`${SLUG} no tiene la tabla de bloqueos (falta migrar citas)`);

  const admin = await User.findOne({ where: { tenantId: tenant.id, role: ["admin", "superadmin"] } });
  if (!admin) throw new Error(`${SLUG} no tiene ningún admin`);

  // Dos profesionales, y un usuario NO admin atado a la segunda. La contraseña
  // es aleatoria y no se usa: se entra firmando el token, como el resto de los
  // smokes.
  const rocio = await TeamMember.create({ displayName: "Rocío (smoke)", email: EMAIL_ROCIO });
  const ana = await TeamMember.create({ displayName: "Ana (smoke)", email: EMAIL_ANA });
  const profesional = await User.create({
    tenantId: tenant.id,
    email: EMAIL_ANA,
    role: "user",
    passwordHash: await bcrypt.hash(randomBytes(24).toString("hex"), 10),
    moduleAccess: ["all"],
  });
  await ana.update({ userId: profesional.id });

  const creados = [];

  const sesion = async (u) => ({
    Cookie: `access_token=${await signAccessToken({ userId: u.id, email: u.email, role: u.role, tenantSlug: SLUG })}`,
    "x-user-id": u.id,
    "x-user-role": u.role,
    "Content-Type": "application/json",
  });

  async function listar(u) {
    const desde = new Date(MAÑANA - 86_400_000).toISOString();
    const hasta = new Date(MAÑANA + 2 * 86_400_000).toISOString();
    const r = await fetch(`${BASE}/api/citas/bloqueos?from=${desde}&to=${hasta}`, {
      headers: await sesion(u),
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, yo: j?.data?.yo, bloqueos: (j?.data?.bloqueos ?? []).filter((b) => b.label?.includes("(smoke)")) };
  }

  try {
    // ── 1. Tres bloqueos: de cada una, y uno del centro ────────────────────
    for (const [teamMemberId, label] of [
      [rocio.id, "Vacaciones (smoke)"],
      [ana.id, "Médico (smoke)"],
      [null, "Formación interna (smoke)"],
    ]) {
      creados.push(
        await TeamBlock.create({
          teamMemberId,
          label,
          startAt: new Date(MAÑANA),
          endAt: new Date(MAÑANA + 2 * 3_600_000),
        })
      );
    }

    // ── 2. Quién los ve ────────────────────────────────────────────────────
    paso("Los ve TODO el equipo, no cada cual los suyos");
    {
      const dir = await listar(admin);
      esperar(dir.status === 200, `dirección recibe 200`, String(dir.status));
      esperar(dir.bloqueos.length === 3, "dirección ve los tres", `ve ${dir.bloqueos.length}`);

      const suya = await listar(profesional);
      esperar(suya.status === 200, "una profesional recibe 200", String(suya.status));
      esperar(suya.bloqueos.length === 3, "y ve los tres también", `ve ${suya.bloqueos.length}`);

      // El de VERDAD importante: el de una COMPAÑERA. Es el que desaparecía, y
      // es justo el que hace falta para cubrirla o dar su hora a otra persona.
      esperar(
        suya.bloqueos.some((b) => b.teamMemberId === rocio.id),
        "incluido el de una compañera, que es el que desaparecía"
      );
      esperar(
        suya.bloqueos.some((b) => !b.teamMemberId),
        "y el cierre del centro, que afecta a todo el mundo"
      );
    }

    paso("Cada bloqueo dice de quién es");
    {
      const dir = await listar(admin);
      const deRocio = dir.bloqueos.find((b) => b.teamMemberId === rocio.id);
      esperar(!!deRocio?.teamMemberName, "viene con el nombre de la persona", JSON.stringify(deRocio ?? {}));
      // Sin esto, ver los de todo el equipo obliga a adivinar de quién es cada
      // franja negra del calendario.
      esperar(
        dir.bloqueos.find((b) => !b.teamMemberId)?.teamMemberName == null,
        "y el del centro viene SIN persona, para poder rotularlo aparte"
      );
    }

    paso("Quién es cada uno, para saber a qué bloqueo ponerle los botones");
    {
      const dir = await listar(admin);
      const suya = await listar(profesional);
      esperar(dir.yo?.esAdmin === true, "dirección consta como admin", JSON.stringify(dir.yo));
      esperar(suya.yo?.esAdmin === false, "la profesional, no", JSON.stringify(suya.yo));
      esperar(suya.yo?.teamMemberId === ana.id, "y se la reconoce por su ficha de equipo", JSON.stringify(suya.yo));
    }

    // ── 3. A nombre de quién se ponen ──────────────────────────────────────
    paso("Quien no es dirección solo puede bloquearse a SÍ MISMA");
    {
      // Pide bloquear a Rocío (o al centro entero, que es peor). El servidor
      // resuelve el nombre desde la sesión: da igual lo que mande el navegador.
      for (const [pedido, titulo] of [
        [rocio.id, "pide bloquear a una compañera"],
        [null, "pide cerrar el centro entero"],
      ]) {
        const r = await fetch(`${BASE}/api/citas/bloqueos`, {
          method: "POST",
          headers: await sesion(profesional),
          body: JSON.stringify({
            teamMemberId: pedido,
            fecha: new Date(MAÑANA).toISOString().slice(0, 10),
            horaInicio: "09:00",
            horaFin: "10:00",
            startAt: new Date(MAÑANA + 5 * 3_600_000).toISOString(),
            endAt: new Date(MAÑANA + 6 * 3_600_000).toISOString(),
            label: `Intento (smoke)`,
          }),
        });
        const j = await r.json().catch(() => ({}));
        const puesto = j?.data?.bloqueo ?? j?.data;
        if (r.status >= 400) {
          ok(`${titulo} → se rechaza (${r.status})`);
          continue;
        }
        if (puesto?.id) creados.push({ id: puesto.id, destroy: async () => TeamBlock.destroy({ where: { id: puesto.id } }) });
        esperar(
          puesto?.teamMemberId === ana.id,
          `${titulo} → queda a SU nombre, no al pedido`,
          `ha quedado a nombre de ${puesto?.teamMemberId ?? "nadie (¡el centro entero!)"}`
        );
      }
    }

    paso("Dirección sí puede cerrar el centro");
    {
      const r = await fetch(`${BASE}/api/citas/bloqueos`, {
        method: "POST",
        headers: await sesion(admin),
        body: JSON.stringify({
          teamMemberId: null,
          fecha: new Date(MAÑANA).toISOString().slice(0, 10),
          horaInicio: "16:00",
          horaFin: "17:00",
          startAt: new Date(MAÑANA + 7 * 3_600_000).toISOString(),
          endAt: new Date(MAÑANA + 8 * 3_600_000).toISOString(),
          label: "Cierre de dirección (smoke)",
        }),
      });
      const j = await r.json().catch(() => ({}));
      const puesto = j?.data?.bloqueo ?? j?.data;
      if (puesto?.id) creados.push({ id: puesto.id, destroy: async () => TeamBlock.destroy({ where: { id: puesto.id } }) });
      esperar(r.status < 400 && puesto?.teamMemberId == null, `queda sin persona = todo el centro (${r.status})`, JSON.stringify(j).slice(0, 200));
    }
  } finally {
    paso("Limpieza");
    for (const b of creados) {
      try { await b.destroy(); } catch { /* ya no estaba */ }
    }
    await TeamBlock.destroy({ where: { teamMemberId: [rocio.id, ana.id] } }).catch(() => {});
    await TeamMember.destroy({ where: { email: [EMAIL_ROCIO, EMAIL_ANA] } });
    await User.destroy({ where: { email: EMAIL_ANA } });
    ok("bloqueos, fichas de equipo y usuario de prueba borrados");
  }
}

main()
  .then(async () => {
    process.stdout.write(fallos === 0 ? "\n✅ Todo en orden\n\n" : `\n❌ ${fallos} fallo(s)\n\n`);
    await closeAllConnections().catch(() => {});
    await getMasterDb().close().catch(() => {});
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    process.stderr.write(`\n✗ Se ha roto: ${err.stack || err.message}\n\n`);
    await closeAllConnections().catch(() => {});
    process.exit(1);
  });

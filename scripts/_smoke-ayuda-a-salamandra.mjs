/**
 * _smoke-ayuda-a-salamandra.mjs — ¿puede este cliente avisarnos de que algo
 * falla?
 *
 * El camino es `/ayuda` → `master.buzon_avisos` → correo a nuestro buzón →
 * `/admin/buzon`. Tiene una trampa conocida: si el correo no sale, NADA falla a
 * la vista. El aviso se guarda igual, el cliente ve su acuse, y el fallo solo se
 * nota en que nadie contesta hasta que a alguien se le ocurre abrir el panel
 * (por eso `avisarPorCorreo.js` es best-effort). O sea: exactamente lo que no se
 * puede comprobar a ojo.
 *
 * Por defecto NO manda nada: comprueba las cuatro cosas que tienen que estar y
 * dice cuál falta. Con `--enviar` hace el viaje entero —crea un aviso de
 * verdad, manda el correo y BORRA el aviso—, que es la única forma de saber que
 * el correo sale.
 *
 * Uso:
 *   docker exec crm-salamandra-app-1 node scripts/_smoke-ayuda-a-salamandra.mjs aumenta
 *   docker exec crm-salamandra-app-1 node scripts/_smoke-ayuda-a-salamandra.mjs aumenta --enviar
 *   node --env-file=.env.local scripts/_smoke-ayuda-a-salamandra.mjs sandbox
 *
 * En local sin clave de Resend, `--enviar` dirá "modo simulacro": es correcto,
 * significa que el camino está bien y que lo único que falta es la clave.
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantResendConfig } from "../lib/outreach/resendConfig.js";
import { crearAviso } from "../lib/buzon/buzonStore.js";
import { serializarAviso, referencia } from "../lib/buzon/buzon.js";
import { avisarnos } from "../lib/buzon/avisarPorCorreo.js";

const SLUG = process.argv[2] || "aumenta";
const ENVIAR = process.argv.includes("--enviar");
const EMISOR = "salamandra_solutions";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const info = (m) => process.stdout.write(`  · ${m}\n`);
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));

async function main() {
  process.stdout.write(`\n═══ Smoke: «${SLUG} nos avisa de que algo falla» ═══\n`);

  const db = getMasterDb();
  const { Tenant, BuzonAviso } = getMasterModels();

  // ── 1. El cliente ────────────────────────────────────────────────────────
  paso("Quien escribe");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    mal(`no existe el tenant "${SLUG}"`);
    return;
  }
  ok(`${tenant.name} (${tenant.slug}), estado ${tenant.status}`);
  info("La pantalla de Ayuda no pide ningún módulo: la ve todo el mundo.");

  // ── 2. Dónde se guarda ───────────────────────────────────────────────────
  paso("Dónde cae el aviso");
  // Se pregunta con `to_regclass` y no con `information_schema.tables`: a esa
  // segunda forma Sequelize le reconoce la pinta de «listar tablas» y devuelve
  // el resultado con otra forma, así que la comprobación decía que no había
  // tablas mientras el aviso se guardaba tan campante dos pasos más abajo.
  const [reg] = await db.query(
    `SELECT to_regclass('master.buzon_avisos')   IS NOT NULL AS avisos,
            to_regclass('master.buzon_mensajes') IS NOT NULL AS mensajes,
            to_regclass('master.buzon_adjuntos') IS NOT NULL AS adjuntos`
  );
  const hay = reg[0];
  esperar(hay.avisos, "master.buzon_avisos");
  esperar(hay.mensajes, "master.buzon_mensajes");
  esperar(hay.adjuntos, "master.buzon_adjuntos");
  if (fallos) {
    info("Falta la migración del buzón: node scripts/migrate-buzon.js");
  }

  // ── 3. Con qué credenciales sale el correo ───────────────────────────────
  paso("Con qué cuenta sale el correo (la NUESTRA, no la del cliente)");
  const emisor = await Tenant.findOne({ where: { slug: EMISOR } });
  if (!emisor) {
    mal(`no existe el tenant "${EMISOR}", que es de quien sale el correo`);
  } else {
    const { apiKey, fromEmail } = getTenantResendConfig({ tenant: emisor });
    esperar(!!apiKey, "clave de Resend de salamandra_solutions (Configuración → Resend)");
    esperar(!!fromEmail, `remitente: ${fromEmail || "(sin poner)"}`);
    info(`destinatario: ${process.env.SOPORTE_EMAIL || "info@salamandrasolutions.com"}`);
    info(
      "Sale de NUESTRA cuenta a propósito: con la del cliente le gastaríamos su " +
        "cuota y su reputación de dominio para un correo nuestro."
    );
  }

  // ── 4. El enlace del panel ───────────────────────────────────────────────
  paso("El enlace que nos llega en el correo");
  const admin = (process.env.ADMIN_HOST || "").trim();
  esperar(!!admin, `ADMIN_HOST: ${admin || "(sin poner — el correo llegaría sin enlace)"}`);

  // ── 5. El viaje entero ───────────────────────────────────────────────────
  if (!ENVIAR) {
    paso("Envío de verdad");
    info("No se ha mandado nada. Añade --enviar para hacer el viaje completo.");
    return;
  }

  paso("Mandando uno de verdad (y borrándolo después)");
  let aviso = null;
  try {
    aviso = await crearAviso({
      tenant,
      usuario: {
        id: null,
        email: process.env.SOPORTE_EMAIL || "info@salamandrasolutions.com",
        nombre: "Comprobación automática",
        rol: "admin",
      },
      limpio: {
        tipo: "error",
        asunto: `PRUEBA — el aviso de ${tenant.name} llega`,
        cuerpo:
          "Aviso de PRUEBA creado por scripts/_smoke-ayuda-a-salamandra.mjs para " +
          "comprobar que el camino Ayuda → buzón → correo funciona. Se borra solo.",
        bloquea: false,
        pantalla: "/ayuda",
        contexto: {},
      },
    });
    ok(`aviso ${referencia(aviso.numero)} guardado en master.buzon_avisos`);

    const r = await avisarnos({ aviso: serializarAviso(aviso, { para: "salamandra" }) });
    if (r.ok) {
      ok("el correo SALIÓ de verdad (mira la bandeja de entrada)");
    } else if (r.motivo === "sin_configurar") {
      mal("el correo NO salió: no hay clave de Resend (modo simulacro)");
      info("En local es lo esperado. En producción significa que nadie se entera de nada.");
    } else {
      mal(`el correo NO salió: ${r.motivo}`);
    }
  } finally {
    if (aviso) {
      await BuzonAviso.destroy({ where: { id: aviso.id } });
      ok("aviso de prueba borrado del buzón");
    }
  }
}

main()
  .then(async () => {
    process.stdout.write(fallos === 0 ? "\n✅ Todo en orden\n\n" : `\n❌ ${fallos} fallo(s)\n\n`);
    await getMasterDb().close().catch(() => {});
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    process.stderr.write(`\n✗ Se ha roto: ${err.stack || err.message}\n\n`);
    await getMasterDb().close().catch(() => {});
    process.exit(1);
  });

// @vivo — Genérico por slug, con `--apagar`, `--sin/--con-cancelacion`, `--sin/--con-reserva` y `--dry-run`; nació para el «segundo centro» (Aumenta)… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * configure-portal-citas.js — enciende (o apaga) el área privada de citas de UN cliente.
 *
 * Sustituye a `configure-nutri-laura-citas-portal.js`, que hacía lo mismo pero
 * con el slug escrito a fuego y sin forma de pasarle otro. Aquí el cliente es un
 * argumento, que es lo que hacía falta para el segundo centro.
 *
 *   node scripts/configure-portal-citas.js <slug> [opciones]
 *
 *   --apagar              apaga el portal en vez de encenderlo
 *   --sin-cancelacion     además, impide que la familia anule sus citas
 *   --con-cancelacion     además, se lo vuelve a permitir
 *   --sin-reserva         además, cierra la agenda pública de reserva
 *   --con-reserva         además, la vuelve a abrir
 *   --dry-run             enseña qué haría y no toca nada
 *
 * Ejemplos:
 *   # Aumenta: portal encendido y anulación solo desde el centro
 *   node --env-file=.env.local scripts/configure-portal-citas.js aumenta --sin-cancelacion
 *
 *   # ver qué pasaría, sin escribir
 *   node --env-file=.env.production scripts/configure-portal-citas.js aumenta --dry-run
 *
 * ── DÓNDE SE EJECUTA EN EL VPS ──────────────────────────────────────────────
 * DENTRO del contenedor:
 *
 *   docker compose exec -T app node scripts/configure-portal-citas.js aumenta
 *
 * ⚠️ En el host NO funciona, aunque ahí estén el repo y `node_modules`: la base
 * de datos se llama `db` —el nombre del servicio de Docker— y ese nombre solo
 * se resuelve desde la red de Docker. Fuera devuelve `ENOTFOUND db`.
 *
 * Y como el Dockerfile hornea `scripts/` dentro de la imagen, un script nuevo
 * no existe en el contenedor hasta reconstruirla. La forma de no pagar un
 * despliegue extra por eso es COMMITEARLO ANTES del despliegue en el que se va
 * a usar: entra solo, con el resto del código.
 *
 * ── EL FLAG NO ES EL SECRETO ────────────────────────────────────────────────
 * Encender esto NO abre el portal por sí solo. Hacen falta además dos secretos
 * que viven SOLO en el entorno (regla 15) y que este script se limita a
 * comprobar:
 *   · WIDGET_SSO_SECRETS='{"<slug>":"<hex>"}'   compartido con su WordPress
 *   · CITAS_PORTAL_SESSION_SECRET='<hex>'        firma la sesión del CRM
 * Sin ellos, la familia no ve un error de configuración: ve «Inicia sesión para
 * ver tu perfil», como si no hubiera entrado en su cuenta. Por eso el script
 * avisa en voz alta cuando faltan.
 *
 * ⚠️ EL CACHÉ DE CLIENTE ES POR PROCESO. Este script corre en un proceso
 * distinto del servidor, así que su `invalidateTenantCache` no llega al que
 * atiende las peticiones: el cambio tarda hasta 60 segundos en notarse.
 * Comprobarlo antes de ese minuto da un resultado FALSO, en los dos sentidos.
 *
 * Idempotente: repetirlo no rompe nada ni duplica nada.
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const tiene = (f) => args.includes(f);

const apagar = tiene("--apagar");
const dryRun = tiene("--dry-run");
const sinCancelacion = tiene("--sin-cancelacion");
const conCancelacion = tiene("--con-cancelacion");
const sinReserva = tiene("--sin-reserva");
const conReserva = tiene("--con-reserva");

function salirConAyuda(motivo) {
  process.stderr.write(`\n✗ ${motivo}\n\n`);
  process.stderr.write("  Uso: node scripts/configure-portal-citas.js <slug> [--apagar]\n");
  process.stderr.write("       [--sin-cancelacion | --con-cancelacion]\n");
  process.stderr.write("       [--sin-reserva | --con-reserva] [--dry-run]\n\n");
  process.exit(1);
}

if (!slug) salirConAyuda("Falta el slug del cliente.");
if (sinCancelacion && conCancelacion) {
  salirConAyuda("--sin-cancelacion y --con-cancelacion se contradicen: elige uno.");
}
if (sinReserva && conReserva) {
  salirConAyuda("--sin-reserva y --con-reserva se contradicen: elige uno.");
}

async function main() {
  const accion = apagar ? "Apagando" : "Encendiendo";
  process.stdout.write(`\n▶ ${accion} el área privada de citas de "${slug}"${dryRun ? "  (SIMULACRO)" : ""}...\n\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant) {
    process.stderr.write(`  ✗ No existe ningún cliente con el slug "${slug}".\n\n`);
    process.exit(1);
  }

  const antesPortal = tenant.settings?.widget?.sso?.enabled === true;
  const antesBloqueo = tenant.settings?.citas?.cancelacionBloqueada === true;
  const antesReserva = tenant.settings?.citas?.reservaOnlineCerrada === true;

  // Merge en profundidad a mano: `widget` guarda además la rama `auth` (el
  // candado del widget de reserva) y `citas` tiene una docena de ajustes.
  // Escribir el objeto entero se los llevaría por delante.
  const settings = {
    ...(tenant.settings || {}),
    widget: {
      ...(tenant.settings?.widget || {}),
      sso: { ...(tenant.settings?.widget?.sso || {}), enabled: !apagar },
    },
  };

  if (sinCancelacion || conCancelacion || sinReserva || conReserva) {
    settings.citas = { ...(tenant.settings?.citas || {}) };
    if (sinCancelacion || conCancelacion) settings.citas.cancelacionBloqueada = sinCancelacion;
    if (sinReserva || conReserva) settings.citas.reservaOnlineCerrada = sinReserva;
  }

  const despuesPortal = !apagar;
  const despuesBloqueo = sinCancelacion || conCancelacion ? sinCancelacion : antesBloqueo;
  const despuesReserva = sinReserva || conReserva ? sinReserva : antesReserva;

  const flecha = (a, b) => (a === b ? `${a} (sin cambio)` : `${a} → ${b}`);
  process.stdout.write(`  Portal (widget.sso.enabled) ....... ${flecha(antesPortal, despuesPortal)}\n`);
  process.stdout.write(`  Anulación bloqueada ............... ${flecha(antesBloqueo, despuesBloqueo)}\n`);
  process.stdout.write(`  Agenda pública cerrada ............ ${flecha(antesReserva, despuesReserva)}\n\n`);

  if (dryRun) {
    process.stdout.write("  · Simulacro: no se ha escrito nada.\n\n");
    process.exit(0);
  }

  await tenant.update({ settings });
  invalidateTenantCache(slug);
  process.stdout.write("  ✓ Guardado.\n\n");

  // ── Lo que falta para que esto sirva de algo ──────────────────────────────
  const mapa = process.env.WIDGET_SSO_SECRETS;
  let tieneSuSecreto = false;
  if (mapa) {
    try {
      tieneSuSecreto = Boolean(JSON.parse(mapa)?.[slug]);
    } catch {
      process.stderr.write("  ⚠ WIDGET_SSO_SECRETS existe pero no es un JSON válido.\n");
    }
  }

  const marca = (ok) => (ok ? "✓" : "✗ FALTA");
  process.stdout.write("  Secretos del entorno (este script NO los pone):\n");
  process.stdout.write(`    ${marca(tieneSuSecreto)}  WIDGET_SSO_SECRETS["${slug}"]\n`);
  process.stdout.write(`    ${marca(Boolean(process.env.CITAS_PORTAL_SESSION_SECRET))}  CITAS_PORTAL_SESSION_SECRET\n\n`);

  if (!apagar && !tieneSuSecreto) {
    process.stdout.write(
      "  ⚠ Sin su secreto, la familia NO verá un error: verá «Inicia sesión para ver\n" +
        "    tu perfil», como si no hubiera entrado. Y el aviso solo se escribe UNA vez\n" +
        "    por proceso en los logs, así que es fácil que pase desapercibido.\n\n"
    );
    process.stdout.write(
      "    El mismo valor tiene que estar en el wp-config.php de su WordPress, en\n" +
        "    CRM_WIDGET_SSO_SECRET. Recuerda: cambiar .env.production exige RECREAR el\n" +
        "    contenedor, no basta con reiniciarlo.\n\n"
    );
  }

  process.stdout.write("  ⏳ El servidor cachea la ficha del cliente 60 s: si lo compruebas antes,\n");
  process.stdout.write("     te dirá lo de antes. No es que no se haya guardado.\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});

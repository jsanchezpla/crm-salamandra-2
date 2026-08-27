/**
 * lib/auth/recuperacion.js — «¿Olvidaste tu contraseña?», por fin con algo detrás.
 *
 * (Fichero en /lib, regla #2: lo comparten las tres rutas de /api/auth/recuperar
 * y concentra decisiones de seguridad que no deben repetirse a mano.)
 *
 * ── EL ESQUEMA, QUE ES DE RODRIGO (27/08/2026) ─────────────────────────────
 * La pantalla pide primero el NOMBRE DE USUARIO, y el camino depende de quién es:
 *
 *   · ADMIN del cliente  → correo a su `emailContacto` con un enlace de un solo
 *     uso que abre una pagina para poner la contraseña nueva dos veces. Es el
 *     caso que dolía: 11 clientes tienen UN solo admin y nadie dentro que pueda
 *     restablecérsela.
 *   · Cualquier otro     → campana al admin de su cliente («X ha olvidado su
 *     contraseña»), que se la restablece desde Equipo. Interno, sin correo.
 *   · Ni el usuario sabe → incidencia al buzón de Salamandra con la empresa, el
 *     cargo y el nombre que teclee.
 *
 * ── LAS REGLAS QUE NO SE VEN ───────────────────────────────────────────────
 * · El token viaja en el enlace y NO se guarda: en la base queda su sha256
 *   (`resetTokenHash`) y una caducidad corta. Un solo uso: al cambiar la
 *   contraseña se borra, y se sube `tokenVersion` para tirar las sesiones vivas.
 * · Un usuario que no existe responde EXACTAMENTE igual que un empleado: la
 *   pantalla no puede servir para comprobar qué usuarios son reales. (El caso
 *   admin sí se distingue — lo pidió Rodrigo: quien es admin tiene que saber
 *   que le ha llegado un correo. Son 13 cuentas con login conocido por sus
 *   dueños; el riesgo de señalarlas se asumió al elegir este esquema.)
 * · Las demos NO entran: le dan sesión de admin a cualquier visitante, así que
 *   aquí se tratan como si no existieran.
 * · La cuenta de back-office tampoco: va por otro host y con más poder que
 *   ningún admin; su reset sigue siendo `scripts/reset-tenant-admin-password.js`
 *   por SSH, a propósito.
 * · El correo sale del remitente de `salamandra_solutions` (info@…), como el
 *   buzón: 9 de 12 clientes no tienen servicio de correo propio, y con el suyo
 *   no podrían recuperar nada. Decidido por Rodrigo el 27/08/2026.
 */

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Op } from "sequelize";

import { getMasterModels } from "../db/masterDb.js";
import { getTenantDb } from "../db/tenantDb.js";
import { whereDelLogin } from "./correoCuentaDb.js";
import { revisarContrasena } from "./contrasena.js";
import { auditarLogin } from "./loginGuard.js";
import { esSlugDemo } from "../demo/demos.js";
import { sendEmail, envioRealizado } from "../email/resendClient.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";
import { correoDeRecuperacion } from "../email/templates/auth/recuperacion.js";
import { notifyAdmins } from "../notifications/notifyUsers.js";
import { crearAviso } from "../buzon/buzonStore.js";
import { avisarnos } from "../buzon/avisarPorCorreo.js";

/** Media hora. Corta a propósito: el correo se abre en minutos o no se abre. */
export const CADUCIDAD_MIN = 30;

/** Mismo emisor que el buzón: la cuenta de Salamandra dentro del CRM. */
const EMISOR = "salamandra_solutions";

const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");

/**
 * El nombre visible de una cuenta no vive en `master.users` (ahí `email` es el
 * identificador): sale de su ficha de equipo, si la tiene. Mismo criterio que
 * `lib/buzon/quienEscribe.js` — sin ficha, se usa el identificador y ya.
 */
async function nombreDe(user, tenantModels) {
  try {
    const { TeamMember } = tenantModels ?? {};
    if (TeamMember) {
      const tm = await TeamMember.findOne({ where: { userId: user.id }, attributes: ["displayName"] });
      if (tm?.displayName) return tm.displayName;
    }
  } catch {
    /* sin ficha de equipo también se recupera la contraseña */
  }
  return user.email;
}

async function remitenteDeSalamandra() {
  const { Tenant } = getMasterModels();
  const emisor = await Tenant.findOne({ where: { slug: EMISOR } });
  if (!emisor) return null;
  const { apiKey, fromEmail, replyTo } = getTenantResendConfig({ tenant: emisor });
  if (!apiKey || !fromEmail) return null;
  return { apiKey, fromEmail, replyTo };
}

/**
 * Paso 1: alguien ha tecleado su usuario en /recuperar.
 *
 * Devuelve SIEMPRE `{ via }` con "correo" (era admin: que mire su bandeja) o
 * "admin" (se ha avisado dentro del CRM — o el usuario no existe, que responde
 * igual adrede). Nunca lanza hacia la ruta: una recuperación caída no puede
 * enseñar un 500 con las tripas.
 */
export async function iniciarRecuperacion({ identificador, origen, ip }) {
  const neutral = { via: "admin" };
  try {
    const id = String(identificador ?? "").trim();
    if (!id) return neutral;

    const { User, Tenant } = getMasterModels();
    const user = await User.findOne({ where: whereDelLogin(id) });

    // No existe, es de back-office o no tiene cliente: misma respuesta que un
    // empleado. Desde fuera no se distingue.
    if (!user || user.soloBackoffice || user.role === "superadmin" || !user.tenantId) {
      await auditarLogin({ action: "password_recovery_desconocido", email: id, ip });
      return neutral;
    }

    const tenant = await Tenant.findByPk(user.tenantId);
    if (!tenant || esSlugDemo(tenant.slug)) return neutral;

    // ── Admin: correo con el enlace ─────────────────────────────────────────
    if (user.role === "admin") {
      if (!user.emailContacto) {
        // Sin dirección no hay a dónde escribirle, y siendo el único admin
        // tampoco hay nadie dentro: incidencia a Salamandra, que es quien
        // puede sacarle del pozo.
        await incidenciaAdminSinCorreo({ user, tenant, ip });
        return { via: "correo" }; // que la pantalla no delate qué cuentas no tienen correo
      }

      const token = crypto.randomBytes(32).toString("base64url");
      await User.update(
        {
          resetTokenHash: sha256(token),
          resetTokenExpira: new Date(Date.now() + CADUCIDAD_MIN * 60_000),
        },
        { where: { id: user.id } }
      );

      const emisor = await remitenteDeSalamandra();
      if (!emisor) {
        process.stderr.write(
          `[recuperacion] CORREO NO ENVIADO: a "${EMISOR}" le falta la clave o el remitente de Resend.\n`
        );
        return { via: "correo" };
      }

      let nombreAdmin = user.email;
      try {
        nombreAdmin = await nombreDe(user, getTenantDb(tenant.slug).models);
      } catch {
        /* el correo sale igual con el identificador */
      }
      const tpl = correoDeRecuperacion({
        nombre: nombreAdmin,
        tenantNombre: tenant.name || tenant.slug,
        url: `${origen}/recuperar/${token}`,
        minutos: CADUCIDAD_MIN,
      });
      const res = await sendEmail({
        to: user.emailContacto,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        from: emisor.fromEmail,
        replyTo: emisor.replyTo || undefined,
        apiKey: emisor.apiKey,
      });
      envioRealizado(res, "recuperacion");
      await auditarLogin({
        action: "password_recovery_correo",
        email: user.email,
        ip,
        userId: user.id,
        tenantId: user.tenantId,
      });
      return { via: "correo" };
    }

    // ── Empleado: campana a los admin de su cliente ─────────────────────────
    try {
      const { models } = getTenantDb(tenant.slug);
      await notifyAdmins({
        tenantId: tenant.id,
        tenantModels: models,
        type: "password_olvidada",
        title: `${await nombreDe(user, models)} ha olvidado su contraseña`,
        body: "Restablécesela desde Configuración → Equipo. Le llegará una nueva y podrá cambiársela al entrar.",
        entityType: "User",
        entityId: user.id,
        dedupe: true,
      });
    } catch (err) {
      process.stderr.write(`[recuperacion] no se pudo avisar al admin de ${tenant.slug}: ${err.message}\n`);
    }
    await auditarLogin({
      action: "password_recovery_aviso_admin",
      email: user.email,
      ip,
      userId: user.id,
      tenantId: user.tenantId,
    });
    return neutral;
  } catch (err) {
    process.stderr.write(`[recuperacion] fallo al iniciar: ${err.message}\n`);
    return neutral;
  }
}

/**
 * Paso 2: el enlace del correo, con la contraseña nueva dos veces (la pantalla
 * comprueba que casan; aquí llega una sola).
 *
 * Devuelve `{ ok: true }` o `{ ok: false, error }` con una frase enseñable.
 */
export async function completarRecuperacion({ token, password, ip }) {
  const t = String(token ?? "").trim();
  if (!t || t.length > 200) return { ok: false, error: "El enlace no es válido." };

  const problema = revisarContrasena(password);
  if (problema) return { ok: false, error: problema };

  const { User } = getMasterModels();
  const user = await User.scope("withPassword").findOne({
    where: { resetTokenHash: sha256(t), resetTokenExpira: { [Op.gt]: new Date() } },
  });
  if (!user) {
    await auditarLogin({ action: "password_recovery_token_malo", email: "(token)", ip });
    return {
      ok: false,
      error: "El enlace ha caducado o ya se usó. Vuelve a pedir la recuperación desde la pantalla de entrar.",
    };
  }

  await User.update(
    {
      passwordHash: await bcrypt.hash(String(password), 12),
      resetTokenHash: null,
      resetTokenExpira: null,
      // Las sesiones que hubiera vivas dejan de valer: si alguien pide el
      // enlace es porque no controla quién puede estar dentro.
      tokenVersion: user.tokenVersion + 1,
    },
    { where: { id: user.id } }
  );
  await auditarLogin({
    action: "password_recovery_completada",
    email: user.email,
    ip,
    userId: user.id,
    tenantId: user.tenantId,
  });
  return { ok: true };
}

/**
 * «Tampoco recuerdo mi usuario»: incidencia al buzón de Salamandra con lo que
 * la persona sepa decir de sí misma. Best-effort de arriba abajo.
 */
export async function incidenciaUsuarioOlvidado({ empresa, cargo, nombre, correo, ip }) {
  try {
    const limpio = {
      texto: (v, tope) => String(v ?? "").trim().slice(0, tope),
    };
    const laEmpresa = limpio.texto(empresa, 120);
    const elCargo = limpio.texto(cargo, 80);
    const elNombre = limpio.texto(nombre, 120);
    // A dónde mandarle el enlace CUANDO se compruebe quién es (Rodrigo,
    // 27/08/2026). Solo se apunta en la incidencia: mandar nada automático a
    // una dirección que acaba de teclear un anónimo sería regalar la cuenta a
    // quien diga ser otro.
    const elCorreo = limpio.texto(correo, 255);
    if (!laEmpresa || !elNombre || !elCorreo) {
      return { ok: false, error: "Di al menos tu nombre, tu empresa y un correo donde escribirte." };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(elCorreo)) {
      return { ok: false, error: "Ese correo no tiene forma de correo." };
    }

    // Si la empresa que teclea casa con un cliente real, el aviso sale ya
    // colgado de su ficha; si no, queda como "desconocido" y se triará a mano.
    const { Tenant } = getMasterModels();
    const tenants = await Tenant.findAll({ attributes: ["id", "slug", "name"] });
    const aguja = laEmpresa.toLowerCase();
    const tenant =
      tenants.find((t) => (t.name || "").toLowerCase() === aguja || t.slug === aguja) ||
      tenants.find((t) => (t.name || "").toLowerCase().includes(aguja) && aguja.length >= 4) ||
      null;

    const aviso = await crearAviso({
      tenant: tenant ?? { id: null, slug: "desconocido", name: laEmpresa },
      usuario: null,
      limpio: {
        tipo: "error",
        asunto: `Recuperación sin usuario: ${elNombre} (${laEmpresa})`,
        cuerpo:
          `Desde la pantalla de recuperación, sin poder entrar y sin recordar su usuario.\n\n` +
          `Empresa: ${laEmpresa}\nNombre: ${elNombre}\nCargo: ${elCargo || "no lo dijo"}\n` +
          `Correo que ha dejado: ${elCorreo}\n\n` +
          `Hay que comprobar que es quien dice ser y, una vez comprobado, restablecerle el acceso ` +
          `escribiéndole a ese correo. NO mandar nada sin comprobar: la dirección la ha tecleado ` +
          `un anónimo.`,
        bloquea: true,
        prioridad: "alta",
        pantalla: "/recuperar",
        contexto: { origen: "recuperacion", correo: elCorreo, ip: ip || null },
      },
    });
    await avisarnos({ aviso });
    await auditarLogin({ action: "password_recovery_sin_usuario", email: elNombre, ip });
    return { ok: true };
  } catch (err) {
    process.stderr.write(`[recuperacion] no se pudo abrir la incidencia: ${err.message}\n`);
    // A quien está fuera no se le dice «ha fallado el buzón»: se le da el
    // camino que siempre funciona.
    return { ok: false, error: "No se pudo registrar. Escríbenos a info@salamandrasolutions.com." };
  }
}

async function incidenciaAdminSinCorreo({ user, tenant, ip }) {
  try {
    const aviso = await crearAviso({
      tenant,
      usuario: null,
      limpio: {
        tipo: "error",
        asunto: `El admin de ${tenant.name || tenant.slug} ha perdido su contraseña y no tiene correo`,
        cuerpo:
          `${user.email} (admin de ${tenant.name || tenant.slug}) ha pedido recuperar su ` +
          `contraseña desde /recuperar, pero su cuenta no tiene correo de contacto: no hay a dónde ` +
          `mandarle el enlace.\n\nHay que restablecérsela a mano (scripts/reset-tenant-admin-password.js) ` +
          `y de paso pedirle un correo y ponérselo en su ficha de Equipo.`,
        bloquea: true,
        prioridad: "alta",
        pantalla: "/recuperar",
        contexto: { origen: "recuperacion", usuarioId: user.id, ip: ip || null },
      },
    });
    await avisarnos({ aviso });
  } catch (err) {
    process.stderr.write(`[recuperacion] admin sin correo y sin incidencia: ${err.message}\n`);
  }
}

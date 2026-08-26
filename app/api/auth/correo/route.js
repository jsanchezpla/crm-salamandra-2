import bcrypt from "bcrypt";

import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, unauthorized, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { esPeticionDeBackoffice } from "../../../../lib/auth/backoffice.js";
import {
  comprobarIntentoLogin,
  registrarFalloLogin,
  limpiarFallosLogin,
  auditarLogin,
} from "../../../../lib/auth/loginGuard.js";
import { correoDeCuenta, normalizarCorreo, revisarCorreoCuenta } from "../../../../lib/auth/correoCuenta.js";
import { correoLibre } from "../../../../lib/auth/correoCuentaDb.js";
import { enforceRateLimit } from "../../../../lib/utils/rateLimit.js";

/**
 * POST /api/auth/correo — ponerse UNO MISMO el correo de su cuenta.
 *
 * ── POR QUÉ HACE FALTA (26/08/2026, Jorge: «¿cómo asignan su correo?») ─────
 * El mismo día en que el correo pasó a ser obligatorio al crear una cuenta,
 * quedaron 14 cuentas vivas SIN ninguna dirección. Entran igual que siempre —eso
 * no cambia—, pero no tienen a dónde recibir un enlace de recuperación.
 *
 * Un admin puede ponérselo a cualquiera desde Equipo, y para las 13 terapeutas
 * de Aumenta con eso basta. El problema son las otras:
 *
 *   · Las cuentas de ADMINISTRADOR no se gestionan desde Equipo —`loadManagedUser`
 *     las rechaza con un 403 a propósito—, así que nadie podía ponerles correo.
 *   · Y tampoco la de UNO MISMO, que esa ruta rechaza aparte.
 *
 * O sea que la persona a la que esto tenía que salvar —el administrador ÚNICO de
 * un cliente, y hay 11 clientes con uno solo— era justo la única que se quedaba
 * sin forma de arreglarlo. Con esta ruta se lo pone él, desde Configuración, al
 * lado de donde se cambia la contraseña.
 *
 * ── LO QUE ESTA RUTA NO ES ────────────────────────────────────────────────
 * No es la recuperación de contraseña. Esto es «ponerme el correo estando
 * dentro»; recuperarla cuando NO puedes entrar sigue sin existir. Pero sin esto,
 * aquello no le serviría a media casa.
 *
 * Los frenos son los mismos que los de `/api/auth/password` y en el mismo orden,
 * porque el riesgo es parecido: el correo de una cuenta también sirve para
 * ENTRAR, y será a donde llegue el enlace de recuperación. Cambiárselo a alguien
 * es media apropiación de su cuenta.
 */
export const POST = withTenant(async (request, _params, ctx) => {
  try {
    const userId = ctx.user?.id;
    if (!userId) return unauthorized();

    /*
     * 1 · LA DEMO, NO. Las cuatro son públicas y dan sesión de admin a
     * cualquiera: el primero que pasara le pondría su correo a la cuenta de la
     * demo, y con eso se la lleva en cuanto exista la recuperación.
     */
    if (isDemoTenant(ctx)) {
      return forbidden("En la demo no se puede cambiar el correo: la cuenta la comparte todo el mundo.");
    }

    // 2 · Un tope al camino de éxito también: cada petición es un bcrypt de
    // coste 12, y el cerrojo de abajo solo cuenta los fallos.
    const limitado = enforceRateLimit(request, { key: "auth-correo", limit: 5, windowMs: 60_000 });
    if (limitado) return limitado;

    // 3 · El cerrojo, antes de leer el cuerpo.
    const { User } = getMasterModels();
    const user = await User.scope("withPassword").findByPk(userId);
    if (!user) return unauthorized();

    // El mismo candado de host que llevan las otras puertas de auth.
    const enBackoffice = esPeticionDeBackoffice(request);
    if (user.soloBackoffice !== enBackoffice) return unauthorized();

    const cerrojo = comprobarIntentoLogin(request, user.email);
    if (cerrojo.bloqueado) {
      return error(`Demasiados intentos. Prueba de nuevo en ${cerrojo.retryAfter}s.`, 429);
    }

    const cuerpo = await request.json().catch(() => null);
    const actual = typeof cuerpo?.actual === "string" ? cuerpo.actual : "";
    const correo = normalizarCorreo(cuerpo?.correo);
    if (!actual) return error("Hace falta tu contraseña para cambiar el correo.");

    /*
     * 4 · LA CONTRASEÑA, SIEMPRE. Es lo que separa «ponerme mi correo» de
     * «quedarme con la cuenta de quien ha dejado la sesión abierta»: sin esto,
     * un ordenador sin bloquear en una sala de espera basta para apuntar la
     * cuenta a un buzón ajeno y esperar a pedir un enlace de recuperación.
     */
    const correcta = await bcrypt.compare(actual, user.passwordHash ?? "");
    if (!correcta) {
      // `barrido: false`: aquí la identidad ya la prueba el JWT y no se pueden
      // tantear cuentas ajenas, así que el contador de la IP —que no se limpia
      // al acertar— no debe tocarse: dejaría sin login a las 15 personas de
      // Aumenta que salen por la misma línea.
      registrarFalloLogin(cerrojo.ip, user.email, { barrido: false });
      await auditarLogin({
        action: "auth.correo_change_failed",
        email: user.email,
        ip: cerrojo.ip,
        userId: user.id,
        tenantId: ctx.tenant?.id ?? null,
        motivo: "password_actual",
      });
      return error("Esa no es tu contraseña.", 401);
    }
    limpiarFallosLogin(user.email, cerrojo.ip);

    // 5 · Que el correo valga y no lo tenga ya nadie. La regla y la consulta son
    // las MISMAS que usan las tres puertas de alta.
    const queja = revisarCorreoCuenta(correo);
    if (queja) return error(queja);
    const ocupado = await correoLibre(User, correo, { exceptoId: user.id });
    if (ocupado) return error(ocupado, 409);

    const antes = correoDeCuenta(user);
    if (antes === correo) return ok({ correo, cambiado: false });

    /*
     * 6 · Guardarlo. NO se sube `tokenVersion` ni se tumban las demás sesiones,
     * al revés que en el cambio de contraseña: allí se hace porque cambiarla
     * significa «sospecho que alguien la sabe». Aquí no ha cambiado ninguna
     * credencial —la contraseña sigue siendo la misma— y echar a la persona de
     * sus otros dispositivos por apuntar su correo sería un castigo sin motivo.
     */
    await user.update({ emailContacto: correo });

    // El resumen guarda direcciones, sí: son de la CUENTA y ya viven en master,
    // no se está sacando nada del schema del cliente. Y es lo que permite ver
    // después a qué buzón se apuntó una cuenta, que es justo lo que importaría
    // si alguna vez alguien lo cambiara sin permiso.
    await auditarLogin({
      action: "auth.correo_changed",
      email: user.email,
      ip: cerrojo.ip,
      userId: user.id,
      tenantId: ctx.tenant?.id ?? null,
      motivo: antes ? `de ${antes} a ${correo}` : `puesto ${correo}`,
    });

    return ok({ correo, cambiado: true });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * GET /api/auth/correo — qué correo tiene mi cuenta ahora, y si esto es la demo.
 *
 * Lo pinta la tarjeta de Configuración. `correo: null` es el caso que importa:
 * significa «esta cuenta no puede recuperar su contraseña», y la pantalla lo
 * dice en ámbar en vez de dejar un campo vacío que no explica nada.
 */
export const GET = withTenant(async (_request, _params, ctx) => {
  try {
    const userId = ctx.user?.id;
    if (!userId) return unauthorized();
    const { User } = getMasterModels();
    const user = await User.findByPk(userId, { attributes: ["id", "email", "emailContacto"] });
    if (!user) return unauthorized();
    return ok({
      usuario: user.email,
      correo: correoDeCuenta(user),
      // `true` cuando el correo ES el identificador: entonces no hay nada que
      // poner y cambiarlo sería cambiarle el login a alguien, que no se hace
      // desde aquí.
      esElIdentificador: correoDeCuenta(user) === normalizarCorreo(user.email),
      enDemo: isDemoTenant(ctx),
    });
  } catch (err) {
    return serverError(err);
  }
});

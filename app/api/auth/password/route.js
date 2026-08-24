import bcrypt from "bcrypt";

import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, unauthorized, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { signAccessToken, signRefreshToken, setAuthCookies } from "../../../../lib/auth/jwt.js";
import { esPeticionDeBackoffice } from "../../../../lib/auth/backoffice.js";
import {
  comprobarIntentoLogin,
  registrarFalloLogin,
  limpiarFallosLogin,
  auditarLogin,
} from "../../../../lib/auth/loginGuard.js";
import { MINIMO, MAXIMO, revisarContrasena } from "../../../../lib/auth/contrasena.js";
import { enforceRateLimit } from "../../../../lib/utils/rateLimit.js";

/**
 * POST /api/auth/password — cambiarse UNO MISMO la contraseña.
 *
 * ── POR QUÉ NO EXISTÍA HASTA HOY (24/08/2026) ─────────────────────────────
 * Se podía cambiar la contraseña de OTRO —un admin, desde Equipo— y esa ruta
 * genera una aleatoria de 12 caracteres y dice explícitamente «nunca uno
 * mismo». O sea que en producción había 24 personas viviendo con una contraseña
 * que no habían elegido, que no podían memorizar, y que solo cambiaba pidiéndolo
 * por teléfono a alguien que además la veía al generarla. De las 16 de Aumenta,
 * 15 no son admin: no podían tocar nada de esto.
 *
 * ── LO QUE ESTA RUTA NO ARREGLA, Y CONVIENE NO CONFUNDIR ──────────────────
 * Esto es «cambiarla estando dentro». Recuperarla cuando NO puedes entrar sigue
 * sin existir: el «¿Olvidaste tu contraseña?» del login es un enlace muerto.
 * Eso es más grande —necesita correo con un enlace de un solo uso— y es otra
 * tarea.
 */

/* ── Los frenos, en el orden en que actúan, y por qué cada uno ───────────── */

export const POST = withTenant(async (request, _ctx, ctx) => {
  try {
    const userId = ctx.user?.id;
    if (!userId) return unauthorized();

    /*
     * 1 · LA DEMO, NO.
     * Las cuatro demos son públicas y le dan sesión de ADMIN a cualquier
     * visitante. Sin este corte, el primero que pasara por ahí le cambiaría la
     * contraseña a la cuenta de la demo y dejaría fuera a todos los demás —
     * incluidos los que estén viéndola en ese momento.
     */
    if (isDemoTenant(ctx)) {
      return forbidden("En la demo no se puede cambiar la contraseña: la comparte todo el mundo.");
    }

    /*
     * 2 · UN TOPE AL CAMINO DE ÉXITO, NO SOLO AL DE FALLO.
     * Cada petición son DOS bcrypt de coste 12 —comparar la vieja y cifrar la
     * nueva— y el cerrojo de abajo solo cuenta los fallos: acertar lo borra. Sin
     * esto, cualquiera con sesión puede alternar dos contraseñas suyas en un
     * bucle y poner a la cola los logins de los once clientes, porque bcrypt
     * ocupa el pool de hilos del proceso. Mismo patrón que `/api/auth/refresh`.
     */
    const limitado = enforceRateLimit(request, {
      key: "auth-password",
      limit: 5,
      windowMs: 60_000,
    });
    if (limitado) return limitado;

    /*
     * 3 · EL CERROJO, ANTES DE LEER EL CUERPO.
     * En este orden y no al revés, igual que el login: si la cuenta está
     * bloqueada no se toca ni el cuerpo de la petición ni la base.
     */
    const { User } = getMasterModels();
    // Scope `withPassword`: el defaultScope esconde `passwordHash`, y sin él ni
    // se puede comparar ni el update del hash es fiable (mismo detalle que en
    // los scripts de reset y en la ruta de Equipo).
    const user = await User.scope("withPassword").findByPk(userId);
    if (!user) return unauthorized();

    /*
     * ¿Puede esta cuenta entrar POR AQUÍ? El mismo candado que llevan las otras
     * dos puertas que firman sesión (`login` y `refresh`), y esta es la tercera.
     * Sin él, a una cuenta del CRM convertida en cuenta de back-office —que el
     * login y el refresh ya rechazan— esta ruta le renovaría el par de tokens
     * del CRM indefinidamente, cada vez que se cambiara la contraseña.
     */
    const enBackoffice = esPeticionDeBackoffice(request);
    if (user.soloBackoffice !== enBackoffice) return unauthorized();

    const cerrojo = comprobarIntentoLogin(request, user.email);
    if (cerrojo.bloqueado) {
      return error(`Demasiados intentos. Prueba de nuevo en ${cerrojo.retryAfter}s.`, 429);
    }

    const cuerpo = await request.json().catch(() => null);
    const actual = typeof cuerpo?.actual === "string" ? cuerpo.actual : "";
    const nueva = typeof cuerpo?.nueva === "string" ? cuerpo.nueva : "";
    if (!actual || !nueva) return error("Hacen falta la contraseña de ahora y la nueva.");

    /*
     * 4 · LA DE AHORA, SIEMPRE.
     * Es lo que separa «cambiar mi contraseña» de «quedarme con la cuenta de
     * quien ha dejado la sesión abierta». Sin esto, un ordenador sin bloquear
     * en una sala de espera es una cuenta perdida para siempre: se le cambia la
     * contraseña, se le tumban las sesiones y ya no puede volver a entrar.
     */
    const correcta = await bcrypt.compare(actual, user.passwordHash ?? "");
    if (!correcta) {
      // `barrido: false`: NO se toca el contador de la IP. Aquí no se pueden
      // tantear cuentas ajenas —la identidad la prueba el JWT— y ese contador no
      // se limpia nunca al acertar: las erratas de las 15 personas de Aumenta,
      // que salen por la misma IP, acabarían dejando al centro entero sin login.
      registrarFalloLogin(cerrojo.ip, user.email, { barrido: false });
      await auditarLogin({
        action: "auth.password_change_failed",
        email: user.email,
        ip: cerrojo.ip,
        userId: user.id,
        tenantId: ctx.tenant?.id ?? null,
        motivo: "password_actual",
      });
      return error("La contraseña de ahora no es esa.", 401);
    }

    /*
     * Ha acertado: el contador se limpia AQUÍ y no al final.
     *
     * Estaba después del guardado, así que quien acertaba la de ahora pero
     * elegía una nueva que no pasaba la validación se quedaba con sus fallos
     * anteriores acumulados — y podía cerrarse el login por unas erratas que ya
     * había corregido.
     */
    limpiarFallosLogin(user.email, cerrojo.ip);

    // 5 · Que la nueva valga. Las reglas viven en `lib/auth/contrasena.js`. Se le
    // pasan el correo y el slug para que pueda rechazar lo que se adivina solo.
    const queja = revisarContrasena(nueva, actual, {
      email: user.email,
      slug: ctx.tenant?.slug ?? null,
    });
    if (queja) return error(queja);

    /*
     * 6 · GUARDARLA, Y TUMBAR LAS DEMÁS SESIONES.
     *
     * `tokenVersion` va dentro del token de REFRESCO, así que subirlo caduca
     * las sesiones de los demás dispositivos en cuanto intenten refrescar. Eso
     * es lo que se quiere: si cambias la contraseña porque sospechas que
     * alguien la sabe, dejarle la sesión abierta no arregla nada.
     *
     * Y por eso mismo hay que volver a emitir las cookies AQUÍ: si no, el
     * primero al que echa el cambio es a quien lo acaba de hacer.
     */
    const passwordHash = await bcrypt.hash(nueva, 12);
    await user.update({ passwordHash });
    /*
     * `increment` y no `leer + 1`: entre que se leyó la fila y se escribe aquí
     * pasan dos bcrypt —medio segundo largo— y en ese hueco otra sesión puede
     * haber refrescado y subido la versión. Escribiendo el número absoluto que
     * leímos, ese refresco se perdería y la sesión que se quería tumbar
     * sobreviviría, que es justo lo contrario de lo que hace este freno. Se deja
     * que sume la BASE, y se firma con lo que ella diga.
     */
    await user.increment("tokenVersion", { by: 1 });
    await user.reload();
    const tokenVersion = user.tokenVersion;

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantSlug: ctx.tenant.slug,
        // El sello del host viaja en el token y el middleware lo exige en cada
        // petición. Si se emitiera sin él, la sesión recién renovada dejaría de
        // valer justo en el sitio donde se está usando.
        bo: enBackoffice,
      }),
      signRefreshToken({ userId: user.id, tenantSlug: ctx.tenant.slug, tokenVersion }),
    ]);

    // Auditoría: que ha cambiado, quién y desde dónde. La contraseña, jamás —
    // ni la vieja, ni la nueva, ni su longitud.
    await auditarLogin({
      action: "auth.password_changed",
      email: user.email,
      ip: cerrojo.ip,
      userId: user.id,
      tenantId: ctx.tenant?.id ?? null,
    });

    const respuesta = ok({ cambiada: true });
    setAuthCookies(respuesta, { accessToken, refreshToken });
    return respuesta;
  } catch (err) {
    return serverError(err);
  }
});

/** Lo que la pantalla necesita saber para poder decir las reglas ANTES de fallar. */
export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    if (!ctx.user?.id) return unauthorized();
    return ok({ minimo: MINIMO, maximo: MAXIMO, enDemo: isDemoTenant(ctx) });
  } catch (err) {
    return serverError(err);
  }
});

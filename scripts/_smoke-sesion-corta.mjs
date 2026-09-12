// @prueba ligera — funciones puras de /lib y cookies sobre una respuesta falsa; sin base, sin servidor.
/**
 * _smoke-sesion-corta.mjs — la sesión «como admin» del calendario global
 * (12/09/2026, revisión del v2).
 *
 *   node --test scripts/_smoke-sesion-corta.mjs
 *
 * Lo que un despiste rompería en silencio:
 *   1. `sesionCortaVigente` decide si SessionKeeper renueva o no. Si dijera
 *      «vigente» de más, una sesión NORMAL dejaría de renovarse y echaría a la
 *      gente del CRM a los 15 minutos; si dijera «no» de más, volvería el corte
 *      a los 12 minutos de la sesión como admin.
 *   2. El orden de las cookies: `setAuthCookies` y `clearAuthCookies` BORRAN la
 *      marca (un login, un refresh o un logout normales la quitan) y
 *      `marcarSesionCorta`, llamada después, gana.
 *   3. El token de esa sesión lleva `imp` y la firma lo conserva.
 *   4. `marcarAutoria`: `after.comoAdminDesde` en nulos y objetos planos, sin
 *      mutar el original y sin tocar lo que no es un objeto plano.
 *   5. El contexto de la petición lleva `impersonadorId` y, fuera de una, no
 *      hay contexto (el hook de AuditLog no firma nada en un script).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.JWT_SECRET ??= "secreto-de-prueba";

const { COOKIE_SESION_CORTA, leerCookie, sesionCortaVigente, marcarAutoria } =
  await import("../lib/auth/sesionCorta.js");
const {
  setAuthCookies,
  clearAuthCookies,
  marcarSesionCorta,
  signAccessToken,
  verifyAccessToken,
  ACCESS_TTL_SECONDS,
} = await import("../lib/auth/jwt.js");
const { conContextoDeUso, contextoDeUso } = await import("../lib/ai/usoDeIA.js");

/** Una respuesta con `cookies.set` que, como la de Next, guarda por nombre. */
function respuestaFalsa() {
  const cookies = new Map();
  return {
    cookies: { set: (nombre, valor, opciones) => cookies.set(nombre, { valor, ...opciones }) },
    guardadas: cookies,
  };
}

describe("sesionCortaVigente", () => {
  const ahora = 1_800_000_000_000;

  it("vigente si el instante es futuro, entre otras cookies y con espacios", () => {
    assert.equal(
      sesionCortaVigente(`a=1; ${COOKIE_SESION_CORTA}=${ahora + 60_000}; b=2`, ahora),
      true
    );
    assert.equal(sesionCortaVigente(`${COOKIE_SESION_CORTA}= ${ahora + 1} `, ahora), true);
  });

  it("no vigente si ya pasó o es justo ahora", () => {
    assert.equal(sesionCortaVigente(`${COOKIE_SESION_CORTA}=${ahora - 1}`, ahora), false);
    assert.equal(sesionCortaVigente(`${COOKIE_SESION_CORTA}=${ahora}`, ahora), false);
  });

  it("sin cookie, vacía o con basura cuenta como no hay: se renueva como siempre", () => {
    assert.equal(sesionCortaVigente("", ahora), false);
    assert.equal(sesionCortaVigente(undefined, ahora), false);
    assert.equal(sesionCortaVigente("a=1; b=2", ahora), false);
    assert.equal(sesionCortaVigente(`${COOKIE_SESION_CORTA}=`, ahora), false);
    assert.equal(sesionCortaVigente(`${COOKIE_SESION_CORTA}=mañana`, ahora), false);
    assert.equal(sesionCortaVigente(`${COOKIE_SESION_CORTA}=-5`, ahora), false);
    assert.equal(sesionCortaVigente(`${COOKIE_SESION_CORTA}=1e20`, ahora), false);
  });

  it("no confunde una cookie cuyo nombre contiene al de la marca", () => {
    assert.equal(sesionCortaVigente(`x${COOKIE_SESION_CORTA}=${ahora + 60_000}`, ahora), false);
    assert.equal(
      leerCookie(`x${COOKIE_SESION_CORTA}=1; ${COOKIE_SESION_CORTA}=2`, COOKIE_SESION_CORTA),
      "2"
    );
  });
});

describe("cookies de la sesión", () => {
  it("setAuthCookies borra la marca; marcarSesionCorta después la pone viva, legible y estricta", () => {
    const r = respuestaFalsa();
    setAuthCookies(r, { accessToken: "a", refreshToken: "" });
    assert.equal(r.guardadas.get(COOKIE_SESION_CORTA).maxAge, 0);

    const antes = Date.now();
    marcarSesionCorta(r);
    const marca = r.guardadas.get(COOKIE_SESION_CORTA);
    assert.equal(marca.httpOnly, false);
    assert.equal(marca.sameSite, "strict");
    assert.equal(marca.path, "/");
    assert.equal(marca.maxAge, ACCESS_TTL_SECONDS);
    assert.equal(
      marca.maxAge,
      r.guardadas.get("access_token").maxAge,
      "vive lo mismo que el access token"
    );
    const caduca = Number(marca.valor);
    assert.ok(
      caduca >= antes + ACCESS_TTL_SECONDS * 1000 &&
        caduca <= Date.now() + ACCESS_TTL_SECONDS * 1000
    );
    assert.equal(sesionCortaVigente(`${COOKIE_SESION_CORTA}=${marca.valor}`), true);
  });

  it("un login o un refresh normal (setAuthCookies) y un logout (clearAuthCookies) la quitan", () => {
    const login = respuestaFalsa();
    marcarSesionCorta(login);
    setAuthCookies(login, { accessToken: "a", refreshToken: "r" });
    assert.equal(login.guardadas.get(COOKIE_SESION_CORTA).maxAge, 0);

    const salir = respuestaFalsa();
    marcarSesionCorta(salir);
    clearAuthCookies(salir);
    assert.equal(salir.guardadas.get(COOKIE_SESION_CORTA).maxAge, 0);
    assert.equal(salir.guardadas.get(COOKIE_SESION_CORTA).path, "/");
  });

  it("el access token conserva `imp` al firmarse y verificarse", async () => {
    const token = await signAccessToken({
      userId: "u-cliente",
      role: "admin",
      tenantSlug: "x",
      bo: false,
      imp: "u-salamandra",
    });
    const payload = await verifyAccessToken(token);
    assert.equal(payload.imp, "u-salamandra");
    assert.equal(payload.userId, "u-cliente");
  });
});

describe("marcarAutoria", () => {
  it("añade comoAdminDesde a un after nulo o a un objeto plano, sin mutarlo", () => {
    assert.deepEqual(marcarAutoria(null, "imp"), { comoAdminDesde: "imp" });
    assert.deepEqual(marcarAutoria(undefined, "imp"), { comoAdminDesde: "imp" });
    const after = { total: 10 };
    assert.deepEqual(marcarAutoria(after, "imp"), { total: 10, comoAdminDesde: "imp" });
    assert.deepEqual(after, { total: 10 });
    const sinPrototipo = Object.assign(Object.create(null), { a: 1 });
    assert.equal(marcarAutoria(sinPrototipo, "imp").comoAdminDesde, "imp");
  });

  it("lo que no es un objeto plano se guarda tal cual", () => {
    const lista = [1, 2];
    assert.equal(marcarAutoria(lista, "imp"), lista);
    assert.equal(marcarAutoria("texto", "imp"), "texto");
    assert.equal(marcarAutoria(7, "imp"), 7);
    const fecha = new Date(0);
    assert.equal(marcarAutoria(fecha, "imp"), fecha);
  });

  it("sin impersonador devuelve lo mismo que recibió", () => {
    const after = { a: 1 };
    assert.equal(marcarAutoria(after, null), after);
    assert.equal(marcarAutoria(after, ""), after);
    assert.equal(marcarAutoria(null, undefined), null);
  });
});

describe("contexto de la petición", () => {
  it("lleva impersonadorId dentro y no hay contexto fuera", async () => {
    assert.equal(contextoDeUso(), null);
    await conContextoDeUso({ tenantId: "t", userId: "u", impersonadorId: "imp" }, async () => {
      await Promise.resolve();
      assert.equal(contextoDeUso().impersonadorId, "imp");
      assert.equal(contextoDeUso().userId, "u");
    });
    await conContextoDeUso({ tenantId: "t", userId: "u" }, async () => {
      assert.equal(contextoDeUso().impersonadorId, null);
    });
    assert.equal(contextoDeUso(), null);
  });
});

"use client";

// modules/config/tarjetas/Cuenta.jsx — pestaña «Tu cuenta» de Configuración:
// la única que puede tocar quien no es admin. El correo con el que se entra y
// la contraseña.


import { useEffect, useState } from "react";
import { MAXIMO, MINIMO, cumpleTodo, requisitosDe } from "@/lib/auth/contrasena.js";
// La MISMA regla del servidor para el correo de la cuenta. `correoCuenta.js` no
// importa nada, justo para poder usarse también aquí.
import { esCorreo as pareceCorreo } from "@/lib/auth/correoCuenta.js";
import { inputCls } from "./ui.jsx";
/**
 * Cambiarte TU contraseña (24/08/2026, Jorge).
 *
 * ── POR QUÉ ES LA ÚNICA TARJETA DE ESTA PANTALLA SIN `readOnly` ───────────
 * Todo lo demás de Configuración es de la EMPRESA, y por eso está en
 * solo-lectura para quien no es admin. Esto es de la PERSONA. En producción hay
 * 24 usuarios de clientes reales y 16 tienen rol `user` —15 de ellos en
 * Aumenta—, o sea que si esta tarjeta heredara el `disabled={!isAdmin}` del
 * resto dejaría fuera justo a quien viene a servir.
 *
 * Hasta hoy nadie podía cambiarse la suya: la única forma era que un admin la
 * RESTABLECIERA desde Equipo, y eso genera una aleatoria de 12 caracteres. La
 * que te dan es la que te queda.
 *
 * ── LO QUE LA PANTALLA HACE Y LO QUE NO ──────────────────────────────────
 * No decide nada: manda las tres cosas al servidor y pinta lo que conteste. Las
 * reglas de qué contraseña vale viven en `lib/auth/contrasena.js` y las aplica
 * el endpoint; aquí solo se ADELANTAN para no hacer escribir tres campos y
 * fallar después. Si algún día divergen, manda el servidor.
 *
 * El campo de repetir no es un capricho: no hay forma de recuperar una
 * contraseña en este CRM —el «¿Olvidaste tu contraseña?» del login no lleva a
 * ninguna parte todavía—, así que una errata al escribirla te deja fuera y hay
 * que llamar por teléfono.
 */
/**
 * «El correo de tu cuenta» — para que cada uno se ponga el suyo.
 *
 * ── POR QUÉ ESTÁ AQUÍ Y NO SOLO EN EQUIPO (26/08/2026) ─────────────────────
 * Un admin puede ponerle el correo a cualquiera desde Equipo, pero esa ruta
 * rechaza a propósito las cuentas de ADMINISTRADOR y la de UNO MISMO. Como hay
 * 11 clientes con un solo administrador, la persona que más necesita poder
 * recuperar su contraseña era justo la que no tenía dónde apuntar su correo.
 *
 * El aviso en ámbar cuando no hay ninguno no es decorativo: es la única señal
 * que verá esa persona antes del día en que se quede fuera.
 */
export function CorreoCuentaCard() {
  const [estado, setEstado] = useState(null); // { usuario, correo, esElIdentificador, enDemo }
  const [abierto, setAbierto] = useState(false);
  const [correo, setCorreo] = useState("");
  const [actual, setActual] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [hecho, setHecho] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/auth/correo", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (vivo && j?.ok) setEstado(j.data); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  // La MISMA regla que aplica el servidor (lib/auth/correoCuenta.js).
  const puede = pareceCorreo(correo) && actual.length > 0 && !guardando;

  async function guardar() {
    setGuardando(true); setFallo(null); setHecho(false);
    try {
      const r = await fetch("/api/auth/correo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo, actual }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
      setEstado((prev) => ({ ...prev, correo: j.data.correo, esElIdentificador: false }));
      setHecho(true); setAbierto(false); setCorreo(""); setActual("");
    } catch (e) {
      setFallo(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (!estado) return null;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">El correo de tu cuenta</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        Es a donde se te mandará el enlace si alguna vez pierdes la contraseña, y también te
        sirve para entrar: puedes escribir tu usuario <strong className="text-neutral-500">o</strong> tu
        correo en la pantalla de entrar.
      </p>

      {estado.enDemo ? (
        <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800 max-w-sm">
          En la demo no se puede cambiar: esta cuenta la comparte todo el que entra a mirarla.
        </div>
      ) : (
        <div className="mt-4 max-w-sm">
          {estado.correo ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm text-neutral-800">{estado.correo}</span>
              {estado.esElIdentificador && (
                <span className="text-[11px] text-neutral-400">(el mismo con el que entras)</span>
              )}
              {!abierto && (
                <button onClick={() => { setAbierto(true); setCorreo(estado.correo); setHecho(false); }}
                  className="text-[11px] text-neutral-400 hover:text-neutral-700 underline">
                  cambiar
                </button>
              )}
            </div>
          ) : (
            <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800">
              <strong>Tu cuenta no tiene correo.</strong> Entras con el usuario{" "}
              <span className="font-mono">{estado.usuario}</span>, y eso sigue funcionando — pero si
              pierdes la contraseña no habrá a dónde mandarte nada y hará falta que te la
              restablezca alguien.
              {!abierto && (
                <button onClick={() => { setAbierto(true); setCorreo(""); setHecho(false); }}
                  className="ml-2 font-semibold underline hover:no-underline">
                  Ponerle uno
                </button>
              )}
            </div>
          )}

          {hecho && !abierto && (
            <p className="mt-2 text-xs text-emerald-700">Guardado.</p>
          )}

          {abierto && (
            <div className="mt-3 grid gap-3">
              <label className="block">
                <span className="block text-xs text-neutral-500 mb-1">Tu correo</span>
                <input type="email" autoComplete="email" value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder="nombre@sucentro.com" className={inputCls} />
              </label>
              {/* La contraseña, siempre: es lo que separa «ponerme mi correo» de
                  «quedarme con la cuenta de quien dejó la sesión abierta». */}
              <label className="block">
                <span className="block text-xs text-neutral-500 mb-1">Tu contraseña</span>
                <input type="password" autoComplete="current-password" value={actual}
                  onChange={(e) => setActual(e.target.value)} className={inputCls} />
                <span className="block text-[11px] text-neutral-400 mt-1">
                  Se pide para asegurar que eres tú: el correo también sirve para entrar.
                </span>
              </label>
              {fallo && <p className="text-xs text-red-600">{fallo}</p>}
              <div className="flex gap-2">
                <button onClick={guardar} disabled={!puede}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-40"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>
                  {guardando ? "Guardando…" : "Guardar correo"}
                </button>
                <button onClick={() => { setAbierto(false); setFallo(null); setActual(""); }}
                  disabled={guardando}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800 disabled:opacity-40">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ContrasenaCard() {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [verlas, setVerlas] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [hecho, setHecho] = useState(false);
  /*
   * Los topes y si esto es una demo los DICE EL SERVIDOR, no se escriben aquí.
   *
   * Estaban a mano como valores por defecto de las props y no los pasaba nadie:
   * o sea, dos sitios con el mismo número esperando a separarse. Es el mismo
   * fallo que ya costó una imagen rota hoy mismo con las capturas — la pantalla
   * decidiendo por su cuenta algo que decide el servidor.
   *
   * Mientras no llegan, se pinta con los que hay: la tarjeta no se queda en
   * blanco por una petición lenta, y el botón valida igual al pulsarlo.
   */
  const [reglas, setReglas] = useState({ minimo: MINIMO, maximo: MAXIMO, enDemo: false });
  useEffect(() => {
    let vivo = true;
    fetch("/api/auth/password", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (vivo && j?.ok) setReglas(j.data);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  const { minimo, maximo, enDemo } = reglas;

  /*
   * Lo que se puede decir ANTES de molestar al servidor.
   *
   * El largo se mide en BYTES, igual que lo mide él, y no con el `maxLength` del
   * input — que cuenta caracteres. No es lo mismo: una tilde ocupa dos bytes y
   * un emoji cuatro, así que 72 caracteres de tildes son 144 bytes. Con
   * `maxLength` la pantalla dejaría escribir algo que el servidor rechaza, que
   * es exactamente la clase de desajuste que se paga en un sitio donde el
   * mensaje de error llega después de escribir tres campos.
   */
  const bytes = new TextEncoder().encode(nueva).length;
  // «Corta» ya no es solo el largo: son los TRES requisitos, y salen de la misma
  // función que usa el servidor (lib/auth/contrasena.js), no de un if de aquí.
  const incumple = nueva.length > 0 && !cumpleTodo(nueva);
  const larga = bytes > maximo;
  const noCoinciden = repetir.length > 0 && nueva !== repetir;
  const puede = actual && nueva && repetir && !incumple && !larga && !noCoinciden && !guardando;

  async function guardar() {
    setGuardando(true);
    setFallo(null);
    setHecho(false);
    try {
      const r = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
      setHecho(true);
      setActual("");
      setNueva("");
      setRepetir("");
    } catch (e) {
      setFallo(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Tu contraseña</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        {/* El texto decía «se cierran tus sesiones en los demás dispositivos», y
            eso prometía más de lo que hace: lo que caduca es su token de
            refresco, así que caen la próxima vez que renueven — hasta un cuarto
            de hora después. Decirlo mal importa porque quien cambia la
            contraseña por sospecha necesita saber cuándo queda cerrado. */}
        La eliges tú. Los demás dispositivos donde tengas la sesión abierta se cerrarán en un cuarto
        de hora como mucho, pero <strong className="text-neutral-500">aquí sigues dentro</strong>,
        sin volver a entrar.
      </p>

      {/* En la demo se dice ANTES, no después de escribir tres campos: la cuenta
          la comparten todos los visitantes y cambiarla dejaría fuera al resto. */}
      {enDemo ? (
        <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800 max-w-sm">
          En la demo no se puede cambiar: esta cuenta la comparte todo el que entra a mirarla.
        </div>
      ) : (
      <div className="mt-4 grid gap-3 max-w-sm">
        <label className="block">
          <span className="block text-xs text-neutral-500 mb-1">La de ahora</span>
          <input
            type={verlas ? "text" : "password"}
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-neutral-500 mb-1">La nueva</span>
          <input
            type={verlas ? "text" : "password"}
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            className={inputCls}
          />
          {/* Los requisitos se dicen SIEMPRE, no solo al fallar, y se marcan
              mientras se escribe. Salen de lib/auth/contrasena.js, la misma
              función que rechaza en el servidor: si se añade una regla,
              aparece aquí sola. */}
          {larga ? (
            <span className="block text-[11px] mt-1 text-red-600">
              Demasiado larga: el tope son {maximo} caracteres, algo menos si lleva tildes o emojis.
            </span>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {requisitosDe(nueva).map((r) => (
                <li
                  key={r.id}
                  className={`flex items-center gap-1.5 text-[11px] ${r.cumple ? "text-emerald-600" : "text-neutral-400"}`}
                >
                  <span aria-hidden className="w-3 shrink-0 text-center">{r.cumple ? "✓" : "·"}</span>
                  {r.texto}
                </li>
              ))}
            </ul>
          )}
        </label>

        <label className="block">
          <span className="block text-xs text-neutral-500 mb-1">La nueva otra vez</span>
          <input
            type={verlas ? "text" : "password"}
            autoComplete="new-password"
            maxLength={maximo}
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            className={inputCls}
          />
          {noCoinciden && (
            <span className="block text-[11px] mt-1 text-red-600">Las dos no son iguales.</span>
          )}
        </label>

        <label className="flex items-center gap-2 text-xs text-neutral-500 cursor-pointer">
          <input
            type="checkbox"
            checked={verlas}
            onChange={(e) => setVerlas(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary,#1B3A2D)]"
          />
          Verlas mientras escribo
        </label>
      </div>
      )}

      {fallo && (
        <div className="mt-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 max-w-sm">
          {fallo}
        </div>
      )}
      {hecho && (
        <div className="mt-3 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700 max-w-sm">
          Cambiada. La próxima vez entra con la nueva.
        </div>
      )}

      <div className="mt-4">
        {/* Botón propio y no `PrimaryButton`: ese no acepta `disabled`, y aquí
            hace falta — con los tres campos a medias no se manda nada. Tocarlo
            a él afectaría a sus veinte usos por un caso. */}
        <button
          type="button"
          onClick={guardar}
          disabled={!puede || enDemo}
          className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {guardando ? "Cambiando…" : "Cambiar la contraseña"}
        </button>
      </div>
    </div>
  );
}

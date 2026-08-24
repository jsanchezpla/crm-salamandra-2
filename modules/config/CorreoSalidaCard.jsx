"use client";

/**
 * CorreoSalidaCard — las cuentas de Resend y las direcciones que salen de cada una.
 *
 * ── QUÉ SUSTITUYE ──────────────────────────────────────────────────────────
 * A dos tarjetas que solo admitían UNA cosa: «Resend (correo de captación)»
 * con una clave, y «Remitente del correo» con un from y un reply-to. Con eso,
 * un cliente con dos dominios —o simplemente con `booking@` y `prensa@`— no
 * cabía.
 *
 * ── LA FORMA IMPORTA, Y ES ANIDADA ─────────────────────────────────────────
 * Rodrigo, 25/08/2026: «poder poner una clave y debajo sus cuentas asociadas,
 * otra clave y sus cuentas asociadas… etc.»
 *
 * El primer intento fueron DOS listas sueltas —cuentas por un lado,
 * direcciones por otro con un desplegable para elegir a cuál pertenecían— y
 * eso obliga a mantener la relación en la cabeza. Anidado no hay nada que
 * elegir: la dirección está DENTRO de su clave, y por eso pertenece a ella.
 *
 *   CUENTA    → una clave de Resend. Normalmente, un dominio verificado.
 *   DIRECCIÓN → un correo que sale de esa cuenta. Tantos como haga falta.
 *
 * El día que rote una clave se cambia en un sitio y todas sus direcciones
 * siguen funcionando.
 *
 * ── LA ASIGNACIÓN ES UNA PUERTA, NO UN ADORNO ──────────────────────────────
 * Una dirección sin nadie marcado es «del centro» y solo la usa admin. Con
 * gente marcada, solo esa gente. Se cumple en el servidor
 * (`lib/email/remitentes.js`); esta pantalla solo lo hace visible.
 */

import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const dominioDe = (e) => String(e || "").toLowerCase().split("@")[1] ?? "";

const inputCls =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400";

/** Un id que no depende del orden: quitar la cuenta 2 no renombra la 3. */
let contador = 0;
const nuevoId = () => `cuenta_${Date.now().toString(36)}_${contador++}`;

export default function CorreoSalidaCard({ cuentas = [], remitentes = [], usuarios = [], isAdmin, onGuardar }) {
  // Estado local editable, sembrado de las props. Se resiembra cuando el padre
  // trae una configuración nueva (tras guardar), comparando en el render —el
  // patrón que recomienda React para ajustar estado a props— en vez de con un
  // efecto que dispara un render de más.
  const [semilla, setSemilla] = useState({ cuentas, remitentes });
  const [cta, setCta] = useState(() => sembrar(cuentas, remitentes));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  if (semilla.cuentas !== cuentas || semilla.remitentes !== remitentes) {
    setSemilla({ cuentas, remitentes });
    setCta(sembrar(cuentas, remitentes));
  }

  const editarCuenta = (i, campo, valor) =>
    setCta((v) => v.map((c, j) => (j === i ? { ...c, [campo]: valor } : c)));

  const editarDir = (i, k, campo, valor) =>
    setCta((v) =>
      v.map((c, j) =>
        j === i ? { ...c, direcciones: c.direcciones.map((d, m) => (m === k ? { ...d, [campo]: valor } : d)) } : c
      )
    );

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await onGuardar({
        // Las heredadas no se reenvían: son la clave única de siempre, que se
        // sigue guardando por su campo de toda la vida.
        cuentasResend: cta
          .filter((c) => !c.heredada && c.nombre?.trim())
          .map((c) => ({ id: c.id, nombre: c.nombre, dominio: c.dominio, apiKey: c.apiKey || "" })),
        remitentes: cta.flatMap((c) =>
          c.direcciones
            .filter((d) => EMAIL_RE.test(String(d.email ?? "").trim()))
            .map((d) => ({
              email: d.email.trim(),
              nombre: d.nombre || "",
              replyTo: d.replyTo || "",
              cuentaId: c.id,
              usuarios: d.usuarios ?? [],
            }))
        ),
      });
    } catch (e) {
      setError(e.message || "No se ha podido guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
      <h3 className="font-display text-lg text-[var(--ink-900)]">Correo de salida</h3>
      <p className="text-xs text-neutral-500 mt-1">
        Cada <strong>clave de Resend</strong> es una cuenta —normalmente, un dominio verificado— y debajo
        van las direcciones que salen de ella. Puedes tener varias cuentas, y dentro de cada una tantas
        direcciones como quieras.
      </p>

      {!cta.length && (
        <p className="text-xs text-neutral-400 mt-4">Todavía no hay ninguna cuenta configurada.</p>
      )}

      <div className="mt-4 space-y-4">
        {cta.map((c, i) => (
          <fieldset key={c.id} className="rounded-xl border border-neutral-200 overflow-hidden">
            {/* ── La clave ─────────────────────────────────────────────── */}
            <legend className="sr-only">{c.nombre || "Cuenta sin nombre"}</legend>
            <div className="bg-neutral-50 p-3 border-b border-neutral-200">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.3fr_auto] sm:items-end">
                <label className="block">
                  <span className="block text-[11px] font-medium text-neutral-500 mb-1">Cuenta</span>
                  <input
                    disabled={!isAdmin || c.heredada}
                    className={inputCls}
                    placeholder="Laura Úbeda"
                    value={c.nombre ?? ""}
                    onChange={(e) => editarCuenta(i, "nombre", e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-neutral-500 mb-1">Dominio verificado</span>
                  <input
                    disabled={!isAdmin || c.heredada}
                    className={inputCls}
                    placeholder="lauraubeda.es"
                    value={c.dominio ?? ""}
                    onChange={(e) => editarCuenta(i, "dominio", e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-medium text-neutral-500 mb-1">
                    Clave de Resend{" "}
                    {c.tieneClave && <span className="text-emerald-700 font-semibold">· ya guardada</span>}
                  </span>
                  <input
                    disabled={!isAdmin || c.heredada}
                    type="password"
                    autoComplete="off"
                    className={inputCls}
                    placeholder={c.tieneClave ? "•••••  (vacío = no la cambies)" : "re_..."}
                    value={c.apiKey ?? ""}
                    onChange={(e) => editarCuenta(i, "apiKey", e.target.value)}
                  />
                </label>
                {isAdmin && !c.heredada && (
                  <button
                    type="button"
                    onClick={() => setCta((v) => v.filter((_, j) => j !== i))}
                    className="text-xs text-neutral-400 hover:text-red-600 pb-2 whitespace-nowrap"
                  >
                    Quitar cuenta
                  </button>
                )}
              </div>
              {c.heredada && (
                <p className="text-[11px] text-neutral-500 mt-2">
                  Es la clave que ya tenías puesta. Sigue usándose para los avisos automáticos; si quieres
                  gestionarla aquí, créala como cuenta nueva.
                </p>
              )}
            </div>

            {/* ── Sus direcciones ──────────────────────────────────────── */}
            <div className="p-3 space-y-3">
              {!c.direcciones.length && (
                <p className="text-xs text-neutral-400">Esta cuenta no tiene ninguna dirección todavía.</p>
              )}

              {c.direcciones.map((d, k) => {
                const desajuste =
                  c.dominio && EMAIL_RE.test(d.email ?? "") && dominioDe(d.email) !== String(c.dominio).toLowerCase();
                return (
                  <div key={k} className="rounded-lg border border-neutral-100 bg-white p-3 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-end">
                      <label className="block">
                        <span className="block text-[11px] font-medium text-neutral-500 mb-1">Dirección</span>
                        <input
                          disabled={!isAdmin}
                          className={inputCls}
                          placeholder={c.dominio ? `booking@${c.dominio}` : "booking@tudominio.com"}
                          value={d.email ?? ""}
                          onChange={(e) => editarDir(i, k, "email", e.target.value)}
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[11px] font-medium text-neutral-500 mb-1">Nombre visible</span>
                        <input
                          disabled={!isAdmin}
                          className={inputCls}
                          placeholder="Laura Úbeda · Booking"
                          value={d.nombre ?? ""}
                          onChange={(e) => editarDir(i, k, "nombre", e.target.value)}
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[11px] font-medium text-neutral-500 mb-1">Responder a</span>
                        <input
                          disabled={!isAdmin}
                          className={inputCls}
                          placeholder="(opcional)"
                          value={d.replyTo ?? ""}
                          onChange={(e) => editarDir(i, k, "replyTo", e.target.value)}
                        />
                      </label>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() =>
                            setCta((v) =>
                              v.map((x, j) =>
                                j === i ? { ...x, direcciones: x.direcciones.filter((_, m) => m !== k) } : x
                              )
                            )
                          }
                          className="text-xs text-neutral-400 hover:text-red-600 pb-2"
                        >
                          Quitar
                        </button>
                      )}
                    </div>

                    <div>
                      <span className="block text-[11px] font-medium text-neutral-500 mb-1">Quién puede usarla</span>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {usuarios.map((u) => (
                          <label key={u.id} className="flex items-center gap-1.5 text-xs text-neutral-700">
                            <input
                              type="checkbox"
                              disabled={!isAdmin}
                              checked={(d.usuarios ?? []).includes(u.id)}
                              onChange={(e) =>
                                editarDir(
                                  i,
                                  k,
                                  "usuarios",
                                  e.target.checked
                                    ? [...new Set([...(d.usuarios ?? []), u.id])]
                                    : (d.usuarios ?? []).filter((id) => id !== u.id)
                                )
                              }
                            />
                            {u.email}
                          </label>
                        ))}
                        {!usuarios.length && <span className="text-xs text-neutral-400">Sin usuarios todavía.</span>}
                      </div>
                      <p className="text-[11px] text-neutral-400 mt-1">
                        {(d.usuarios ?? []).length === 0
                          ? "Sin nadie marcado: solo la usa administración."
                          : "Solo estas personas podrán escribir desde aquí."}
                      </p>
                    </div>

                    {desajuste && (
                      <p className="text-[11px] text-amber-700">
                        Esta dirección es de <strong>{dominioDe(d.email)}</strong> y la cuenta tiene verificado{" "}
                        <strong>{c.dominio}</strong>. Resend lo rechazará con un 403 que no explica nada.
                      </p>
                    )}
                  </div>
                );
              })}

              {isAdmin && (
                <button
                  type="button"
                  onClick={() =>
                    setCta((v) =>
                      v.map((x, j) =>
                        j === i
                          ? { ...x, direcciones: [...x.direcciones, { email: "", nombre: "", replyTo: "", usuarios: [] }] }
                          : x
                      )
                    )
                  }
                  className="text-xs underline text-neutral-500 hover:text-neutral-800"
                >
                  + Añadir dirección a esta cuenta
                </button>
              )}
            </div>
          </fieldset>
        ))}
      </div>

      {isAdmin && (
        <button
          type="button"
          onClick={() =>
            setCta((v) => [
              ...v,
              { id: nuevoId(), nombre: "", dominio: "", apiKey: "", tieneClave: false, heredada: false, direcciones: [] },
            ])
          }
          className="mt-4 text-xs underline text-neutral-500 hover:text-neutral-800"
        >
          + Añadir otra cuenta
        </button>
      )}

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

      {isAdmin && (
        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="px-4 py-2 rounded-lg bg-[var(--ink-900)] text-white text-sm font-semibold disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Guardar correo de salida"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Junta las dos listas planas que devuelve el servidor en el árbol que se pinta.
 *
 * Una dirección cuya cuenta ya no existe NO se tira: se cuelga de la primera,
 * porque perder una dirección configurada en silencio es peor que enseñarla en
 * el sitio equivocado, donde además se ve y se arregla.
 */
function sembrar(cuentas, remitentes) {
  const arbol = cuentas.map((c) => ({ ...c, apiKey: "", direcciones: [] }));
  if (!arbol.length) return arbol;
  const porId = new Map(arbol.map((c) => [c.id, c]));
  for (const r of remitentes) {
    const destino = porId.get(r.cuentaId) ?? arbol[0];
    destino.direcciones.push({
      email: r.email ?? "",
      nombre: r.nombre ?? "",
      replyTo: r.replyTo ?? "",
      usuarios: r.usuarios ?? [],
    });
  }
  return arbol;
}

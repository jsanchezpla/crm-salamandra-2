"use client";

/**
 * Custodia de configuraciones — la vista de todos los clientes a la vez.
 *
 * UNA TARJETA POR CLIENTE (06/08/2026, propuesta de Rodrigo). Antes era una
 * matriz de puntos de color —clientes en filas, credenciales en columnas— que
 * respondía bien a «¿qué falta en todos?» pero exigía contar posiciones para
 * saber QUÉ falta: los rótulos iban girados 90° y el estado era un punto.
 *
 * Ahora cada cliente dice sus servicios con palabras y lleva su acción al lado,
 * que es como se trabaja de verdad: se mira un cliente y se le pide lo que le
 * falta. Lo que se pierde es la comparación de un vistazo entre todos; si vuelve
 * a hacer falta, el sitio es un resumen arriba, no volver a la matriz.
 *
 * Lo que NO hace, y es lo importante: no enseña ni un carácter de ninguna
 * credencial. El endpoint no las descifra (ver app/api/admin/configuraciones),
 * así que aquí no hay nada que ocultar en el cliente.
 *
 * ── DESDE EL 13/08/2026 TAMBIÉN SE PONEN ────────────────────────────────────
 * Esta pantalla decía qué le faltaba a cada cliente —hasta con la frase «Ya
 * tiene todas las claves puestas. No hay nada que pedirle»— y no podía ponerlas:
 * la única forma era que entrara el cliente, en su Configuración. Y no entran.
 *
 * Los campos son de SOLO ESCRIBIR: se pega, se manda, y lo que vuelve es «puesta»
 * o «cambiada», nunca el valor. Que no se pueda LEER lo que ya está puesto no es
 * una limitación de la pantalla: es la regla del endpoint, y se mantiene entera.
 * Por eso no hay ningún campo que venga relleno ni enmascarado.
 */

import { useEffect, useMemo, useState } from "react";
import { anchoPanel } from "@/components/admin/anchoPanel.js";

const GRUPOS = ["Cobros", "Correo", "IA", "Otros"];

/** Estado de una credencial, en un punto. */
function Pip({ puesta, cifrada, titulo }) {
  const base = "inline-block rounded-full transition-all duration-200";
  if (!puesta) {
    return (
      <span
        title={`${titulo} — sin configurar`}
        className={`${base} w-[9px] h-[9px] border`}
        style={{ borderColor: "var(--apagado)", background: "transparent" }}
      />
    );
  }
  if (cifrada === false) {
    // El único caso que grita. Un secreto legible en la base de datos.
    return (
      <span
        title={`${titulo} — PUESTA PERO SIN CIFRAR`}
        className={`${base} w-[9px] h-[9px] ring-2 ring-offset-2`}
        style={{
          background: "var(--alerta)",
          "--tw-ring-color": "color-mix(in srgb, var(--alerta) 35%, transparent)",
          "--tw-ring-offset-color": "var(--panel)",
        }}
      />
    );
  }
  return (
    <span
      title={`${titulo} — configurada y cifrada`}
      className={`${base} w-[9px] h-[9px]`}
      style={{ background: "var(--ok)" }}
    />
  );
}

/**
 * Nombre corto para la cabecera de columna.
 *
 * Los nombres largos («Stripe — clave secreta», «Transcripción (OpenAI)») venían
 * girados 90° para caber en columnas de 34 px, y girado no se lee: había que
 * ladear la cabeza o ir pasando el ratón uno por uno. Se prefiere acortar el
 * texto y ensanchar la columna — el nombre completo sigue estando en el `title`
 * y en el detalle que se abre al pulsar la fila.
 *
 * La regla sale de cómo están escritos hoy en el endpoint: lo que va entre
 * paréntesis es la marca («Correo (Resend)» → Resend), y lo que va tras la raya
 * distingue dos credenciales de la misma marca («Stripe — webhook»).
 */
function etiquetaCorta(nombre) {
  const enParentesis = nombre.match(/\(([^)]+)\)/);
  if (enParentesis) return enParentesis[1];

  const partes = nombre.split("—").map((p) => p.trim());
  if (partes.length > 1) {
    // «Stripe — clave secreta» → «Stripe clave»: la marca y la primera palabra
    // que la distingue de su hermana.
    return `${partes[0]} ${partes[1].split(" ")[0]}`;
  }
  return nombre;
}

function tamaño(bytes) {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

function fecha(iso) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

/** Distintivo de un tipo de personalización, con si el código lo lee o no. */
function Marca({ tipo, meta }) {
  const lee = meta?.lee;
  const color = lee === true ? "var(--ok)" : lee === false ? "var(--tenue)" : "var(--alerta)";
  return (
    <span
      title={meta?.nota ?? ""}
      className="text-[10px] px-1.5 py-0.5 rounded"
      style={{
        color,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        textDecoration: lee === false ? "line-through" : "none",
      }}
    >
      {tipo}
    </span>
  );
}

function Etiqueta({ children, tono = "dim" }) {
  const color = tono === "alerta" ? "var(--alerta)" : tono === "ok" ? "var(--ok)" : "var(--tenue)";
  return (
    <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color }}>
      {children}
    </span>
  );
}

export default function CustodiaPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [abierto, setAbierto] = useState(null);
  // Cliente al que se le va a pedir la configuración. El envío del correo NO
  // está hecho a propósito (06/08/2026): escribir a un cliente pidiéndole
  // credenciales necesita el texto aprobado antes de existir, así que de momento
  // el botón enseña lo que se le pediría y nada sale de aquí.
  const [pidiendo, setPidiendo] = useState(null);

  // Lo que se está tecleando AHORA en los campos de credencial, por clave. Vive
  // aquí y no en el cliente abierto porque se vacía entero al guardar: un campo
  // que conserva lo pegado da la impresión de que el valor «está», y aquí
  // precisamente no se puede leer nada de lo guardado.
  const [pegando, setPegando] = useState({});
  const [contacto, setContacto] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  async function recargar() {
    const r = await fetch("/api/admin/configuraciones", { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
    setDatos(j.data);
    return j.data;
  }

  useEffect(() => {
    recargar().catch((e) => setError(e.message));
  }, []);

  /** Abre/cierra la ficha de un cliente, y con ella su formulario en limpio. */
  function abrir(cliente) {
    const cerrando = abierto === cliente.slug;
    setAbierto(cerrando ? null : cliente.slug);
    setPegando({});
    setResultado(null);
    setContacto(cerrando ? null : { ...cliente.contacto });
  }

  /**
   * Manda lo que haya escrito. `claves` va con lo pegado; `contacto` solo si ha
   * cambiado, para no reescribirlo cada vez que se guarda una clave.
   */
  async function guardar(cliente) {
    const claves = {};
    for (const [k, v] of Object.entries(pegando)) {
      if (typeof v === "string" && v.trim()) claves[k] = v.trim();
      else if (v === null) claves[k] = null; // marcada para borrar
    }
    const cambiaContacto =
      contacto && JSON.stringify(contacto) !== JSON.stringify(cliente.contacto);

    if (!Object.keys(claves).length && !cambiaContacto) {
      setResultado({ error: "No has escrito nada." });
      return;
    }

    setGuardando(true);
    setResultado(null);
    try {
      const r = await fetch("/api/admin/configuraciones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: cliente.slug,
          ...(Object.keys(claves).length ? { claves } : {}),
          ...(cambiaContacto ? { contacto } : {}),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setResultado({ error: j?.error || `Error ${r.status}` });
        return;
      }
      setPegando({});
      setResultado({ aplicado: j.data.aplicado, avisos: j.data.avisos ?? [] });
      const frescos = await recargar();
      const actualizado = frescos.clientes.find((c) => c.slug === cliente.slug);
      if (actualizado) setContacto({ ...actualizado.contacto });
    } catch (e) {
      setResultado({ error: e.message });
    } finally {
      setGuardando(false);
    }
  }

  const clientes = datos?.clientes ?? [];
  const enClaroTotal = useMemo(
    () => clientes.reduce((n, c) => n + (c.enClaro ?? 0), 0),
    [clientes]
  );
  const detalle = clientes.find((c) => c.slug === abierto) ?? null;

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div style={{ fontFamily: "var(--admin-display)" }} className="text-3xl mb-3">
            No se puede mostrar
          </div>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--dim)" }}>
            {error}
          </p>
          <p className="text-[12px] mt-4" style={{ color: "var(--tenue)" }}>
            Este panel es solo para el tenant de Salamandra Solutions, con rol de administrador.
          </p>
        </div>
      </main>
    );
  }

  if (!datos) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <span className="text-[12px] tracking-[0.2em] uppercase animate-pulse" style={{ color: "var(--tenue)" }}>
          Leyendo configuraciones
        </span>
      </main>
    );
  }

  return (
    <main className={anchoPanel()}>
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <header className="mb-10 lg:mb-14">
        <Etiqueta>Salamandra · panel interno</Etiqueta>
        <h1
          className="mt-2 text-[42px] lg:text-[58px] leading-[0.95] tracking-tight"
          style={{ fontFamily: "var(--admin-display)" }}
        >
          Custodia de
          <br />
          <span style={{ fontStyle: "italic", color: "var(--ok)" }}>configuraciones</span>
        </h1>

        <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="text-[34px] leading-none tabular-nums">{clientes.length}</div>
            <Etiqueta>clientes</Etiqueta>
          </div>
          <div>
            <div
              className="text-[34px] leading-none tabular-nums"
              style={{ color: enClaroTotal > 0 ? "var(--alerta)" : "var(--ok)" }}
            >
              {enClaroTotal}
            </div>
            <Etiqueta tono={enClaroTotal > 0 ? "alerta" : "ok"}>secretos sin cifrar</Etiqueta>
          </div>
          <p className="text-[12px] leading-relaxed max-w-sm ml-auto" style={{ color: "var(--dim)" }}>
            {datos.politica?.nota}
          </p>
        </div>
      </header>

      {/* ── Matriz ───────────────────────────────────────────────────────── */}
      <section
        className="rounded-lg overflow-hidden"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        {/* Sin cabecera de columnas: ya no hay columnas. Cada tarjeta dice sus
            servicios con palabras, que era el objetivo del cambio. */}
        <div className="px-5 pt-5 pb-1">
          <Etiqueta>{clientes.length === 1 ? "1 cliente" : `${clientes.length} clientes`}</Etiqueta>
        </div>

        {clientes.map((c, i) => {
          const activo = abierto === c.slug;
          const puestas = c.credenciales.filter((cr) => cr.puesta);
          const faltan = c.credenciales.filter((cr) => !cr.puesta);
          const sinCifrar = puestas.filter((cr) => cr.cifrada === false);

          return (
            <div
              key={c.slug}
              className="px-5 py-4 transition-colors"
              style={{
                borderTop: "1px solid var(--line-suave)",
                background: activo ? "var(--panel-alto)" : "transparent",
                animation: `aparecer 420ms ease-out both`,
                animationDelay: `${i * 45}ms`,
              }}
            >
              <div className="flex items-start gap-4">
                {/* Izquierda: nombre arriba, servicios abajo separados por guiones */}
                <button onClick={() => abrir(c)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="text-[15px] font-semibold">{c.nombre}</span>
                    <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
                      {c.slug} · {c.modulos.length} módulos
                      {c.bd?.existe ? ` · ${tamaño(c.bd.bytes)}` : " · sin base de datos"}
                    </span>
                    {c.estado !== "active" && (
                      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--alerta)" }}>
                        {c.estado}
                      </span>
                    )}
                  </div>

                  {/* Los servicios CON clave, en palabras. Antes eran ocho puntos
                      de color en columnas: para saber cuál era cuál había que
                      contar posiciones o ir pasando el ratón. */}
                  <div className="mt-1.5 text-[12px] leading-relaxed">
                    {puestas.length === 0 ? (
                      <span style={{ color: "var(--alerta)" }}>Sin ninguna clave configurada</span>
                    ) : (
                      <span style={{ color: "var(--dim)" }}>
                        {puestas.map((cr, n) => (
                          <span key={cr.clave}>
                            {n > 0 && <span style={{ color: "var(--apagado)" }}> — </span>}
                            <span
                              title={cr.cifrada === false ? `${cr.nombre}: PUESTA SIN CIFRAR` : cr.nombre}
                              style={{
                                color: cr.cifrada === false ? "var(--alerta)" : "var(--ok)",
                                fontWeight: cr.cifrada === false ? 600 : 400,
                              }}
                            >
                              {etiquetaCorta(cr.nombre)}
                              {cr.cifrada === false && " ⚠"}
                            </span>
                          </span>
                        ))}
                      </span>
                    )}
                  </div>

                  {faltan.length > 0 && (
                    <div className="mt-1 text-[11px]" style={{ color: "var(--tenue)" }}>
                      Le faltan: {faltan.map((cr) => etiquetaCorta(cr.nombre)).join(" — ")}
                    </div>
                  )}
                </button>

                {/* Derecha: las dos acciones. Poner las claves es lo que abre la
                    ficha; pedírselas al cliente sigue sin mandar nada. */}
                <div className="shrink-0 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => abrir(c)}
                    className="px-3.5 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-colors"
                    style={{ border: "1px solid var(--ok)", color: "var(--ok)" }}
                  >
                    {activo ? "Cerrar" : "Poner claves"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPidiendo(c)}
                    className="px-3.5 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-colors"
                    style={{ border: "1px solid var(--line)", color: "var(--dim)" }}
                  >
                    Pedírselas
                  </button>
                </div>
              </div>

              {sinCifrar.length > 0 && (
                <div
                  className="mt-2.5 text-[11px] rounded px-2.5 py-1.5"
                  style={{ color: "var(--alerta)", background: "color-mix(in srgb, var(--alerta) 8%, transparent)" }}
                >
                  {sinCifrar.length === 1 ? "Un secreto legible" : `${sinCifrar.length} secretos legibles`} en la base
                  de datos: {sinCifrar.map((cr) => etiquetaCorta(cr.nombre)).join(", ")}.
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ── Leyenda ──────────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 text-[11px]" style={{ color: "var(--dim)" }}>
        <span className="flex items-center gap-2">
          <Pip puesta cifrada titulo="" /> configurada y cifrada
        </span>
        <span className="flex items-center gap-2">
          <Pip puesta cifrada={false} titulo="" /> puesta pero SIN cifrar
        </span>
        <span className="flex items-center gap-2">
          <Pip puesta={false} titulo="" /> sin configurar
        </span>
      </div>

      {/* ── Solicitar configuración: enseña QUÉ se pediría, sin mandar nada ─ */}
      {pidiendo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(15,23,42,0.55)" }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl p-6 space-y-4 text-neutral-800">
            <div>
              <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
                Pedir configuración a
              </div>
              <h2 className="text-xl font-semibold mt-1">{pidiendo.nombre}</h2>
            </div>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
              <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                A quién
              </div>
              {pidiendo.contacto?.email ? (
                <p className="text-sm text-neutral-700">
                  {pidiendo.contacto.email}
                  {pidiendo.contacto.nombre ? ` · ${pidiendo.contacto.nombre}` : ""}
                </p>
              ) : (
                <p className="text-sm text-amber-700">
                  No hay correo de contacto apuntado. Se pone en su ficha, abajo del todo.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
              <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                Se le pediría
              </div>
              {pidiendo.credenciales.filter((c) => !c.puesta).length === 0 ? (
                <p className="text-sm text-neutral-600">
                  Ya tiene todas las claves puestas. No hay nada que pedirle.
                </p>
              ) : (
                <ul className="text-sm text-neutral-700 space-y-0.5">
                  {pidiendo.credenciales.filter((c) => !c.puesta).map((c) => (
                    <li key={c.clave}>· {c.nombre}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900 leading-relaxed">
              <b>Todavía no se envía nada.</b> Falta el texto aprobado: pedirle credenciales a un
              cliente es de lo más delicado que se le escribe. Mientras tanto, si te la da por otro
              lado, se la puedes poner tú desde su ficha.
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPidiendo(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide text-neutral-600 hover:bg-neutral-100"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detalle del cliente ──────────────────────────────────────────── */}
      {detalle && (
        <section
          className="mt-8 rounded-lg p-6"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <div className="flex items-baseline justify-between gap-4 mb-5">
            <h2 className="text-[26px] leading-none" style={{ fontFamily: "var(--admin-display)" }}>
              {detalle.nombre}
            </h2>
            <button
              onClick={() => abrir(detalle)}
              className="text-[11px] uppercase tracking-[0.16em]"
              style={{ color: "var(--tenue)" }}
            >
              cerrar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
            <div>
              <Etiqueta>credenciales</Etiqueta>
              <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: "var(--dim)" }}>
                Pega una clave y guarda. No se puede ver lo que ya está puesto —ni aquí ni en
                ninguna pantalla—; volver a pegar una la sustituye.
              </p>
              <div className="mt-3 space-y-3">
                {GRUPOS.map((g) => {
                  const del = detalle.credenciales.filter((c) => c.grupo === g);
                  if (!del.length) return null;
                  return (
                    <div key={g}>
                      <div className="text-[10px] mb-1" style={{ color: "var(--tenue)" }}>{g}</div>
                      {del.map((c) => {
                        const marcadaParaBorrar = pegando[c.clave] === null;
                        return (
                          <div key={c.clave} className="py-1">
                            <div className="flex items-center gap-2.5 text-[12px]">
                              <Pip puesta={c.puesta} cifrada={c.cifrada} titulo={c.nombre} />
                              <span style={{ color: c.puesta ? "var(--text)" : "var(--tenue)" }}>
                                {c.nombre}
                              </span>
                              {c.puesta && c.cifrada === false && (
                                <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--alerta)" }}>
                                  sin cifrar
                                </span>
                              )}
                              {c.puesta && !marcadaParaBorrar && (
                                <button
                                  type="button"
                                  onClick={() => setPegando((p) => ({ ...p, [c.clave]: null }))}
                                  className="ml-auto text-[10px] uppercase tracking-wider"
                                  style={{ color: "var(--tenue)" }}
                                  title="Marcar para borrar al guardar"
                                >
                                  quitar
                                </button>
                              )}
                            </div>
                            {marcadaParaBorrar ? (
                              <div
                                className="mt-1 ml-[19px] text-[11px] flex items-center gap-3 rounded px-2 py-1"
                                style={{ color: "var(--alerta)", background: "color-mix(in srgb, var(--alerta) 8%, transparent)" }}
                              >
                                Se borrará al guardar.
                                <button
                                  type="button"
                                  onClick={() => setPegando((p) => { const n = { ...p }; delete n[c.clave]; return n; })}
                                  className="uppercase tracking-wider text-[10px]"
                                  style={{ color: "var(--dim)" }}
                                >
                                  deshacer
                                </button>
                              </div>
                            ) : (
                              <input
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                value={pegando[c.clave] ?? ""}
                                onChange={(e) => setPegando((p) => ({ ...p, [c.clave]: e.target.value }))}
                                placeholder={c.puesta ? "pegar otra para sustituirla" : `pegar aquí — ${c.donde ?? ""}`}
                                className="mt-1 ml-[19px] w-[calc(100%-19px)] rounded px-2 py-1.5 text-[12px] font-mono"
                                style={{
                                  background: "var(--panel-alto)",
                                  border: "1px solid var(--line)",
                                  color: "var(--text)",
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <Etiqueta>la cuenta</Etiqueta>
                <dl className="mt-3 text-[12px] space-y-1.5">
                  {[
                    // Sin el plan desde el 12/08/2026: no gateaba nada y lo que
                    // cada cliente tenía escrito venía de cómo se sembró.
                    ["Estado", detalle.estado],
                    ["Alta", fecha(detalle.alta)],
                    ["Último acceso", fecha(detalle.ultimoAcceso)],
                    ["Usuarios", `${detalle.usuarios.total} (${detalle.usuarios.admins} admin)`],
                    ["Base de datos", detalle.bd.existe ? `${detalle.bd.tablas} tablas · ${tamaño(detalle.bd.bytes)}` : "SIN SCHEMA"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-3">
                      <dt className="w-40 shrink-0" style={{ color: "var(--tenue)" }}>{k}</dt>
                      <dd className="truncate" style={{ color: v === "SIN SCHEMA" ? "var(--alerta)" : undefined }}>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <Etiqueta>ajustes</Etiqueta>
                <dl className="mt-3 text-[12px] space-y-1.5">
                  {[
                    ["Remitente correo", detalle.ajustes.remitenteCorreo ?? "—"],
                    ["Modelo de IA", detalle.ajustes.modeloIA ?? "por defecto"],
                    ["Acceso del equipo a IA", detalle.ajustes.accesoIA],
                    ["Videollamada", detalle.ajustes.modoVideollamada],
                    ["Recordatorio de citas", detalle.ajustes.recordatorios ? "activado" : "desactivado"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-3">
                      <dt className="w-40 shrink-0" style={{ color: "var(--tenue)" }}>{k}</dt>
                      <dd className="truncate">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Lo que de verdad usa: sin esto, "tiene 12 módulos" no dice nada. */}
              {detalle.uso?.length > 0 && (
                <div>
                  <Etiqueta>cuánto lo usa</Etiqueta>
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
                    {detalle.uso.map((u) => (
                      <div key={u.etiqueta} className="flex justify-between gap-3">
                        <span style={{ color: "var(--tenue)" }}>{u.etiqueta}</span>
                        <span className="tabular-nums" style={{ color: u.filas > 0 ? "var(--text)" : "var(--apagado)" }}>
                          {u.filas > 0 ? u.filas.toLocaleString("es-ES") : "0"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: "var(--apagado)" }}>
                    Cifras estimadas por PostgreSQL, no un recuento exacto.
                  </p>
                </div>
              )}

              {/* ── A quién se le escribe ────────────────────────────────────
                  El `adminEmail` del alta NO es esto: es el usuario con el que
                  entra, y si se deja vacío se inventa `admin_{slug}`. Hasta hoy
                  no había dónde apuntar a quién se le pide una clave. */}
              <div>
                <Etiqueta>a quién se le escribe</Etiqueta>
                <div className="mt-2.5 space-y-1.5">
                  {[
                    ["email", "Correo", "alguien@sucliente.com"],
                    ["nombre", "Persona", "nombre y apellidos"],
                    ["telefono", "Teléfono", "opcional"],
                  ].map(([campo, rotulo, ejemplo]) => (
                    <div key={campo} className="flex items-center gap-3">
                      <label className="w-40 shrink-0 text-[12px]" style={{ color: "var(--tenue)" }}>
                        {rotulo}
                      </label>
                      <input
                        type={campo === "email" ? "email" : "text"}
                        value={contacto?.[campo] ?? ""}
                        onChange={(e) => setContacto((c) => ({ ...(c ?? {}), [campo]: e.target.value }))}
                        placeholder={ejemplo}
                        className="flex-1 min-w-0 rounded px-2 py-1.5 text-[12px]"
                        style={{ background: "var(--panel-alto)", border: "1px solid var(--line)", color: "var(--text)" }}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "var(--apagado)" }}>
                  No es el usuario con el que entra al CRM. Es la dirección a la que se le pide
                  algo.
                </p>
              </div>
            </div>
          </div>

          {/* ── Guardar ──────────────────────────────────────────────────── */}
          <div
            className="mt-6 pt-5 flex flex-wrap items-center gap-4"
            style={{ borderTop: "1px solid var(--line-suave)" }}
          >
            <button
              type="button"
              onClick={() => guardar(detalle)}
              disabled={guardando}
              className="px-4 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wide disabled:opacity-50"
              style={{ background: "var(--ok)", color: "var(--panel)" }}
            >
              {guardando ? "Guardando…" : "Guardar en este cliente"}
            </button>

            {resultado?.error && (
              <span className="text-[12px]" style={{ color: "var(--alerta)" }}>
                {resultado.error}
              </span>
            )}

            {resultado?.aplicado && (
              <div className="text-[12px] flex-1 min-w-0">
                {Object.keys(resultado.aplicado).length === 0 ? (
                  <span style={{ color: "var(--tenue)" }}>No había nada que cambiar.</span>
                ) : (
                  <span style={{ color: "var(--ok)" }}>
                    {Object.entries(resultado.aplicado)
                      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : "guardado"}`)
                      .join(" · ")}
                  </span>
                )}
                {resultado.avisos?.map((a) => (
                  <div key={a} className="mt-1" style={{ color: "var(--alerta)" }}>
                    {a}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Módulos y personalización del cliente abierto ─────────────────── */}
      {detalle && (
        <section
          className="mt-4 rounded-lg p-6"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <div className="flex items-baseline gap-4 mb-4">
            <Etiqueta>módulos y personalización</Etiqueta>
            <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
              {detalle.modulos.length} activos · {detalle.personalizados} con algo propio
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            {detalle.modulosDetalle.map((m) => {
              const p = m.personalizacion;
              const algo = p.ui || p.logica || p.flags || p.camposExtra;
              return (
                <div
                  key={m.clave}
                  className="flex items-start gap-2.5 py-1.5"
                  style={{ borderTop: "1px solid var(--line-suave)" }}
                >
                  <span
                    className="inline-block w-[7px] h-[7px] rounded-full mt-[6px] shrink-0"
                    style={{ background: m.activo ? "var(--ok)" : "var(--apagado)" }}
                    title={m.activo ? "activo" : "desactivado (sus datos siguen ahí)"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[12px]" style={{ color: m.activo ? "var(--text)" : "var(--tenue)" }}>
                        {m.clave}
                      </span>
                      {p.flags && <Marca tipo="flags" meta={datos.loLeeElCodigo?.featureFlags} />}
                      {p.logica && <Marca tipo="lógica" meta={datos.loLeeElCodigo?.logicOverrides} />}
                      {p.ui && <Marca tipo="ui" meta={datos.loLeeElCodigo?.uiOverride} />}
                      {p.camposExtra && <Marca tipo={`+${p.camposExtra.length} campos`} meta={datos.loLeeElCodigo?.schemaExtensions} />}
                    </div>
                    {algo && (
                      <div className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--apagado)" }}>
                        {p.flags && <span>{JSON.stringify(p.flags)} </span>}
                        {p.logica && <span>{JSON.stringify(p.logica)} </span>}
                        {p.ui && <span>ui: {p.ui} </span>}
                        {p.camposExtra && <span>campos: {p.camposExtra.join(", ")}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* La parte incómoda, y la razón de que este bloque exista. */}
          <p className="text-[11px] mt-5 leading-relaxed max-w-2xl" style={{ color: "var(--dim)" }}>
            Los distintivos <span style={{ color: "var(--tenue)", textDecoration: "line-through" }}>tachados</span> son
            personalización que está guardada en la base de datos pero que{" "}
            <b>ningún código lee</b>: la pantalla propia de un cliente se elige con un <code>if</code> por slug dentro
            de cada página, y sus campos extra están escritos a mano dentro del componente. Pasa el ratón por cada uno
            para ver el detalle.
          </p>
        </section>
      )}

      <p className="mt-10 text-[11px] leading-relaxed max-w-lg" style={{ color: "var(--tenue)" }}>
        Las credenciales se pueden PONER desde aquí, nunca leer: ni esta pantalla ni el
        endpoint descifran ninguna. El cliente puede seguir poniéndolas él desde su propia
        Configuración, y cualquiera de los dos caminos le manda el recibo por correo con el
        detalle de qué se tocó y de quién lo hizo.
      </p>

      <style>{`
        @keyframes aparecer {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </main>
  );
}

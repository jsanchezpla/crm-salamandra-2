"use client";

/**
 * Custodia de configuraciones — la vista de todos los clientes a la vez.
 *
 * Es una MATRIZ, no una lista de tarjetas: clientes en filas, credenciales en
 * columnas. El objetivo de la pantalla es responder de un vistazo a "¿qué falta
 * y qué está mal?" en los nueve clientes, no navegar cliente a cliente.
 *
 * Lo que NO hace, y es lo importante: no enseña ni un carácter de ninguna
 * credencial. El endpoint no las descifra (ver app/api/admin/configuraciones),
 * así que aquí no hay nada que ocultar en el cliente.
 */

import { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    fetch("/api/admin/configuraciones", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
        return j.data;
      })
      .then(setDatos)
      .catch((e) => setError(e.message));
  }, []);

  const clientes = datos?.clientes ?? [];
  const columnas = clientes[0]?.credenciales ?? [];
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
    <main className="min-h-screen px-6 lg:px-12 py-10 lg:py-14 max-w-[1180px] mx-auto">
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
        {/* Cabecera de columnas */}
        <div
          className="hidden lg:grid items-end gap-px px-5 pt-5 pb-3"
          style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${columnas.length}, 34px) 78px` }}
        >
          <Etiqueta>cliente</Etiqueta>
          {columnas.map((c) => (
            <div key={c.clave} className="flex justify-center">
              <span
                className="text-[10px] whitespace-nowrap"
                style={{
                  color: "var(--tenue)",
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  letterSpacing: "0.08em",
                }}
                title={c.nombre}
              >
                {c.nombre.replace(/^.*— /, "")}
              </span>
            </div>
          ))}
          <div className="text-right">
            <Etiqueta>módulos</Etiqueta>
          </div>
        </div>

        {clientes.map((c, i) => {
          const activo = abierto === c.slug;
          return (
            <button
              key={c.slug}
              onClick={() => setAbierto(activo ? null : c.slug)}
              className="w-full text-left px-5 py-3.5 grid items-center gap-px transition-colors"
              style={{
                gridTemplateColumns: `minmax(0,1fr) repeat(${columnas.length}, 34px) 78px`,
                borderTop: "1px solid var(--line-suave)",
                background: activo ? "var(--panel-alto)" : "transparent",
                animation: `aparecer 420ms ease-out both`,
                animationDelay: `${i * 45}ms`,
              }}
            >
              <div className="min-w-0 pr-4">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[14px] truncate">{c.nombre}</span>
                  {c.estado !== "active" && (
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--alerta)" }}>
                      {c.estado}
                    </span>
                  )}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--tenue)" }}>
                  {c.slug} · {c.plan}
                </div>
              </div>

              {c.credenciales.map((cr) => (
                <div key={cr.clave} className="flex justify-center">
                  <Pip puesta={cr.puesta} cifrada={cr.cifrada} titulo={cr.nombre} />
                </div>
              ))}

              <div className="text-right text-[12px] tabular-nums" style={{ color: "var(--dim)" }}>
                {c.modulos.length}
              </div>
            </button>
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
              onClick={() => setAbierto(null)}
              className="text-[11px] uppercase tracking-[0.16em]"
              style={{ color: "var(--tenue)" }}
            >
              cerrar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
            <div>
              <Etiqueta>credenciales</Etiqueta>
              <div className="mt-3 space-y-2">
                {GRUPOS.map((g) => {
                  const del = detalle.credenciales.filter((c) => c.grupo === g);
                  if (!del.length) return null;
                  return (
                    <div key={g}>
                      <div className="text-[10px] mb-1" style={{ color: "var(--tenue)" }}>{g}</div>
                      {del.map((c) => (
                        <div key={c.clave} className="flex items-center gap-2.5 text-[12px] py-0.5">
                          <Pip puesta={c.puesta} cifrada={c.cifrada} titulo={c.nombre} />
                          <span style={{ color: c.puesta ? "var(--text)" : "var(--tenue)" }}>
                            {c.nombre}
                          </span>
                          {c.puesta && c.cifrada === false && (
                            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--alerta)" }}>
                              sin cifrar
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
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
                    <dt className="w-44 shrink-0" style={{ color: "var(--tenue)" }}>{k}</dt>
                    <dd className="truncate">{String(v)}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5">
                <Etiqueta>módulos activos</Etiqueta>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detalle.modulos.map((m) => (
                    <span
                      key={m}
                      className="text-[10px] px-2 py-0.5 rounded"
                      style={{ background: "var(--panel-alto)", color: "var(--dim)", border: "1px solid var(--line)" }}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <p className="mt-10 text-[11px] leading-relaxed max-w-lg" style={{ color: "var(--tenue)" }}>
        Solo lectura. Para cambiar la configuración de un cliente se entra en su propio CRM, y
        cada cambio le llega por correo con el detalle de qué se tocó.
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

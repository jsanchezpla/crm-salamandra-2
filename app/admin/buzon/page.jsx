"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Buzón — lo que nos escriben los clientes.
 *
 * ── LO QUE ESTA PANTALLA TIENE QUE CONTESTAR DE UN VISTAZO ──────────────────
 * «¿Qué me toca mirar ahora?». Por eso la pestaña por defecto es Activos y no
 * Todos, por eso lo que bloquea el trabajo de alguien lleva marca roja, y por
 * eso la fila enseña el CLIENTE antes que el asunto: un mismo fallo contado por
 * tres clientes distintos es otra cosa que contado por uno.
 *
 * ── LO QUE NO HACE ──────────────────────────────────────────────────────────
 * No borra. Ni desde aquí ni desde la pantalla del cliente. Lo que caduca lo
 * quita `scripts/podar-buzon.js`, que mira lo que se lleva antes de llevárselo.
 *
 * Las NOTAS INTERNAS se ven aquí y no se le mandan al cliente. El recorte lo
 * hace `serializarAviso` en `lib/buzon/buzon.js`, no esta pantalla.
 */

const NIVEL = {
  amber: { fondo: "#FEF3C7", texto: "#92400E" },
  blue: { fondo: "#DBEAFE", texto: "#1E40AF" },
  grey: { fondo: "#F3F4F6", texto: "#4B5563" },
  green: { fondo: "#D1FAE5", texto: "#065F46" },
};

const PESTANAS = [
  { key: "activos", label: "Activos" },
  { key: "nuevo", label: "Nuevos" },
  { key: "en_curso", label: "En curso" },
  { key: "esperando", label: "Esperando" },
  { key: "resuelto", label: "Resueltos" },
];

function fechaHora(v) {
  if (!v) return "";
  return new Date(v).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Etiqueta({ children }) {
  return (
    <span className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--tenue)" }}>
      {children}
    </span>
  );
}

function Chip({ nivel = "grey", children }) {
  const c = NIVEL[nivel] ?? NIVEL.grey;
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: c.fondo, color: c.texto }}
    >
      {children}
    </span>
  );
}

export default function BuzonPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("activos");
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const p = new URLSearchParams({ estado: tab });
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch(`/api/admin/buzon?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo leer");
      setDatos(json.data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [tab, q]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-[28px]" style={{ fontFamily: "var(--admin-display)", color: "var(--alerta)" }}>
            No se pudo leer
          </h1>
          <p className="text-[13px] mt-2" style={{ color: "var(--tenue)" }}>{error}</p>
        </div>
      </main>
    );
  }

  if (!datos) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-[11px] uppercase tracking-[0.2em] animate-pulse" style={{ color: "var(--tenue)" }}>
          Abriendo el buzón
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 lg:px-12 py-10 lg:py-14 max-w-[1100px] mx-auto">
      <Etiqueta>Salamandra · panel interno</Etiqueta>
      <h1
        className="text-[42px] lg:text-[58px] leading-[0.95] tracking-tight mt-2"
        style={{ fontFamily: "var(--admin-display)" }}
      >
        Buzón
        <br />
        <span style={{ fontStyle: "italic", color: "var(--ok)" }}>de clientes</span>
      </h1>

      <p className="text-[13px] mt-5 max-w-xl leading-relaxed" style={{ color: "var(--dim)" }}>
        Lo que nos escriben desde <b>Ayuda</b>, dentro de su CRM. Cualquier usuario de cualquier
        cliente puede abrir uno, tenga los módulos que tenga. Lo que se conteste aquí lo ve en su
        pantalla; lo que se marque como <b>nota</b>, no.
      </p>

      {datos.soloLectura && (
        <div
          className="mt-5 text-[12px] rounded px-3 py-2.5"
          style={{ background: "color-mix(in srgb, var(--alerta) 8%, transparent)", color: "var(--alerta)" }}
        >
          Faltan las tablas, así que esto está vacío porque no puede leer, no porque nadie haya
          escrito. En el VPS: <code>docker exec crm-salamandra-app-1 node scripts/migrate-buzon.js</code>
        </div>
      )}

      <div className="mt-8 flex items-center gap-1.5 flex-wrap">
        {PESTANAS.map((p) => {
          const n = datos.recuento?.[p.key] ?? 0;
          const activa = tab === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setTab(p.key)}
              className="text-[12px] px-3 py-1.5 rounded cursor-pointer transition-colors"
              style={{
                background: activa ? "var(--ok)" : "var(--panel)",
                color: activa ? "#fff" : "var(--dim)",
                border: `1px solid ${activa ? "var(--ok)" : "var(--line)"}`,
              }}
            >
              {p.label} {n > 0 && <span style={{ opacity: 0.7 }}>{n}</span>}
            </button>
          );
        })}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar…"
          className="ml-auto text-[12px] px-3 py-1.5 rounded outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)" }}
        />
      </div>

      <div className="mt-5">
        {datos.avisos.length === 0 ? (
          <p className="text-[13px] py-8 text-center" style={{ color: "var(--tenue)" }}>
            Nada por aquí.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {datos.avisos.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setAbierto(a.id)}
                  className="w-full text-left px-4 py-3 rounded cursor-pointer transition-colors"
                  style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold" style={{ color: "var(--ok)" }}>
                          {a.tenantNombre}
                        </span>
                        <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
                          {a.ref}
                        </span>
                        {a.bloquea && <Chip nivel="amber">Le bloquea</Chip>}
                        {!a.leidoAt && <Chip nivel="blue">Sin abrir</Chip>}
                      </div>
                      <div className="text-[13px] mt-1 truncate" style={{ color: "var(--text)" }}>
                        {a.asunto}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--tenue)" }}>
                        {a.usuarioNombre || a.usuarioEmail || "—"} · {fechaHora(a.createdAt)}
                        {a.asignadoA && ` · ${a.asignadoA}`}
                      </div>
                    </div>
                    <Chip nivel={a.estadoNivel}>{a.estadoLabel}</Chip>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {abierto && (
        <Detalle
          avisoId={abierto}
          asignables={datos.asignables}
          estados={datos.estados}
          prioridades={datos.prioridades}
          onCerrar={() => {
            setAbierto(null);
            cargar();
          }}
        />
      )}
    </main>
  );
}

function Detalle({ avisoId, asignables, estados, prioridades, onCerrar }) {
  const [aviso, setAviso] = useState(null);
  const [texto, setTexto] = useState("");
  const [interno, setInterno] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/buzon/${avisoId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo leer");
      setAviso(json.data);
    } catch (e) {
      setFallo(e.message);
    }
  }, [avisoId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function cambiar(campo, valor) {
    try {
      const res = await fetch(`/api/admin/buzon/${avisoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: valor }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo guardar");
      setAviso(json.data);
      setFallo(null);
    } catch (e) {
      setFallo(e.message);
    }
  }

  async function responder(e) {
    e.preventDefault();
    if (enviando || !texto.trim()) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/admin/buzon/${avisoId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuerpo: texto, interno }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo enviar");
      setAviso(json.data);
      setTexto("");
      setFallo(null);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onCerrar} aria-hidden="true" />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[540px] z-50 shadow-xl flex flex-col"
        style={{ background: "var(--panel)" }}
      >
        <div
          className="px-5 py-4 flex items-start justify-between gap-3"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <div className="min-w-0">
            <div className="text-[11px]" style={{ color: "var(--tenue)" }}>
              {aviso?.ref} · {aviso?.tenantNombre}
            </div>
            <h2 className="text-[15px] font-semibold truncate" style={{ color: "var(--text)" }}>
              {aviso?.asunto ?? "…"}
            </h2>
          </div>
          <button
            onClick={onCerrar}
            className="cursor-pointer text-xl leading-none"
            style={{ color: "var(--tenue)" }}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {fallo && <div className="text-[12px]" style={{ color: "var(--alerta)" }}>{fallo}</div>}

          {aviso && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {estados.map((e) => (
                  <button
                    key={e.key}
                    onClick={() => cambiar("estado", e.key)}
                    className="text-[11px] px-2 py-1 rounded cursor-pointer"
                    style={{
                      background: aviso.estado === e.key ? "var(--ok)" : "transparent",
                      color: aviso.estado === e.key ? "#fff" : "var(--dim)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {e.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[11px]" style={{ color: "var(--tenue)" }}>Prioridad</span>
                {prioridades.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => cambiar("prioridad", p.key)}
                    className="text-[11px] px-2 py-1 rounded cursor-pointer"
                    style={{
                      background: aviso.prioridad === p.key ? "var(--panel-alto)" : "transparent",
                      color: "var(--dim)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
                <span className="text-[11px] ml-2" style={{ color: "var(--tenue)" }}>Es de</span>
                {[...asignables, null].map((quien) => (
                  <button
                    key={quien ?? "nadie"}
                    onClick={() => cambiar("asignadoA", quien)}
                    className="text-[11px] px-2 py-1 rounded cursor-pointer capitalize"
                    style={{
                      background: (aviso.asignadoA ?? null) === quien ? "var(--panel-alto)" : "transparent",
                      color: "var(--dim)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {quien ?? "nadie"}
                  </button>
                ))}
              </div>

              <div
                className="rounded px-3 py-2.5 text-[11px] space-y-0.5"
                style={{ background: "var(--panel-alto)", color: "var(--dim)" }}
              >
                <div>
                  <b>Quién</b>: {aviso.usuarioNombre || "—"} · {aviso.usuarioEmail || "sin correo"} ·{" "}
                  {aviso.usuarioRol || "—"}
                </div>
                <div>
                  <b>Dónde</b>: {aviso.pantalla || "no lo dijo"}
                </div>
                {aviso.contexto?.navegador && (
                  <div className="truncate">
                    <b>Con</b>: {aviso.contexto.navegador} · {aviso.contexto.ventana ?? ""}
                  </div>
                )}
                {aviso.bloquea && <div style={{ color: "var(--alerta)" }}>Dice que le impide trabajar.</div>}
              </div>

              <div>
                <div className="text-[11px] mb-1" style={{ color: "var(--tenue)" }}>
                  {aviso.usuarioNombre || "El cliente"} · {fechaHora(aviso.createdAt)}
                </div>
                <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text)" }}>
                  {aviso.cuerpo}
                </p>
                {aviso.adjuntos?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {aviso.adjuntos.map((ad) => (
                      <li key={ad.id}>
                        <a
                          href={`/api/admin/buzon/adjuntos/${ad.id}`}
                          className="text-[12px] underline underline-offset-2"
                          style={{ color: "var(--ok)" }}
                        >
                          {ad.nombre}
                        </a>{" "}
                        <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
                          {Math.round((ad.bytes ?? 0) / 1024)} kB
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {aviso.mensajes.map((m) => (
                <div key={m.id}>
                  <div className="text-[11px] mb-1" style={{ color: "var(--tenue)" }}>
                    {m.autorTipo === "salamandra" ? m.autorNombre || "Salamandra" : aviso.usuarioNombre || "El cliente"}{" "}
                    · {fechaHora(m.createdAt)}
                    {m.interno && <span style={{ color: "var(--alerta)" }}> · nota, no la ve</span>}
                  </div>
                  <p
                    className="text-[13px] whitespace-pre-wrap leading-relaxed rounded px-3 py-2"
                    style={{
                      background: m.interno
                        ? "color-mix(in srgb, var(--alerta) 8%, transparent)"
                        : "var(--panel-alto)",
                      color: "var(--text)",
                    }}
                  >
                    {m.cuerpo}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>

        <form onSubmit={responder} className="px-5 py-4" style={{ borderTop: "1px solid var(--line)" }}>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            maxLength={5000}
            placeholder={interno ? "Nota para nosotros…" : "Contestarle…"}
            className="w-full rounded px-3 py-2 text-[13px] outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)" }}
          />
          <div className="flex items-center justify-between gap-3 mt-2">
            <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: "var(--dim)" }}>
              <input
                type="checkbox"
                checked={interno}
                onChange={(e) => setInterno(e.target.checked)}
                className="cursor-pointer"
              />
              Nota interna
            </label>
            <button
              type="submit"
              disabled={enviando || !texto.trim()}
              className="px-4 py-2 rounded text-[13px] text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--ok)" }}
            >
              {enviando ? "Enviando…" : interno ? "Guardar nota" : "Contestar"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

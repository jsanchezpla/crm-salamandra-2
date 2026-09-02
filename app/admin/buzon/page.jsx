"use client";

import { useCallback, useEffect, useState } from "react";
import { anchoPanel } from "@/components/admin/anchoPanel.js";

import { EVENTO_PENDIENTES } from "../../../lib/buzon/buzon.js";

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

// Dos estados (`lib/buzon/buzon.js`, Rodrigo 02/09/2026): nuevo → enviado al
// Registro, y ahí se acaba el Buzón: lo enviado cuenta como cerrado aquí y
// sigue vivo en el tablero. «Enviado» lo pone el botón, no la mano.
const PESTANAS = [
  { key: "activos", label: "Activos" },
  { key: "enviado", label: "En el Registro" },
  { key: "todos", label: "Todos" },
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

/**
 * Las capturas de un mensaje (o del alta), con su peso.
 *
 * «Ver» solo aparece cuando el fichero se puede enseñar de verdad (`verComo`,
 * que decide la extensión guardada y nunca acepta SVG). Lo demás se descarga.
 */
function Capturas({ lista, onVer }) {
  if (!lista?.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {lista.map((ad) => (
        <li key={ad.id} className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/admin/buzon/adjuntos/${ad.id}`}
            className="text-[12px] underline underline-offset-2"
            style={{ color: "var(--ok)" }}
          >
            {ad.nombre}
          </a>
          <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
            {Math.round((ad.bytes ?? 0) / 1024)} kB
          </span>
          {ad.verComo && (
            <button
              type="button"
              onClick={() => onVer(ad)}
              className="text-[11px] px-2 py-0.5 rounded cursor-pointer"
              style={{ border: "1px solid var(--line)", color: "var(--dim)" }}
            >
              Ver
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * El visor. Encima del panel lateral (z-[60] sobre su z-50), porque se abre
 * desde él y taparlo es lo que tiene que hacer.
 *
 * Pide el fichero con `?ver=1`; sin ese parámetro el endpoint lo sirve como
 * descarga. Solo llegan aquí imágenes y PDF: el botón que lo abre no existe
 * para lo demás.
 */
function Visor({ adjunto, onCerrar }) {
  useEffect(() => {
    const alPulsar = (e) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [onCerrar]);

  if (!adjunto) return null;
  const url = `/api/admin/buzon/adjuntos/${adjunto.id}?ver=1`;
  const esPdf = adjunto.verComo === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex flex-col"
      onClick={onCerrar}
      role="dialog"
      aria-label={adjunto.nombre}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white shrink-0">
        <span className="text-[13px] truncate">{adjunto.nombre}</span>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={`/api/admin/buzon/adjuntos/${adjunto.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[12px] underline underline-offset-2 text-white/80 hover:text-white"
          >
            Descargar
          </a>
          <button
            onClick={onCerrar}
            className="text-white/80 hover:text-white text-2xl leading-none cursor-pointer"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 px-4 pb-4" onClick={(e) => e.stopPropagation()}>
        {esPdf ? (
          <iframe src={url} title={adjunto.nombre} className="w-full h-full rounded bg-white" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={adjunto.nombre} className="max-w-full max-h-full object-contain rounded" />
          </div>
        )}
      </div>
    </div>
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

/**
 * Cómo se tría esto con Claude, explicado DENTRO del buzón.
 *
 * Va aquí y no en un README porque el momento en que hace falta saberlo es
 * mirando esta pantalla, no buscando por el repositorio (lo pidió Jorge el
 * 13/08/2026, para que Rodrigo lo tenga a mano sin preguntar).
 *
 * Plegado por defecto: quien ya lo sabe no tiene que verlo cada vez, y quien no,
 * lo encuentra sin buscar. Es `<details>` del navegador y no un estado de React
 * a propósito — un desplegable que no necesita JavaScript no se puede romper.
 */
function ComoTriarlo() {
  const orden = { background: "var(--panel-alto)", border: "1px solid var(--line)" };
  return (
    <details className="mt-5 rounded" style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
      <summary className="text-[12px] px-3.5 py-2.5 cursor-pointer select-none" style={{ color: "var(--dim)" }}>
        ¿Cómo se convierte esto en tareas? — triaje con Claude
      </summary>

      <div className="px-3.5 pb-3.5 text-[12px] leading-relaxed" style={{ color: "var(--dim)" }}>
        <p className="mb-2.5">
          Hay una skill que lee de aquí los avisos de <b>«algo no funciona»</b> (las dudas y las
          mejoras no), comprueba <b>contra producción</b> si el fallo sigue pasando y hace una de
          dos cosas: lo apunta en el Registro y lo despliega, o —si ya estaba arreglado— le
          contesta al cliente ella misma. Para contestarle tiene que poder señalar el commit que
          lo arregla <i>y</i> comprobar que está desplegado; si no puede, no le dice nada.
        </p>

        <p className="mb-1.5">
          <b>Cómo se lanza.</b> Abre <b>Claude Code de escritorio</b> en la carpeta del CRM
          (<code>crm-salamandra-2</code>), escribe esto y pulsa Enter:
        </p>
        <div className="rounded px-2.5 py-1.5 mb-2.5 font-mono text-[12px]" style={orden}>
          /incidencias-buzon
        </div>

        <p className="mb-1.5">
          Así las tría todas. Para una sola, con su referencia —la que sale en cada fila, tipo
          AV-0007—:
        </p>
        <div className="rounded px-2.5 py-1.5 mb-2.5 font-mono text-[12px]" style={orden}>
          /incidencias-buzon AV-0007
        </div>

        <p className="mb-2.5">
          <b>Cuándo se para y te lo deja a ti.</b> Cuando no pueda decidir si un fallo sigue pasando —porque
          hace falta la captura, o reproducirlo con la sesión del cliente— <b>no se lo inventa</b>:
          te lo dice y lo deja. Eso es una respuesta buena, no un fallo de la skill.
        </p>

        <p className="mb-0" style={{ color: "var(--tenue)" }}>
          Lo que escribe en el Registro viaja dentro de la imagen de Docker, así que la skill
          despliega sola: hasta que no se despliega, el tablero enseña lo de antes. Las reglas
          completas están en <code>.claude/skills/incidencias-buzon/SKILL.md</code> y en{" "}
          <code>docs/como-apuntar-en-el-tablero.md</code>.
        </p>
      </div>
    </details>
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

  /**
   * Abrir el aviso al que apunta la campana.
   *
   * Se lee de `window.location.search` y no con `useSearchParams` a propósito:
   * ese hook obliga a envolver la página en un `<Suspense>` para que Next pueda
   * prerenderizarla, y esto es una pantalla de cliente entera detrás de un
   * login. Un efecto de montaje hace lo mismo sin arrastrar esa ceremonia.
   *
   * La query se limpia de la barra con `replaceState` para que recargar no
   * vuelva a abrir el aviso de hace media hora.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("aviso");
    if (!id) return;
    setAbierto(id);
    window.history.replaceState(null, "", "/admin/buzon");
  }, []);

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
    <main className={anchoPanel()}>
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

      <ComoTriarlo />

      <div className="mt-8 flex items-center gap-1.5 flex-wrap">
        {PESTANAS.map((p) => {
          const n =
            p.key === "todos"
              ? Object.entries(datos.recuento ?? {})
                  .filter(([k]) => k !== "activos")
                  .reduce((suma, [, v]) => suma + (Number(v) || 0), 0)
              : (datos.recuento?.[p.key] ?? 0);
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
                        {/* Antes esto era `!a.leidoAt`, o sea «no lo hemos
                            abierto NUNCA», y por eso un cliente podía insistir
                            tres veces en un hilo ya visto sin que la fila se
                            marcara. Ahora es `pendiente`: nos ha escrito él
                            después de la última vez que miramos. Es lo mismo que
                            cuenta la campana de arriba, salido de la misma
                            función. */}
                        {a.pendiente && (
                          <Chip nivel="blue">{a.leidoAt ? "Ha vuelto a escribir" : "Sin abrir"}</Chip>
                        )}
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
  const [viendo, setViendo] = useState(null);
  const [alRegistro, setAlRegistro] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/buzon/${avisoId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo leer");
      setAviso(json.data);
      // Abrirlo ES haberlo mirado, y el GET acaba de apuntarlo (`leidoAt`). Se
      // avisa a la campana de la barra para que el número baje AHORA y no en la
      // próxima recarga: si no, se queda diciendo que hay algo esperando
      // mientras lo tienes abierto delante.
      //
      // El evento no lleva el número, solo un «vuelve a mirar»: esta pantalla
      // no lo sabe —el suyo es el recuento por estado, otra cosa— y la campana
      // lo pregunta a su endpoint, que es una consulta pequeña.
      window.dispatchEvent(new Event(EVENTO_PENDIENTES));
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

  /**
   * «Enviar al registro» (02/09/2026): apunta la tarea de verdad en «Sin
   * comprobar» del backlog y deja el aviso en «enviado», enlazado por la ficha.
   * Sin confirmación: publicar una versión es reversible desde el tablero, y
   * el servidor se niega a apuntar el mismo aviso dos veces.
   */
  async function enviarAlRegistro() {
    if (alRegistro) return;
    setAlRegistro(true);
    try {
      const res = await fetch(`/api/admin/buzon/${avisoId}/registro`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo enviar al Registro");
      setAviso(json.data.aviso);
      setFallo(null);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setAlRegistro(false);
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
                    // «Enviado al registro» no es una etiqueta: si el aviso aún no
                    // tiene su tarea, pulsarlo la apunta de verdad.
                    onClick={() =>
                      e.key === "enviado" && !aviso.registroFicha
                        ? enviarAlRegistro()
                        : cambiar("estado", e.key)
                    }
                    disabled={alRegistro}
                    className="text-[11px] px-2 py-1 rounded cursor-pointer disabled:opacity-50"
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

              {aviso.registroFicha || aviso.estado === "enviado" ? (
                <div
                  className="rounded px-3 py-2 text-[11px]"
                  style={{ background: "var(--panel-alto)", color: "var(--dim)" }}
                >
                  <b>En el Registro</b>
                  {aviso.registroEnviadoAt
                    ? ` desde el ${fechaHora(aviso.registroEnviadoAt)}`
                    : " (sin ficha enlazada: es anterior al botón)"}
                  {aviso.registroFicha ? ` · ficha ${aviso.registroFicha}` : ""} ·{" "}
                  <a href="/admin/tablero" className="underline">
                    abrir el Registro
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={enviarAlRegistro}
                    disabled={alRegistro}
                    className="text-[12px] px-3 py-1.5 rounded cursor-pointer font-medium disabled:opacity-50"
                    style={{ background: "var(--ok)", color: "#fff" }}
                  >
                    {alRegistro ? "Apuntando…" : "Enviar al registro →"}
                  </button>
                  <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
                    Apunta la tarea en «Sin comprobar» del backlog, con lo que cuenta el cliente.
                  </span>
                </div>
              )}

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
                {/* El churro del user-agent NO se pinta (Jorge, 13/08/2026): son
                    tres líneas ilegibles que no dicen nada de un vistazo. Se
                    SIGUE guardando en `contexto.navegador` por si algún día hace
                    falta para un fallo que solo pase en un navegador; se mira en
                    la base, no aquí. El tamaño de ventana sí se queda: es corto
                    y es lo que explica los «el botón se sale de la pantalla». */}
                <div>
                  <b>Dónde</b>: {aviso.pantalla || "no lo dijo"}
                  {aviso.contexto?.ventana ? ` · ventana ${aviso.contexto.ventana}` : ""}
                </div>
                {aviso.bloquea && <div style={{ color: "var(--alerta)" }}>Dice que le impide trabajar.</div>}
              </div>

              <div>
                <div className="text-[11px] mb-1" style={{ color: "var(--tenue)" }}>
                  {aviso.usuarioNombre || "El cliente"} · {fechaHora(aviso.createdAt)}
                </div>
                <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text)" }}>
                  {aviso.cuerpo}
                </p>
                {/* Las del alta: las que no cuelgan de ningún mensaje. */}
                <Capturas lista={(aviso.adjuntos ?? []).filter((a) => !a.mensajeId)} onVer={setViendo} />
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
                  {/* La captura, donde se mandó. Saber a qué respuesta
                      acompañaba es la mitad de la información. */}
                  <Capturas lista={(aviso.adjuntos ?? []).filter((a) => a.mensajeId === m.id)} onVer={setViendo} />
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

      <Visor adjunto={viendo} onCerrar={() => setViendo(null)} />
    </>
  );
}

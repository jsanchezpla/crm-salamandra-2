"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

/**
 * «Documentos por leer» (01/09/2026, Rodrigo).
 *
 * El destino del aviso de la portada: lo que me han pedido leer, y —solo para
 * dirección— quién del centro lo lleva al día.
 *
 * ABRIR EL DOCUMENTO ES LEERLO: el enlace de cada fila descarga, y esa descarga
 * es la que sella el acuse en el servidor (`lib/documents/lecturas.js`). El
 * botón «Ya lo he leído» está para lo que ya se conocía —vino por correo, se
 * leyó en la reunión— y pone el mismo sello.
 *
 * La pantalla no gatea nada por su cuenta: el endpoint exige que el centro
 * tenga equipo y que el panorama del centro sea de dirección, y aquí se enseña
 * lo que conteste.
 */

const fmtFechaHora = (iso) =>
  iso
    ? new Date(iso).toLocaleString("es-ES", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Madrid",
      })
    : "—";

const fmtFecha = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "Europe/Madrid" })
    : "—";

// De dónde cuelga el documento, en cristiano: el tramo de agenda con su día y
// su hora, que es lo que convierte «acta.pdf» en algo reconocible.
function DeDonde({ doc }) {
  if (!doc.bloqueo) return <span className="text-neutral-400">Documento del archivo</span>;
  return (
    <span className="text-neutral-500">
      {doc.bloqueo.label} · {fmtFechaHora(doc.bloqueo.startAt)}
    </span>
  );
}

export default function LecturasPage() {
  const [ambito, setAmbito] = useState("mias");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [marcando, setMarcando] = useState(null);

  const cargar = useCallback(() => {
    let cancelado = false;
    setLoading(true); setErrorMsg(null);
    fetch(`/api/documents/lecturas?ambito=${ambito}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelado) return;
        if (j.ok) setData(j.data);
        else setErrorMsg(j.error);
      })
      .catch((e) => { if (!cancelado) setErrorMsg(e.message); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [ambito]);
  useEffect(() => cargar(), [cargar]);

  async function marcarLeido(documentId) {
    setMarcando(documentId);
    try {
      await fetch("/api/documents/lecturas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      cargar();
    } catch {
      // Si falla, la lista se queda como estaba: el acuse no se inventa.
    } finally {
      setMarcando(null);
    }
  }

  const esAdmin = !!data?.yo?.esAdmin;
  const lecturas = data?.lecturas ?? [];
  const pendientes = lecturas.filter((l) => !l.leido);
  const hechas = lecturas.filter((l) => l.leido);
  const documentos = data?.documentos ?? [];

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <Link
        href="/documentos"
        className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Volver a Documentos
      </Link>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Documentos · Lectura</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            {ambito === "centro" ? "Quién lo ha leído" : "Documentos por leer"}
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {ambito === "centro"
              ? "Lo que se ha pedido leer al equipo y quién lo lleva al día."
              : "Lo que te han pedido leer. Abrirlo lo da por leído."}
          </p>
        </div>
        {esAdmin && (
          <div className="flex gap-1 self-start lg:self-auto rounded-lg border border-neutral-200 p-0.5 bg-white">
            {[
              { key: "mias", label: "Lo mío" },
              { key: "centro", label: "El centro" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setAmbito(t.key)}
                className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                  ambito === t.key ? "bg-[var(--color-primary,#1B3A2D)] text-white font-semibold" : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>
      )}
      {loading && <div className="text-xs text-neutral-400 py-4">Cargando…</div>}

      {/* ── LO MÍO ────────────────────────────────────────────────────────── */}
      {!loading && ambito === "mias" && (
        <>
          {lecturas.length === 0 && !errorMsg && (
            <div className="bg-white border border-neutral-100 rounded-xl p-8 text-center">
              <div className="font-display text-lg text-[var(--ink-900)]">No tienes nada por leer.</div>
              <p className="text-xs text-neutral-400 mt-1">
                Cuando alguien te pida leer un documento, aparecerá aquí y en tu pantalla de inicio.
              </p>
            </div>
          )}

          {pendientes.length > 0 && (
            <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
              <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
                <h2 className="eyebrow">Pendientes</h2>
                <span className="text-[10px] text-neutral-400">{pendientes.length}</span>
              </div>
              {pendientes.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-4 lg:px-5 py-3 border-t border-neutral-100 first:border-t-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400" />
                  <div className="min-w-0 flex-1">
                    <a href={l.documento.href} className="block text-sm text-neutral-800 font-medium truncate hover:underline">
                      {l.documento.name}
                    </a>
                    <div className="text-[11px] mt-0.5">
                      <DeDonde doc={l.documento} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => marcarLeido(l.documento.id)}
                    disabled={marcando === l.documento.id}
                    className="shrink-0 text-[11px] text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] disabled:opacity-40"
                  >
                    {marcando === l.documento.id ? "…" : "Ya lo he leído"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {hechas.length > 0 && (
            <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
              <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
                <h2 className="eyebrow">Ya leídos</h2>
                <span className="text-[10px] text-neutral-400">{hechas.length}</span>
              </div>
              {hechas.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-4 lg:px-5 py-2.5 border-t border-neutral-100 first:border-t-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-500" />
                  <a href={l.documento.href} className="min-w-0 flex-1 text-sm text-neutral-600 truncate hover:underline">
                    {l.documento.name}
                  </a>
                  <span className="shrink-0 text-[11px] text-neutral-400">{fmtFecha(l.readAt)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── EL CENTRO (dirección) ─────────────────────────────────────────── */}
      {!loading && ambito === "centro" && (
        <>
          {documentos.length === 0 && !errorMsg && (
            <div className="bg-white border border-neutral-100 rounded-xl p-8 text-center text-sm text-neutral-400">
              Todavía no se ha pedido leer ningún documento.
            </div>
          )}
          {documentos.map((d) => (
            <div key={d.id} className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
              <div className="px-4 lg:px-5 py-3 border-b border-neutral-100 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <a href={d.href} className="block text-sm text-neutral-800 font-medium truncate hover:underline">
                    {d.name}
                  </a>
                  <div className="text-[11px] mt-0.5">
                    <DeDonde doc={d} />
                  </div>
                </div>
                <span
                  className={`shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                    d.pendientes > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {d.pendientes > 0 ? `${d.pendientes} sin leer` : "Todo el mundo lo ha leído"}
                </span>
              </div>
              <div className="px-4 lg:px-5 py-2.5 flex flex-wrap gap-1.5">
                {d.lectores.map((l) => (
                  <span
                    key={l.teamMemberId}
                    className={`text-[10px] rounded-full px-2 py-0.5 ${
                      l.leido ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}
                    title={l.leido ? `Leído el ${fmtFecha(l.readAt)}` : "Sin leer"}
                  >
                    {l.nombre || "—"}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

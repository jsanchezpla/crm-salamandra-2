"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import FileTypeIcon from "@/components/documents/FileTypeIcon.jsx";
import PdfPreviewModal from "@/components/documents/PdfPreviewModal.jsx";
import { fmtSize, fmtDate } from "@/components/documents/formato.js";
import { tipoParaVerEnPantalla } from "@/lib/documents/verEnPantalla.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

/**
 * «Todos los documentos»: el archivo entero de una visibilidad, sin carpetas
 * por medio —cada fila dice en cuál está— y con buscador por nombre. La
 * navegación por carpetas sigue viviendo en /documentos.
 */
export default function TodosLosDocumentosModule({ visibilidadInicial = "private" }) {
  const [me, setMe] = useState(null);
  const [visibility, setVisibility] = useState(visibilidadInicial);
  const [q, setQ] = useState("");
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && j.ok && setMe(j.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const texto = q.trim();
    // Pequeño respiro al teclear para no disparar una petición por letra.
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ visibility, all: "1" });
        if (texto) params.set("q", texto);
        fetch(`/api/documents?${params}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((j) => {
            if (!alive) return;
            if (!j?.ok) throw new Error(j?.error || "Error cargando documentos");
            setDocuments(j.data.documents ?? []);
            setError(null);
          })
          .catch((e) => alive && setError(e.message))
          .finally(() => alive && setLoading(false));
      },
      texto ? 250 : 0
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [visibility, q, reloadKey]);

  const canManage = (row) => me && row.ownerUserId === me.id;

  async function deleteDoc(doc) {
    if (!confirm(`¿Eliminar «${doc.fileName}»?`)) return;
    setError(null);
    try {
      const r = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo eliminar");
      }
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <div>
        <div className="eyebrow">Empresa · Documentos</div>
        <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1">Todos los documentos</h1>
        <p className="text-xs text-neutral-400 mt-1">
          El archivo entero, con lo que hay dentro de cada carpeta.{" "}
          <Link href="/documentos" className="underline hover:text-neutral-600">
            Volver a las carpetas
          </Link>
        </p>
      </div>

      {/* Tabs private/shared + buscador */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5 shrink-0" role="tablist">
          {[
            { key: "private", label: "Privados" },
            { key: "shared", label: "Compartidos" },
          ].map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={visibility === t.key}
              onClick={() => setVisibility(t.key)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                visibility === t.key ? "bg-neutral-800 text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-md">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre…"
            className="w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-neutral-400"
          />
        </div>
      </div>

      {error && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">{error}</div>}

      {!loading && (
        <div className="text-[11px] text-neutral-400">
          {documents.length === 1 ? "1 documento" : `${documents.length} documentos`}
          {q.trim() ? ` con «${q.trim()}» en el nombre` : ""}
        </div>
      )}

      {documents.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
          {documents.map((doc) => (
            <div key={doc.id} className="group flex items-center gap-3 px-3 py-2.5">
              <FileTypeIcon mimeType={doc.mimeType} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-neutral-800 font-medium truncate">{doc.fileName}</div>
                <div className="text-[11px] text-neutral-400 truncate">
                  {fmtSize(doc.fileSize)} · {fmtDate(doc.createdAt)}
                  {visibility === "shared" && doc.ownerName ? ` · ${doc.ownerName}` : ""}
                  {doc.folderPath ? ` · 📁 ${doc.folderPath}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {tipoParaVerEnPantalla(doc.fileName) && (
                  <button
                    onClick={() => setPreview(doc)}
                    title="Ver sin descargar"
                    className="w-8 h-8 flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>
                  </button>
                )}
                <a
                  href={`/api/documents/${doc.id}/download`}
                  title="Descargar"
                  className="w-8 h-8 flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
                  </svg>
                </a>
                {canManage(doc) && (
                  <button
                    onClick={() => deleteDoc(doc)}
                    title="Eliminar"
                    className="w-8 h-8 flex items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0v12a2 2 0 01-2 2H8a2 2 0 01-2-2V7" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="text-xs text-neutral-400 py-4">Cargando…</div>}
      {!loading && documents.length === 0 && (
        <div className="text-center py-10 text-sm text-neutral-400">
          {q.trim()
            ? `Ningún documento con «${q.trim()}» en el nombre.`
            : "Aquí no hay documentos todavía. Se suben desde la pantalla de carpetas."}
        </div>
      )}

      <PdfPreviewModal doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import ContratoServiciosCard from "@/components/documents/ContratoServiciosCard.jsx";
import FileTypeIcon from "@/components/documents/FileTypeIcon.jsx";
import UploadDropzone from "@/components/documents/UploadDropzone.jsx";
import PdfPreviewModal from "@/components/documents/PdfPreviewModal.jsx";
import PedirLecturaModal from "@/components/documents/PedirLecturaModal.jsx";
import CompartirCarpetaModal from "@/components/documents/CompartirCarpetaModal.jsx";
import { fmtSize, fmtDate } from "@/components/documents/formato.js";
import { tipoParaVerEnPantalla } from "@/lib/documents/verEnPantalla.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const MAX_LEVEL = 3; // 0..3 → 4 niveles
// En la raíz la lista de archivos se corta para que las carpetas se vean sin
// hacer scroll; el resto vive en /documentos/todos (Rodrigo, 30/08/2026).
const DOCS_EN_PORTADA = 4;

export default function DocumentsModule({ avanzado = true }) {
  const [me, setMe] = useState(null);
  const [visibility, setVisibility] = useState("private"); // private | shared
  const [path, setPath] = useState([]); // [{id,name,level}], vacío = raíz
  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [preview, setPreview] = useState(null);
  // El documento al que se le está pidiendo lectura (01/09/2026, Rodrigo).
  const [pidiendoLectura, setPidiendoLectura] = useState(null);
  // Y la carpeta a la que se le está eligiendo quién la ve (01/09/2026).
  const [compartiendo, setCompartiendo] = useState(null);
  const [actionError, setActionError] = useState(null);

  const currentFolderId = path.length ? path[path.length - 1].id : null;
  const canCreateFolder = path.length <= MAX_LEVEL; // nueva carpeta = level path.length
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

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
    // Sin el avanzado no hay archivo que pedir: estas tres llamadas responden
    // 403 y la pantalla acababa enseñando un error a quien solo tiene el
    // contrato — que no es que le falle nada, es que eso no es suyo.
    if (!avanzado) {
      setLoading(false);
      return () => { alive = false; };
    }
    const fp = currentFolderId ? `parentFolderId=${currentFolderId}` : "parentFolderId=null";
    const dp = currentFolderId ? `folderId=${currentFolderId}` : "folderId=null";
    Promise.all([
      fetch(`/api/documents/folders?visibility=${visibility}&${fp}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/documents?visibility=${visibility}&${dp}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/documents/quota`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ])
      .then(([f, d, q]) => {
        if (!alive) return;
        if (!f?.ok) throw new Error(f?.error || "Error cargando carpetas");
        setFolders(f.data.folders ?? []);
        setDocuments(d?.ok ? d.data.documents ?? [] : []);
        setQuota(q?.ok ? q.data : null);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [visibility, currentFolderId, reloadKey, avanzado]);

  const canManage = (row) => me && row.ownerUserId === me.id;

  function switchVisibility(v) {
    setVisibility(v);
    setPath([]);
    setShowNewFolder(false);
    setActionError(null);
  }
  function openFolder(f) {
    setPath((p) => [...p, { id: f.id, name: f.name, level: f.level }]);
    setActionError(null);
  }
  function goToCrumb(i) {
    setPath((p) => p.slice(0, i));
    setActionError(null);
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setActionError(null);
    try {
      const r = await fetch("/api/documents/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, visibility, parentFolderId: currentFolderId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error creando carpeta");
      setShowNewFolder(false);
      setNewFolderName("");
      refresh();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function saveRename(id) {
    const name = renameValue.trim();
    if (!name) return;
    setActionError(null);
    try {
      const r = await fetch(`/api/documents/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error renombrando");
      setRenamingId(null);
      refresh();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function deleteFolder(f) {
    if (!confirm(`¿Eliminar la carpeta «${f.name}» y todo su contenido?`)) return;
    setActionError(null);
    try {
      const r = await fetch(`/api/documents/folders/${f.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo eliminar");
      }
      refresh();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function deleteDoc(doc) {
    if (!confirm(`¿Eliminar «${doc.fileName}»?`)) return;
    setActionError(null);
    try {
      const r = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo eliminar");
      }
      refresh();
    } catch (e) {
      setActionError(e.message);
    }
  }

  const pct = quota?.usedPercent ?? 0;
  const quotaColor = pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  const empty = !loading && folders.length === 0 && documents.length === 0;

  const enRaiz = path.length === 0;
  const docsVisibles = enRaiz ? documents.slice(0, DOCS_EN_PORTADA) : documents;

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      {/* Header + cuota */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <div className="eyebrow">Empresa · Documentos</div>
          <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1">
            Documentos
            {avanzado && (
              <HelpTooltip title="Qué hay en Compartidos" className="ml-2">
                Aquí no está solo lo que sube el equipo en esta pantalla: también aparecen los
                archivos que se adjuntan en las fichas y los que llegan desde el área privada.{" "}
                <strong className="text-white">
                  Si borras uno, desaparece a la vez de su ficha y del área privada, y no hay
                  papelera.
                </strong>
              </HelpTooltip>
            )}
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {avanzado
              ? "Tus documentos privados y las carpetas compartidas del equipo."
              : "El contrato que firman las familias en su área privada."}
          </p>
        </div>
        {quota && (
          <div className="w-full lg:w-64">
            <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1">
              <span>Almacenamiento</span>
              <span>
                {quota.usedMB} / {quota.limitMB} MB
              </span>
            </div>
            <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
              <div className={`h-full ${quotaColor} transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* El contrato del centro: lo ve cualquiera que tenga Documentos, básico
          o avanzado. Es lo ÚNICO que ve quien solo tiene el básico. */}
      <ContratoServiciosCard isAdmin={me?.role === "admin" || me?.role === "superadmin"} />

      {avanzado && (
      <>
      {/* Tabs private/shared */}
      <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5" role="tablist">
        {[
          { key: "private", label: "Privados" },
          { key: "shared", label: "Compartidos" },
        ].map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={visibility === t.key}
            onClick={() => switchVisibility(t.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
              visibility === t.key ? "bg-neutral-800 text-white" : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Breadcrumb + nueva carpeta */}
      <div className="flex items-center justify-between gap-3">
        <nav className="flex items-center gap-1 text-sm text-neutral-500 flex-wrap min-w-0">
          <button onClick={() => goToCrumb(0)} className="hover:text-neutral-800 truncate">
            {visibility === "private" ? "Mis documentos" : "Compartido"}
          </button>
          {path.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1 min-w-0">
              <span className="text-neutral-300">/</span>
              <button
                onClick={() => goToCrumb(i + 1)}
                className={`truncate ${i === path.length - 1 ? "text-neutral-800 font-medium" : "hover:text-neutral-800"}`}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          {enRaiz && (
            <Link
              href={`/documentos/todos?visibilidad=${visibility}`}
              className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg px-3 py-1.5"
            >
              Ver todos
            </Link>
          )}
          {canCreateFolder && !showNewFolder && (
            <button
              onClick={() => {
                setShowNewFolder(true);
                setNewFolderName("");
              }}
              className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg px-3 py-1.5"
            >
              + Nueva carpeta
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">{actionError}</div>
      )}

      {/* Form nueva carpeta */}
      {showNewFolder && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createFolder();
              if (e.key === "Escape") setShowNewFolder(false);
            }}
            maxLength={255}
            placeholder="Nombre de la carpeta"
            className="flex-1 rounded-md px-3 py-1.5 text-sm bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
          />
          <button
            onClick={createFolder}
            disabled={!newFolderName.trim()}
            className="px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            Crear
          </button>
          <button onClick={() => setShowNewFolder(false)} className="px-3 py-1.5 rounded-md text-xs text-neutral-500 hover:bg-white">
            Cancelar
          </button>
        </div>
      )}

      {/* Upload */}
      <UploadDropzone folderId={currentFolderId} visibility={visibility} onUploaded={refresh} disabled={loading} />

      {error && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">{error}</div>}

      {/* Carpetas */}
      {folders.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {folders.map((f) => (
            <div
              key={f.id}
              className="group flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 hover:border-neutral-300 transition-colors"
            >
              {renamingId === f.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename(f.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => saveRename(f.id)}
                  maxLength={255}
                  className="flex-1 rounded-md px-2 py-1 text-sm border border-neutral-300 focus:outline-none"
                />
              ) : (
                <button onClick={() => openFolder(f)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5 text-amber-500 shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  <span className="min-w-0">
                    <span className="block text-sm text-neutral-800 font-medium truncate">{f.name}</span>
                    <span className="block text-[11px] text-neutral-400">
                      {f.subfolderCount} carpetas · {f.documentCount} archivos
                      {visibility === "shared" && f.ownerName ? ` · ${f.ownerName}` : ""}
                      {/* Con quién la comparte su dueño, o que a mí me la han
                          pasado: dos cosas distintas y se dicen distinto. */}
                      {f.compartidaConmigo
                        ? " · te la han compartido"
                        : f.sharedWith > 0
                        ? ` · compartida con ${f.sharedWith}`
                        : ""}
                    </span>
                  </span>
                </button>
              )}
              {canManage(f) && renamingId !== f.id && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {/* Quién la ve (01/09/2026, Rodrigo). Solo en las privadas:
                      una carpeta compartida con todo el centro ya la ve todo
                      el mundo, y el endpoint lo rechaza con esas palabras. */}
                  {f.visibility !== "shared" && (
                    <button
                      title="Quién ve esta carpeta"
                      onClick={() => setCompartiendo(f)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.5a4.2 4.2 0 018-1.8M4 19v-1.5A3.5 3.5 0 017.5 14h1M8 7.5a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0zM15 20h5m-2.5-2.5v5" />
                      </svg>
                    </button>
                  )}
                  <button
                    title="Renombrar"
                    onClick={() => {
                      setRenamingId(f.id);
                      setRenameValue(f.name);
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </button>
                  <button
                    title="Eliminar"
                    onClick={() => deleteFolder(f)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0v12a2 2 0 01-2 2H8a2 2 0 01-2-2V7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Documentos (en la raíz, solo los primeros; el resto en /documentos/todos) */}
      {documents.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
          {docsVisibles.map((doc) => (
            <div key={doc.id} className="group flex items-center gap-3 px-3 py-2.5">
              <FileTypeIcon mimeType={doc.mimeType} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-neutral-800 font-medium truncate">{doc.fileName}</div>
                <div className="text-[11px] text-neutral-400">
                  {fmtSize(doc.fileSize)} · {fmtDate(doc.createdAt)}
                  {visibility === "shared" && doc.ownerName ? ` · ${doc.ownerName}` : ""}
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
                {/* Pedir que lo lea alguien del equipo (01/09/2026, Rodrigo):
                    la puerta del archivo al mismo aviso que se elige al subir
                    un documento desde un bloqueo de la agenda. */}
                <button
                  onClick={() => setPidiendoLectura(doc)}
                  title="Pedir lectura al equipo"
                  className="w-8 h-8 flex items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.5a4.2 4.2 0 018-1.8M4 19v-1.5A3.5 3.5 0 017.5 14h1M8 7.5a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0zM14 20l2 2 4-4.5" />
                  </svg>
                </button>
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
          {enRaiz && documents.length > DOCS_EN_PORTADA && (
            <Link
              href={`/documentos/todos?visibilidad=${visibility}`}
              className="block px-3 py-2.5 text-center text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 transition-colors"
            >
              Ver todos los documentos ({documents.length - DOCS_EN_PORTADA} más)
            </Link>
          )}
        </div>
      )}

      {loading && <div className="text-xs text-neutral-400 py-4">Cargando…</div>}
      {empty && (
        <div className="text-center py-10 text-sm text-neutral-400">
          Esta carpeta está vacía. Sube archivos o crea una carpeta.
        </div>
      )}

      <PdfPreviewModal doc={preview} onClose={() => setPreview(null)} />
      {pidiendoLectura && (
        <PedirLecturaModal doc={pidiendoLectura} onClose={() => setPidiendoLectura(null)} onSaved={refresh} />
      )}
      {compartiendo && (
        <CompartirCarpetaModal carpeta={compartiendo} onClose={() => setCompartiendo(null)} onSaved={refresh} />
      )}
      </>
      )}
    </div>
  );
}

"use client";

/**
 * MiEquipo — mini-módulo de Equipo para perfiles NO admin (p.ej. terapeutas).
 * Su pantalla: (1) sus datos personales, (2) su documentación general con botón
 * de subir, y (3) accesos a Incidencias y Bandeja de trabajo (que también salen
 * como sub-entradas de Equipo en el sidebar). La gestión completa del equipo
 * (alta, retribución, ranking...) es solo para admin y vive en la otra rama.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const STATUS_LABELS = { active: "Activo", inactive: "Inactivo", on_leave: "De baja" };

function initials(name) {
  if (!name) return "??";
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}
function fmtBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return String(d); }
}

function Dato({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-0.5">{label}</div>
      <div className={`text-sm text-neutral-700 ${mono ? "font-mono" : ""}`}>{value || "—"}</div>
    </div>
  );
}

export default function MiEquipo({ modulos = null }) {
  const [member, setMember] = useState(undefined); // undefined=cargando · null=sin ficha
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    fetch("/api/team/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setMember(j.ok ? j.data.member : null))
      .catch(() => setMember(null));
  }, []);

  function loadDocs() {
    setDocsLoading(true);
    fetch("/api/team/me/documents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setDocs(j?.data?.documents ?? []))
      .catch(() => {})
      .finally(() => setDocsLoading(false));
  }
  useEffect(() => { loadDocs(); }, []);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ""; // permite resubir el mismo nombre
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/team/me/documents", { method: "POST", body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "No se pudo subir el documento");
      }
      loadDocs();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeDoc(id) {
    if (!window.confirm("¿Eliminar este documento?")) return;
    try {
      const r = await fetch(`/api/team/me/documents/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      setDocs((d) => d.filter((x) => x.id !== id));
    } catch {
      setErr("No se pudo eliminar");
    }
  }

  // Las dos tarjetas del final (Incidencias y Bandeja de trabajo) llevaban a
  // /equipo/* sin comprobar nada. Quien no tiene Clínica ni Equipo avanzado las
  // veía igual, pulsaba, y lo único que le llegaba era la banda roja del 403 de
  // /api/clinica/{incidencias,bandeja}. Lo sufre cualquier usuario no admin de
  // una consulta sin Clínica —hoy nutri_laura, que tiene Equipo y no Clínica—, y
  // esta pantalla es justamente la que ven los que no son admin.
  //
  // Se pide EXACTAMENTE lo que piden esos dos endpoints (`team_avanzado` y, o
  // bien `clinica`, o bien `pacientes`) y ni un módulo más. Con eso, la tarjeta
  // solo se cae donde ya estaba muerta: a quien hoy la usa no se le quita nada.
  // El sidebar es un pelo más estricto (exige `clinica` a secas) y no se toca:
  // apretar aquí para igualarlo sí podría quitarle una pantalla a alguien.
  //
  // `modulos` viene de /api/auth/me, que es el cruce de los módulos del tenant
  // con el acceso del usuario — la misma cuenta que hace `hasModule()` en el
  // servidor. Si algún día alguien monta este componente sin pasarlo, no se
  // esconde nada: enseñar un enlace de más es menos grave que dejar sin su
  // trabajo a quien sí lo tiene, y el endpoint sigue siendo la puerta de verdad.
  const tieneModulo = (clave) => !Array.isArray(modulos) || modulos.includes(clave);
  const verAccesosDeEquipoAvanzado =
    tieneModulo("team_avanzado") && (tieneModulo("clinica") || tieneModulo("pacientes"));

  return (
    <div className={anchoPantalla("listado")}>
      <div className="mb-6">
        <div className="eyebrow">Mi espacio</div>
        <h1 className="font-display text-2xl lg:text-4xl text-neutral-900 tracking-tight mt-1">Equipo</h1>
        <p className="text-xs text-neutral-400 mt-1">Tus datos, tu documentación y tus accesos del día a día.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Datos personales */}
        <div className="lg:col-span-2 bg-white border border-neutral-100 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-neutral-800 mb-4">Mis datos</h2>
          {member === undefined ? (
            <p className="text-[12px] text-neutral-400">Cargando…</p>
          ) : member === null ? (
            <p className="text-[13px] text-neutral-500">Tu usuario aún no tiene ficha de equipo. Pídeselo a administración.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full border border-neutral-200 flex items-center justify-center text-[15px] font-semibold text-white shrink-0 overflow-hidden"
                  style={{ backgroundColor: member.avatarColor || "var(--color-primary,#1B3A2D)" }}
                >
                  {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="w-full h-full object-cover" /> : initials(member.displayName)}
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-neutral-900 truncate">{member.displayName}</div>
                  <div className="text-[12px] text-neutral-500">{member.position || member.department || STATUS_LABELS[member.status] || ""}</div>
                </div>
              </div>
              <Dato label="Email" value={member.email} mono />
              <Dato label="Teléfono" value={member.phone} mono />
              <Dato label="Departamento" value={member.department} />
              <Dato label="Fecha de incorporación" value={fmtDate(member.hiredAt)} />
              <Link href="/mi-horario" className="inline-flex items-center gap-1 text-[12px] font-medium mt-1" style={{ color: "var(--color-primary,#1B3A2D)" }}>
                Ver y editar mi horario →
              </Link>
            </div>
          )}
        </div>

        {/* Documentación */}
        <div className="lg:col-span-3 bg-white border border-neutral-100 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4 gap-2">
            <h2 className="text-sm font-semibold text-neutral-800">Mi documentación</h2>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-[12px] font-medium px-3 py-1.5 rounded-md text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}
            >
              {uploading ? "Subiendo…" : "+ Subir documento"}
            </button>
            <input ref={fileRef} type="file" className="hidden" onChange={onUpload} />
          </div>
          {err && <p className="text-[12px] text-rose-600 mb-3">{err}</p>}
          {docsLoading ? (
            <p className="text-[12px] text-neutral-400">Cargando…</p>
          ) : docs.length === 0 ? (
            <p className="text-[12px] text-neutral-400">Aún no has subido ningún documento. Usa “Subir documento” para añadir tu CV, titulaciones, etc.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-lg overflow-hidden">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-neutral-400 shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <a href={`/api/team/me/documents/${d.id}`} className="text-[13px] text-neutral-800 hover:underline truncate block">{d.fileName}</a>
                    <span className="text-[11px] text-neutral-400">{fmtBytes(d.fileSize)}</span>
                  </div>
                  <button onClick={() => removeDoc(d.id)} className="text-neutral-300 hover:text-rose-600 shrink-0 p-1" title="Eliminar" aria-label="Eliminar documento">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Accesos: Incidencias + Bandeja de trabajo. Solo donde existen de
          verdad — el porqué, justo encima del `return`. */}
      {verAccesosDeEquipoAvanzado && (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
        <Link href="/equipo/incidencias" className="group bg-white border border-neutral-100 rounded-xl p-5 hover:border-[var(--color-primary,#1B3A2D)] hover:shadow-sm transition-all">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 text-white" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="font-display text-base text-neutral-900">Incidencias</div>
          <div className="text-xs text-neutral-500 mt-1 leading-relaxed">Registra y sigue las incidencias que te asignan.</div>
        </Link>
        <Link href="/equipo/bandeja" className="group bg-white border border-neutral-100 rounded-xl p-5 hover:border-[var(--color-primary,#1B3A2D)] hover:shadow-sm transition-all">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 text-white" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
            </svg>
          </div>
          <div className="font-display text-base text-neutral-900">Bandeja de trabajo</div>
          <div className="text-xs text-neutral-500 mt-1 leading-relaxed">Lo que tienes pendiente: informes, incidencias y citas de hoy.</div>
        </Link>
      </div>
      )}
    </div>
  );
}

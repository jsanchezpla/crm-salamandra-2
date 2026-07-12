"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import PreviewBanner from "../clinica/_components/PreviewBanner.jsx";

const STATUS_STYLES = {
  active: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  paused: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  discharged: { bg: "bg-neutral-100", text: "text-neutral-500", dot: "bg-neutral-400" },
};
const statusStyle = (s) => STATUS_STYLES[s] ?? STATUS_STYLES.discharged;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const EMPTY_FORM = { firstName: "", lastName: "", age: "", educationCenter: "", educationLevel: "", referralReason: "", mainTherapistId: "", status: "active" };

export default function PacientesPage() {
  const [patients, setPatients] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  const [search, setSearch] = useState("");
  const [therapistFilter, setTherapistFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = () => {
    setLoading(true);
    fetch("/api/pacientes", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "Error cargando pacientes");
        setPatients(j.data.patients ?? []);
      })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Terapeutas para el filtro y el alta (equipo del tenant).
    fetch("/api/team?status=active&limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.ok && setTherapists((j.data?.members ?? []).map((m) => ({ id: m.id, name: m.displayName }))))
      .catch(() => {});
  }, []);

  // Si el módulo team no está disponible, deriva terapeutas de los propios pacientes.
  const therapistOptions = useMemo(() => {
    const base = therapists.length
      ? therapists
      : [...new Map(patients.filter((p) => p.therapist).map((p) => [p.therapist.id, { id: p.therapist.id, name: p.therapist.name }])).values()];
    return base;
  }, [therapists, patients]);

  const filtered = patients.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (therapistFilter !== "all" && p.mainTherapistId !== therapistFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  const kpis = [
    { label: "Pacientes activos", value: patients.filter((p) => p.status === "active").length, sub: `${patients.length} en seguimiento` },
    { label: "En pausa", value: patients.filter((p) => p.status === "paused").length, sub: "Revisar continuidad" },
    { label: "Altas", value: patients.filter((p) => p.status === "discharged").length, sub: "Este periodo" },
    { label: "Sesiones registradas", value: patients.reduce((s, p) => s + (p.sessionsCount ?? 0), 0), sub: "Total del centro" },
  ];

  const submitCreate = async (e) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setFormError("Nombre y apellidos son obligatorios");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = { ...form, age: form.age ? Number(form.age) : null, mainTherapistId: form.mainTherapistId || null };
      const r = await fetch("/api/pacientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e2) {
      setFormError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400";

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">Pacientes</h1>
          <p className="text-xs text-neutral-400 mt-1">Pacientes del centro · {patients.length} en seguimiento</p>
        </div>
        <button
          onClick={() => {
            setForm(EMPTY_FORM);
            setFormError(null);
            setShowCreate(true);
          }}
          className="self-start lg:self-auto text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nuevo paciente
        </button>
      </div>

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white border border-neutral-100 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">{k.label}</div>
            <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{loading ? "—" : k.value}</div>
            <div className="text-[11px] text-neutral-500 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-neutral-100 rounded-xl p-3 flex flex-col lg:flex-row gap-2">
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400"
          />
        </div>
        <Select
          value={therapistFilter}
          onChange={(v) => setTherapistFilter(v)}
          options={[{ value: "all", label: "Todas las terapeutas" }, ...therapistOptions.map((t) => ({ value: t.id, label: t.name }))]}
          className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
        />
        <Select
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          options={[
            { value: "all", label: "Todos los estados" },
            { value: "active", label: "Activo" },
            { value: "paused", label: "En pausa" },
            { value: "discharged", label: "Alta" },
          ]}
          className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
        />
      </div>

      {/* Tabla */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50/50">
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Centro / curso</th>
                <th className="px-4 py-3 font-medium">Motivo</th>
                <th className="px-4 py-3 font-medium">Terapeuta</th>
                <th className="px-4 py-3 font-medium">Última sesión</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-400 text-xs">Cargando…</td>
                </tr>
              )}
              {!loading &&
                filtered.map((p) => {
                  const t = p.therapist ?? { name: "—", initials: "?", color: "#666" };
                  const s = statusStyle(p.status);
                  return (
                    <tr key={p.id} className="border-t border-neutral-100 hover:bg-neutral-50/40">
                      <td className="px-4 py-3">
                        <Link href={`/pacientes/${p.id}`} className="flex items-center gap-2.5 group">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-display shrink-0" style={{ backgroundColor: p.color }}>
                            {p.initials}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[var(--ink-900)] font-medium leading-tight group-hover:underline">{p.firstName} {p.lastName}</div>
                            <div className="text-[10px] text-neutral-400">{p.age != null ? `${p.age} años` : "—"}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-neutral-700 truncate max-w-[180px]">{p.educationCenter ?? "—"}</div>
                        <div className="text-[10px] text-neutral-400">{p.educationLevel ?? ""}</div>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="text-neutral-600 truncate" title={p.referralReason ?? ""}>{p.referralReason ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-1.5 bg-neutral-50 border border-neutral-100 rounded-full px-2 py-0.5">
                          <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-white text-[7px] font-display" style={{ backgroundColor: t.color }}>{t.initials}</div>
                          <span className="text-[11px] text-neutral-700">{t.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular text-neutral-600">{fmtDate(p.lastSession)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 ${s.bg} ${s.text} text-[10px] font-medium px-2 py-0.5 rounded-full`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                          {p.statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link href={`/pacientes/${p.id}`} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">Ver ficha</Link>
                      </td>
                    </tr>
                  );
                })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-400 text-xs">
                    {patients.length === 0 ? "Aún no hay pacientes. Crea el primero con «Nuevo paciente»." : "Sin resultados para esos filtros."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal alta de paciente */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl text-[var(--ink-900)] mb-3">Nuevo paciente</h3>
            <form onSubmit={submitCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input className={inputCls} placeholder="Nombre *" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} maxLength={120} />
                <input className={inputCls} placeholder="Apellidos *" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} maxLength={120} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className={inputCls} type="number" min={0} max={120} placeholder="Edad" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
                <input className={inputCls} placeholder="Curso (ej. 3º Primaria)" value={form.educationLevel} onChange={(e) => setForm({ ...form, educationLevel: e.target.value })} />
              </div>
              <input className={inputCls} placeholder="Centro escolar" value={form.educationCenter} onChange={(e) => setForm({ ...form, educationCenter: e.target.value })} />
              <textarea className={inputCls} rows={3} placeholder="Motivo de derivación" value={form.referralReason} onChange={(e) => setForm({ ...form, referralReason: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <Select
                  value={form.mainTherapistId}
                  onChange={(v) => setForm({ ...form, mainTherapistId: v })}
                  options={[{ value: "", label: "— Terapeuta —" }, ...therapistOptions.map((t) => ({ value: t.id, label: t.name }))]}
                  className={inputCls}
                />
                <Select
                  value={form.status}
                  onChange={(v) => setForm({ ...form, status: v })}
                  options={[{ value: "active", label: "Activo" }, { value: "paused", label: "En pausa" }, { value: "discharged", label: "Alta" }]}
                  className={inputCls}
                />
              </div>
              {formError && <p className="text-xs text-rose-600">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} disabled={saving} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Creando…" : "Crear paciente"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

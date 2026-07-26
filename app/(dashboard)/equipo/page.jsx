"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import EmployeeBillingSection from "../../../components/billing/EmployeeBillingSection.jsx";
import Select from "@/components/ui/Select.jsx";
import SpecialtyPicker from "@/components/clinica/SpecialtyPicker.jsx";
import TeamHoursEditor from "@/components/team/TeamHoursEditor.jsx";

const STATUS_LABELS = { active: "Activo", inactive: "Inactivo", on_leave: "De baja" };
const STATUS_FILTER_OPTIONS = [
  { value: "default", label: "Activos + de baja" },
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
  { value: "on_leave", label: "De baja" },
  { value: "all", label: "Todos" },
];

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

function fmtMoney(n, currency = "EUR") {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function initials(name) {
  if (!name) return "??";
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

const EMPTY_FORM = {
  displayName: "", email: "", role: "", department: "",
  phone: "", hourlyRate: "", hourlyCost: "",
  annualGross: "", paymentPeriods: 12,
  currency: "EUR", startDate: "", notes: "", status: "active",
  specialties: [],
};

// Mensual = bruto anual / pagas (mismo cálculo que el backend).
function computeMonthly(annualGross, paymentPeriods) {
  const ag = Number(annualGross);
  const pp = Number(paymentPeriods) || 12;
  if (!annualGross && annualGross !== 0) return null;
  if (!Number.isFinite(ag) || ag < 0) return null;
  return Math.round((ag / pp) * 100) / 100;
}

function StatusBadge({ value }) {
  const cls =
    value === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : value === "on_leave" ? "bg-amber-50 text-amber-700 border-amber-100"
    : "bg-neutral-100 text-neutral-500 border-neutral-200";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {STATUS_LABELS[value] ?? value}
    </span>
  );
}

export default function EquipoPage() {
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("default");
  const [filterRole, setFilterRole] = useState("");

  const [openMember, setOpenMember] = useState(null);    // member abierto en el panel (modo detalle/edición)
  const [showCreate, setShowCreate] = useState(false);   // panel de alta
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Debounce para búsqueda
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Cargar /api/auth/me al montar
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setMe(j.data); })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      params.set("status", filterStatus);
      if (filterRole) params.set("role", filterRole);
      if (search) params.set("q", search);
      const res = await fetch(`/api/team?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setMembers(json.data?.members ?? []);
      setAvailableRoles(json.data?.availableRoles ?? []);
      setViewerIsAdmin(!!json.data?.viewerIsAdmin);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterRole, search]);

  useEffect(() => { load(); }, [load]);

  const total = members.length;
  const inactivos = useMemo(() => members.filter((m) => m.status === "inactive").length, [members]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditing(false);
  }
  function closePanel() {
    setOpenMember(null);
    setShowCreate(false);
    resetForm();
  }
  function openCreate() {
    setOpenMember(null);
    setForm(EMPTY_FORM);
    setEditing(true);
    setShowCreate(true);
    setFormError(null);
  }
  function openDetail(member) {
    setShowCreate(false);
    setOpenMember(member);
    setEditing(false);
    setFormError(null);
  }
  function startEdit() {
    if (!openMember) return;
    setForm({
      displayName: openMember.displayName ?? "",
      email: openMember.email ?? "",
      role: openMember.role ?? "",
      department: openMember.department ?? "",
      phone: openMember.phone ?? "",
      hourlyRate: openMember.hourlyRate ?? "",
      hourlyCost: openMember.hourlyCost ?? "",
      annualGross: openMember.annualGross ?? "",
      paymentPeriods: openMember.paymentPeriods ?? 12,
      currency: openMember.currency ?? "EUR",
      startDate: openMember.startDate ?? "",
      notes: openMember.notes ?? "",
      status: openMember.status ?? "active",
      specialties: openMember.specialties ?? [],
    });
    setEditing(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        ...form,
        hourlyRate: form.hourlyRate === "" ? null : Number(form.hourlyRate),
        hourlyCost: form.hourlyCost === "" ? null : Number(form.hourlyCost),
        // monthlySalary lo calcula el backend a partir de estos dos.
        annualGross: form.annualGross === "" ? null : Number(form.annualGross),
        paymentPeriods: Number(form.paymentPeriods) || 12,
      };
      // Solo admin puede tocar campos sensibles. Si por algún motivo el form
      // se enviara desde un viewer no-admin, omitimos los campos del payload.
      if (!viewerIsAdmin) {
        delete payload.hourlyCost;
        delete payload.annualGross;
        delete payload.paymentPeriods;
      }
      const url = openMember ? `/api/team/${openMember.id}` : "/api/team";
      const method = openMember ? "PATCH" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");

      if (openMember) {
        setOpenMember(json.data);
        setEditing(false);
      } else {
        closePanel();
      }
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!openMember) return;
    if (!confirm(`¿Desactivar a ${openMember.displayName}? El histórico se conserva.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/team/${openMember.id}`, { method: "DELETE" });
      if (res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "No se pudo desactivar");
      }
      closePanel();
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Recursos Humanos</div>
          <h1 className="font-display text-2xl text-neutral-900 mt-1">Equipo</h1>
          <p className="text-xs text-neutral-400 mt-1">
            {total} miembro{total === 1 ? "" : "s"} · {inactivos} inactivo{inactivos === 1 ? "" : "s"}
          </p>
        </div>
        {viewerIsAdmin && (
          <button
            onClick={openCreate}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white transition-opacity self-start sm:self-auto"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            + Añadir empleado
          </button>
        )}
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por nombre o email..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <Select
          value={filterStatus}
          onChange={(v) => setFilterStatus(v)}
          options={STATUS_FILTER_OPTIONS}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
        />
        <Select
          value={filterRole}
          onChange={(v) => setFilterRole(v)}
          options={[{ value: "", label: "Todos los roles" }, ...availableRoles.map((r) => ({ value: r, label: r }))]}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
        />
        {(search || filterRole || filterStatus !== "default") && (
          <button
            onClick={() => { setSearchInput(""); setFilterRole(""); setFilterStatus("default"); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors"
          >
            Limpiar
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Empleado</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Rol</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Departamento</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Email</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Estado</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Tarifa/h</th>
                {viewerIsAdmin && (
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Coste/h</th>
                )}
                {viewerIsAdmin && (
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Salario/mes</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading && members.length === 0 && (
                <tr><td colSpan={viewerIsAdmin ? 8 : 6} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && members.length === 0 && (
                <tr><td colSpan={viewerIsAdmin ? 8 : 6} className="text-center py-12 text-xs text-neutral-400">Sin resultados</td></tr>
              )}
              {members.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => openDetail(m)}
                  className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 shrink-0 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-[11px] font-semibold text-neutral-500">
                        {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" /> : initials(m.displayName)}
                      </div>
                      <div>
                        <div className="font-medium text-neutral-800">{m.displayName}</div>
                        {m.phone && <div className="text-[11px] text-neutral-400 font-mono">{m.phone}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-600">{m.role ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{m.department ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500 font-mono">{m.email ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge value={m.status} /></td>
                  <td className="px-4 py-3 text-right text-neutral-700 tabular">{fmtMoney(m.hourlyRate, m.currency)}</td>
                  {viewerIsAdmin && (
                    <td className="px-4 py-3 text-right text-neutral-500 tabular">{fmtMoney(m.hourlyCost, m.currency)}</td>
                  )}
                  {viewerIsAdmin && (
                    <td className="px-4 py-3 text-right text-neutral-500 tabular">{fmtMoney(m.monthlySalary, m.currency)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel lateral */}
      {(openMember || showCreate) && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closePanel} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="eyebrow">{showCreate ? "Nuevo" : "Detalle"}</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1 truncate">
                  {showCreate ? "Añadir empleado" : openMember?.displayName}
                </h2>
                {openMember && !showCreate && (
                  <div className="flex items-center gap-2 mt-2">
                    <StatusBadge value={openMember.status} />
                    {openMember.role && <span className="text-xs text-neutral-500">{openMember.role}</span>}
                  </div>
                )}
              </div>
              <button onClick={closePanel} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1" aria-label="Cerrar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5">
              {!editing && openMember && (
                <div className="space-y-4">
                  <DetailRow label="Email" value={openMember.email} mono />
                  <DetailRow label="Teléfono" value={openMember.phone} mono />
                  <DetailRow label="Departamento" value={openMember.department} />
                  <DetailRow label="Fecha de incorporación" value={openMember.startDate} />
                  <DetailRow label="Tarifa por hora" value={fmtMoney(openMember.hourlyRate, openMember.currency)} />
                  {viewerIsAdmin && (
                    <DetailRow label="Coste por hora" value={fmtMoney(openMember.hourlyCost, openMember.currency)} />
                  )}
                  {viewerIsAdmin && (
                    <div className="grid grid-cols-3 gap-3">
                      <DetailRow label="Bruto anual" value={fmtMoney(openMember.annualGross, openMember.currency)} />
                      <DetailRow label="Pagas" value={openMember.paymentPeriods ?? 12} />
                      <DetailRow label="Salario mensual" value={fmtMoney(openMember.monthlySalary, openMember.currency)} />
                    </div>
                  )}
                  {openMember.notes && (
                    <div>
                      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1">Notas</div>
                      <p className="text-sm text-neutral-700 whitespace-pre-wrap">{openMember.notes}</p>
                    </div>
                  )}

                  <EmployeeBillingSection employeeId={openMember.id} isAdmin={viewerIsAdmin} />

                  {viewerIsAdmin && <ModulesSection memberId={openMember.id} />}

                  <div className="pt-2">
                    <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">Horario de trabajo</div>
                    <TeamHoursEditor
                      memberId={openMember.id}
                      canEdit={viewerIsAdmin || !!(me?.id && openMember?.userId && me.id === openMember.userId)}
                    />
                  </div>

                  {viewerIsAdmin && (
                    <div className="flex flex-wrap gap-2 pt-4 border-t border-neutral-100">
                      <button onClick={startEdit}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-white"
                        style={{ background: "var(--color-primary, #1B3A2D)" }}>
                        Editar
                      </button>
                      {openMember.status !== "inactive" && (
                        <button onClick={handleDeactivate} disabled={saving}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40">
                          {saving ? "..." : "Desactivar"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {editing && (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <FormRow label="Nombre completo *">
                    <input required value={form.displayName}
                      onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                      className={inputCls} />
                  </FormRow>
                  <FormRow label="Email">
                    <input type="email" value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className={inputCls} placeholder="nombre@dominio.com" />
                  </FormRow>
                  <div className="grid grid-cols-2 gap-3">
                    <FormRow label="Rol">
                      <input value={form.role}
                        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                        className={inputCls} placeholder="Empleado Senior" />
                    </FormRow>
                    <FormRow label="Departamento">
                      <input value={form.department}
                        onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                        className={inputCls} />
                    </FormRow>
                  </div>
                  {/* Rol clínico: solo relevante si atiende pacientes (módulo
                      Clínica o Nutrición). Se puede dejar vacío para el resto. */}
                  <SpecialtyPicker
                    label="Especialidad clínica (si atiende pacientes)"
                    value={form.specialties}
                    onChange={(v) => setForm((f) => ({ ...f, specialties: v }))}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormRow label="Teléfono">
                      <input value={form.phone}
                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        className={inputCls} />
                    </FormRow>
                    <FormRow label="Fecha de incorporación">
                      <input type="date" value={form.startDate}
                        onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                        className={inputCls} />
                    </FormRow>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FormRow label="Tarifa/h">
                      <input type="number" min="0" step="0.01" value={form.hourlyRate}
                        onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                        className={inputCls} placeholder="0.00" />
                    </FormRow>
                    {viewerIsAdmin && (
                      <FormRow label="Coste/h">
                        <input type="number" min="0" step="0.01" value={form.hourlyCost}
                          onChange={(e) => setForm((f) => ({ ...f, hourlyCost: e.target.value }))}
                          className={inputCls} placeholder="0.00" />
                      </FormRow>
                    )}
                    <FormRow label="Moneda">
                      <input maxLength={3} value={form.currency}
                        onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                        className={inputCls} />
                    </FormRow>
                  </div>
                  {viewerIsAdmin && (
                    <div className="rounded-lg border border-neutral-100 bg-neutral-50/60 p-3 space-y-3">
                      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Retribución</div>
                      <div className="grid grid-cols-2 gap-3">
                        <FormRow label="Bruto anual">
                          <input type="number" min="0" step="0.01" value={form.annualGross}
                            onChange={(e) => setForm((f) => ({ ...f, annualGross: e.target.value }))}
                            className={inputCls} placeholder={`0.00 ${form.currency || "EUR"}`} />
                        </FormRow>
                        <FormRow label="Pagas / año">
                          <div className="flex gap-2">
                            {[12, 14].map((p) => (
                              <button key={p} type="button"
                                onClick={() => setForm((f) => ({ ...f, paymentPeriods: p }))}
                                className={`flex-1 py-2 text-xs font-semibold rounded-lg border-2 transition ${
                                  Number(form.paymentPeriods) === p
                                    ? "text-white border-transparent"
                                    : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                                }`}
                                style={Number(form.paymentPeriods) === p ? { background: "var(--color-primary, #1B3A2D)", borderColor: "var(--color-primary, #1B3A2D)" } : {}}>
                                {p}
                              </button>
                            ))}
                          </div>
                        </FormRow>
                      </div>
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-neutral-200">
                        <span className="text-[11px] text-neutral-500">Salario mensual (calculado)</span>
                        <span className="text-sm font-semibold text-neutral-900 tabular-nums">
                          {fmtMoney(computeMonthly(form.annualGross, form.paymentPeriods), form.currency || "EUR")}
                        </span>
                      </div>
                      <p className="text-[10px] text-neutral-400">
                        Solo visible para administradores. El mensual se calcula (bruto ÷ pagas) y alimenta la analítica de empleados.
                      </p>
                    </div>
                  )}
                  <FormRow label="Estado">
                    <Select value={form.status}
                      onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                      options={[
                        { value: "active", label: "Activo" },
                        { value: "inactive", label: "Inactivo" },
                        // on_leave solo se muestra si ya viene de BD con ese estado
                        ...(form.status === "on_leave" || (openMember && openMember.status === "on_leave")
                          ? [{ value: "on_leave", label: "De baja" }]
                          : []),
                      ]}
                      className={inputCls} />
                  </FormRow>
                  <FormRow label="Notas">
                    <textarea rows={3} value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      className={inputCls + " resize-y"} />
                  </FormRow>

                  {formError && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>
                  )}

                  <div className="flex gap-2 justify-end pt-2 border-t border-neutral-100">
                    {openMember && (
                      <button type="button" onClick={() => setEditing(false)}
                        className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
                        Cancelar
                      </button>
                    )}
                    {!openMember && (
                      <button type="button" onClick={closePanel}
                        className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
                        Cancelar
                      </button>
                    )}
                    <button type="submit" disabled={saving}
                      className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
                      style={{ background: "var(--color-primary, #1B3A2D)" }}>
                      {saving ? "Guardando..." : openMember ? "Guardar cambios" : "Crear empleado"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-0.5">{label}</div>
      <div className={`text-sm text-neutral-700 ${mono ? "font-mono" : ""}`}>{value || "—"}</div>
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}

const MODULE_LABELS = {
  clients: "Clientes", leads: "Leads", outreach: "Captación", referidos: "Referidos",
  calendar: "Calendario", citas: "Citas", nutricion: "Nutrición", projects: "Proyectos",
  orders: "Pedidos", billing: "Facturación", documents: "Documentos", clinica: "Clínica",
  pacientes: "Pacientes", team: "Equipo", inventory: "Inventario", training: "Formación",
  cuestionarios: "Cuestionarios", support: "Soporte", planning: "Planificación",
  analytics: "Analítica", ai: "IA", automations: "Automatizaciones",
  integrations: "Integraciones", configuracion: "Configuración",
};
const moduleLabel = (key) => MODULE_LABELS[key] || key;

// Sección "Módulos con acceso" — asignación de módulos por miembro. Config
// informativa (SIN gate real este sprint). Autónoma: carga y guarda por su cuenta.
function ModulesSection({ memberId }) {
  const [modules, setModules] = useState(null); // [{ moduleKey, enabled }]
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setModules(null); setDirty(false); setErr(null);
    fetch(`/api/team/${memberId}/modules`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setModules(j.data.modules); else setErr(j.error || "Error"); })
      .catch(() => setErr("No se pudieron cargar los módulos"));
  }, [memberId]);

  function toggle(key) {
    setModules((prev) => prev.map((m) => (m.moduleKey === key ? { ...m, enabled: !m.enabled } : m)));
    setDirty(true);
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/team/${memberId}/modules`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setModules(j.data.modules); setDirty(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pt-4 border-t border-neutral-100">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Módulos con acceso</div>
        {dirty && (
          <button onClick={save} disabled={saving}
            className="text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            {saving ? "Guardando..." : "Guardar módulos"}
          </button>
        )}
      </div>
      {err && <div className="text-xs text-red-600 mb-2">{err}</div>}
      {modules == null ? (
        <div className="text-xs text-neutral-400">Cargando módulos...</div>
      ) : modules.length === 0 ? (
        <div className="text-xs text-neutral-400">El tenant no tiene módulos activos.</div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {modules.map((m) => (
            <label key={m.moduleKey} className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer py-0.5">
              <input type="checkbox" checked={m.enabled} onChange={() => toggle(m.moduleKey)}
                className="rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]" />
              {moduleLabel(m.moduleKey)}
            </label>
          ))}
        </div>
      )}
      <p className="text-[10px] text-neutral-400 mt-2">
        Config informativa por ahora: no bloquea el acceso al CRM (eso lo controla el usuario de login).
      </p>
    </div>
  );
}

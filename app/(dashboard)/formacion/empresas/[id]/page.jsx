"use client";

import { useState, useEffect, use, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TrainingTable, Tr, Td } from "../../../../../components/training/TrainingTable.jsx";
import { ActiveBadge } from "../../../../../components/training/TrainingBadge.jsx";
import CreateEmployeeDrawer from "../../../../../components/training/CreateEmployeeDrawer.jsx";
import ArchiveUserDialog from "../../../../../components/training/ArchiveUserDialog.jsx";
import HardDeleteUserDialog from "../../../../../components/training/HardDeleteUserDialog.jsx";
import { anchoPantalla } from "../../../../../components/layout/anchoPantalla.js";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

const TABS = [
  { id: "info", label: "Información" },
  { id: "empleados", label: "Empleados" },
  { id: "cursos", label: "Cursos" },
];

export default function EmpresaDetailPage({ params }) {
  const { id } = use(params);
  const router = useRouter();

  const [tab, setTab] = useState("info");
  const [company, setCompany] = useState(null);
  const [counters, setCounters] = useState({ activeCount: 0, pendingCount: 0, courseCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [empleadosReloadKey, setEmpleadosReloadKey] = useState(0);

  const loadCompany = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [compRes, listRes] = await Promise.all([
        fetch(`/api/training/companies/${id}`),
        fetch("/api/training/companies"),
      ]);
      const compJson = await compRes.json();
      const listJson = await listRes.json();
      if (!compRes.ok) throw new Error(compJson.error || "Empresa no encontrada");
      setCompany(compJson.data);
      if (listJson.ok) {
        const found = listJson.data.find((c) => c.id === id);
        if (found) {
          setCounters({
            activeCount: found.activeCount ?? found.userCount ?? 0,
            pendingCount: found.pendingCount ?? 0,
            courseCount: found.courseCount ?? 0,
          });
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadCompany(); }, [loadCompany]);

  if (loading) {
    return (
      <div className={anchoPantalla("ficha")}>
        <div className="h-8 w-48 bg-neutral-100 rounded animate-pulse mb-4" />
        <div className="h-32 bg-white border border-neutral-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className={anchoPantalla("ficha")}>
        <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
          {error || "Empresa no encontrada"}
        </div>
        <Link href="/formacion/empresas" className="mt-4 inline-block text-xs text-neutral-400 hover:text-neutral-700">
          ← Volver a empresas
        </Link>
      </div>
    );
  }

  return (
    <div className={anchoPantalla("ficha")}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-extrabold text-neutral-900 truncate" style={{ fontFamily: "'Syne', sans-serif" }}>
              {company.name}
            </h1>
            <ActiveBadge active={company.active} />
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            {company.externalId ? `ID externo #${company.externalId} · ` : ""}
            {counters.activeCount} activos · {counters.pendingCount} pendientes · {counters.courseCount} cursos
          </p>
        </div>
        <Link href="/formacion/empresas" className="shrink-0 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
          ← Volver
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-neutral-200">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-4 py-2.5 text-xs font-semibold transition-colors ${
                active ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700"
              }`}
            >
              {t.label}
              {active && (
                <span
                  className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full"
                  style={{ background: "var(--color-primary)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {tab === "info" && (
        <InfoTab
          company={company}
          counters={counters}
          onSaved={loadCompany}
          onDeleted={() => router.push("/formacion/empresas")}
        />
      )}

      {tab === "empleados" && (
        <EmpleadosTab
          companyId={id}
          onOpenImport={() => setImportOpen(true)}
          onOpenCreate={() => setCreateOpen(true)}
          reloadKey={empleadosReloadKey}
        />
      )}

      {tab === "cursos" && (
        <CursosTab
          companyId={id}
          assignedCourses={company.courses ?? []}
          activeEmployeesCount={counters.activeCount}
          onChange={loadCompany}
        />
      )}

      {importOpen && (
        <ImportDrawer
          companyId={id}
          companyName={company.name}
          onClose={() => setImportOpen(false)}
          onCompleted={() => { setImportOpen(false); loadCompany(); }}
        />
      )}

      {createOpen && (
        <CreateEmployeeDrawer
          companyId={id}
          companyName={company.name}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setEmpleadosReloadKey((k) => k + 1);
            loadCompany();
          }}
        />
      )}
    </div>
  );
}

// ───────────────────── Tab Información ─────────────────────────────────────

function InfoTab({ company, counters, onSaved, onDeleted }) {
  const [name, setName] = useState(company.name);
  const [externalId, setExternalId] = useState(company.externalId ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState("deactivate"); // "deactivate" | "reactivate"

  useEffect(() => {
    setName(company.name);
    setExternalId(company.externalId ?? "");
  }, [company.id, company.name, company.externalId]);

  const dirty = name.trim() !== company.name || String(externalId) !== String(company.externalId ?? "");

  async function handleSave(e) {
    e?.preventDefault();
    if (!dirty || !name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/training/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          externalId: externalId === "" ? null : externalId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al guardar");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      onSaved();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function askDeactivate() {
    setConfirmKind("deactivate");
    setConfirmOpen(true);
  }
  function askReactivate() {
    setConfirmKind("reactivate");
    setConfirmOpen(true);
  }

  async function performToggleActive() {
    setSaving(true);
    setSaveError(null);
    try {
      if (confirmKind === "deactivate") {
        const res = await fetch(`/api/training/companies/${company.id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "Error al desactivar");
        }
      } else {
        const res = await fetch(`/api/training/companies/${company.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: true }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al reactivar");
      }
      setConfirmOpen(false);
      onSaved();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* Datos editables */}
      <form
        onSubmit={handleSave}
        className="bg-white border border-neutral-100 rounded-xl p-5 space-y-4"
      >
        <div>
          <h2 className="text-sm font-bold text-neutral-700 mb-3" style={{ fontFamily: "'Syne', sans-serif" }}>
            Datos
          </h2>
          <Field label="Nombre">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
              required
            />
          </Field>
          <Field label="ID externo (Wordpress)">
            <input
              type="number"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
            />
          </Field>
        </div>

        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
        {savedFlash && <p className="text-xs text-emerald-600">Cambios guardados</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="submit"
            disabled={saving || !dirty || !name.trim()}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-primary)" }}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>

      {/* Estado */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5">
        <h2 className="text-sm font-bold text-neutral-700 mb-3" style={{ fontFamily: "'Syne', sans-serif" }}>
          Estado
        </h2>

        <div className="flex items-center justify-between py-2">
          <span className="text-xs text-neutral-500">Estado actual</span>
          <ActiveBadge active={company.active} />
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-xs text-neutral-500">Empleados activos</span>
          <span className="text-xs font-semibold text-neutral-700">{counters.activeCount}</span>
        </div>
        <div className="flex items-center justify-between py-2 border-b border-neutral-100">
          <span className="text-xs text-neutral-500">Empleados pendientes</span>
          <span className="text-xs font-semibold text-neutral-700">{counters.pendingCount}</span>
        </div>

        <p className="text-[11px] text-neutral-400 mt-3 leading-relaxed">
          {company.active
            ? "Una empresa inactiva no permite a empleados pre-aprobados activarse vía registro web. Los ya activos siguen accediendo a sus cursos."
            : "Reactivar la empresa permite que los empleados pre-aprobados completen su registro y acceso al campus."}
        </p>

        <div className="flex justify-end pt-3">
          {company.active ? (
            <button
              type="button"
              onClick={askDeactivate}
              className="px-4 py-2 rounded-lg text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
            >
              Desactivar empresa
            </button>
          ) : (
            <button
              type="button"
              onClick={askReactivate}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
              style={{ background: "var(--color-primary)" }}
            >
              Reactivar empresa
            </button>
          )}
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          kind={confirmKind}
          activeCount={counters.activeCount}
          pendingCount={counters.pendingCount}
          loading={saving}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={performToggleActive}
        />
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3 last:mb-0">
      <span className="block text-[11px] font-medium text-neutral-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function ConfirmDialog({ kind, activeCount, pendingCount, loading, onCancel, onConfirm }) {
  const isDeactivate = kind === "deactivate";
  const showCounters = isDeactivate && (activeCount + pendingCount) > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-base font-bold text-neutral-900 mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
          {isDeactivate ? "Desactivar empresa" : "Reactivar empresa"}
        </h2>
        {isDeactivate ? (
          <div className="space-y-3 text-xs text-neutral-600 leading-relaxed">
            {showCounters && (
              <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 space-y-1">
                <p>
                  <span className="font-semibold text-amber-800">{activeCount}</span> empleados activos
                  · <span className="font-semibold text-amber-800">{pendingCount}</span> pre-aprobados
                </p>
              </div>
            )}
            <p>
              Los empleados <strong>activos</strong> podrán seguir accediendo a sus cursos sin cambios.
            </p>
            <p>
              Los empleados <strong>pre-aprobados</strong> no podrán registrarse en el campus hasta que vuelvas a activar la empresa.
            </p>
          </div>
        ) : (
          <p className="text-xs text-neutral-600 leading-relaxed">
            Los empleados pre-aprobados volverán a poder completar su registro a través del formulario web del campus.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-50 ${isDeactivate ? "" : "hover:opacity-80"}`}
            style={{ background: isDeactivate ? "#DC2626" : "var(--color-primary)" }}
          >
            {loading ? "…" : isDeactivate ? "Sí, desactivar" : "Sí, reactivar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────── Tab Empleados ───────────────────────────────────────

function EmpleadosTab({ companyId, onOpenImport, onOpenCreate, reloadKey = 0 }) {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 4 filtros: todos (no archivados), activos, pendientes (no archivados),
  // archivados. Cuando el filtro es "archived" la query envía
  // ?archivedOnly=true; el resto envían el listado por defecto
  // (archivedAt IS NULL).
  const [filter, setFilter] = useState("all"); // all | active | pending | archived
  const [search, setSearch] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [flash, setFlash] = useState(null);

  // Dialogs de borrado
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        companyId,
        type: "company",
        limit: "200",
      });
      if (search.trim()) params.set("search", search.trim());
      if (filter === "archived") params.set("archivedOnly", "true");
      const res = await fetch(`/api/training/users?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar empleados");
      setUsers(json.data.users);
      setTotal(json.data.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, search, filter]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const filteredByStatus = useMemo(() => {
    if (filter === "active") return users.filter((u) => u.active);
    if (filter === "pending") return users.filter((u) => !u.active);
    return users;
  }, [users, filter]);

  const activeCountLocal = users.filter((u) => u.active).length;
  const pendingCountLocal = users.filter((u) => !u.active).length;

  async function handleArchived(u) {
    const name = [u.name, u.lastName].filter(Boolean).join(" ") || u.email;
    setFlash(`${name} archivado`);
    setTimeout(() => setFlash(null), 2200);
    setArchiveTarget(null);
    await load();
  }

  async function handleHardDeleted(u) {
    const name = [u.name, u.lastName].filter(Boolean).join(" ") || u.email;
    setFlash(`${name} eliminado definitivamente`);
    setTimeout(() => setFlash(null), 2200);
    setHardDeleteTarget(null);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <FilterChips
          filter={filter}
          onChange={setFilter}
          activeCount={activeCountLocal}
          pendingCount={pendingCountLocal}
          totalCount={total}
        />
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar nombre o email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg px-3 py-2 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-56"
          />
          <button
            onClick={onOpenCreate}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 transition whitespace-nowrap"
          >
            + Crear empleado
          </button>
          <button
            onClick={onOpenImport}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80 whitespace-nowrap"
            style={{ background: "var(--color-primary)" }}
          >
            Importar empleados
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}
      {flash && (
        <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{flash}</div>
      )}

      <TrainingTable
        headers={["Nombre", "Email", "Estado", "F. Nacimiento", ""]}
        loading={loading}
        empty={
          filter === "archived"
            ? "No hay empleados archivados."
            : users.length === 0
            ? "Esta empresa aún no tiene empleados. Usa «Importar empleados» para subir un Excel."
            : "No hay empleados con los filtros actuales"
        }
      >
        {filteredByStatus.map((u) => (
          <Tr key={u.id} onClick={() => setSelectedEmployee(u)}>
            <Td>
              <span className="font-semibold text-neutral-900">
                {[u.name, u.lastName].filter(Boolean).join(" ") || "—"}
              </span>
            </Td>
            <Td>{u.email}</Td>
            <Td>
              {u.archivedAt
                ? <span className="text-[11px] font-medium text-neutral-400">Archivado</span>
                : <ActiveBadge active={u.active} />}
            </Td>
            <Td>
              {u.birthDate
                ? new Date(u.birthDate).toLocaleDateString("es-ES")
                : <span className="text-neutral-300">—</span>}
            </Td>
            <Td className="text-right">
              {!u.archivedAt && (
                <div className="inline-flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setArchiveTarget(u); }}
                    className="text-[11px] font-medium text-neutral-400 hover:text-amber-600 transition-colors px-2 py-1 rounded-md hover:bg-amber-50"
                    title="Archivar empleado (conserva historial)"
                  >
                    Archivar
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setHardDeleteTarget(u); }}
                    className="text-[11px] font-medium text-neutral-300 hover:text-red-600 transition-colors px-2 py-1 rounded-md hover:bg-red-50"
                    title="Eliminar definitivamente (borra matrículas e historial)"
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </Td>
          </Tr>
        ))}
      </TrainingTable>

      {selectedEmployee && (
        <EmployeeDetailDrawer
          companyId={companyId}
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          onChanged={async () => { await load(); }}
        />
      )}

      {archiveTarget && (
        <ArchiveUserDialog
          user={archiveTarget}
          onCancel={() => setArchiveTarget(null)}
          onArchived={handleArchived}
        />
      )}

      {hardDeleteTarget && (
        <HardDeleteUserDialog
          user={hardDeleteTarget}
          onCancel={() => setHardDeleteTarget(null)}
          onDeleted={handleHardDeleted}
        />
      )}
    </div>
  );
}

function FilterChips({ filter, onChange, activeCount, pendingCount, totalCount }) {
  // El filtro "archived" cambia la query del backend (archivedOnly=true) en
  // lugar de filtrar client-side. El count para "archived" no se conoce hasta
  // que se selecciona; lo dejamos sin badge numérico.
  const items = [
    { id: "all", label: "Todos", count: totalCount },
    { id: "active", label: "Activos", count: activeCount },
    { id: "pending", label: "Pendientes", count: pendingCount },
    { id: "archived", label: "Archivados", count: null },
  ];
  return (
    <div className="inline-flex rounded-lg bg-neutral-100 p-0.5">
      {items.map((it) => {
        const active = it.id === filter;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
              active
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {it.label}
            {it.count !== null && (
              <span className={`ml-1.5 text-[10px] ${active ? "text-neutral-400" : "text-neutral-400"}`}>
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────── Drawer Detalle Empleado ─────────────────────────────

function EmployeeDetailDrawer({ companyId, employee, onClose, onChanged }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);

  async function handleRestore() {
    setRestoring(true);
    setRestoreError(null);
    try {
      const res = await fetch(`/api/training/users/${employee.id}/restore`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Error al restaurar");
      if (typeof onChanged === "function") await onChanged();
      onClose();
    } catch (e) {
      setRestoreError(e.message);
    } finally {
      setRestoring(false);
    }
  }

  // ESC cierra el drawer
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Cargamos las matrículas filtrando por companyId y nos quedamos con las del
  // empleado seleccionado. No hay endpoint single-user (ver backlog); por
  // ahora client-side filter es suficiente para los volúmenes esperados.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/training/enrollments?companyId=${companyId}&limit=200`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al cargar matrículas");
        if (cancelled) return;
        const own = (json.data?.enrollments ?? []).filter(
          (e) => e.trainingUser?.id === employee.id || e.trainingUserId === employee.id
        );
        // Orden estable por nombre del curso (alfabético).
        own.sort((a, b) => (a.course?.name || "").localeCompare(b.course?.name || ""));
        setEnrollments(own);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, employee.id]);

  const fullName = [employee.name, employee.lastName].filter(Boolean).join(" ") || "—";

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-x-0 top-14 lg:top-0 bottom-0 z-40 bg-black/40"
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label={`Detalle de empleado ${employee.email}`}
        className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:max-w-md bg-white shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-neutral-900 truncate" style={{ fontFamily: "'Syne', sans-serif" }}>
              {fullName}
            </h2>
            <p className="text-[11px] text-neutral-500 truncate">{employee.email}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <ActiveBadge active={employee.active} />
              {employee.username && (
                <span className="text-[10px] text-neutral-400">@{employee.username}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 transition-colors"
            title="Cerrar"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {employee.archivedAt && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-amber-800 leading-snug">
                Empleado archivado el {new Date(employee.archivedAt).toLocaleDateString("es-ES")}
              </p>
              <p className="text-[10px] text-amber-700 mt-0.5 leading-snug">
                No podrá completar el registro en el campus mientras esté archivado.
              </p>
              {restoreError && (
                <p className="text-[10px] text-red-600 mt-1.5">{restoreError}</p>
              )}
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring}
                className="mt-2 px-3 py-1.5 rounded-md text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {restoring ? "Restaurando…" : "Restaurar empleado"}
              </button>
            </div>
          )}

          {/* Datos básicos */}
          <section>
            <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wide mb-2">
              Datos
            </h3>
            <dl className="space-y-1.5">
              <Detail label="Estado">
                {employee.active ? "Activo" : "Pendiente de activación"}
              </Detail>
              {employee.birthDate && (
                <Detail label="F. nacimiento">
                  {new Date(employee.birthDate).toLocaleDateString("es-ES")}
                </Detail>
              )}
              {employee.nif && <Detail label="NIF">{employee.nif}</Detail>}
              {employee.country && <Detail label="País">{employee.country}</Detail>}
              <Detail label="Importado el">
                {employee.createdAt
                  ? new Date(employee.createdAt).toLocaleDateString("es-ES")
                  : "—"}
              </Detail>
              <Detail label="Última actualización">
                {employee.updatedAt
                  ? new Date(employee.updatedAt).toLocaleDateString("es-ES")
                  : "—"}
              </Detail>
              <Detail label="Empresa (companyId)">
                <code className="text-[10px] bg-neutral-100 rounded px-1.5 py-0.5 text-neutral-600">
                  {employee.companyId ?? "—"}
                </code>
              </Detail>
            </dl>
          </section>

          {/* Matrículas */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wide">
                Matrículas
              </h3>
              {!loading && (
                <span className="text-[10px] text-neutral-400">
                  {enrollments.length} {enrollments.length === 1 ? "curso" : "cursos"}
                </span>
              )}
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-14 bg-neutral-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : error ? (
              <p className="text-xs text-red-500">{error}</p>
            ) : enrollments.length === 0 ? (
              <p className="text-xs text-neutral-400 py-6 text-center">
                {employee.active
                  ? "Aún no se ha matriculado en ningún curso."
                  : "Se matriculará automáticamente al completar el registro en el campus."}
              </p>
            ) : (
              <ul className="space-y-2">
                {enrollments.map((e) => (
                  <li key={e.id} className="bg-neutral-50 rounded-lg px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-neutral-800 truncate">
                          {e.course?.name || "Curso eliminado"}
                        </p>
                        <p className="text-[10px] text-neutral-400 mt-0.5">
                          {e.course?.wcProductId ? `WC #${e.course.wcProductId}` : "sin WC"}
                          {e.enrolledAt
                            ? ` · matriculado ${new Date(e.enrolledAt).toLocaleDateString("es-ES")}`
                            : ""}
                        </p>
                      </div>
                      {e.metadata?.source && <SourceBadge source={e.metadata.source} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-neutral-100 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
            style={{ background: "var(--color-primary)" }}
          >
            Cerrar
          </button>
        </div>
      </aside>
    </>
  );
}

function Detail({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <dt className="text-[11px] text-neutral-400 shrink-0">{label}</dt>
      <dd className="text-[11px] font-medium text-neutral-700 text-right min-w-0 truncate">
        {children}
      </dd>
    </div>
  );
}

function SourceBadge({ source }) {
  const map = {
    register_empresa: { label: "registro web", cls: "bg-emerald-50 text-emerald-700" },
    bulk_propagateToActive: { label: "propagado", cls: "bg-blue-50 text-blue-700" },
    propagateToActive: { label: "propagado", cls: "bg-blue-50 text-blue-700" },
  };
  const m = map[source] || { label: source, cls: "bg-neutral-100 text-neutral-500" };
  return (
    <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide ${m.cls}`}>
      {m.label}
    </span>
  );
}

// ───────────────────── Tab Cursos ──────────────────────────────────────────

function CursosTab({ companyId, assignedCourses, activeEmployeesCount, onChange }) {
  const [allCourses, setAllCourses] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [propagate, setPropagate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultFlash, setResultFlash] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/training/courses?active=true");
        const json = await res.json();
        if (json.ok) setAllCourses(json.data);
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, []);

  const assignedIds = useMemo(
    () => new Set(assignedCourses.map((c) => c.id)),
    [assignedCourses]
  );
  // Orden estable por nombre alfabético — el backend devuelve en orden de
  // Sequelize, que no es estable entre runs.
  const sortedAssigned = useMemo(
    () => [...assignedCourses].sort((a, b) => a.name.localeCompare(b.name)),
    [assignedCourses]
  );
  const availableCourses = useMemo(
    () => allCourses
      .filter((c) => !assignedIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allCourses, assignedIds]
  );

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAssignBulk() {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    setError(null);
    setResultFlash(null);
    try {
      const res = await fetch(`/api/training/companies/${companyId}/courses/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseIds: Array.from(selectedIds),
          propagateToActive: propagate,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al asignar cursos");
      const added = json.data?.added?.length ?? 0;
      const newEnroll = json.data?.propagated?.totalEnrollmentsCreated ?? 0;
      setResultFlash(
        propagate
          ? `${added} curso(s) asignado(s) · ${newEnroll} matrículas nuevas`
          : `${added} curso(s) asignado(s)`
      );
      setSelectedIds(new Set());
      setPropagate(false);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnassign(courseId) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/training/companies/${companyId}/courses/${courseId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Error al quitar curso");
      }
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* Cursos asignados */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-neutral-700" style={{ fontFamily: "'Syne', sans-serif" }}>
            Cursos asignados
          </h2>
          <span className="text-[11px] text-neutral-400">
            {sortedAssigned.length} {sortedAssigned.length === 1 ? "curso" : "cursos"}
          </span>
        </div>
        {sortedAssigned.length === 0 ? (
          <p className="text-xs text-neutral-400 py-6 text-center">
            Esta empresa aún no tiene cursos contratados.
          </p>
        ) : (
          <ul className="space-y-2">
            {sortedAssigned.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 py-2.5"
              >
                <div className="min-w-0">
                  <span className="text-xs font-medium text-neutral-800 truncate block">{c.name}</span>
                  {c.wcProductId && (
                    <span className="text-[10px] text-neutral-400">WC #{c.wcProductId}</span>
                  )}
                </div>
                <button
                  onClick={() => handleUnassign(c.id)}
                  disabled={submitting}
                  className="text-neutral-300 hover:text-red-400 transition-colors ml-3 disabled:opacity-40"
                  title="Quitar curso"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Asignar nuevos */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5">
        <h2 className="text-sm font-bold text-neutral-700 mb-3" style={{ fontFamily: "'Syne', sans-serif" }}>
          Asignar cursos
        </h2>

        {loadingCatalog ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-9 bg-neutral-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : availableCourses.length === 0 ? (
          <p className="text-xs text-neutral-400 py-6 text-center">
            No quedan cursos disponibles para asignar.
          </p>
        ) : (
          <>
            <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {availableCourses.map((c) => {
                const checked = selectedIds.has(c.id);
                return (
                  <li key={c.id}>
                    <label
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        checked ? "bg-neutral-100" : "hover:bg-neutral-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(c.id)}
                        className="rounded border-neutral-300"
                        style={{ accentColor: "var(--color-primary)" }}
                      />
                      <span className="text-xs text-neutral-700 truncate flex-1">{c.name}</span>
                      {c.wcProductId && (
                        <span className="text-[10px] text-neutral-400">WC #{c.wcProductId}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>

            <label className={`flex items-start gap-2 mt-4 p-2.5 rounded-lg cursor-pointer transition-colors ${
              activeEmployeesCount === 0 ? "opacity-50 cursor-not-allowed" : "bg-neutral-50 hover:bg-neutral-100"
            }`}>
              <input
                type="checkbox"
                checked={propagate}
                disabled={activeEmployeesCount === 0}
                onChange={(e) => setPropagate(e.target.checked)}
                className="mt-0.5 rounded border-neutral-300"
                style={{ accentColor: "var(--color-primary)" }}
              />
              <span className="text-[11px] text-neutral-600 leading-snug">
                Matricular automáticamente a los <strong>{activeEmployeesCount}</strong> empleado(s) ya activo(s) en los cursos seleccionados.
                <span className="block text-[10px] text-neutral-400 mt-0.5">
                  Los pre-aprobados se matriculan automáticamente al activar su cuenta (no requiere esta opción).
                </span>
              </span>
            </label>

            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
            {resultFlash && <p className="text-xs text-emerald-600 mt-3">{resultFlash}</p>}

            <div className="flex justify-end pt-3">
              <button
                type="button"
                onClick={handleAssignBulk}
                disabled={submitting || selectedIds.size === 0}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-40"
                style={{ background: "var(--color-primary)" }}
              >
                {submitting
                  ? "Asignando…"
                  : selectedIds.size === 0
                    ? "Selecciona cursos"
                    : `Asignar ${selectedIds.size} curso${selectedIds.size > 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────── Drawer Importar empleados (FASE D) ───────────────────

function ImportDrawer({ companyId, companyName, onClose, onCompleted }) {
  const [step, setStep] = useState("pick"); // pick | previewing | preview | importing | done
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [importResult, setImportResult] = useState(null);

  async function onFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setPreview(null);
    setStep("previewing");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`/api/training/users/import/preview?companyId=${companyId}`, {
        method: "POST",
        body: fd,
      });
      const json = await leerRespuestaApi(res);
      if (!res.ok) throw new Error(json.error || "Error al analizar el Excel");
      setPreview(json.data ?? json);
      setStep("preview");
    } catch (e) {
      setError(e.message);
      setStep("pick");
      setFile(null);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setStep("importing");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/training/users/import?companyId=${companyId}`, {
        method: "POST",
        body: fd,
      });
      const json = await leerRespuestaApi(res);
      if (!res.ok) throw new Error(json.error || "Error al importar");
      setImportResult(json.data ?? json);
      setStep("done");
    } catch (e) {
      setError(e.message);
      setStep("preview");
    }
  }

  function resetForAnother() {
    setStep("pick");
    setFile(null);
    setPreview(null);
    setImportResult(null);
    setError(null);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-x-0 top-14 lg:top-0 bottom-0 z-40 bg-black/40"
      />
      {/* Drawer panel — respeta la barra móvil h-14 (regla #13) */}
      <div className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:max-w-md bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
              Importar empleados
            </h2>
            <p className="text-[11px] text-neutral-400 truncate">{companyName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 transition-colors"
            title="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === "pick" && (
            <PickStep onFileChange={onFileChange} error={error} />
          )}
          {step === "previewing" && <CenteredSpinner label="Analizando Excel…" />}
          {step === "preview" && preview && (
            <PreviewStep preview={preview} fileName={file?.name} />
          )}
          {step === "importing" && <CenteredSpinner label="Importando empleados…" />}
          {step === "done" && importResult && (
            <DoneStep result={importResult} />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-neutral-100 flex items-center justify-end gap-2">
          {step === "preview" && (
            <>
              <button
                onClick={resetForAnother}
                className="px-3 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition"
              >
                Cambiar archivo
              </button>
              <button
                onClick={handleConfirm}
                disabled={(preview?.newCount ?? 0) + (preview?.updateCount ?? 0) === 0}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-40"
                style={{ background: "var(--color-primary)" }}
              >
                Confirmar importación
              </button>
            </>
          )}
          {step === "done" && (
            <>
              <button
                onClick={resetForAnother}
                className="px-3 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition"
              >
                Importar otro
              </button>
              <button
                onClick={onCompleted}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
                style={{ background: "var(--color-primary)" }}
              >
                Cerrar
              </button>
            </>
          )}
          {(step === "pick" || step === "previewing" || step === "importing") && (
            <button
              onClick={onClose}
              disabled={step === "importing"}
              className="px-3 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition disabled:opacity-50"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function PickStep({ onFileChange, error }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold text-neutral-700 mb-2">1. Descargar plantilla</h3>
        <a
          href="/api/training/users/import/template"
          download
          className="inline-flex items-center gap-2 text-xs font-semibold underline decoration-dotted"
          style={{ color: "var(--color-primary)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
          </svg>
          Descargar plantilla Excel
        </a>
        <p className="text-[11px] text-neutral-400 mt-1.5">
          3 columnas: <code>Email</code> obligatorio, <code>Nombre</code> opcional, <code>Fecha_nacimiento</code> opcional (DD-MM-AAAA).
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-neutral-700 mb-2">2. Subir el Excel relleno</h3>
        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-neutral-200 rounded-xl p-8 cursor-pointer hover:border-neutral-300 hover:bg-neutral-50 transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-neutral-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <span className="text-xs font-medium text-neutral-700">Haz click o arrastra tu archivo</span>
          <span className="text-[10px] text-neutral-400">.xlsx</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={onFileChange}
          />
        </label>
        <p className="text-[11px] text-neutral-400 mt-3 leading-relaxed">
          La columna «Empresa» se ignora si la hubiera: los empleados se asignan automáticamente a esta empresa.
          Re-subir el mismo Excel actualiza los empleados existentes (no los duplica).
        </p>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}
    </div>
  );
}

function PreviewStep({ preview, fileName }) {
  const newCount = preview.newCount ?? 0;
  const updateCount = preview.updateCount ?? 0;
  const errorCount = preview.errors?.length ?? 0;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-neutral-700 mb-2">Resumen del análisis</h3>
        <p className="text-[11px] text-neutral-400 truncate">{fileName} — {preview.totalRows ?? 0} filas analizadas</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat color="emerald" label="Nuevos" value={newCount} />
        <Stat color="blue" label="Actualizaciones" value={updateCount} />
        <Stat color="red" label="Errores" value={errorCount} />
      </div>

      {errorCount > 0 && (
        <div className="rounded-xl border border-red-100 bg-red-50/40 overflow-hidden">
          <div className="px-3 py-2 bg-red-50 border-b border-red-100">
            <span className="text-[11px] font-bold text-red-700 uppercase tracking-wide">
              {errorCount} filas con errores
            </span>
            <span className="ml-2 text-[10px] text-red-500">no se importarán</span>
          </div>
          <ul className="max-h-40 overflow-y-auto divide-y divide-red-50">
            {preview.errors.slice(0, 50).map((e, i) => (
              <li key={i} className="px-3 py-1.5 text-[11px] text-red-700">
                Fila {e.row}: <strong>{e.field}</strong> «{e.value || "—"}» — {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.preview?.length > 0 && (
        <div className="rounded-xl border border-neutral-100 overflow-hidden">
          <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-100 flex items-center justify-between">
            <span className="text-[11px] font-bold text-neutral-700 uppercase tracking-wide">
              Previsualización
            </span>
            <span className="text-[10px] text-neutral-400">
              {preview.preview.length}{preview.preview.length === 50 ? " (primeros)" : ""} de {newCount + updateCount}
            </span>
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-neutral-50">
            {preview.preview.map((r, i) => (
              <li key={i} className="px-3 py-2 flex items-center gap-2">
                <ActionBadge action={r.action} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-neutral-800 truncate">{r.email}</p>
                  <p className="text-[10px] text-neutral-400 truncate">
                    {[r.name, r.lastName].filter(Boolean).join(" ") || "—"}
                    {r.birthDate ? ` · ${r.birthDate}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {newCount + updateCount === 0 && (
        <p className="text-xs text-neutral-500 text-center py-2">
          No hay ninguna fila válida para importar. Corrige los errores y vuelve a subir el Excel.
        </p>
      )}
    </div>
  );
}

function ActionBadge({ action }) {
  if (action === "create") {
    return (
      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700">
        Nuevo
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700">
      Update
    </span>
  );
}

function Stat({ color, label, value }) {
  const map = {
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-100" },
    red: { bg: "bg-red-50", text: "text-red-700", border: "border-red-100" },
  };
  const c = map[color];
  return (
    <div className={`${c.bg} ${c.border} border rounded-xl p-3 text-center`}>
      <p className={`${c.text} text-xl font-extrabold leading-none`} style={{ fontFamily: "'Syne', sans-serif" }}>
        {value}
      </p>
      <p className={`${c.text} text-[10px] uppercase tracking-wide font-semibold mt-1`}>{label}</p>
    </div>
  );
}

function CenteredSpinner({ label }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-700 rounded-full animate-spin" />
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}

function DoneStep({ result }) {
  const imported = result.imported ?? 0;
  const updated = result.updated ?? 0;
  const skipped = result.skipped ?? 0;
  const errors = result.errors?.length ?? 0;
  return (
    <div className="space-y-4">
      <div className="text-center py-2">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 mb-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-6 h-6 text-emerald-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-sm font-bold text-neutral-800" style={{ fontFamily: "'Syne', sans-serif" }}>
          Importación completada
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat color="emerald" label="Creados" value={imported} />
        <Stat color="blue" label="Actualizados" value={updated} />
      </div>

      {(skipped > 0 || errors > 0) && (
        <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3">
          <p className="text-[11px] text-neutral-600">
            <strong>{skipped}</strong> filas omitidas
            {errors > 0 && <> · <strong>{errors}</strong> con errores</>}
          </p>
        </div>
      )}

      {errors > 0 && (
        <ul className="max-h-40 overflow-y-auto divide-y divide-neutral-100 border border-neutral-100 rounded-xl">
          {result.errors.slice(0, 50).map((e, i) => (
            <li key={i} className="px-3 py-1.5 text-[11px] text-neutral-700">
              Fila {e.row}: <strong>{e.field}</strong> — {e.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

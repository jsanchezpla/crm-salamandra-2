"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import StatusBadge, { STATUS_OPTIONS } from "../../../../components/projects/StatusBadge.jsx";
import PriorityBadge, { PRIORITY_OPTIONS } from "../../../../components/projects/PriorityBadge.jsx";
import Select from "@/components/ui/Select.jsx";

const TABS = [
  { key: "overview",  label: "Resumen" },
  { key: "team",      label: "Equipo" },
  { key: "phases",    label: "Fases" },
  { key: "milestones", label: "Hitos" },
  { key: "board",     label: "Tablero" },
  { key: "settings",  label: "Configuración" },
];

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

function fmtDate(d) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }
function fmtMoney(n, cur = "EUR") {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}
function initials(name) {
  if (!name) return "??";
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

const ROLE_LABELS = { lead: "Lead", member: "Miembro", viewer: "Observador" };
const ROLE_CLASSES = {
  lead: "bg-emerald-50 text-emerald-700 border-emerald-100",
  member: "bg-sky-50 text-sky-700 border-sky-100",
  viewer: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

const MILESTONE_STATUS = {
  pending: { label: "Pendiente", cls: "bg-amber-50 text-amber-700 border-amber-100" },
  completed: { label: "Completado", cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  missed: { label: "Perdido", cls: "bg-rose-50 text-rose-700 border-rose-100" },
};

export default function ProyectoDetallePage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [me, setMe] = useState(null);
  const [tab, setTab] = useState(() => {
    const t = searchParams?.get("tab");
    return TABS.some((x) => x.key === t) ? t : "overview";
  });
  const [project, setProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [phases, setPhases] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [columns, setColumns] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, mRes, phRes, miRes, cRes, teamRes, clRes] = await Promise.all([
        fetch(`/api/projects/${id}`).then((r) => r.json()),
        fetch(`/api/projects/${id}/members`).then((r) => r.json()),
        fetch(`/api/projects/${id}/phases`).then((r) => r.json()),
        fetch(`/api/projects/${id}/milestones`).then((r) => r.json()),
        fetch(`/api/projects/${id}/columns`).then((r) => r.json()),
        fetch(`/api/team?limit=200`).then((r) => r.json()).catch(() => null),
        fetch(`/api/clients?limit=200`).then((r) => r.json()).catch(() => null),
      ]);
      if (!pRes?.ok) throw new Error(pRes?.error || "Proyecto no encontrado");
      setProject(pRes.data);
      setMembers(mRes?.data ?? []);
      setPhases(phRes?.data ?? []);
      setMilestones(miRes?.data ?? []);
      setColumns(cRes?.data ?? []);
      setTeamMembers(teamRes?.data?.members ?? teamRes?.data ?? []);
      setClients(clRes?.data?.clients ?? clRes?.data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => setMe(j?.data ?? null)).catch(() => {});
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const phaseProgress = useMemo(() => {
    if (phases.length === 0) return 0;
    const done = phases.filter((p) => p.completedAt).length;
    return Math.round((done / phases.length) * 100);
  }, [phases]);

  if (loading) return <div className="p-6 text-sm text-neutral-400">Cargando proyecto...</div>;
  if (error) return <div className="p-6 text-sm text-rose-700">{error}</div>;
  if (!project) return null;

  return (
    <div className="p-4 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="mb-6">
        <Link
          href="/proyectos"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 mb-2"
        >
          <span aria-hidden="true">←</span> Proyectos
        </Link>
        {project.client?.name && (
          <div className="text-xs text-neutral-400 mb-1">{project.client.name}</div>
        )}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div>
            <h1 className="font-[Fraunces] text-3xl lg:text-4xl text-neutral-800">{project.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span className="font-mono">{project.code ?? "—"}</span>
              <StatusBadge value={project.status} />
              <PriorityBadge value={project.priority} />
              {project.archivedAt && (
                <span className="px-2 py-0.5 rounded-full text-[11px] border bg-neutral-100 text-neutral-500 border-neutral-200">archivado</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-neutral-200 mb-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition " +
              (tab === t.key
                ? "border-neutral-800 text-neutral-800"
                : "border-transparent text-neutral-500 hover:text-neutral-700")
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Contenido por pestaña */}
      {tab === "overview" && (
        <OverviewTab
          project={project}
          phases={phases}
          milestones={milestones}
          phaseProgress={phaseProgress}
          isAdmin={isAdmin}
        />
      )}
      {tab === "team" && (
        <TeamTab
          projectId={project.id}
          members={members}
          teamMembers={teamMembers}
          onChange={fetchAll}
        />
      )}
      {tab === "phases" && (
        <PhasesTab projectId={project.id} phases={phases} onChange={fetchAll} />
      )}
      {tab === "milestones" && (
        <MilestonesTab projectId={project.id} milestones={milestones} phases={phases} onChange={fetchAll} />
      )}
      {tab === "board" && <BoardSummary projectId={project.id} columns={columns} />}
      {tab === "settings" && (
        <SettingsTab
          project={project}
          columns={columns}
          clients={clients}
          isAdmin={isAdmin}
          onChange={fetchAll}
          onArchive={() => { router.push("/proyectos"); }}
        />
      )}
    </div>
  );
}

// ─── Pestaña: Resumen ─────────────────────────────────────────────────────

function OverviewTab({ project, phases, milestones, phaseProgress, isAdmin }) {
  const daysLeft = daysBetween(new Date(), project.dueDate);
  const upcoming = milestones
    .filter((m) => m.status === "pending")
    .slice()
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0, 3);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Kpis>
          <Kpi label="Días restantes" value={daysLeft != null ? (daysLeft >= 0 ? daysLeft : `${daysLeft} (vencido)`) : "—"} />
          <Kpi label="Progreso fases" value={`${phaseProgress}%`} />
          <Kpi label="Hitos" value={milestones.length} />
          {isAdmin && project.budgetAmount != null && (
            <Kpi label="Presupuesto" value={fmtMoney(project.budgetAmount, project.budgetCurrency)} />
          )}
        </Kpis>

        <Card title="Descripción">
          <p className="text-sm text-neutral-600 whitespace-pre-wrap">
            {project.description || <span className="text-neutral-400">Sin descripción.</span>}
          </p>
        </Card>

        <Card title="Fases">
          {phases.length === 0 ? (
            <p className="text-sm text-neutral-400">Sin fases definidas.</p>
          ) : (
            <ul className="space-y-2">
              {phases.map((p) => (
                <li key={p.id} className="flex items-center gap-3 text-sm">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: p.color || "#94A3B8" }}
                  />
                  <span className={`flex-1 ${p.completedAt ? "text-neutral-400 line-through" : "text-neutral-700"}`}>
                    {p.name}
                  </span>
                  {p.endDate && <span className="text-xs text-neutral-400">{fmtDate(p.endDate)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Próximos hitos">
          {upcoming.length === 0 ? (
            <p className="text-sm text-neutral-400">Sin hitos pendientes.</p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="font-medium text-neutral-800">{m.name}</div>
                  <div className="text-xs text-neutral-500">{fmtDate(m.dueDate)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Detalles">
          <Detail label="Cliente" value={project.client?.name ?? "—"} />
          <Detail label="Inicio" value={fmtDate(project.startDate)} />
          <Detail label="Fecha límite" value={fmtDate(project.dueDate)} />
          <Detail label="Estimado" value={project.estimatedHours ? `${project.estimatedHours} h` : "—"} />
          {project.tags?.length > 0 && (
            <Detail
              label="Tags"
              value={
                <div className="flex flex-wrap gap-1">
                  {project.tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full text-[11px] bg-neutral-100 text-neutral-600 border border-neutral-200">
                      {t}
                    </span>
                  ))}
                </div>
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Pestaña: Equipo ──────────────────────────────────────────────────────

function TeamTab({ projectId, members, teamMembers, onChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [tmId, setTmId] = useState("");
  const [role, setRole] = useState("member");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const memberTeamIds = new Set(members.map((m) => m.teamMemberId));
  const available = teamMembers.filter((tm) => !memberTeamIds.has(tm.id));

  const submit = async (e) => {
    e.preventDefault();
    if (!tmId) return;
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberId: tmId, role }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error añadiendo miembro");
      setTmId("");
      setRole("member");
      setShowAdd(false);
      onChange();
    } catch (e) { setErr(e.message); } finally { setSubmitting(false); }
  };

  const changeRole = async (memberId, newRole) => {
    await fetch(`/api/projects/${projectId}/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    onChange();
  };

  const remove = async (memberId) => {
    if (!confirm("¿Quitar este miembro del proyecto?")) return;
    await fetch(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
    onChange();
  };

  return (
    <Card
      title="Equipo del proyecto"
      action={
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 text-white font-medium hover:bg-neutral-700"
        >
          {showAdd ? "Cerrar" : "+ Añadir miembro"}
        </button>
      }
    >
      {err && <div className="mb-3 text-sm text-rose-700">{err}</div>}
      {showAdd && (
        <form onSubmit={submit} className="mb-4 p-3 bg-neutral-50 rounded-lg flex flex-col sm:flex-row gap-2">
          <Select
            className={inputCls}
            value={tmId}
            onChange={(v) => setTmId(v)}
            options={[
              { value: "", label: "— Selecciona empleado —" },
              ...available.map((tm) => ({ value: tm.id, label: tm.displayName })),
            ]}
          />
          <Select
            className={inputCls + " sm:w-40"}
            value={role}
            onChange={(v) => setRole(v)}
            options={[
              { value: "lead", label: "Lead" },
              { value: "member", label: "Miembro" },
              { value: "viewer", label: "Observador" },
            ]}
          />
          <button disabled={submitting || !tmId} className="px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium disabled:opacity-50">
            {submitting ? "Añadiendo..." : "Añadir"}
          </button>
        </form>
      )}
      {members.length === 0 ? (
        <p className="text-sm text-neutral-400">Sin miembros asignados.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {members.map((m) => (
            <li key={m.id} className="py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-neutral-200 flex items-center justify-center text-sm font-medium text-neutral-600">
                {initials(m.teamMember?.displayName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-neutral-800">{m.teamMember?.displayName}</div>
                <div className="text-xs text-neutral-500">{m.teamMember?.position ?? "—"}</div>
              </div>
              <Select
                className="text-xs rounded-lg border border-neutral-200 px-2 py-1"
                value={m.role}
                onChange={(v) => changeRole(m.id, v)}
                options={[
                  { value: "lead", label: "Lead" },
                  { value: "member", label: "Miembro" },
                  { value: "viewer", label: "Observador" },
                ]}
              />
              <span className={`px-2 py-0.5 rounded-full text-[11px] border ${ROLE_CLASSES[m.role]}`}>
                {ROLE_LABELS[m.role]}
              </span>
              <button onClick={() => remove(m.id)} className="text-xs text-rose-600 hover:text-rose-700">
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Pestaña: Fases ───────────────────────────────────────────────────────

function PhasesTab({ projectId, phases, onChange }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/projects/${projectId}/phases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, startDate: startDate || null, endDate: endDate || null }),
      });
      setName(""); setColor("#3B82F6"); setStart(""); setEnd("");
      onChange();
    } finally { setSubmitting(false); }
  };

  const remove = async (phaseId) => {
    if (!confirm("¿Borrar la fase?")) return;
    await fetch(`/api/projects/${projectId}/phases/${phaseId}`, { method: "DELETE" });
    onChange();
  };

  return (
    <Card title="Fases del proyecto">
      <form onSubmit={submit} className="mb-4 grid grid-cols-1 sm:grid-cols-5 gap-2">
        <input className={inputCls + " sm:col-span-2"} placeholder="Nombre de la fase" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" className="w-full h-10 rounded-lg border border-neutral-200" value={color} onChange={(e) => setColor(e.target.value)} />
        <input type="date" className={inputCls} value={startDate} onChange={(e) => setStart(e.target.value)} />
        <input type="date" className={inputCls} value={endDate} onChange={(e) => setEnd(e.target.value)} />
        <button disabled={submitting || !name.trim()} className="sm:col-span-5 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium disabled:opacity-50">
          {submitting ? "Añadiendo..." : "+ Añadir fase"}
        </button>
      </form>

      {phases.length === 0 ? (
        <p className="text-sm text-neutral-400">Sin fases definidas.</p>
      ) : (
        <ul className="space-y-2">
          {phases.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 bg-white">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: p.color || "#94A3B8" }} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-neutral-800">{p.name}</div>
                <div className="text-xs text-neutral-500">
                  {p.startDate ? fmtDate(p.startDate) : "?"} → {p.endDate ? fmtDate(p.endDate) : "?"}
                </div>
              </div>
              <button onClick={() => remove(p.id)} className="text-xs text-rose-600 hover:text-rose-700">Borrar</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Pestaña: Hitos ───────────────────────────────────────────────────────

function MilestonesTab({ projectId, milestones, phases, onChange }) {
  const [name, setName] = useState("");
  const [dueDate, setDue] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !dueDate) return;
    setSubmitting(true);
    try {
      await fetch(`/api/projects/${projectId}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, dueDate, phaseId: phaseId || null }),
      });
      setName(""); setDue(""); setPhaseId("");
      onChange();
    } finally { setSubmitting(false); }
  };

  const update = async (mid, body) => {
    await fetch(`/api/projects/${projectId}/milestones/${mid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    onChange();
  };

  const remove = async (mid) => {
    if (!confirm("¿Borrar el hito?")) return;
    await fetch(`/api/projects/${projectId}/milestones/${mid}`, { method: "DELETE" });
    onChange();
  };

  const sorted = milestones.slice().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  return (
    <Card title="Hitos del proyecto">
      <form onSubmit={submit} className="mb-4 grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input className={inputCls + " sm:col-span-2"} placeholder="Nombre del hito" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDue(e.target.value)} />
        <Select
          className={inputCls}
          value={phaseId}
          onChange={(v) => setPhaseId(v)}
          options={[
            { value: "", label: "— Sin fase —" },
            ...phases.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <button disabled={submitting || !name.trim() || !dueDate} className="sm:col-span-4 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium disabled:opacity-50">
          {submitting ? "Añadiendo..." : "+ Añadir hito"}
        </button>
      </form>

      {sorted.length === 0 ? (
        <p className="text-sm text-neutral-400">Sin hitos.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((m) => {
            const meta = MILESTONE_STATUS[m.status] ?? MILESTONE_STATUS.pending;
            return (
              <li key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 bg-white">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-800">{m.name}</div>
                  <div className="text-xs text-neutral-500">{fmtDate(m.dueDate)}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] border ${meta.cls}`}>{meta.label}</span>
                <Select
                  className="text-xs rounded-lg border border-neutral-200 px-2 py-1"
                  value={m.status}
                  onChange={(v) => update(m.id, { status: v })}
                  options={[
                    { value: "pending", label: "Pendiente" },
                    { value: "completed", label: "Completado" },
                    { value: "missed", label: "Perdido" },
                  ]}
                />
                <button onClick={() => remove(m.id)} className="text-xs text-rose-600 hover:text-rose-700">Borrar</button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ─── Pestaña: Tablero (resumen + entrada al Kanban completo) ────────────

function BoardSummary({ projectId, columns }) {
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/board`).then((r) => r.json());
        if (r?.ok) {
          const map = {};
          let total = 0;
          for (const col of r.data.columns) {
            map[col.id] = col.tasks.length;
            total += col.tasks.length;
          }
          setCounts({ map, total });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const total = counts?.total ?? 0;

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-6 lg:p-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-5">
        <div>
          <h2 className="font-[Fraunces] text-2xl text-neutral-800 mb-1">Tablero Kanban</h2>
          <p className="text-sm text-neutral-500">
            {loading
              ? "Cargando…"
              : `${columns.length} columna${columns.length !== 1 ? "s" : ""} · ${total} tarea${total !== 1 ? "s" : ""} en total`}
          </p>
        </div>
        <Link
          href={`/proyectos/${projectId}/board`}
          className="px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 inline-flex items-center gap-2"
        >
          Abrir tablero
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {columns.map((c) => (
          <div key={c.id} className="bg-neutral-50 rounded-lg border border-neutral-100 p-3 flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: c.color || "#94A3B8" }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-neutral-600 truncate">{c.name}</div>
              <div className="font-[Fraunces] text-xl text-neutral-800">
                {counts?.map?.[c.id] ?? "—"}
              </div>
            </div>
            {c.isDoneColumn && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                Hecho
              </span>
            )}
          </div>
        ))}
      </div>

      {columns.length === 0 && (
        <p className="text-sm text-neutral-400 mt-4">
          Sin columnas configuradas. Crea columnas en la pestaña <strong>Configuración</strong>.
        </p>
      )}
    </div>
  );
}

// ─── Pestaña: Configuración ──────────────────────────────────────────────

function SettingsTab({ project, columns, clients, isAdmin, onChange, onArchive }) {
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? "",
    clientId: project.clientId ?? "",
    status: project.status,
    priority: project.priority,
    startDate: project.startDate ?? "",
    dueDate: project.dueDate ?? "",
    estimatedHours: project.estimatedHours ?? "",
    budgetAmount: project.budgetAmount ?? "",
    budgetCurrency: project.budgetCurrency ?? "EUR",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const payload = { ...form };
      payload.estimatedHours = payload.estimatedHours === "" ? null : Number(payload.estimatedHours);
      payload.budgetAmount = payload.budgetAmount === "" ? null : Number(payload.budgetAmount);
      payload.startDate = payload.startDate || null;
      payload.dueDate = payload.dueDate || null;
      payload.clientId = payload.clientId || null;
      const r = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error al guardar");
      setMsg({ type: "ok", text: "Cambios guardados" });
      onChange();
    } catch (e) { setMsg({ type: "err", text: e.message }); } finally { setSaving(false); }
  };

  const archive = async () => {
    if (!confirm("Archivar este proyecto? Quedará oculto en los listados por defecto.")) return;
    const r = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (r.ok) onArchive();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Datos del proyecto">
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre</label>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Descripción</label>
            <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              className={inputCls}
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <Select
              className={inputCls}
              value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v })}
              options={PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
          <Select
            className={inputCls}
            value={form.clientId}
            onChange={(v) => setForm({ ...form, clientId: v })}
            options={[
              { value: "", label: "— Sin cliente —" },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
          {isAdmin && (
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" min="0" placeholder="Presupuesto" className={inputCls}
                value={form.budgetAmount} onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })} />
              <input maxLength={3} className={inputCls} value={form.budgetCurrency} onChange={(e) => setForm({ ...form, budgetCurrency: e.target.value.toUpperCase() })} />
            </div>
          )}
          {msg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
              {msg.text}
            </div>
          )}
          <button disabled={saving} className="w-full px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium disabled:opacity-50">
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </form>
      </Card>

      <div className="space-y-4">
        <ColumnsManager projectId={project.id} columns={columns} onChange={onChange} />
        {isAdmin && !project.archivedAt && (
          <Card title="Zona peligrosa">
            <p className="text-sm text-neutral-500 mb-3">
              Archivar oculta el proyecto del listado por defecto. No borra datos.
            </p>
            <button onClick={archive} className="px-4 py-2 rounded-lg border border-rose-200 text-sm text-rose-700 hover:bg-rose-50">
              Archivar proyecto
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}

function ColumnsManager({ projectId, columns, onChange }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#94A3B8");

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch(`/api/projects/${projectId}/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    setName(""); setColor("#94A3B8");
    onChange();
  };

  const setDone = async (id) => {
    await fetch(`/api/projects/${projectId}/columns/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDoneColumn: true }),
    });
    onChange();
  };

  const remove = async (id) => {
    if (!confirm("¿Borrar columna?")) return;
    const r = await fetch(`/api/projects/${projectId}/columns/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      alert(j?.error ?? "No se ha podido borrar");
    }
    onChange();
  };

  return (
    <Card title="Columnas del Kanban">
      <form onSubmit={add} className="mb-3 flex gap-2">
        <input className={inputCls} placeholder="Nueva columna" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" className="w-12 h-10 rounded-lg border border-neutral-200" value={color} onChange={(e) => setColor(e.target.value)} />
        <button disabled={!name.trim()} className="px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm disabled:opacity-50">+</button>
      </form>
      <ul className="space-y-2">
        {columns.map((c) => (
          <ColumnRow
            key={c.id}
            projectId={projectId}
            column={c}
            onChange={onChange}
            onSetDone={() => setDone(c.id)}
            onRemove={() => remove(c.id)}
          />
        ))}
      </ul>
    </Card>
  );
}

function ColumnRow({ projectId, column, onChange, onSetDone, onRemove }) {
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState(column.color || "#94A3B8");
  const [saving, setSaving] = useState(false);
  // Track valores pendientes de guardar (para persistir al desmontar).
  const pendingRef = useRef({ name: null, color: null });

  // Re-sync cuando el server actualiza el column (tras un PATCH o cambio externo).
  useEffect(() => { setName(column.name); }, [column.name]);
  useEffect(() => { setColor(column.color || "#94A3B8"); }, [column.color]);

  const patch = useCallback(async (body) => {
    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/columns/${column.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onChange();
    } finally {
      setSaving(false);
    }
  }, [projectId, column.id, onChange]);

  const commitName = () => {
    if (name === column.name) return;
    pendingRef.current.name = null;
    patch({ name });
  };

  const onColorChange = (value) => {
    setColor(value);
    pendingRef.current.color = null;
    // Color inmediato — no requiere blur (el picker cierra al elegir).
    if (value !== column.color) patch({ color: value });
  };

  // Persistir cambios pendientes al desmontar (p.ej. cambio de tab sin blur).
  useEffect(() => {
    return () => {
      const pending = pendingRef.current;
      if (!pending.name && !pending.color) return;
      const body = {};
      if (pending.name != null) body.name = pending.name;
      if (pending.color != null) body.color = pending.color;
      // keepalive: la petición sobrevive al unmount / cambio de página.
      fetch(`/api/projects/${projectId}/columns/${column.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <li className="flex items-center gap-2 p-2 rounded-lg border border-neutral-200 bg-white">
      <input
        type="color"
        className="w-6 h-6 rounded-full border border-neutral-200 cursor-pointer flex-shrink-0"
        value={color}
        onChange={(e) => onColorChange(e.target.value)}
        title="Cambiar color"
      />
      <input
        className="flex-1 text-sm text-neutral-700 bg-transparent outline-none"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          pendingRef.current.name = e.target.value;
        }}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        }}
      />
      {saving && (
        <span className="text-[11px] text-neutral-400 italic">Guardando…</span>
      )}
      {column.isDoneColumn ? (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">Hecho</span>
      ) : (
        <button onClick={onSetDone} className="text-[11px] text-neutral-500 hover:text-neutral-700">marcar hecho</button>
      )}
      <button onClick={onRemove} className="text-xs text-rose-600 hover:text-rose-700">×</button>
    </li>
  );
}

// ─── Helpers de UI ───────────────────────────────────────────────────────

function Card({ title, children, action }) {
  return (
    <section className="bg-white rounded-xl border border-neutral-200 p-4 lg:p-5">
      <header className="flex items-center justify-between mb-3">
        <h3 className="font-[Fraunces] text-lg text-neutral-800">{title}</h3>
        {action}
      </header>
      <div>{children}</div>
    </section>
  );
}

function Kpis({ children }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>;
}
function Kpi({ label, value }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="font-[Fraunces] text-2xl text-neutral-800 mt-1">{value}</div>
    </div>
  );
}
function Detail({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-sm py-1.5 border-b border-neutral-50 last:border-0">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-800 text-right">{value}</span>
    </div>
  );
}

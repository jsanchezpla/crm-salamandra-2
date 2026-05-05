"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "./StatusBadge.jsx";

const ROLE_LABELS = { lead: "Lead", member: "Miembro", viewer: "Observador" };

/**
 * Sección embebida en el drawer/panel de /equipo que muestra los proyectos
 * en los que participa un empleado, con su rol en cada uno.
 *
 * Si el módulo `projects` no está activo, devuelve null (oculto).
 */
export default function EmployeeProjectsSection({ teamMemberId }) {
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/team/${teamMemberId}/projects`)
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 403) setHidden(true);
          return null;
        }
        return r.json();
      })
      .then((j) => { if (!cancelled && j?.ok) setProjects(j.data ?? []); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [teamMemberId]);

  if (hidden) return null;
  if (loading) return <div className="text-xs text-neutral-400 py-3">Cargando proyectos…</div>;
  if (!projects || projects.length === 0) {
    return (
      <div className="text-sm text-neutral-400">Sin proyectos asignados.</div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {projects.map((p) => (
        <li key={p.id} className="py-2 flex items-center gap-3 text-sm">
          <Link href={`/proyectos/${p.id}`} className="flex-1 min-w-0 truncate font-medium text-neutral-800 hover:text-neutral-600">
            {p.name}
          </Link>
          {p.memberRole && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
              {ROLE_LABELS[p.memberRole] ?? p.memberRole}
            </span>
          )}
          <StatusBadge value={p.status} />
        </li>
      ))}
    </ul>
  );
}

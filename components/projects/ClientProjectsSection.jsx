"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "./StatusBadge.jsx";

function fmtDate(d) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }
function fmtMoney(n, cur = "EUR") {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

/**
 * Sección embebida en /clientes/[id] que muestra los proyectos de un cliente.
 *
 * Si el módulo `projects` no está activo en el tenant, el endpoint devuelve
 * 403 y el componente se oculta silenciosamente (return null).
 */
export default function ClientProjectsSection({ clientId, isAdmin = false }) {
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/projects`)
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
  }, [clientId]);

  if (hidden) return null;
  if (loading) return <div className="text-xs text-neutral-400 py-4">Cargando proyectos…</div>;
  if (!projects || projects.length === 0) {
    return (
      <section className="bg-white rounded-xl border border-neutral-200 p-4">
        <h3 className="font-[Fraunces] text-lg text-neutral-800 mb-2">Proyectos</h3>
        <p className="text-sm text-neutral-400">Este cliente no tiene proyectos.</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-neutral-200 p-4">
      <h3 className="font-[Fraunces] text-lg text-neutral-800 mb-3">Proyectos</h3>
      <ul className="divide-y divide-neutral-100">
        {projects.map((p) => (
          <li key={p.id} className="py-2 flex items-center gap-3 text-sm">
            <Link href={`/proyectos/${p.id}`} className="font-medium text-neutral-800 hover:text-neutral-600 flex-1 min-w-0 truncate">
              {p.name}
            </Link>
            <StatusBadge value={p.status} />
            <span className="text-xs text-neutral-500 hidden sm:inline">{fmtDate(p.dueDate)}</span>
            {isAdmin && p.budgetAmount != null && (
              <span className="text-xs text-neutral-700 hidden sm:inline">{fmtMoney(p.budgetAmount, p.budgetCurrency)}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

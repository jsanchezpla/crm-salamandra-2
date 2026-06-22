"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { TrainingTable, Tr, Td } from "../../../../components/training/TrainingTable.jsx";
import { TypeBadge, ActiveBadge } from "../../../../components/training/TrainingBadge.jsx";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import ArchiveUserDialog from "../../../../components/training/ArchiveUserDialog.jsx";
import HardDeleteUserDialog from "../../../../components/training/HardDeleteUserDialog.jsx";

const LIMIT = 50;

export default function UsuariosPage() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [type, setType] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState(null);
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (type) params.set("type", type);
      if (companyId) params.set("companyId", companyId);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/training/users?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar usuarios");
      setUsers(json.data.users);
      setTotal(json.data.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [type, companyId, search, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/training/companies")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setCompanies(json.data); });
  }, []);

  function handleFilterChange(setter) {
    return (e) => { setter(e.target.value); setPage(1); };
  }

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

  function handleExport() {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (companyId) params.set("companyId", companyId);
    if (search.trim()) params.set("search", search.trim());
    window.location.href = `/api/training/users/export?${params}`;
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900 flex items-center gap-2" style={{ fontFamily: "'Syne', sans-serif" }}>
            Usuarios
            <HelpTooltip title="Usuarios">
              Todas las personas registradas en tu plataforma de formación. Aquí hay dos tipos:
              alumnos particulares (han comprado un curso por su cuenta) y empleados de empresa
              (vienen de una empresa cliente). Puedes filtrar, buscar y exportar la lista a Excel.
              {" "}<strong className="text-white">Importante:</strong> los alumnos de empresa se
              importan desde Formación → Empresas → ficha de la empresa → «Importar empleados».
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">{total} usuarios</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/formacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <span className="inline-flex items-center gap-1">
            <button
              onClick={handleExport}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 transition"
            >
              Exportar Excel
            </button>
            <HelpTooltip title="Exportar a Excel">
              Descarga un archivo Excel con todos los usuarios que cumplen los filtros que tienes ahora mismo
              activos. Útil para enviar la lista a alguien o para guardarte una copia.
            </HelpTooltip>
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <HelpTooltip title="Filtros" className="mr-1">
          Combínalos para acotar la lista. Por ejemplo: tipo «Empresa» + una empresa concreta = solo
          los empleados de esa empresa. El buscador acepta nombre, apellido o email.
        </HelpTooltip>
        <select
          value={type}
          onChange={handleFilterChange(setType)}
          className="rounded-lg px-3 py-2 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
        >
          <option value="">Todos los tipos</option>
          <option value="private">Privado</option>
          <option value="company">Empresa</option>
        </select>
        <select
          value={companyId}
          onChange={handleFilterChange(setCompanyId)}
          className="rounded-lg px-3 py-2 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
        >
          <option value="">Todas las empresas</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Buscar nombre, email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="rounded-lg px-3 py-2 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition flex-1 min-w-[180px]"
        />
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}
      {flash && (
        <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{flash}</div>
      )}

      <TrainingTable
        headers={[
          "Nombre",
          "Email",
          (
            <span key="user-h" className="inline-flex items-center gap-1">
              Username
              <HelpTooltip title="Nombre de usuario">
                El nombre que el alumno usa para entrar en el campus. Suele ser su email o un alias.
              </HelpTooltip>
            </span>
          ),
          (
            <span key="tipo-h" className="inline-flex items-center gap-1">
              Tipo
              <HelpTooltip title="Tipo de alumno">
                Privado = ha comprado el curso por su cuenta. Empresa = ha sido dado de alta a través
                de una empresa cliente (no paga él directamente).
              </HelpTooltip>
            </span>
          ),
          "Empresa",
          (
            <span key="est-h" className="inline-flex items-center gap-1">
              Estado
              <HelpTooltip title="Estado del alumno">
                Activo = tiene acceso al campus y puede entrar a sus cursos. Inactivo = el acceso está
                pausado; no puede entrar hasta que se reactive.
              </HelpTooltip>
            </span>
          ),
          "F. Nacimiento",
          "",
        ]}
        loading={loading}
        empty="No hay usuarios con los filtros actuales"
      >
        {users.map((u) => (
          <Tr key={u.id}>
            <Td>
              <span className="font-semibold text-neutral-900">
                {[u.name, u.lastName].filter(Boolean).join(" ") || "—"}
              </span>
            </Td>
            <Td>{u.email}</Td>
            <Td>{u.username || <span className="text-neutral-300">—</span>}</Td>
            <Td><TypeBadge type={u.type} /></Td>
            <Td>{u.company?.name || <span className="text-neutral-300">—</span>}</Td>
            <Td><ActiveBadge active={u.active} /></Td>
            <Td>
              {u.birthDate
                ? new Date(u.birthDate).toLocaleDateString("es-ES")
                : <span className="text-neutral-300">—</span>}
            </Td>
            <Td className="text-right">
              {!u.archivedAt && (
                <div className="inline-flex items-center gap-1">
                  <button
                    onClick={() => setArchiveTarget(u)}
                    className="text-[11px] font-medium text-neutral-400 hover:text-amber-600 transition-colors px-2 py-1 rounded-md hover:bg-amber-50"
                    title="Archivar usuario (conserva historial)"
                  >
                    Archivar
                  </button>
                  <button
                    onClick={() => setHardDeleteTarget(u)}
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

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-neutral-400">
            Página {page} de {totalPages} — {total} usuarios
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 bg-white border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition"
            >
              ← Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 bg-white border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

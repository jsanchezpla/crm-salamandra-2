"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { TrainingTable, Tr, Td } from "../../../../components/training/TrainingTable.jsx";
import { TypeBadge, ActiveBadge } from "../../../../components/training/TrainingBadge.jsx";

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

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);

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

  function handleExport() {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (companyId) params.set("companyId", companyId);
    if (search.trim()) params.set("search", search.trim());
    window.location.href = `/api/training/users/export?${params}`;
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/training/users/import", { method: "POST", body: formData });
      const json = await res.json();
      setImportResult(json.data ?? json);
      load();
    } catch (err) {
      setImportResult({ error: err.message });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
            Usuarios
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">{total} usuarios</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/formacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <button
            onClick={handleExport}
            className="px-3 py-2 rounded-lg text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 transition"
          >
            Exportar Excel
          </button>
          <label className={`px-3 py-2 rounded-lg text-xs font-semibold text-white cursor-pointer transition-opacity hover:opacity-80 ${importing ? "opacity-50 pointer-events-none" : ""}`} style={{ background: "var(--color-primary)" }}>
            {importing ? "Importando…" : "Importar empresa"}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          </label>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
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

      {importResult && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-xs border ${importResult.error ? "bg-red-50 border-red-100 text-red-600" : "bg-emerald-50 border-emerald-100 text-emerald-700"}`}>
          {importResult.error
            ? `Error: ${importResult.error}`
            : `Importados: ${importResult.imported} · Omitidos: ${importResult.skipped}${importResult.errors?.length ? ` · Errores: ${importResult.errors.length}` : ""}`}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <TrainingTable
        headers={["Nombre", "Email", "Username", "Tipo", "Empresa", "Estado", "F. Nacimiento"]}
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
          </Tr>
        ))}
      </TrainingTable>

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

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrainingTable, Tr, Td } from "../../../../components/training/TrainingTable.jsx";
import { ActiveBadge } from "../../../../components/training/TrainingBadge.jsx";

export default function EmpresasPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  // Modal nueva empresa
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/training/companies");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar empresas");
      setCompanies(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = companies.filter((c) =>
    !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/training/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al crear empresa");
      setModalOpen(false);
      setNewName("");
      load();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
            Empresas
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">{companies.length} empresas registradas</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/formacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
            style={{ background: "var(--color-primary)" }}
          >
            + Nueva empresa
          </button>
        </div>
      </div>

      {/* Buscador */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar empresa…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72 rounded-lg px-3 py-2 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
        />
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <TrainingTable
        headers={["Nombre", "Cursos", "Empleados", "Estado", ""]}
        loading={loading}
        empty="No hay empresas registradas"
      >
        {filtered.map((c) => (
          <Tr key={c.id} onClick={() => router.push(`/formacion/empresas/${c.id}`)}>
            <Td>
              <span className="font-semibold text-neutral-900">{c.name}</span>
              {c.externalId && (
                <span className="ml-2 text-[10px] text-neutral-400">#{c.externalId}</span>
              )}
            </Td>
            <Td>{c.courseCount}</Td>
            <Td>
              <EmpleadosCell activeCount={c.activeCount ?? c.userCount ?? 0} pendingCount={c.pendingCount ?? 0} />
            </Td>
            <Td><ActiveBadge active={c.active} /></Td>
            <Td className="text-right">
              <span className="text-neutral-300 text-xs">→</span>
            </Td>
          </Tr>
        ))}
      </TrainingTable>

      {/* Leyenda de contadores */}
      {!loading && filtered.length > 0 && (
        <p className="mt-3 text-[10px] text-neutral-400">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle mr-1" />
          activos · acceso al campus
          <span className="ml-3 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle mr-1" />
          pendientes · importados, esperan a registrarse
        </p>
      )}

      {/* Modal nueva empresa */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-base font-bold text-neutral-900 mb-4" style={{ fontFamily: "'Syne', sans-serif" }}>
              Nueva empresa
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-neutral-600 block mb-1">Nombre *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre de la empresa"
                  className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
                  autoFocus
                />
              </div>
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setModalOpen(false); setNewName(""); setSaveError(null); }}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !newName.trim()}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-50"
                  style={{ background: "var(--color-primary)" }}
                >
                  {saving ? "Guardando…" : "Crear empresa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function EmpleadosCell({ activeCount, pendingCount }) {
  if (!activeCount && !pendingCount) {
    return <span className="text-neutral-300">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        {activeCount} activos
      </span>
      {pendingCount > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-700">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          {pendingCount} pendientes
        </span>
      )}
    </span>
  );
}

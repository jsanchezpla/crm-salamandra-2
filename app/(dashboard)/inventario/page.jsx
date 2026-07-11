"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Select from "@/components/ui/Select.jsx";

function fmtKg(v) { return Number(v || 0).toLocaleString("es-ES", { maximumFractionDigits: 3 }); }
function fmtEur(v) { return Number(v || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString("es-ES") : ""; }
function clientLabel(c) { return c?.name || "—"; }

const TABS = [
  { key: "inbound", label: "Entrantes" },
  { key: "outbound", label: "Salientes" },
];

const EMPTY_INBOUND = { name: "", tags: "", notes: "", supplier: "", lot: "", entryDate: "", kg: "", packaging: "", purchasePrice: "" };
const EMPTY_OUTBOUND = { name: "", tags: "", defaultSalePrice: "", notes: "" };
const EMPTY_BATCH = { supplier: "", lot: "", entryDate: "", kg: "", packaging: "", purchasePrice: "" };
const EMPTY_FORMULA = { inboundProductId: "", qtyKgPerOutputKg: "1", clientId: "" };
const EMPTY_ALIAS = { clientId: "", aliasName: "", customSalePrice: "" };

export default function InventarioPage() {
  // ── State principal ──────────────────────────────────────────────────────
  const [tab, setTab] = useState("inbound");
  const [inbound, setInbound] = useState([]);
  const [outbound, setOutbound] = useState([]);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [loading, setLoading] = useState(true);

  // ── Drawer detalle ───────────────────────────────────────────────────────
  const [selectedInboundId, setSelectedInboundId] = useState(null);
  const [selectedOutboundId, setSelectedOutboundId] = useState(null);
  const [selectedInboundData, setSelectedInboundData] = useState(null);
  const [selectedOutboundData, setSelectedOutboundData] = useState(null);

  // ── Modales ──────────────────────────────────────────────────────────────
  const [newInboundOpen, setNewInboundOpen] = useState(false);
  const [newInboundForm, setNewInboundForm] = useState(EMPTY_INBOUND);
  const [newOutboundOpen, setNewOutboundOpen] = useState(false);
  const [newOutboundForm, setNewOutboundForm] = useState(EMPTY_OUTBOUND);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchForm, setBatchForm] = useState(EMPTY_BATCH);
  const [formulaModalOpen, setFormulaModalOpen] = useState(false);
  const [formulaForm, setFormulaForm] = useState(EMPTY_FORMULA);
  const [aliasModalOpen, setAliasModalOpen] = useState(false);
  const [aliasForm, setAliasForm] = useState(EMPTY_ALIAS);
  const [saving, setSaving] = useState(false);

  // ── Fetchers ─────────────────────────────────────────────────────────────
  const fetchInbound = useCallback(() => {
    const params = new URLSearchParams({ limit: "200" });
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (filterTag) params.set("tag", filterTag);
    return fetch(`/api/inventory/inbound?${params}`).then((r) => r.json());
  }, [debouncedSearch, filterTag]);

  const fetchOutbound = useCallback(() => {
    const params = new URLSearchParams({ limit: "200" });
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (filterTag) params.set("tag", filterTag);
    return fetch(`/api/inventory/outbound?${params}`).then((r) => r.json());
  }, [debouncedSearch, filterTag]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [inboundRes, outboundRes, statsRes] = await Promise.all([
        fetchInbound(),
        fetchOutbound(),
        fetch("/api/inventory/stats-v2").then((r) => r.json()),
      ]);
      if (inboundRes.ok) setInbound(inboundRes.data.products);
      if (outboundRes.ok) setOutbound(outboundRes.data.products);
      if (statsRes.ok) setStats(statsRes.data);
    } finally {
      setLoading(false);
    }
  }, [fetchInbound, fetchOutbound]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    fetch("/api/clients?limit=200")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setClients(data.data.clients || []); });
  }, []);

  // ── Detalle: cargar producto completo al abrir drawer ────────────────────
  useEffect(() => {
    if (!selectedInboundId) { setSelectedInboundData(null); return; }
    fetch(`/api/inventory/inbound/${selectedInboundId}`)
      .then((r) => r.json())
      .then((data) => { if (data.ok) setSelectedInboundData(data.data); });
  }, [selectedInboundId]);

  useEffect(() => {
    if (!selectedOutboundId) { setSelectedOutboundData(null); return; }
    fetch(`/api/inventory/outbound/${selectedOutboundId}`)
      .then((r) => r.json())
      .then((data) => { if (data.ok) setSelectedOutboundData(data.data); });
  }, [selectedOutboundId]);

  const closeDrawers = useCallback(() => {
    setSelectedInboundId(null);
    setSelectedOutboundId(null);
  }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") closeDrawers(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDrawers]);

  // ── Tags disponibles para filtro ─────────────────────────────────────────
  const availableTags = useMemo(() => {
    const set = new Set();
    inbound.forEach((p) => (p.tags || []).forEach((t) => set.add(t)));
    outbound.forEach((p) => (p.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [inbound, outbound]);

  // ── Acciones CRUD ────────────────────────────────────────────────────────
  async function createInbound() {
    setSaving(true);
    try {
      const payload = {
        name: newInboundForm.name.trim(),
        tags: newInboundForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes: newInboundForm.notes.trim() || null,
      };
      if (newInboundForm.supplier.trim() || Number(newInboundForm.kg) > 0) {
        payload.firstBatch = {
          supplier: newInboundForm.supplier.trim(),
          lot: newInboundForm.lot.trim() || null,
          entryDate: newInboundForm.entryDate || null,
          kg: newInboundForm.kg ? parseFloat(newInboundForm.kg) : 0,
          packaging: newInboundForm.packaging.trim() || null,
          purchasePrice: newInboundForm.purchasePrice ? parseFloat(newInboundForm.purchasePrice) : null,
        };
      }
      const res = await fetch("/api/inventory/inbound", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setNewInboundOpen(false);
        setNewInboundForm(EMPTY_INBOUND);
        await refresh();
      } else {
        alert(data.error || "Error al crear");
      }
    } finally {
      setSaving(false);
    }
  }

  async function createOutbound() {
    setSaving(true);
    try {
      const payload = {
        name: newOutboundForm.name.trim(),
        tags: newOutboundForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
        defaultSalePrice: newOutboundForm.defaultSalePrice ? parseFloat(newOutboundForm.defaultSalePrice) : null,
        notes: newOutboundForm.notes.trim() || null,
      };
      const res = await fetch("/api/inventory/outbound", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setNewOutboundOpen(false);
        setNewOutboundForm(EMPTY_OUTBOUND);
        await refresh();
      } else {
        alert(data.error || "Error al crear");
      }
    } finally {
      setSaving(false);
    }
  }

  async function addBatch() {
    if (!selectedInboundId) return;
    setSaving(true);
    try {
      const payload = {
        supplier: batchForm.supplier.trim(),
        lot: batchForm.lot.trim() || null,
        entryDate: batchForm.entryDate || null,
        kg: batchForm.kg ? parseFloat(batchForm.kg) : 0,
        packaging: batchForm.packaging.trim() || null,
        purchasePrice: batchForm.purchasePrice ? parseFloat(batchForm.purchasePrice) : null,
      };
      const res = await fetch(`/api/inventory/inbound/${selectedInboundId}/batches`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setBatchModalOpen(false);
        setBatchForm(EMPTY_BATCH);
        // recargar el inbound + listado
        const refreshRes = await fetch(`/api/inventory/inbound/${selectedInboundId}`).then((r) => r.json());
        if (refreshRes.ok) setSelectedInboundData(refreshRes.data);
        await refresh();
      } else {
        alert(data.error || "Error al añadir lote");
      }
    } finally {
      setSaving(false);
    }
  }

  async function addFormula() {
    if (!selectedOutboundId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/inventory/formulas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundProductId: selectedOutboundId,
          inboundProductId: formulaForm.inboundProductId,
          qtyKgPerOutputKg: parseFloat(formulaForm.qtyKgPerOutputKg),
          clientId: formulaForm.clientId || null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setFormulaModalOpen(false);
        setFormulaForm(EMPTY_FORMULA);
        const refreshRes = await fetch(`/api/inventory/outbound/${selectedOutboundId}`).then((r) => r.json());
        if (refreshRes.ok) setSelectedOutboundData(refreshRes.data);
      } else {
        alert(data.error || "Error al añadir receta");
      }
    } finally {
      setSaving(false);
    }
  }

  async function addAlias() {
    if (!selectedOutboundId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/inventory/aliases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundProductId: selectedOutboundId,
          clientId: aliasForm.clientId,
          aliasName: aliasForm.aliasName.trim(),
          customSalePrice: aliasForm.customSalePrice ? parseFloat(aliasForm.customSalePrice) : null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setAliasModalOpen(false);
        setAliasForm(EMPTY_ALIAS);
        const refreshRes = await fetch(`/api/inventory/outbound/${selectedOutboundId}`).then((r) => r.json());
        if (refreshRes.ok) setSelectedOutboundData(refreshRes.data);
      } else {
        alert(data.error || "Error al añadir alias");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteFormula(formulaId) {
    if (!confirm("¿Eliminar esta línea de receta?")) return;
    const res = await fetch(`/api/inventory/formulas/${formulaId}`, { method: "DELETE" });
    if (res.ok) {
      const refreshRes = await fetch(`/api/inventory/outbound/${selectedOutboundId}`).then((r) => r.json());
      if (refreshRes.ok) setSelectedOutboundData(refreshRes.data);
    }
  }

  async function deleteAlias(aliasId) {
    if (!confirm("¿Eliminar este alias?")) return;
    const res = await fetch(`/api/inventory/aliases/${aliasId}`, { method: "DELETE" });
    if (res.ok) {
      const refreshRes = await fetch(`/api/inventory/outbound/${selectedOutboundId}`).then((r) => r.json());
      if (refreshRes.ok) setSelectedOutboundData(refreshRes.data);
    }
  }

  async function deleteBatch(batchId) {
    if (!confirm("¿Eliminar este lote? (solo si no tiene movimientos)")) return;
    const res = await fetch(`/api/inventory/inbound/${selectedInboundId}/batches/${batchId}`, { method: "DELETE" });
    if (res.ok) {
      const refreshRes = await fetch(`/api/inventory/inbound/${selectedInboundId}`).then((r) => r.json());
      if (refreshRes.ok) setSelectedInboundData(refreshRes.data);
      await refresh();
    } else {
      const data = await res.json();
      alert(data.error || "No se pudo eliminar");
    }
  }

  async function deleteInbound(id) {
    if (!confirm("¿Eliminar este producto entrante?")) return;
    const res = await fetch(`/api/inventory/inbound/${id}`, { method: "DELETE" });
    if (res.ok) {
      closeDrawers();
      await refresh();
    } else {
      const data = await res.json();
      alert(data.error || "No se pudo eliminar");
    }
  }

  async function deleteOutbound(id) {
    if (!confirm("¿Eliminar este producto saliente?")) return;
    const res = await fetch(`/api/inventory/outbound/${id}`, { method: "DELETE" });
    if (res.ok) {
      closeDrawers();
      await refresh();
    } else {
      const data = await res.json();
      alert(data.error || "No se pudo eliminar");
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {inbound.length} entrantes · {outbound.length} salientes
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setNewInboundForm(EMPTY_INBOUND); setNewInboundOpen(true); }}
            className="px-4 py-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium rounded-lg transition-opacity"
          >
            + Producto entrante
          </button>
          <button
            onClick={() => { setNewOutboundForm(EMPTY_OUTBOUND); setNewOutboundOpen(true); }}
            className="px-4 py-2 bg-[var(--color-secondary)] hover:opacity-90 text-white text-sm font-medium rounded-lg transition-opacity"
          >
            + Producto saliente
          </button>
        </div>
      </div>

      {/* ─── KPIs ───────────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiCard label="Stock actual" value={`${fmtKg(stats.totalKgStock)} kg`} />
          <KpiCard label="Comprado" value={`${fmtKg(stats.totalKgPurchased)} kg`} sub={fmtEur(stats.totalPurchaseValue)} />
          <KpiCard label="Vendido" value={`${fmtKg(stats.totalKgSold)} kg`} sub={fmtEur(stats.totalRevenue)} />
          <KpiCard label="Margen" value={fmtEur(stats.totalMargin)} sub={`${stats.marginPercent}%`} />
          <KpiCard label="Catálogo" value={`${stats.totalInboundProducts}`} sub="productos entrantes" />
        </div>
      )}

      {/* ─── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label} ({t.key === "inbound" ? inbound.length : outbound.length})
          </button>
        ))}
      </div>

      {/* ─── Filtros ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Buscar por nombre…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
        />
        {availableTags.length > 0 && (
          <Select
            value={filterTag}
            onChange={(v) => setFilterTag(v)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
            options={[
              { value: "", label: "Todas las etiquetas" },
              ...availableTags.map((t) => ({ value: t, label: t })),
            ]}
          />
        )}
      </div>

      {/* ─── Contenido ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Cargando…</div>
      ) : tab === "inbound" ? (
        <InboundTable products={inbound} onSelect={(id) => setSelectedInboundId(id)} />
      ) : (
        <OutboundTable products={outbound} onSelect={(id) => setSelectedOutboundId(id)} />
      )}

      {/* ─── Drawer entrante ────────────────────────────────────────────── */}
      {selectedInboundId && (
        <Drawer onClose={closeDrawers} title={selectedInboundData?.name || "Cargando…"}>
          {selectedInboundData ? (
            <InboundDetail
              product={selectedInboundData}
              clients={clients}
              onAddBatch={() => { setBatchForm(EMPTY_BATCH); setBatchModalOpen(true); }}
              onDeleteBatch={deleteBatch}
              onDelete={() => deleteInbound(selectedInboundData.id)}
            />
          ) : (
            <div className="p-6 text-sm text-gray-400">Cargando…</div>
          )}
        </Drawer>
      )}

      {/* ─── Drawer saliente ────────────────────────────────────────────── */}
      {selectedOutboundId && (
        <Drawer onClose={closeDrawers} title={selectedOutboundData?.name || "Cargando…"}>
          {selectedOutboundData ? (
            <OutboundDetail
              product={selectedOutboundData}
              clients={clients}
              inboundCatalog={inbound}
              onAddFormula={() => { setFormulaForm(EMPTY_FORMULA); setFormulaModalOpen(true); }}
              onDeleteFormula={deleteFormula}
              onAddAlias={() => { setAliasForm(EMPTY_ALIAS); setAliasModalOpen(true); }}
              onDeleteAlias={deleteAlias}
              onDelete={() => deleteOutbound(selectedOutboundData.id)}
            />
          ) : (
            <div className="p-6 text-sm text-gray-400">Cargando…</div>
          )}
        </Drawer>
      )}

      {/* ─── Modales ────────────────────────────────────────────────────── */}
      {newInboundOpen && (
        <Modal title="Nuevo producto entrante" onClose={() => setNewInboundOpen(false)}>
          <NewInboundForm form={newInboundForm} setForm={setNewInboundForm} />
          <ModalFooter
            saving={saving}
            onCancel={() => setNewInboundOpen(false)}
            onSave={createInbound}
            disabled={!newInboundForm.name.trim()}
          />
        </Modal>
      )}

      {newOutboundOpen && (
        <Modal title="Nuevo producto saliente" onClose={() => setNewOutboundOpen(false)}>
          <NewOutboundForm form={newOutboundForm} setForm={setNewOutboundForm} />
          <ModalFooter
            saving={saving}
            onCancel={() => setNewOutboundOpen(false)}
            onSave={createOutbound}
            disabled={!newOutboundForm.name.trim()}
          />
        </Modal>
      )}

      {batchModalOpen && (
        <Modal title="Nuevo lote / proveedor" onClose={() => setBatchModalOpen(false)}>
          <BatchForm form={batchForm} setForm={setBatchForm} />
          <ModalFooter
            saving={saving}
            onCancel={() => setBatchModalOpen(false)}
            onSave={addBatch}
            disabled={!batchForm.supplier.trim()}
          />
        </Modal>
      )}

      {formulaModalOpen && (
        <Modal title="Añadir línea a la receta" onClose={() => setFormulaModalOpen(false)}>
          <FormulaForm form={formulaForm} setForm={setFormulaForm} inboundCatalog={inbound} clients={clients} />
          <ModalFooter
            saving={saving}
            onCancel={() => setFormulaModalOpen(false)}
            onSave={addFormula}
            disabled={!formulaForm.inboundProductId || !(Number(formulaForm.qtyKgPerOutputKg) > 0)}
          />
        </Modal>
      )}

      {aliasModalOpen && (
        <Modal title="Alias del producto para un cliente" onClose={() => setAliasModalOpen(false)}>
          <AliasForm form={aliasForm} setForm={setAliasForm} clients={clients} />
          <ModalFooter
            saving={saving}
            onCancel={() => setAliasModalOpen(false)}
            onSave={addAlias}
            disabled={!aliasForm.clientId || !aliasForm.aliasName.trim()}
          />
        </Modal>
      )}
    </div>
  );
}

// ─── Componentes auxiliares ────────────────────────────────────────────────

function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-lg lg:text-xl font-semibold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function TagPills({ tags }) {
  if (!tags || tags.length === 0) return <span className="text-xs text-gray-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded-full">{t}</span>
      ))}
    </div>
  );
}

function InboundTable({ products, onSelect }) {
  if (products.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">No hay productos entrantes</div>;
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Producto</th>
            <th className="text-left px-4 py-3 font-medium">Etiquetas</th>
            <th className="text-left px-4 py-3 font-medium">Proveedores</th>
            <th className="text-right px-4 py-3 font-medium">Lotes</th>
            <th className="text-right px-4 py-3 font-medium">Stock</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} onClick={() => onSelect(p.id)} className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer">
              <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
              <td className="px-4 py-3"><TagPills tags={p.tags} /></td>
              <td className="px-4 py-3 text-gray-600 text-xs">
                {(p.suppliers || []).length === 0 ? <span className="text-gray-300">—</span> : (p.suppliers || []).join(", ")}
              </td>
              <td className="px-4 py-3 text-right text-gray-600">{(p.batches || []).length}</td>
              <td className="px-4 py-3 text-right font-medium text-gray-900">{fmtKg(p.stockKg)} kg</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutboundTable({ products, onSelect }) {
  if (products.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">No hay productos salientes</div>;
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Producto</th>
            <th className="text-left px-4 py-3 font-medium">Etiquetas</th>
            <th className="text-right px-4 py-3 font-medium">Componentes</th>
            <th className="text-right px-4 py-3 font-medium">Alias clientes</th>
            <th className="text-right px-4 py-3 font-medium">Precio base</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} onClick={() => onSelect(p.id)} className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer">
              <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
              <td className="px-4 py-3"><TagPills tags={p.tags} /></td>
              <td className="px-4 py-3 text-right text-gray-600">{(p.components || []).length}</td>
              <td className="px-4 py-3 text-right text-gray-600">{(p.aliases || []).length}</td>
              <td className="px-4 py-3 text-right text-gray-900">
                {p.defaultSalePrice ? fmtEur(p.defaultSalePrice) + "/kg" : <span className="text-gray-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Drawer({ title, onClose, children }) {
  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-14 lg:top-0 right-0 bottom-0 w-full lg:w-[640px] bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 truncate">{title}</h2>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </>,
    document.body
  );
}

function InboundDetail({ product, clients, onAddBatch, onDeleteBatch, onDelete }) {
  const usedIn = product.formulaUses || [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
      {/* Izquierda: datos + lotes */}
      <div className="p-6 space-y-5">
        <div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Stock actual</div>
          <div className="text-2xl font-semibold text-gray-900">{fmtKg(product.stockKg)} kg</div>
        </div>

        <div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Etiquetas</div>
          <TagPills tags={product.tags} />
        </div>

        {product.notes && (
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notas</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{product.notes}</div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Lotes / proveedores ({(product.batches || []).length})
            </div>
            <button onClick={onAddBatch} className="text-xs text-[var(--color-primary)] hover:underline">+ Añadir</button>
          </div>
          {(product.batches || []).length === 0 ? (
            <div className="text-sm text-gray-400">Sin lotes registrados</div>
          ) : (
            <div className="space-y-2">
              {product.batches.map((b) => (
                <div key={b.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{b.supplier}{b.lot ? ` (lote ${b.lot})` : ""}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {fmtDate(b.entryDate)} · {fmtKg(b.kgRemaining)}/{fmtKg(b.kg)} kg
                        {b.purchasePrice ? ` · ${fmtEur(b.purchasePrice)}/kg` : ""}
                      </div>
                    </div>
                    <button onClick={() => onDeleteBatch(b.id)} className="text-xs text-red-400 hover:text-red-600 ml-2">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700">
          Eliminar producto entrante
        </button>
      </div>

      {/* Derecha: productos salientes que lo usan */}
      <div className="p-6 space-y-3">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          Se usa en {usedIn.length} producto{usedIn.length === 1 ? "" : "s"} saliente{usedIn.length === 1 ? "" : "s"}
        </div>
        {usedIn.length === 0 ? (
          <div className="text-sm text-gray-400">Este producto entrante no se usa en ninguna receta todavía. Añade una receta desde la ficha del producto saliente correspondiente.</div>
        ) : (
          <div className="space-y-2">
            {usedIn.map((f) => (
              <div key={f.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                <div className="font-medium text-gray-900">{f.outboundProduct?.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {Number(f.qtyKgPerOutputKg).toFixed(4)} kg input/kg output
                  {f.clientId ? ` · cliente: ${clientLabel(f.client)}` : " · receta global"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OutboundDetail({ product, clients, inboundCatalog, onAddFormula, onDeleteFormula, onAddAlias, onDeleteAlias, onDelete }) {
  const components = product.components || [];
  const aliases = product.aliases || [];

  const globalFormulas = components.filter((f) => !f.clientId);
  const clientFormulas = components.filter((f) => f.clientId);
  const formulasByClient = {};
  for (const f of clientFormulas) {
    const key = f.clientId;
    if (!formulasByClient[key]) formulasByClient[key] = { client: f.client, formulas: [] };
    formulasByClient[key].formulas.push(f);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
      {/* Izquierda: datos */}
      <div className="p-6 space-y-5">
        <div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Precio base</div>
          <div className="text-xl font-semibold text-gray-900">
            {product.defaultSalePrice ? `${fmtEur(product.defaultSalePrice)}/kg` : <span className="text-gray-300 text-base">Sin definir</span>}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Etiquetas</div>
          <TagPills tags={product.tags} />
        </div>

        {product.notes && (
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notas</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{product.notes}</div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Alias por cliente ({aliases.length})
            </div>
            <button onClick={onAddAlias} className="text-xs text-[var(--color-primary)] hover:underline">+ Añadir</button>
          </div>
          {aliases.length === 0 ? (
            <div className="text-sm text-gray-400">Sin alias. El producto se vende a todos los clientes con el nombre <strong>{product.name}</strong>.</div>
          ) : (
            <div className="space-y-2">
              {aliases.map((a) => (
                <div key={a.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{a.aliasName}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Para {clientLabel(a.client)}
                        {a.customSalePrice ? ` · ${fmtEur(a.customSalePrice)}/kg` : ""}
                      </div>
                    </div>
                    <button onClick={() => onDeleteAlias(a.id)} className="text-xs text-red-400 hover:text-red-600 ml-2">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700">
          Eliminar producto saliente
        </button>
      </div>

      {/* Derecha: recetas */}
      <div className="p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Receta global
            </div>
            <button onClick={onAddFormula} className="text-xs text-[var(--color-primary)] hover:underline">+ Añadir</button>
          </div>
          {globalFormulas.length === 0 ? (
            <div className="text-sm text-gray-400">Sin receta global definida</div>
          ) : (
            <div className="space-y-1.5">
              {globalFormulas.map((f) => (
                <div key={f.id} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2">
                  <div>
                    <div className="font-medium text-gray-900">{f.inboundProduct?.name}</div>
                    <div className="text-xs text-gray-500">{Number(f.qtyKgPerOutputKg).toFixed(4)} kg / kg output</div>
                  </div>
                  <button onClick={() => onDeleteFormula(f.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {Object.keys(formulasByClient).length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Recetas por cliente
            </div>
            <div className="space-y-3">
              {Object.entries(formulasByClient).map(([clientId, group]) => (
                <div key={clientId} className="border border-gray-100 rounded-lg p-3">
                  <div className="font-medium text-sm text-gray-900 mb-2">{clientLabel(group.client)}</div>
                  <div className="space-y-1.5">
                    {group.formulas.map((f) => (
                      <div key={f.id} className="flex items-center justify-between text-sm">
                        <div>
                          <span className="text-gray-700">{f.inboundProduct?.name}</span>
                          <span className="text-xs text-gray-500 ml-2">{Number(f.qtyKgPerOutputKg).toFixed(4)} kg/kg</span>
                        </div>
                        <button onClick={() => onDeleteFormula(f.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modales ───────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function ModalFooter({ saving, disabled, onSave, onCancel }) {
  return (
    <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2">
      <button onClick={onSave} disabled={saving || disabled}
        className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-50">
        {saving ? "Guardando…" : "Guardar"}
      </button>
      <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">
        Cancelar
      </button>
    </div>
  );
}

function Field({ label, children, optional }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{optional && <span className="text-gray-300 ml-1">(opcional)</span>}
      </label>
      {children}
    </div>
  );
}

function Input(props) {
  return <input {...props} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />;
}

function NewInboundForm({ form, setForm }) {
  return (
    <div className="p-6 space-y-3 overflow-y-auto">
      <Field label="Nombre">
        <Input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Etiquetas (separadas por coma)" optional>
        <Input type="text" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="ej: industrial, panificación" />
      </Field>
      <Field label="Notas" optional>
        <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none" />
      </Field>
      <div className="pt-2 border-t border-gray-100">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Primer lote (opcional)</div>
        <div className="space-y-3">
          <Field label="Proveedor" optional>
            <Input type="text" value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha entrada" optional>
              <Input type="date" value={form.entryDate} onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))} />
            </Field>
            <Field label="Lote" optional>
              <Input type="text" value={form.lot} onChange={(e) => setForm((f) => ({ ...f, lot: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kg" optional>
              <Input type="number" step="0.001" value={form.kg} onChange={(e) => setForm((f) => ({ ...f, kg: e.target.value }))} />
            </Field>
            <Field label="€/kg compra" optional>
              <Input type="number" step="0.01" value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} />
            </Field>
          </div>
          <Field label="Embalaje" optional>
            <Input type="text" value={form.packaging} onChange={(e) => setForm((f) => ({ ...f, packaging: e.target.value }))} />
          </Field>
        </div>
      </div>
    </div>
  );
}

function NewOutboundForm({ form, setForm }) {
  return (
    <div className="p-6 space-y-3">
      <Field label="Nombre">
        <Input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Etiquetas (separadas por coma)" optional>
        <Input type="text" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="ej: granel, especialidad" />
      </Field>
      <Field label="Precio base (€/kg)" optional>
        <Input type="number" step="0.01" value={form.defaultSalePrice} onChange={(e) => setForm((f) => ({ ...f, defaultSalePrice: e.target.value }))} />
      </Field>
      <Field label="Notas" optional>
        <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none" />
      </Field>
    </div>
  );
}

function BatchForm({ form, setForm }) {
  return (
    <div className="p-6 space-y-3">
      <Field label="Proveedor">
        <Input type="text" value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha entrada" optional>
          <Input type="date" value={form.entryDate} onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))} />
        </Field>
        <Field label="Lote" optional>
          <Input type="text" value={form.lot} onChange={(e) => setForm((f) => ({ ...f, lot: e.target.value }))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kg">
          <Input type="number" step="0.001" value={form.kg} onChange={(e) => setForm((f) => ({ ...f, kg: e.target.value }))} />
        </Field>
        <Field label="€/kg compra" optional>
          <Input type="number" step="0.01" value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} />
        </Field>
      </div>
      <Field label="Embalaje" optional>
        <Input type="text" value={form.packaging} onChange={(e) => setForm((f) => ({ ...f, packaging: e.target.value }))} />
      </Field>
    </div>
  );
}

function FormulaForm({ form, setForm, inboundCatalog, clients }) {
  return (
    <div className="p-6 space-y-3">
      <Field label="Producto entrante">
        <Select value={form.inboundProductId} onChange={(v) => setForm((f) => ({ ...f, inboundProductId: v }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
          options={[
            { value: "", label: "— Elegir —" },
            ...inboundCatalog.map((p) => ({ value: p.id, label: p.name })),
          ]} />
      </Field>
      <Field label="Cantidad (kg entrada por kg salida)">
        <Input type="number" step="0.0001" value={form.qtyKgPerOutputKg} onChange={(e) => setForm((f) => ({ ...f, qtyKgPerOutputKg: e.target.value }))} />
      </Field>
      <Field label="Específica para cliente" optional>
        <Select value={form.clientId} onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
          options={[
            { value: "", label: "— Receta global (todos los clientes) —" },
            ...clients.map((c) => ({ value: c.id, label: c.name })),
          ]} />
      </Field>
    </div>
  );
}

function AliasForm({ form, setForm, clients }) {
  return (
    <div className="p-6 space-y-3">
      <Field label="Cliente">
        <Select value={form.clientId} onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
          options={[
            { value: "", label: "— Elegir —" },
            ...clients.map((c) => ({ value: c.id, label: c.name })),
          ]} />
      </Field>
      <Field label="Nombre del producto para este cliente">
        <Input type="text" value={form.aliasName} onChange={(e) => setForm((f) => ({ ...f, aliasName: e.target.value }))} placeholder="ej: Enzima Premium B" />
      </Field>
      <Field label="Precio especial (€/kg)" optional>
        <Input type="number" step="0.01" value={form.customSalePrice} onChange={(e) => setForm((f) => ({ ...f, customSalePrice: e.target.value }))} />
      </Field>
    </div>
  );
}

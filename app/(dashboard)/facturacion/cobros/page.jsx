"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import Link from "next/link";
import StatusBadge from "../_components/StatusBadge.jsx";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../_components/tableSort.jsx";
import Select from "@/components/ui/Select.jsx";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";
import ExportButtons from "@/components/billing/ExportButtons.jsx";
import FacturarMesDrawer from "../_components/FacturarMesDrawer.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import { partesConProrrateo } from "../../../../lib/billing/prorrateo.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const METHOD_LABELS = {
  card: "Tarjeta",
  transfer: "Transferencia",
  cash: "Efectivo",
  direct_debit: "Domiciliación",
};

export default function CobrosPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [me, setMe] = useState(null);
  /*
   * Facturar lo hace quien tiene el MÓDULO de Facturación, no solo quien manda
   * (14/08/2026, Rodrigo — la regla, en lib/auth/permisos.js). En Aumenta son
   * Olga y Rosa: rol `user`, y son las que llevan la contabilidad. Esto era
   * `me.role === "admin"` y las dejaba mirando la pantalla entera sin poder
   * pulsar un botón — ni siquiera apuntar un cobro.
   *
   * `Boolean(me)` y no `true`: mientras /api/auth/me va y viene no hay que
   * enseñar botones que a lo mejor luego se quitan.
   */
  const puedeFacturar = Boolean(me);

  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  // `modo`: "factura" (cobro de una factura emitida) o "cuota" (el flujo real
  // del centro: se cobra la mensualidad y se factura después). El mes es lo que
  // abre los documentos de esa familia en su área privada.
  const [form, setForm] = useState({ modo: "factura", invoiceId: "", clientId: "", periodMonth: new Date().toISOString().slice(0, 7), amount: "", method: "transfer", paidAt: new Date().toISOString().slice(0, 10), notes: "" });
  const [editing, setEditing] = useState(null); // cobro que se está editando
  // Facturas abiertas del cliente del cobro que se edita, para poder ASOCIAR
  // un cobro suelto a la factura que se emitió después (31/08/2026).
  const [facturasCliente, setFacturasCliente] = useState([]);
  const [showFacturarMes, setShowFacturarMes] = useState(false);
  const [morosidad, setMorosidad] = useState(null);
  const [mesMorosidad, setMesMorosidad] = useState(new Date().toISOString().slice(0, 7));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  // Cuota compuesta desde el catálogo (31/08/2026, formación con Rosa): la
  // cuota puede llevar VARIOS conceptos (dos hermanos, cuota + descuento) y,
  // si la familia empieza a mitad de mes, la parte proporcional se calcula
  // sola (lib/billing/prorrateo.js). Los conceptos van por índice, no por Set:
  // el mismo concepto dos veces es legítimo (dos hermanos, misma cuota).
  // La fecha de inicio va POR CONCEPTO (31/08/2026, Rodrigo): empezó el 13
  // con logopedia y el 17 con psicología, y cada servicio paga lo suyo.
  const [conceptosCatalogo, setConceptosCatalogo] = useState([]);
  const [lineasCuota, setLineasCuota] = useState([]); // [{ id, inicio }]

  const conceptosElegidos = lineasCuota
    .map(({ id, inicio }) => {
      const c = conceptosCatalogo.find((c2) => String(c2.id) === String(id));
      return c ? { c, inicio } : null;
    })
    .filter(Boolean);
  const cuentaCuota = partesConProrrateo(
    conceptosElegidos.map(({ c, inicio }) => ({ importe: Number(c.unitPrice || 0), inicio }))
  );

  // El importe se rellena solo al tocar conceptos o fecha de inicio, desde el
  // HANDLER (no un efecto): así un importe retocado a mano solo se pisa cuando
  // el usuario vuelve a tocar la composición de la cuota.
  function aplicarImporteCuota(items) {
    const partes = items
      .map(({ id, inicio }) => {
        const c = conceptosCatalogo.find((c2) => String(c2.id) === String(id));
        return c ? { importe: Number(c.unitPrice || 0), inicio } : null;
      })
      .filter(Boolean);
    if (!partes.length) return;
    setForm((f) => ({ ...f, amount: String(partesConProrrateo(partes).total) }));
  }
  function addConceptoCuota(id) {
    if (!id) return;
    const items = [...lineasCuota, { id, inicio: "" }];
    setLineasCuota(items);
    aplicarImporteCuota(items);
  }
  function quitarConceptoCuota(idx) {
    const items = lineasCuota.filter((_, i) => i !== idx);
    setLineasCuota(items);
    aplicarImporteCuota(items);
  }
  function cambiarInicioConcepto(idx, fecha) {
    const items = lineasCuota.map((it, i) => (i === idx ? { ...it, inicio: fecha } : it));
    setLineasCuota(items);
    aplicarImporteCuota(items);
  }

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterMethod, setFilterMethod] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const { sortKey, sortDir, toggle: toggleSort } = useSortState("paidAt", "desc");

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // «Cobrar» desde el menú contextual de la agenda (31/08/2026): llega como
  // /facturacion/cobros?abrir=cuota&cliente=<id> y el drawer se abre solo en
  // modo cuota con el cliente puesto. window.location y no useSearchParams:
  // se lee UNA vez al montar y no obliga a suspender la página.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("abrir") !== "cuota") return;
    const clientId = sp.get("cliente") || "";
    setForm((f) => ({ ...f, modo: "cuota", clientId: clientId || f.clientId }));
    setShowForm(true);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    // Las fichas ya no se bajan aquí (28/08/2026). Este `limit=300` recibía 200,
    // porque /api/clients corta por su cuenta: con las 1.083 de Aumenta se
    // quedaban fuera 883 familias y no había forma de llegar a ellas. Ahora
    // pregunta SelectorCliente al servidor según se escribe.
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({ limit: 100, sortBy: sortKey, sortDir });
      if (filterMethod) params.set("method", filterMethod);
      if (filterStatus) params.set("status", filterStatus);
      // La búsqueda va al SERVIDOR (31/08/2026): filtrar aquí solo veía los
      // 100 cargados y un cobro antiguo no aparecía por mucho que se buscara.
      if (search) params.set("q", search);
      const res = await fetch(`/api/billing/payments?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setPayments(json.data?.payments ?? []);
    } catch (e) {
      setErrorMsg(e.message);
    } finally { setLoading(false); }
  }, [sortKey, sortDir, filterMethod, filterStatus, search]);

  useEffect(() => { load(); }, [load]);

  // Cargar facturas pendientes para el selector
  useEffect(() => {
    if (!showForm) return;
    Promise.all([
      fetch("/api/billing/invoices?status=issued&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=sent&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=partially_paid&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=overdue&limit=100", { cache: "no-store" }).then((r) => r.json()),
    ]).then((results) => {
      const merged = [];
      for (const r of results) merged.push(...(r.data?.invoices ?? []));
      // Ordenar por fecha desc
      merged.sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));
      setUnpaidInvoices(merged);
    }).catch(() => {});
  }, [showForm]);

  // El catálogo de conceptos, para componer la cuota. Si está vacío o el
  // fetch falla, el bloque no se enseña y el formulario queda como siempre:
  // importe a mano.
  useEffect(() => {
    if (!showForm) return;
    fetch("/api/billing/conceptos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setConceptosCatalogo(j.data?.conceptos ?? []))
      .catch(() => {});
  }, [showForm]);

  // Al abrir la edición de un cobro SIN factura, se cargan las facturas
  // abiertas de su cliente para el desplegable de «Asociar a factura». Solo
  // las suyas: asociar a la de otro cliente lo rechaza igualmente el PATCH.
  useEffect(() => {
    if (!editing || editing.invoice?.id || !editing.clientId) { setFacturasCliente([]); return; }
    Promise.all(
      ["issued", "sent", "partially_paid", "overdue"].map((st) =>
        fetch(`/api/billing/invoices?clientId=${editing.clientId}&status=${st}&limit=100`, { cache: "no-store" }).then((r) => r.json())
      )
    ).then((results) => {
      const merged = [];
      for (const r of results) merged.push(...(r.data?.invoices ?? []));
      merged.sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));
      setFacturasCliente(merged);
    }).catch(() => setFacturasCliente([]));
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // method y status se filtran en backend; aquí solo búsqueda libre por texto
  // La búsqueda ya la hizo el SERVIDOR (31/08/2026, lib/billing/busquedaCobros):
  // volver a filtrar aquí solo podía QUITAR resultados que el servidor sí
  // encontró (p. ej. por el nombre del cliente de la factura, que esta lista
  // no siempre trae plano).
  const filtered = payments;

  const totalCollected = useMemo(
    () => filtered.filter((p) => p.status === "completed").reduce((s, p) => s + Number(p.amount || 0), 0),
    [filtered]
  );

  const loadMorosidad = useCallback(() => {
    fetch(`/api/billing/morosidad?mes=${mesMorosidad}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMorosidad(j?.data ?? null))
      .catch(() => {});
  }, [mesMorosidad]);

  useEffect(() => { loadMorosidad(); }, [loadMorosidad]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const porFactura = form.modo === "factura";
      if (porFactura && !form.invoiceId) throw new Error("Selecciona una factura");
      if (!porFactura && !form.clientId) throw new Error("Selecciona el cliente que ha pagado");
      // Qué conceptos componen la cuota (y el prorrateo de cada uno, si lo
      // hay) queda escrito en la nota del cobro: es lo que Rosa lee meses
      // después.
      const notaConceptos = !porFactura && conceptosElegidos.length
        ? `Cuota: ${conceptosElegidos
            .map(({ c }, i) => {
              const r = cuentaCuota.partes[i]?.rotulo;
              return r ? `${c.name} (${r})` : c.name;
            })
            .join(" + ")}`
        : "";
      const res = await fetch("/api/billing/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: porFactura ? form.invoiceId : null,
          clientId: porFactura ? null : form.clientId,
          periodMonth: porFactura ? null : form.periodMonth,
          amount: Number(form.amount),
          method: form.method,
          paidAt: form.paidAt,
          notes: [notaConceptos, form.notes].filter(Boolean).join(" — ") || null,
          // La terapia del cobro, para que «Facturar el mes» pueda agrupar por
          // concepto: solo cuando la cuota es de UN concepto (una compuesta no
          // se puede partir por terapia).
          conceptId: !porFactura && conceptosElegidos.length === 1 ? conceptosElegidos[0].c.id : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setForm((f) => ({ ...f, invoiceId: "", clientId: "", amount: "", notes: "" }));
      setLineasCuota([]);
      setShowForm(false);
      load();
      loadMorosidad();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/billing/payments/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(editing.amount),
          method: editing.method,
          paidAt: editing.paidAt,
          notes: editing.notes || null,
          status: editing.status,
          // La clave solo viaja si se ELIGIÓ factura: mandarla vacía sería
          // pedirle al PATCH que desasocie.
          ...(editing.asociarFacturaId ? { invoiceId: editing.asociarFacturaId } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo guardar");
      setEditing(null);
      load();
      loadMorosidad();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function selectInvoice(invId) {
    const inv = unpaidInvoices.find((i) => i.id === invId);
    if (!inv) return;
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paidAmount || 0));
    setForm((f) => ({ ...f, invoiceId: invId, amount: remaining.toFixed(2) }));
  }

  const exportParams = new URLSearchParams();
  if (filterMethod) exportParams.set("method", filterMethod);
  if (filterStatus) exportParams.set("status", filterStatus);
  const exportUrl = `/api/billing/exports/payments${exportParams.toString() ? `?${exportParams}` : ""}`;

  return (
    <div className={anchoPantalla("listado")}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Tesorería</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Cobros
            <HelpTooltip title="Cobros" placement="bottom">
              El dinero que ha entrado de verdad, factura a factura. Una factura emitida NO es
              dinero cobrado: hasta que se registra aquí, sigue debiéndose.
              {" "}
              <strong className="text-white">La morosidad está en esta misma pantalla</strong> —
              son las facturas vencidas sin cobro registrado, no una lista aparte.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Total cobrado: <span className="font-semibold text-emerald-700 tabular">{fmtMoney(totalCollected)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          <ExportButtons xlsxUrl={exportUrl} />
          {puedeFacturar && (
            <button
              onClick={() => setShowFacturarMes(true)}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-[var(--color-primary,#1B3A2D)] border border-[var(--color-primary,#1B3A2D)] hover:bg-neutral-50 transition-colors"
            >Facturar el mes</button>
          )}
          {puedeFacturar && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >+ Registrar cobro</button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por cliente, nº factura, método, notas..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <Select value={filterMethod} onChange={(v) => setFilterMethod(v)}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
          options={[
            { value: "", label: "Todos los métodos" },
            ...Object.entries(METHOD_LABELS).map(([k, v]) => ({ value: k, label: v })),
          ]}
        />
        <Select value={filterStatus} onChange={(v) => setFilterStatus(v)}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
          options={[
            { value: "", label: "Todos los estados" },
            { value: "completed", label: "Completado" },
            { value: "pending", label: "Pendiente" },
            { value: "failed", label: "Fallido" },
            { value: "refunded", label: "Reembolsado" },
          ]}
        />
        {(searchInput || filterMethod || filterStatus) && (
          <button onClick={() => { setSearchInput(""); setFilterMethod(""); setFilterStatus(""); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors">Limpiar</button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      {/* ── Morosidad ── quién no ha pagado el mes. Mismo criterio que abre los
          documentos del portal, para que Cobros y el área privada no se
          contradigan. */}
      {morosidad?.aplicable && (
        <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-neutral-100 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-neutral-800">Morosidad</span>
            <input
              type="month"
              value={mesMorosidad}
              onChange={(e) => setMesMorosidad(e.target.value)}
              className="rounded-lg px-2.5 py-1 text-xs border border-neutral-200"
            />
            <span className="text-[11px] text-neutral-400">
              {morosidad.morosos.length} sin pagar · {morosidad.alDia} al día · {morosidad.familias} familias con paciente activo
            </span>
          </div>
          {morosidad.sinCobros ? (
            <div className="px-4 py-5 text-xs text-amber-800 bg-amber-50/60">
              Aún no hay ningún cobro registrado en el CRM, así que aquí no se acusa a nadie:
              la morosidad empezará a decir la verdad con los primeros cobros que registres
              (a mano o con «Facturar el mes»).
            </div>
          ) : morosidad.morosos.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-neutral-400">Nadie debe este mes.</div>
          ) : (
            <ul className="divide-y divide-neutral-50 max-h-64 overflow-y-auto">
              {morosidad.morosos.map((m) => (
                <li key={m.clientId} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                  <Link href={`/clientes/${m.clientId}`} className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline min-w-0 flex-1 truncate">
                    {m.name}
                  </Link>
                  <span className="text-[11px] text-neutral-500">{m.phone || m.email || "sin contacto"}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${m.mesesSeguidos >= 3 ? "bg-red-50 text-red-700" : m.mesesSeguidos === 2 ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>
                    {m.mesesSeguidos === 1 ? "1 mes" : `${m.mesesSeguidos} meses`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-neutral-100">
                {/* Sin onClick = cabecera no ordenable (así lo decide
                    SortableTh). El cliente llega por dos caminos —enlace
                    directo del cobro o su factura— y un solo ORDER BY no puede
                    con los dos: antes que una flecha que ordena mal, ninguna. */}
                <SortableTh k="clientName" label="Cliente" />
                <SortableTh k="invoice.number" label="Factura" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="method" label="Método" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="paidAt" label="Fecha" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="status" label="Estado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="amount" label="Importe" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                {/* El salto al dinero de verdad (29/08/2026): el movimiento del
                    banco casado (módulo Banco) o la página del cobro en Stripe.
                    Sin ordenar: es un enlace, no un dato. */}
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Movimiento</th>
                {puedeFacturar && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Sin cobros{(search || filterMethod || filterStatus) ? " que coincidan con los filtros" : " registrados"}</td></tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                  <td className="px-4 py-3 text-neutral-800 text-xs">{p.clientName ?? "—"}</td>
                  {/* Enlace a la factura: el flujo real es cobro → factura, y
                      desde el cobro hay que poder saltar a la suya. Un cobro
                      registrado antes de facturar todavía no tiene ninguna. */}
                  <td className="px-4 py-3 font-mono text-xs">
                    {p.invoice?.id ? (
                      <Link href={`/facturacion/facturas/${p.invoice.id}`} className="text-[var(--color-primary,#1B3A2D)] hover:underline">
                        {p.invoice.number}
                      </Link>
                    ) : (
                      <span className="text-amber-600" title="Cobro registrado sin factura todavía">
                        sin factura{p.periodMonth ? ` · ${String(p.periodMonth).slice(0, 7)}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 text-xs">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{fmtDate(p.paidAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} kind="payment" /></td>
                  <td className="px-4 py-3 text-right font-semibold text-neutral-900 tabular">{fmtMoney(p.amount)}</td>
                  {/* De un cobro al dinero de verdad, en un clic: el movimiento
                      del banco si está conciliado, y la página de Stripe si el
                      cobro entró por tarjeta online. Un cobro a mano sin
                      conciliar no tiene a dónde saltar todavía. */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {p.bankTransactionId && (
                        <Link
                          href={`/facturacion/banco?mov=${p.bankTransactionId}`}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                          title="Ver el movimiento del banco con el que está conciliado"
                        >
                          Banco
                        </Link>
                      )}
                      {p.stripeUrl && (
                        <a
                          href={p.stripeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                          title="Ver este cobro en el panel de Stripe"
                        >
                          Stripe ↗
                        </a>
                      )}
                      {!p.bankTransactionId && !p.stripeUrl && <span className="text-neutral-300 text-xs">—</span>}
                    </div>
                  </td>
                  {puedeFacturar && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing({ ...p, paidAt: String(p.paidAt).slice(0, 10) })}
                        className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline"
                      >
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DRAWER */}
      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowForm(false)} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Registrar</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1">Nuevo cobro</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreate} className="px-6 py-5 space-y-3">
              {/* El centro cobra la cuota y factura después: obligar a elegir
                  factura dejaba ese dinero sin registrar. */}
              <FormRow label="¿De qué es el cobro?">
                <div className="flex gap-2">
                  {[["factura", "De una factura"], ["cuota", "Cuota del mes"]].map(([k, lbl]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, modo: k }))}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition ${form.modo === k ? "border-transparent text-white" : "bg-white border-neutral-200 text-neutral-500"}`}
                      style={form.modo === k ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </FormRow>

              {form.modo === "cuota" && (
                <>
                  <FormRow label="Cliente *">
                    <SelectorCliente
                      value={form.clientId}
                      onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
                      className={inputCls}
                      opcionesFijas={[{ value: "", label: "Selecciona cliente..." }]}
                    />
                  </FormRow>
                  <FormRow label="Mes que se paga *">
                    <input type="month" required value={form.periodMonth}
                      onChange={(e) => setForm((f) => ({ ...f, periodMonth: e.target.value }))} className={inputCls} />
                  </FormRow>
                  <p className="text-[10px] text-neutral-400 -mt-1">
                    Al registrarlo, si el centro tiene activado el bloqueo por impago, la familia
                    pasa a ver los documentos de ese mes en su área privada.
                  </p>
                  {conceptosCatalogo.length > 0 && (
                    <FormRow label="Conceptos de la cuota">
                      <div className="space-y-1.5">
                        {conceptosElegidos.map(({ c, inicio }, i) => {
                          const parte = cuentaCuota.partes[i];
                          return (
                            <div key={i} className="text-xs bg-neutral-50 border border-neutral-100 rounded-lg px-2.5 py-1.5 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-neutral-700 truncate">{c.name}</span>
                                <span className="flex items-center gap-2 shrink-0">
                                  <span className="text-neutral-500">{fmtMoney(parte.importe)}</span>
                                  <button type="button" onClick={() => quitarConceptoCuota(i)}
                                    className="text-neutral-300 hover:text-red-500 transition-colors" aria-label="Quitar concepto">✕</button>
                                </span>
                              </div>
                              {/* Cada servicio con SU fecha: empezó el 13 con logopedia,
                                  el 17 con psicología… y cada uno paga lo suyo. */}
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] text-neutral-400 shrink-0">Empezó el</label>
                                <input type="date" value={inicio} onChange={(e) => cambiarInicioConcepto(i, e.target.value)}
                                  className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 focus:outline-none focus:border-neutral-400" />
                                {parte.prorrateo && (
                                  <span className="text-[10px] text-neutral-400 shrink-0">
                                    {parte.prorrateo.diasCobrados}/{parte.prorrateo.diasDelMes} días (de {fmtMoney(parte.importeCompleto)})
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <Select
                          value=""
                          onChange={addConceptoCuota}
                          className={inputCls}
                          options={[
                            { value: "", label: conceptosElegidos.length ? "Añadir otro concepto..." : "Elegir del catálogo (rellena el importe)..." },
                            ...conceptosCatalogo.map((c) => ({ value: String(c.id), label: `${c.name} · ${fmtMoney(c.unitPrice)}` })),
                          ]}
                        />
                        {conceptosElegidos.length > 0 && (
                          <p className="text-[10px] text-neutral-400">
                            La fecha «Empezó el» solo hace falta si ese servicio empezó a mitad de mes:
                            su parte se prorratea sola.
                          </p>
                        )}
                      </div>
                    </FormRow>
                  )}
                  {cuentaCuota.hayProrrateo && (
                    <p className="text-[10px] text-neutral-400 -mt-1">
                      Con la parte proporcional: <strong className="text-neutral-600">{fmtMoney(cuentaCuota.total)}</strong>
                      {" "}(el mes entero serían {fmtMoney(cuentaCuota.totalCompleto)}).
                      El importe se ha rellenado solo; puedes retocarlo.
                    </p>
                  )}
                </>
              )}

              {form.modo === "factura" && (
              <FormRow label="Factura *">
                <Select
                  value={form.invoiceId}
                  onChange={(v) => selectInvoice(v)}
                  className={inputCls}
                  options={[
                    { value: "", label: "Selecciona factura pendiente..." },
                    ...unpaidInvoices.map((i) => {
                      const remaining = Math.max(0, Number(i.total) - Number(i.paidAmount || 0));
                      return {
                        value: i.id,
                        label: `${i.number} · ${i.client?.name ?? "?"} · pendiente ${fmtMoney(remaining)}`,
                      };
                    }),
                  ]}
                />
              </FormRow>
              )}
              <FormRow label="Importe (€) *">
                <input required type="number" min="0.01" step="0.01" value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={inputCls} />
              </FormRow>
              <FormRow label="Método de pago">
                <Select value={form.method} onChange={(v) => setForm((f) => ({ ...f, method: v }))}
                  className={inputCls}
                  options={Object.entries(METHOD_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                />
              </FormRow>
              <FormRow label="Fecha *">
                <input required type="date" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} className={inputCls} />
              </FormRow>
              <FormRow label="Notas">
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls + " resize-y"} />
              </FormRow>

              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-neutral-100">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Guardando..." : "Registrar"}</button>
              </div>
            </form>
          </aside>
        </>
      )}
      {/* DRAWER DE EDICIÓN — un cobro mal tecleado se corregía antes a mano en
          la base de datos. Queda auditado por el PATCH. */}
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !saving && setEditing(null)} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100">
              <div className="eyebrow">Editar</div>
              <h2 className="font-display text-xl text-neutral-900 mt-1">Cobro de {editing.clientName ?? "—"}</h2>
              <p className="text-[11px] text-neutral-400 mt-1">
                {editing.invoice?.number ? `Factura ${editing.invoice.number}` : "Sin factura asociada"}
              </p>
            </div>
            <form onSubmit={guardarEdicion} className="px-6 py-5 space-y-3">
              <FormRow label="Importe (€) *">
                <input required type="number" min="0.01" step="0.01" value={editing.amount}
                  onChange={(e) => setEditing((p) => ({ ...p, amount: e.target.value }))} className={inputCls} />
              </FormRow>
              <FormRow label="Método de pago">
                <Select value={editing.method} onChange={(v) => setEditing((p) => ({ ...p, method: v }))}
                  className={inputCls}
                  options={Object.entries(METHOD_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
              </FormRow>
              <FormRow label="Fecha *">
                <input required type="date" value={editing.paidAt}
                  onChange={(e) => setEditing((p) => ({ ...p, paidAt: e.target.value }))} className={inputCls} />
              </FormRow>
              <FormRow label="Estado">
                <Select value={editing.status} onChange={(v) => setEditing((p) => ({ ...p, status: v }))}
                  className={inputCls}
                  options={[
                    { value: "completed", label: "Cobrado" },
                    { value: "pending", label: "Pendiente" },
                    { value: "failed", label: "Fallido" },
                    { value: "refunded", label: "Devuelto" },
                  ]} />
              </FormRow>
              {/* Un cobro suelto se puede enganchar a la factura que se emitió
                  después (31/08/2026): la factura pasa a cobrada y el cobro
                  deja de salir como «sin factura». El mes de cuota no se toca. */}
              {!editing.invoice?.id && facturasCliente.length > 0 && (
                <FormRow label="Asociar a factura (opcional)">
                  <Select
                    value={editing.asociarFacturaId ?? ""}
                    onChange={(v) => setEditing((p) => ({ ...p, asociarFacturaId: v }))}
                    className={inputCls}
                    options={[
                      { value: "", label: "Dejar sin factura" },
                      ...facturasCliente.map((i) => {
                        const remaining = Math.max(0, Number(i.total) - Number(i.paidAmount || 0));
                        return { value: i.id, label: `${i.number} · pendiente ${fmtMoney(remaining)}` };
                      }),
                    ]}
                  />
                </FormRow>
              )}
              <FormRow label="Notas">
                <textarea rows={3} value={editing.notes ?? ""}
                  onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} className={inputCls + " resize-y"} />
              </FormRow>
              {formError && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>}
              <div className="flex gap-2 justify-end pt-3 border-t border-neutral-100">
                <button type="button" onClick={() => setEditing(null)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Guardando..." : "Guardar"}</button>
              </div>
            </form>
          </aside>
        </>
      )}

      {/* FACTURAR EL MES — la Facturación múltiple de Organízate: las cuotas
          cobradas del mes se convierten en facturas de una pasada. */}
      <FacturarMesDrawer
        open={showFacturarMes}
        onClose={() => setShowFacturarMes(false)}
        onDone={() => { load(); loadMorosidad(); }}
      />
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}

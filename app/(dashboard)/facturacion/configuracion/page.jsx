"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import Select from "@/components/ui/Select.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

export default function ConfiguracionPage() {
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

  const [settings, setSettings] = useState(null);
  const [series, setSeries] = useState([]);
  const [vatInput, setVatInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    loadAll();
  }, []);

  async function loadAll() {
    try {
      const [s, ss] = await Promise.all([
        fetch("/api/billing/settings", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/billing/series", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (s.ok) setSettings(s.data);
      if (ss.ok) setSeries(ss.data ?? []);
    } catch (e) { setErrorMsg(e.message); }
  }

  function setField(k, v) { setSettings((s) => ({ ...s, [k]: v })); }

  // ── Catálogo de conceptos y cuotas (31/08/2026) ────────────────────────────
  const CONCEPTO_VACIO = { name: "", description: "", unitPrice: "", vatRate: "0", category: "", periodicity: "" };
  const [conceptos, setConceptos] = useState([]);
  const [nuevoConcepto, setNuevoConcepto] = useState(CONCEPTO_VACIO);
  const [guardandoConcepto, setGuardandoConcepto] = useState(false);

  useEffect(() => {
    fetch("/api/billing/conceptos?todos=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setConceptos(j.data.conceptos ?? []))
      .catch(() => {});
  }, []);

  async function crearConcepto() {
    if (guardandoConcepto || !nuevoConcepto.name.trim()) return;
    setGuardandoConcepto(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/billing/conceptos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...nuevoConcepto, unitPrice: Number(nuevoConcepto.unitPrice || 0), vatRate: Number(nuevoConcepto.vatRate || 0) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear el concepto");
      setConceptos((cs) => [...cs, j.data]);
      setNuevoConcepto(CONCEPTO_VACIO);
    } catch (e) { setErrorMsg(e.message); } finally { setGuardandoConcepto(false); }
  }

  /*
   * EDITAR un concepto (01/09/2026, petición de Aumenta: «poder dar de baja,
   * MODIFICAR, eliminar una cuota»). El PATCH ya existía desde el 31/08; lo que
   * faltaba era la puerta: se podía apagar y borrar, pero no corregir un precio
   * sin dar de alta otro concepto y dejar el viejo apagado.
   *
   * Importa especialmente ahora: las cuotas asignadas con importe a NULL toman
   * el precio de AQUÍ, así que subir la tarifa es editar un concepto y no
   * repasar 260 familias.
   */
  const [editandoConcepto, setEditandoConcepto] = useState(null);

  async function guardarConcepto() {
    const c = editandoConcepto;
    if (!c || !String(c.name ?? "").trim()) return;
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/conceptos/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: c.name,
          description: c.description || null,
          unitPrice: Number(c.unitPrice || 0),
          vatRate: Number(c.vatRate || 0),
          category: c.category || null,
          periodicity: c.periodicity || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar el concepto");
      setConceptos((cs) => cs.map((x) => (x.id === c.id ? j.data : x)));
      setEditandoConcepto(null);
    } catch (e) { setErrorMsg(e.message); }
  }

  async function alternarConcepto(c) {
    const r = await fetch(`/api/billing/conceptos/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok) setConceptos((cs) => cs.map((x) => (x.id === c.id ? j.data : x)));
  }

  async function borrarConcepto(c) {
    const r = await fetch(`/api/billing/conceptos/${c.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (j.ok) setConceptos((cs) => cs.filter((x) => x.id !== c.id));
  }

  async function save() {
    setSaving(true); setErrorMsg(null); setOkMsg(null);
    try {
      const res = await fetch("/api/billing/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalName: settings.fiscalName,
          taxId: settings.taxId,
          fiscalAddress: settings.fiscalAddress,
          fiscalCity: settings.fiscalCity,
          fiscalZip: settings.fiscalZip,
          fiscalCountry: settings.fiscalCountry,
          defaultVatRate: Number(settings.defaultVatRate),
          availableVatRates: (settings.availableVatRates ?? []).map(Number),
          defaultPaymentTermsDays: Number(settings.defaultPaymentTermsDays),
          invoiceFooterText: settings.invoiceFooterText,
          logoUrl: settings.logoUrl,
          quoteFooterText: settings.quoteFooterText,
          quoteLogoUrl: settings.quoteLogoUrl,
          stampUrl: settings.stampUrl,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setSettings(j.data);
      setOkMsg("Cambios guardados");
      setTimeout(() => setOkMsg(null), 2500);
    } catch (e) {
      setErrorMsg(e.message);
    } finally { setSaving(false); }
  }

  function addVatRate() {
    const v = Number(vatInput);
    if (!Number.isFinite(v) || v < 0 || v > 100) return;
    if ((settings.availableVatRates ?? []).includes(v)) return;
    setField("availableVatRates", [...(settings.availableVatRates ?? []), v].sort((a, b) => b - a));
    setVatInput("");
  }
  function removeVatRate(v) {
    setField("availableVatRates", (settings.availableVatRates ?? []).filter((x) => x !== v));
  }

  if (!settings) {
    return <div className="p-4 lg:p-8 text-xs text-neutral-400">Cargando...</div>;
  }

  return (
    <div className={`${anchoPantalla("ajustes")} space-y-5`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Finanzas · Configuración</div>
          <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Configuración
            <HelpTooltip title="Configuración de facturación" placement="bottom">
              Los datos con los que facturas tú. La razón social, el NIF y la dirección son
              {" "}
              <strong className="text-white">los mismos</strong> que salen en el engranaje de
              Configuración, abajo del todo: es un solo dato con dos puertas, y cambiarlo aquí
              lo cambia allí. El régimen fiscal (empresa o autónomo) y la exención de IVA solo
              se tocan allí.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">Datos fiscales, series, tipos de IVA</p>
        </div>
        <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
      </div>

      {errorMsg && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}

      {/* Aquí iba un aviso ámbar de «Solo administradores pueden modificar la
          configuración». Se va con la puerta que lo justificaba (14/08/2026):
          ahora esto lo toca quien tiene el módulo. Dejarlo colgando de
          `!puedeFacturar` lo habría convertido en un parpadeo mientras carga
          /api/auth/me, que es peor que no avisar de nada. */}

      {/* Datos fiscales */}
      <Section title="Datos fiscales del emisor">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Razón social">
            <input disabled={!puedeFacturar} value={settings.fiscalName ?? ""} onChange={(e) => setField("fiscalName", e.target.value)} className={inputCls} />
          </Field>
          <Field label="NIF / CIF">
            <input disabled={!puedeFacturar} value={settings.taxId ?? ""} onChange={(e) => setField("taxId", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Dirección" full>
            <input disabled={!puedeFacturar} value={settings.fiscalAddress ?? ""} onChange={(e) => setField("fiscalAddress", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Ciudad">
            <input disabled={!puedeFacturar} value={settings.fiscalCity ?? ""} onChange={(e) => setField("fiscalCity", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Código postal">
            <input disabled={!puedeFacturar} value={settings.fiscalZip ?? ""} onChange={(e) => setField("fiscalZip", e.target.value)} className={inputCls} />
          </Field>
          <Field label="País (ISO 2)">
            <input disabled={!puedeFacturar} maxLength={2} value={settings.fiscalCountry ?? ""} onChange={(e) => setField("fiscalCountry", e.target.value.toUpperCase())} className={inputCls} />
          </Field>
        </div>
      </Section>

      {/* Tipos de IVA */}
      <Section title="Tipos de IVA disponibles">
        <div className="flex flex-wrap gap-2 mb-3">
          {(settings.availableVatRates ?? []).map((v) => (
            <span key={v} className="inline-flex items-center gap-1 px-3 py-1 bg-neutral-100 text-neutral-700 text-xs rounded-full border border-neutral-200">
              {v}%
              {puedeFacturar && (
                <button onClick={() => removeVatRate(v)} className="text-neutral-400 hover:text-red-500 transition-colors">×</button>
              )}
            </span>
          ))}
        </div>
        {puedeFacturar && (
          <div className="flex items-center gap-2">
            <input type="number" min="0" max="100" step="0.01" value={vatInput} onChange={(e) => setVatInput(e.target.value)}
              placeholder="Nuevo tipo (ej: 5)" className={inputCls + " w-40"} />
            <button onClick={addVatRate} className="px-3 py-2 text-xs font-semibold text-[var(--color-primary,#1B3A2D)] hover:underline">Añadir</button>
          </div>
        )}
        <div className="mt-3">
          <Field label="IVA por defecto">
            <Select disabled={!puedeFacturar} value={settings.defaultVatRate} onChange={(v) => setField("defaultVatRate", Number(v))} options={(settings.availableVatRates ?? []).map((v) => ({ value: v, label: `${v}%` }))} className={inputCls + " sm:w-48"} />
          </Field>
        </div>
      </Section>

      {/* Términos */}
      <Section title="Términos de pago y branding">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Días de vencimiento por defecto">
            <input disabled={!puedeFacturar} type="number" min="0" value={settings.defaultPaymentTermsDays} onChange={(e) => setField("defaultPaymentTermsDays", Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="URL del logo (facturas)">
            <input disabled={!puedeFacturar} value={settings.logoUrl ?? ""} onChange={(e) => setField("logoUrl", e.target.value)} placeholder="https://… (PNG o JPG)" className={inputCls} />
          </Field>
          <Field label="URL del sello del centro">
            <input disabled={!puedeFacturar} value={settings.stampUrl ?? ""} onChange={(e) => setField("stampUrl", e.target.value)} placeholder="https://… (PNG o JPG); sale junto a los totales" className={inputCls} />
          </Field>
          <Field label="URL del logo (presupuestos)">
            <input disabled={!puedeFacturar} value={settings.quoteLogoUrl ?? ""} onChange={(e) => setField("quoteLogoUrl", e.target.value)} placeholder="Vacío = el de las facturas" className={inputCls} />
          </Field>
          <Field label="Texto al pie de la factura" full>
            <textarea disabled={!puedeFacturar} rows={2} value={settings.invoiceFooterText ?? ""} onChange={(e) => setField("invoiceFooterText", e.target.value)} className={inputCls + " resize-y"} />
          </Field>
          <Field label="Texto al pie del presupuesto" full>
            <textarea disabled={!puedeFacturar} rows={2} placeholder="Vacío = el de las facturas" value={settings.quoteFooterText ?? ""} onChange={(e) => setField("quoteFooterText", e.target.value)} className={inputCls + " resize-y"} />
          </Field>
        </div>
      </Section>

      {/* Catálogo de conceptos y cuotas (31/08/2026) */}
      <Section
        title="Conceptos y cuotas"
        help={
          <HelpTooltip title="Conceptos y cuotas" placement="top">
            Los conceptos habituales del centro, con su texto de factura, importe e IVA. Al hacer
            una factura se eligen del desplegable y la línea se rellena sola —{" "}
            <strong className="text-white">como las cuotas del Organízate</strong>. La periodicidad
            es orientativa: la cuota mensual real la lleva el cobro con su mes.
          </HelpTooltip>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Nombre</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Texto en la factura</th>
                <th className="text-right px-2 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Importe</th>
                <th className="text-right px-2 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">IVA %</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Categoría</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Period.</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {conceptos.map((c) => editandoConcepto?.id === c.id ? (
                <tr key={c.id} className="border-b border-neutral-50 bg-neutral-50/70">
                  <td className="px-2 py-2">
                    <input className={inputCls} value={editandoConcepto.name ?? ""}
                      onChange={(e) => setEditandoConcepto((v) => ({ ...v, name: e.target.value }))} />
                  </td>
                  <td className="px-2 py-2">
                    <input className={inputCls} placeholder="Vacío = el nombre" value={editandoConcepto.description ?? ""}
                      onChange={(e) => setEditandoConcepto((v) => ({ ...v, description: e.target.value }))} />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="0.01" className={inputCls} value={editandoConcepto.unitPrice ?? ""}
                      onChange={(e) => setEditandoConcepto((v) => ({ ...v, unitPrice: e.target.value }))} />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" min="0" max="100" step="0.01" className={inputCls} value={editandoConcepto.vatRate ?? ""}
                      onChange={(e) => setEditandoConcepto((v) => ({ ...v, vatRate: e.target.value }))} />
                  </td>
                  <td className="px-2 py-2">
                    <input className={inputCls} value={editandoConcepto.category ?? ""}
                      onChange={(e) => setEditandoConcepto((v) => ({ ...v, category: e.target.value }))} />
                  </td>
                  <td className="px-2 py-2">
                    <input className={inputCls} value={editandoConcepto.periodicity ?? ""}
                      onChange={(e) => setEditandoConcepto((v) => ({ ...v, periodicity: e.target.value }))} />
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={guardarConcepto} disabled={!String(editandoConcepto.name ?? "").trim()}
                      className="text-[11px] font-semibold text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-40 mr-2">Guardar</button>
                    <button onClick={() => setEditandoConcepto(null)} className="text-[11px] text-neutral-400 hover:text-neutral-700">Cancelar</button>
                  </td>
                </tr>
              ) : (
                <tr key={c.id} className={`border-b border-neutral-50 ${c.active ? "" : "opacity-40"}`}>
                  <td className="px-2 py-2 font-medium text-neutral-800">{c.name}</td>
                  <td className="px-2 py-2 text-neutral-500 max-w-[260px] truncate" title={c.description || ""}>{c.description || "—"}</td>
                  {/* Un concepto a 0 € se marca: las cuotas que solo lo lleven a él
                      no se pueden generar, y así se ve dónde hay que poner precio. */}
                  <td className={`px-2 py-2 text-right tabular-nums ${Number(c.unitPrice) === 0 ? "text-amber-600 font-semibold" : ""}`}
                    title={Number(c.unitPrice) === 0 ? "Sin precio: una cuota que solo lleve este concepto no se puede generar" : undefined}>
                    {Number(c.unitPrice).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{Number(c.vatRate)}</td>
                  <td className="px-2 py-2 text-neutral-500">{c.category || "—"}</td>
                  <td className="px-2 py-2 text-neutral-500">{c.periodicity || "—"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {puedeFacturar && (
                      <>
                        <button onClick={() => setEditandoConcepto({ ...c })} className="text-[11px] text-neutral-500 hover:text-neutral-800 mr-2">Editar</button>
                        <button onClick={() => alternarConcepto(c)} className="text-[11px] text-neutral-500 hover:text-neutral-800 mr-2">
                          {c.active ? "Apagar" : "Encender"}
                        </button>
                        <button onClick={() => borrarConcepto(c)} className="text-[11px] text-rose-500 hover:text-rose-700">Borrar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {conceptos.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-6 text-center text-neutral-400 text-sm">Sin conceptos todavía. Da de alta el primero aquí debajo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {puedeFacturar && (
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-7 gap-2 items-end">
            <input className={inputCls} placeholder="Nombre *" value={nuevoConcepto.name} onChange={(e) => setNuevoConcepto((v) => ({ ...v, name: e.target.value }))} />
            <input className={`${inputCls} lg:col-span-2`} placeholder="Texto en la factura (vacío = el nombre)" value={nuevoConcepto.description} onChange={(e) => setNuevoConcepto((v) => ({ ...v, description: e.target.value }))} />
            <input type="number" min="0" step="0.01" className={inputCls} placeholder="Importe €" value={nuevoConcepto.unitPrice} onChange={(e) => setNuevoConcepto((v) => ({ ...v, unitPrice: e.target.value }))} />
            <input type="number" min="0" max="100" step="0.01" className={inputCls} placeholder="IVA %" value={nuevoConcepto.vatRate} onChange={(e) => setNuevoConcepto((v) => ({ ...v, vatRate: e.target.value }))} />
            <input className={inputCls} placeholder="Categoría" value={nuevoConcepto.category} onChange={(e) => setNuevoConcepto((v) => ({ ...v, category: e.target.value }))} />
            <div className="flex gap-2">
              <input className={inputCls} placeholder="mensual…" value={nuevoConcepto.periodicity} onChange={(e) => setNuevoConcepto((v) => ({ ...v, periodicity: e.target.value }))} />
              <button onClick={crearConcepto} disabled={guardandoConcepto || !nuevoConcepto.name.trim()} className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                {guardandoConcepto ? "…" : "Añadir"}
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* Series */}
      <Section
        title="Series de facturación"
        help={
          <HelpTooltip title="Series y numeración" placement="top">
            Cada serie lleva su propia numeración. El contador sube{" "}
            <strong className="text-white">solo al emitir</strong>: un borrador no gasta número,
            y al cambiar de año vuelve a empezar por el 1. Dentro de una serie los números van
            en orden de fecha, así que no podrás emitir una factura con fecha anterior a la
            última que ya emitiste en ella. Las series se dejan preparadas al poner en marcha la
            facturación; aquí solo se consultan.
          </HelpTooltip>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Código</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Nombre</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Año</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Próximo nº</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.id} className="border-b border-neutral-50">
                  <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                  <td className="px-3 py-2 text-neutral-700">{s.name}</td>
                  <td className="px-3 py-2 text-neutral-500">{s.year}</td>
                  <td className="px-3 py-2 text-right tabular font-semibold text-neutral-900">{s.nextNumber}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{s.kind === "rectificative" ? "Rectificativa" : "Normal"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-neutral-400 mt-2">El contador no se puede editar a mano para garantizar la correlatividad fiscal.</p>
      </Section>

      {puedeFacturar && (
        <div className="flex justify-end pt-3 border-t border-neutral-100">
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Guardando..." : "Guardar cambios"}</button>
        </div>
      )}
    </div>
  );
}

function Section({ title, help, children }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
      <h2 className="eyebrow mb-3 flex items-center gap-1.5">
        {title}
        {help}
      </h2>
      {children}
    </div>
  );
}
function Field({ label, children, full }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "sm:col-span-2" : ""}`}>
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}

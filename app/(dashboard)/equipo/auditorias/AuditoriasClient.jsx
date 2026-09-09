"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import SelectorPaciente from "@/components/citas/SelectorPaciente.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import {
  ETIQUETA_RESULTADO,
  ETIQUETA_VALOR,
  RESULTADOS,
  VALORES,
  nombreDelMes,
  recuentoDeAuditoria,
} from "@/lib/team/auditoriaDesempeno.js";

/**
 * Auditorías de desempeño (09/09/2026, AV-0100).
 *
 * Dos mitades: la lista de la izquierda (por persona y mes) y la auditoría
 * abierta a la derecha. Lo que decide qué se valora, qué NO decide un «no apto»
 * y qué se considera repetido vive en `lib/team/auditoriaDesempeno.js`; aquí solo
 * se pinta.
 */

const mesVigente = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const COLOR_VALOR = {
  apto: "bg-emerald-50 text-emerald-700 border-emerald-200",
  noApto: "bg-rose-50 text-rose-700 border-rose-200",
  noAplica: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

export default function AuditoriasClient() {
  const [lista, setLista] = useState(null);
  const [equipo, setEquipo] = useState([]);
  const [abiertaId, setAbiertaId] = useState(null);
  const [nuevaPersona, setNuevaPersona] = useState("");
  const [nuevoMes, setNuevoMes] = useState(mesVigente());
  const [err, setErr] = useState(null);
  const [creando, setCreando] = useState(false);

  const cargarLista = useCallback(() => {
    fetch("/api/equipo/auditorias", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setLista(j?.data ?? { auditorias: [], esDireccion: false }))
      .catch(() => setLista({ auditorias: [], esDireccion: false }));
  }, []);

  useEffect(() => { cargarLista(); }, [cargarLista]);

  useEffect(() => {
    if (!lista?.esDireccion) return undefined;
    let vivo = true;
    // La plantilla en activo. Es `/api/team`, que ya gatea por admin: quien no
    // es dirección no llega aquí porque no ve el formulario de abrir.
    fetch("/api/team?status=active", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setEquipo(j?.data?.members ?? []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [lista?.esDireccion]);

  async function crear() {
    if (!nuevaPersona) { setErr("Elige a quién se audita."); return; }
    setCreando(true);
    setErr(null);
    try {
      const r = await fetch("/api/equipo/auditorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberId: nuevaPersona, mes: nuevoMes }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo abrir la auditoría");
      cargarLista();
      setAbiertaId(j.data.auditoria.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setCreando(false);
    }
  }

  const porPersona = useMemo(() => {
    const mapa = new Map();
    for (const a of lista?.auditorias ?? []) {
      const k = a.auditado?.displayName ?? "(sin nombre)";
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(a);
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lista]);

  if (!lista) return <div className={anchoPantalla("lista")}><p className="text-xs text-neutral-400">Cargando…</p></div>;

  return (
    <div className={anchoPantalla("lista")}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">Auditorías de desempeño</h1>
        <p className="text-xs text-neutral-500 mt-1">
          {lista.esDireccion
            ? "La revisión mensual de cada profesional. Un «no apto» no hace desfavorable la auditoría: queda como aspecto a mejorar, y si se repite mes a mes se ve arriba."
            : "Aquí salen tus auditorías cerradas. Las escribe dirección."}
        </p>
      </div>

      {err && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{err}</div>}

      {lista.esDireccion && (
        <div className="bg-white border border-neutral-100 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">A quién se audita</label>
            <Select value={nuevaPersona} onChange={(e) => setNuevaPersona(e.target.value)} className="w-full mt-1">
              <option value="">— Elegir —</option>
              {equipo.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Mes auditado</label>
            <input
              type="month"
              value={nuevoMes}
              onChange={(e) => setNuevoMes(e.target.value)}
              className="block mt-1 rounded-lg px-2.5 py-2 text-xs border border-neutral-200"
            />
          </div>
          <button
            onClick={crear}
            disabled={creando}
            className="text-xs px-3 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {creando ? "Abriendo…" : "Abrir auditoría"}
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
        <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
          {porPersona.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-neutral-400">
              {lista.esDireccion ? "Todavía no hay ninguna auditoría." : "No tienes auditorías cerradas."}
            </div>
          ) : (
            porPersona.map(([nombre, suyas]) => (
              <div key={nombre} className="border-b border-neutral-50 last:border-0">
                <div className="px-4 py-2 bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500">{nombre}</div>
                <ul>
                  {suyas.map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => setAbiertaId(a.id)}
                        className={`w-full text-left px-4 py-2.5 hover:bg-neutral-50 flex items-center gap-2 ${abiertaId === a.id ? "bg-neutral-50" : ""}`}
                      >
                        <span className="text-xs text-neutral-800 flex-1">{nombreDelMes(a.mes) || a.mes}</span>
                        {a.estado === "borrador" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">borrador</span>}
                        {a.resultado && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${a.resultado === "favorable" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                            {ETIQUETA_RESULTADO[a.resultado]}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        {abiertaId ? (
          <Auditoria id={abiertaId} onCambio={cargarLista} onCerrar={() => setAbiertaId(null)} />
        ) : (
          <div className="bg-white border border-neutral-100 rounded-xl px-6 py-16 text-center text-xs text-neutral-400">
            Elige una auditoría de la lista.
          </div>
        )}
      </div>
    </div>
  );
}

/** Una auditoría abierta: lo pendiente de la anterior, las áreas y el cierre. */
function Auditoria({ id, onCambio, onCerrar }) {
  const [datos, setDatos] = useState(null);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [avisos, setAvisos] = useState([]);
  const [err, setErr] = useState(null);

  const cargar = useCallback(() => {
    fetch(`/api/equipo/auditorias/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "No se pudo abrir");
        setDatos(j.data);
        setForm(j.data.auditoria);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  if (err) return <div className="bg-white border border-neutral-100 rounded-xl px-6 py-10 text-xs text-red-600">{err}</div>;
  if (!datos || !form) return <div className="bg-white border border-neutral-100 rounded-xl px-6 py-10 text-xs text-neutral-400">Cargando…</div>;

  const puede = datos.puedeEditar;
  const recuento = recuentoDeAuditoria(form.areas);

  function ponCriterio(areaKey, criterioKey, cambio) {
    setForm((f) => ({
      ...f,
      areas: f.areas.map((a) =>
        a.key !== areaKey ? a : { ...a, criterios: a.criterios.map((c) => (c.key !== criterioKey ? c : { ...c, ...cambio })) }
      ),
    }));
  }

  async function guardar(extra = {}) {
    setGuardando(true);
    setErr(null);
    try {
      const r = await fetch(`/api/equipo/auditorias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...extra }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      setForm(j.data.auditoria);
      setAvisos(j.data.avisos ?? []);
      onCambio?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-neutral-900">{datos.auditoria.auditado?.displayName ?? "—"}</div>
            <div className="text-xs text-neutral-500">
              {nombreDelMes(form.mes) || form.mes}
              {datos.auditoria.auditor?.displayName ? ` · audita ${datos.auditoria.auditor.displayName}` : ""}
            </div>
          </div>
          <button onClick={onCerrar} className="text-xs text-neutral-400 hover:text-neutral-700">Cerrar</button>
        </div>
        {puede && (
          <div className="mt-3">
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Fecha de la auditoría</label>
            <input
              type="date"
              value={form.fecha ?? ""}
              onChange={(e) => setForm({ ...form, fecha: e.target.value })}
              className="block mt-1 rounded-lg px-2.5 py-1.5 text-xs border border-neutral-200"
            />
          </div>
        )}
      </div>

      {/* ── Lo que se repite: el aviso que se pidió ───────────────────────── */}
      {datos.seRepiten?.length > 0 && (
        <div className="bg-rose-50 border border-rose-100 rounded-xl p-4">
          <div className="text-xs font-semibold text-rose-800">Se repite mes a mes</div>
          <ul className="mt-2 space-y-1">
            {datos.seRepiten.map((r) => (
              <li key={`${r.areaLabel}/${r.label}`} className="text-xs text-rose-700">
                <span className="font-medium">{r.label}</span> · {r.areaLabel} · {r.meses.length} meses seguidos ({r.meses.map((m) => nombreDelMes(m) || m).join(", ")})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Lo que quedó pendiente del mes anterior ───────────────────────── */}
      {datos.anterior && (
        <div className="bg-white border border-neutral-100 rounded-xl p-5">
          <div className="text-xs font-semibold text-neutral-800">
            De {nombreDelMes(datos.anterior.mes) || datos.anterior.mes} quedó pendiente
          </div>
          <dl className="mt-2 space-y-1.5">
            {datos.anterior.aspectosAMejorar && <Dato k="Aspectos a mejorar" v={datos.anterior.aspectosAMejorar} />}
            {datos.anterior.accionAcordada && <Dato k="Acción acordada" v={datos.anterior.accionAcordada} />}
            {datos.anterior.plazoRevision && <Dato k="Plazo de revisión" v={datos.anterior.plazoRevision} />}
            {datos.anterior.noAptos.length > 0 && (
              <Dato k="No aptos" v={datos.anterior.noAptos.map((c) => `${c.label} (${c.areaLabel})`).join(" · ")} />
            )}
          </dl>
          <div className="mt-3">
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">¿Se ha resuelto?</label>
            <textarea
              value={form.resueltoLoAnterior ?? ""}
              onChange={(e) => setForm({ ...form, resueltoLoAnterior: e.target.value })}
              disabled={!puede}
              rows={2}
              className="w-full mt-1 rounded-lg px-3 py-2 text-xs border border-neutral-200 disabled:bg-neutral-50"
              placeholder="Qué ha pasado con lo que se acordó el mes pasado."
            />
          </div>
        </div>
      )}

      {/* ── Las cuatro áreas ──────────────────────────────────────────────── */}
      {form.areas.map((area) => (
        <div key={area.key} className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-100 text-sm font-semibold text-neutral-800">{area.label}</div>
          <ul className="divide-y divide-neutral-50">
            {area.criterios.map((c) => (
              <li key={c.key} className="px-5 py-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="text-xs text-neutral-700 flex-1 min-w-[180px]">{c.label}</span>
                  <div className="flex gap-1">
                    {VALORES.map((v) => (
                      <button
                        key={v}
                        type="button"
                        disabled={!puede}
                        onClick={() => ponCriterio(area.key, c.key, { valor: c.valor === v ? null : v })}
                        className={`text-[11px] px-2 py-1 rounded-lg border transition-colors disabled:opacity-60 ${
                          c.valor === v ? COLOR_VALOR[v] : "border-neutral-200 text-neutral-400 hover:border-neutral-400"
                        }`}
                      >
                        {ETIQUETA_VALOR[v]}
                      </button>
                    ))}
                  </div>
                </div>
                {(puede || c.observaciones) && (
                  <textarea
                    value={c.observaciones ?? ""}
                    onChange={(e) => ponCriterio(area.key, c.key, { observaciones: e.target.value })}
                    disabled={!puede}
                    rows={1}
                    placeholder="Observaciones"
                    className="w-full mt-2 rounded-lg px-3 py-1.5 text-[11px] border border-neutral-200 disabled:bg-neutral-50"
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* ── Pacientes revisados ───────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5">
        <div className="text-xs font-semibold text-neutral-800">Pacientes revisados</div>
        <p className="text-[10px] text-neutral-400 mt-0.5">
          Los casos concretos por los que se preguntó en esta auditoría. Quedan enlazados a su ficha.
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {(datos.pacientes ?? []).map((p) => (
            <li key={p.id} className="text-[11px] bg-neutral-100 rounded-full px-2.5 py-1 flex items-center gap-2">
              <Link href={`/pacientes/${p.id}`} className="text-[var(--color-primary,#1B3A2D)] hover:underline">{p.nombre}</Link>
              {puede && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, pacientesRevisados: form.pacientesRevisados.filter((x) => x !== p.id) })}
                  className="text-neutral-400 hover:text-rose-600"
                  aria-label={`Quitar ${p.nombre}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
          {(datos.pacientes ?? []).length === 0 && <li className="text-[11px] text-neutral-400">Ninguno todavía.</li>}
        </ul>
        {puede && (
          <div className="mt-3 max-w-sm">
            <SelectorPaciente
              value=""
              onChange={(idPaciente) => {
                if (!idPaciente || form.pacientesRevisados.includes(idPaciente)) return;
                guardar({ pacientesRevisados: [...form.pacientesRevisados, idPaciente] }).then(cargar);
              }}
              placeholder="— Añadir un paciente revisado —"
            />
          </div>
        )}
      </div>

      {/* ── El cierre ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5 space-y-3">
        <Campo label="Fortalezas" value={form.fortalezas} onChange={(v) => setForm({ ...form, fortalezas: v })} disabled={!puede} />
        <Campo label="Aspectos a mejorar" value={form.aspectosAMejorar} onChange={(v) => setForm({ ...form, aspectosAMejorar: v })} disabled={!puede} />
        <Campo label="Acción acordada" value={form.accionAcordada} onChange={(v) => setForm({ ...form, accionAcordada: v })} disabled={!puede} />
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Plazo de revisión</label>
            <input
              type="date"
              value={form.plazoRevision ?? ""}
              onChange={(e) => setForm({ ...form, plazoRevision: e.target.value })}
              disabled={!puede}
              className="block w-full mt-1 rounded-lg px-2.5 py-2 text-xs border border-neutral-200 disabled:bg-neutral-50"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Resultado</label>
            <Select
              value={form.resultado ?? ""}
              onChange={(e) => setForm({ ...form, resultado: e.target.value })}
              disabled={!puede}
              className="w-full mt-1"
            >
              <option value="">— Sin decidir —</option>
              {RESULTADOS.map((r) => (
                <option key={r} value={r}>{ETIQUETA_RESULTADO[r]}</option>
              ))}
            </Select>
          </div>
        </div>
        <Campo label="Observaciones" value={form.observaciones} onChange={(v) => setForm({ ...form, observaciones: v })} disabled={!puede} />
        {/* El recuento, SIN nota ni porcentaje: se pidió que no hubiera
            puntuaciones, y un «3 de 16» invita a comparar personas. */}
        <div className="text-[11px] text-neutral-400">
          {recuento.apto} aptos · {recuento.noApto} no aptos · {recuento.noAplica} no aplica · {recuento.sinValorar} sin valorar
        </div>
      </div>

      {avisos.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <div className="text-xs font-semibold text-amber-800">Antes de darla por buena</div>
          <ul className="mt-1 space-y-0.5">
            {avisos.map((a) => <li key={a} className="text-[11px] text-amber-800">{a}</li>)}
          </ul>
        </div>
      )}

      {puede && (
        <div className="bg-white border border-neutral-100 rounded-xl p-4 flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-neutral-400 mr-auto">
            {form.estado === "cerrada" ? "Cerrada. La ve la persona auditada." : "Borrador. Solo lo ves tú."}
          </span>
          <button
            onClick={() => guardar()}
            disabled={guardando}
            className="text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:border-neutral-400 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <button
            onClick={() => guardar({ estado: form.estado === "cerrada" ? "borrador" : "cerrada" })}
            disabled={guardando}
            className="text-xs px-3 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {form.estado === "cerrada" ? "Volver a borrador" : "Cerrar auditoría"}
          </button>
        </div>
      )}
    </div>
  );
}

function Campo({ label, value, onChange, disabled }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</label>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={2}
        className="w-full mt-1 rounded-lg px-3 py-2 text-xs border border-neutral-200 disabled:bg-neutral-50"
      />
    </div>
  );
}

function Dato({ k, v }) {
  return (
    <div className="flex gap-2 text-xs">
      <dt className="text-neutral-400 shrink-0">{k}:</dt>
      <dd className="text-neutral-700">{v}</dd>
    </div>
  );
}

"use client";

import { useState } from "react";
import SelectorPaciente from "../citas/SelectorPaciente.jsx";
import Select from "../ui/Select.jsx";
import { formatoHoras } from "../../lib/clinica/diagnostico.js";

/**
 * NuevoDiagnosticoPanel — abrir un expediente de diagnóstico (12/09/2026,
 * Rodrigo con Isa, Aumenta).
 *
 * Tres cosas y nada más: paciente, producto (simple 10 h / completo 20 h, o
 * los que el centro haya puesto en Configuración → Módulos) y terapeuta
 * asignado. Sin dinero: el cobro nace después, al parar o al seguir. El
 * paciente se busca en el servidor (`SelectorPaciente`): Aumenta tiene 1.174 y
 * un desplegable no los enseña todos.
 *
 * Si el paciente ya tiene un diagnóstico abierto la API contesta 409 y aquí
 * se pregunta si de verdad se quiere otro (`permitirOtro`): lo normal es un
 * doble clic, pero un simple cerrado y un completo que empieza son dos
 * expedientes legítimos.
 *
 * Panel lateral con la regla #13: barra móvil (`top-14 lg:top-0 … bottom-0`),
 * fondo `z-40` y panel `z-50`, alto en `dvh` para que el pie no quede bajo la
 * barra del navegador del móvil.
 */

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const euros = (n) => (n === null || n === undefined ? null : `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`);

export default function NuevoDiagnosticoPanel({ productos = [], equipo = [], onClose, onCreado }) {
  const [patientId, setPatientId] = useState("");
  const [paciente, setPaciente] = useState(null);
  const [productoKey, setProductoKey] = useState(productos[0]?.key ?? "");
  const [therapistId, setTherapistId] = useState("");
  const [notes, setNotes] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const producto = productos.find((p) => p.key === productoKey) ?? null;
  const precio = producto?.cobro?.importeEuros ?? producto?.precioEuros ?? null;

  async function crear(permitirOtro = false) {
    if (!patientId) { setError("Elige al paciente"); return; }
    if (!producto) { setError("Elige el producto"); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/clinica/diagnosticos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          productoKey: producto.key,
          therapistId: therapistId || null,
          notes: notes.trim() || null,
          ...(permitirOtro ? { permitirOtro: true } : {}),
        }),
      });
      const j = await r.json();
      if (r.status === 409 && j?.id && !permitirOtro) {
        // Ya tiene uno abierto: se dice y se deja abrir otro a propósito.
        if (confirm(`${j.error}.\n\n¿Abrir otro de todas formas?`)) return crear(true);
        return;
      }
      if (!j.ok) throw new Error(j.error || "No se pudo abrir el diagnóstico");
      onCreado?.(j.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-14 lg:top-0 bottom-0 max-h-dvh w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-800">Nuevo diagnóstico</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-[12.5px]">Cerrar</button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
        )}

        <label className="block">
          <span className="text-[12px] text-neutral-500">Paciente *</span>
          <SelectorPaciente
            value={patientId}
            onChange={(id) => { setPatientId(id ?? ""); if (!id) setPaciente(null); }}
            onPaciente={(p) => setPaciente(p ?? null)}
            className={inputCls}
            aria-label="Paciente del diagnóstico"
          />
          {paciente && !paciente.clientId && !paciente.client && (
            <span className="block text-[11px] text-amber-700 mt-1">
              Este paciente no tiene ficha de familia: se podrá abrir el diagnóstico, pero no cobrarlo.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-[12px] text-neutral-500">Producto *</span>
          <Select
            value={productoKey}
            onChange={setProductoKey}
            options={productos.map((p) => ({ value: p.key, label: `${p.nombre} · ${formatoHoras(p.horas)} h` }))}
            placeholder="— Elegir producto —"
            className={inputCls}
            aria-label="Producto de diagnóstico"
          />
          {producto && (
            <span className="block text-[11px] text-neutral-400 mt-1">
              {formatoHoras(producto.horas)} h en total, la entrevista inicial incluida.
              {precio !== null
                ? ` Si la familia sigue, nacerá un cobro pendiente de ${euros(precio)}${producto.cobro?.texto ? ` («${producto.cobro.texto}»)` : ""}.`
                : " No hay precio para este producto: si la familia sigue, el bono nacerá sin cobro."}
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-[12px] text-neutral-500">Terapeuta asignado</span>
          <Select
            value={therapistId}
            onChange={setTherapistId}
            options={[{ value: "", label: "— Sin asignar todavía —" }, ...equipo.map((m) => ({ value: m.id, label: m.nombre }))]}
            className={inputCls}
            aria-label="Terapeuta asignado"
          />
          <span className="block text-[11px] text-neutral-400 mt-1">
            Quien lleva el diagnóstico. Se puede cambiar después desde la lista.
          </span>
        </label>

        <label className="block">
          <span className="text-[12px] text-neutral-500">Notas</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Motivo de consulta, quién deriva…" />
        </label>

        <button
          onClick={() => crear(false)}
          disabled={guardando}
          className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-50"
        >
          {guardando ? "Abriendo…" : "Abrir diagnóstico"}
        </button>
        <p className="text-[11px] text-neutral-400">
          Nace en «Entrevista inicial» y sin dinero. Después, «Abrir entrevista inicial» lleva a la agenda con la
          cita preparada; el cobro aparece al decidir si la familia sigue o no.
        </p>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import SelectorPaciente from "../citas/SelectorPaciente.jsx";
import Select from "../ui/Select.jsx";
import { useDialogo } from "../ui/Dialogo.jsx";
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
 * expedientes legítimos. Se pregunta con `useDialogo`, no con el `confirm`
 * del navegador (que Chrome puede silenciar y entonces siempre dice que no).
 *
 * ── «EMPEZAR DESDE LO QUE YA HAY» (12/09/2026, respuesta de Aumenta) ───────
 * Desde el bloque de candidatos (`CandidatosDiagnostico`) el panel se abre
 * con el paciente FIJO (`pacienteFijo`, sin buscador), el terapeuta que más
 * se repite en sus citas ya puesto (`terapeutaSugerido`) y una casilla
 * marcada «Meter en el expediente lo que ya hay: …» con la frase que ya trae
 * la fila del servidor (`adopcion.resumen`). Al crear, se manda
 * `adoptar` tal cual llegó (`adopcion.adoptar`): el servidor recalcula qué
 * citas entran; aquí no se decide nada.
 *
 * Panel lateral con la regla #13: barra móvil (`top-14 lg:top-0 … bottom-0`),
 * fondo `z-40` y panel `z-50`, alto en `dvh` para que el pie no quede bajo la
 * barra del navegador del móvil.
 */

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const euros = (n) => (n === null || n === undefined ? null : `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`);

export default function NuevoDiagnosticoPanel({
  productos = [],
  equipo = [],
  pacienteFijo = null,
  terapeutaSugerido = null,
  adopcion = null,
  onClose,
  onCreado,
}) {
  const [patientId, setPatientId] = useState(pacienteFijo?.id ?? "");
  const [paciente, setPaciente] = useState(pacienteFijo ?? null);
  const [productoKey, setProductoKey] = useState(productos[0]?.key ?? "");
  const [therapistId, setTherapistId] = useState(terapeutaSugerido ?? "");
  const [notes, setNotes] = useState("");
  const [adoptar, setAdoptar] = useState(Boolean(adopcion?.adoptar));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const { confirmar, dialogo } = useDialogo();

  const producto = productos.find((p) => p.key === productoKey) ?? null;
  const precio = producto?.cobro?.importeEuros ?? producto?.precioEuros ?? null;
  const sinFamilia = paciente && !paciente.clientId && !paciente.client;

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
          ...(adoptar && adopcion?.adoptar ? { adoptar: adopcion.adoptar } : {}),
        }),
      });
      const j = await r.json();
      if (r.status === 409 && j?.id && !permitirOtro) {
        // Ya tiene uno abierto: se dice y se deja abrir otro a propósito.
        setGuardando(false);
        const otro = await confirmar({
          titulo: "Ya tiene un diagnóstico abierto",
          texto: `${j.error}.\n\n¿Abrir otro de todas formas?`,
          confirmar: "Abrir otro",
        });
        if (otro) return crear(true);
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
          {pacienteFijo ? (
            <div className={`${inputCls} flex items-center justify-between gap-2 bg-neutral-50`}>
              <span className="font-medium text-neutral-800 truncate">{pacienteFijo.nombre}</span>
              <Link href={`/pacientes/${pacienteFijo.id}`} className="text-[11px] text-neutral-400 hover:text-neutral-700 whitespace-nowrap">
                Ver ficha
              </Link>
            </div>
          ) : (
            <SelectorPaciente
              value={patientId}
              onChange={(id) => { setPatientId(id ?? ""); if (!id) setPaciente(null); }}
              onPaciente={(p) => setPaciente(p ?? null)}
              className={inputCls}
              aria-label="Paciente del diagnóstico"
            />
          )}
          {sinFamilia && (
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
            {terapeutaSugerido && therapistId === terapeutaSugerido
              ? "Quien más citas de diagnóstico le ha dado. Se puede cambiar aquí o después desde la lista."
              : "Quien lleva el diagnóstico. Se puede cambiar después desde la lista."}
          </span>
        </label>

        {adopcion && (
          <label className="flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={adoptar}
              onChange={(e) => setAdoptar(e.target.checked)}
              disabled={!adopcion.adoptar}
              className="mt-0.5 w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
            />
            <span className="text-[12px] text-sky-900">
              Meter en el expediente lo que ya hay: <strong>{adopcion.resumen ?? "nada que meter"}</strong>.
              <span className="block text-[11px] text-sky-700 mt-0.5">
                Las citas de diagnóstico pasan a contar en la barra y, si la entrevista ya está cobrada, se descontará del
                precio del producto al seguir.
              </span>
            </span>
          </label>
        )}

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
          {adopcion && adoptar
            ? "Nace con lo que ya hay dentro y sin dinero nuevo: el cobro del producto aparece al decidir si la familia sigue."
            : "Nace en «Entrevista inicial» y sin dinero. Después, «Abrir entrevista inicial» lleva a la agenda con la cita preparada; el cobro aparece al decidir si la familia sigue o no."}
        </p>
      </div>
      {dialogo}
    </>
  );
}

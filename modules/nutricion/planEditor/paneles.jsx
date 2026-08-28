"use client";

// modules/nutricion/planEditor/paneles.jsx — la columna derecha del editor de
// pautas: el panel del paciente, el lateral de una plantilla (asignaciones) y
// el desplegable para cargar otra plantilla.

// ────────────────────────────────────────────────────────────────────────────
// Panel paciente (type='assigned') o info plantilla (type='template')
// ────────────────────────────────────────────────────────────────────────────


import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";
import { fmtDate } from "./ui.jsx";
export function PatientPanel({ client, clientId }) {
  if (!client && clientId) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-400">
        Cargando datos del paciente…
      </div>
    );
  }
  if (!client) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-400">
        Sin cliente asociado.
      </div>
    );
  }
  // customFields actuales en nutri-laura: edad, motivo, info_adicional.
  // Peso/altura/alergias/sexo no están en el modelo; mostramos "No especificado".
  const cf = client.customFields || {};
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Paciente</div>
      <div className="font-semibold text-gray-900 text-base leading-tight">{client.name}</div>
      <dl className="text-xs space-y-1 pt-1">
        <Field label="Edad" value={cf.edad || "—"} suffix={cf.edad ? "años" : ""} />
        <Field label="Sexo" value="—" />
        <Field label="Altura" value="—" />
        <Field label="Peso" value="—" />
        <Field label="Motivo" value={cf.motivo || "—"} />
        <Field label="Alergias" value="—" />
        <Field label="Email" value={client.email || "—"} />
        <Field label="Teléfono" value={client.phone || "—"} />
      </dl>
      <p className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
        Algunos campos no están todavía en el perfil del paciente. Se podrán
        rellenar desde la ficha en C4.
      </p>
    </div>
  );
}

export function Field({ label, value, suffix }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 text-right">
        {value} {suffix && <span className="text-gray-400">{suffix}</span>}
      </dd>
    </div>
  );
}

export function TemplateSidePanel({ plan }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Menú</div>
      <div className="font-semibold text-gray-900 text-base leading-tight">{plan.name}</div>
      <dl className="text-xs space-y-1 pt-1">
        <Field label="Creada" value={fmtDate(plan.createdAt)} />
        <Field label="Última edición" value={fmtDate(plan.updatedAt)} />
        <Field label="Comidas" value={String((plan.meals || []).length)} />
      </dl>
      <TemplateAssignPanel plan={plan} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Asignación directa a pacientes desde el editor (Nutrinotas item 9).
// Lista los pacientes con este menú asignado (copia independiente: editar el
// menú NO cambia sus planes; para eso está "Re-aplicar" en la ficha) y permite
// asignar a otro paciente sin salir del editor.
// ────────────────────────────────────────────────────────────────────────────

export function TemplateAssignPanel({ plan }) {
  const [assignments, setAssignments] = useState([]);
  const [pickedClientId, setPickedClientId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [msg, setMsg] = useState(null); // { kind: 'ok'|'err', text }

  const loadAssignments = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/nutricion/plans?type=assigned&templateId=${plan.id}&withSummary=true&limit=100`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (j.ok) {
        const items = j.items || j.data?.items || [];
        setAssignments(items.filter((p) => !p.archivedAt));
      }
    } catch { /* noop */ }
  }, [plan.id]);

  useEffect(() => { loadAssignments(); }, [loadAssignments]);


  async function assign() {
    if (!pickedClientId || assigning) return;
    setAssigning(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/nutricion/plans/${plan.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: pickedClientId }),
      });
      const j = await r.json();
      if (r.status === 409) throw new Error("Ese paciente ya tiene este menú asignado");
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo asignar");
      setMsg({ kind: "ok", text: "Pauta creada a partir de este menú (copia independiente)" });
      setPickedClientId("");
      loadAssignments();
    } catch (e) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setAssigning(false);
    }
  }

  // Aquí SÍ había buscador, pero filtraba sobre las 200 descargadas: el techo
  // callado de siempre. Ahora pregunta al servidor (28/08/2026).
  const clientOptions = useMemo(() => [{ value: "", label: "Asignar a paciente…" }], []);

  return (
    <div className="pt-2 border-t border-gray-100 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Pacientes con este menú</div>
      {assignments.length === 0 ? (
        <p className="text-[11px] text-gray-400">Sin asignaciones activas.</p>
      ) : (
        <ul className="space-y-1">
          {assignments.map((a) => (
            <li key={a.id} className="text-xs text-gray-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] shrink-0" />
              <span className="truncate">{a.client?.name || a.clientName || a.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <SelectorCliente
            value={pickedClientId}
            onChange={setPickedClientId}
            opcionesFijas={clientOptions}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 bg-white"
          />
        </div>
        <button
          onClick={assign}
          disabled={!pickedClientId || assigning}
          className="text-[11px] font-medium px-2 py-1.5 rounded-md bg-[var(--color-primary)] text-white disabled:opacity-40 shrink-0"
        >
          {assigning ? "…" : "Asignar"}
        </button>
      </div>
      <p className="text-[10px] text-gray-400">
        La asignación crea una copia independiente: los cambios posteriores del menú no
        alteran las pautas ya asignadas (usa «Re-aplicar» en la ficha del paciente).
      </p>
      {msg && (
        <p className={`text-[11px] ${msg.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TemplatesDropdown — abre dropdown con plantillas para cargar
// ────────────────────────────────────────────────────────────────────────────

export function TemplatesDropdown({ open, onOpen, onClose, onSelect, excludeId }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || items !== null) return;
    setLoading(true);
    fetch("/api/nutricion/plans?type=template&limit=100")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setItems(j.items || []); else setItems([]); })
      .finally(() => setLoading(false));
  }, [open, items]);

  return (
    <div className="relative">
      <button
        onClick={() => (open ? onClose() : onOpen())}
        className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition flex items-center gap-1"
        title="Cargar contenido desde otro menú"
      >
        Menús ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-white border border-gray-200 rounded-md shadow-lg py-1 max-h-80 overflow-y-auto">
            {loading && <div className="px-3 py-2 text-xs text-gray-400">Cargando…</div>}
            {!loading && items && items.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">No hay menús.</div>
            )}
            {(items || [])
              .filter((p) => p.id !== excludeId)
              .map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                  onClick={() => { onClose(); onSelect(p); }}
                >
                  <div className="font-medium text-gray-800 truncate">{p.name}</div>
                  <div className="text-[10px] text-gray-400">Actualizada {fmtDate(p.updatedAt)}</div>
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

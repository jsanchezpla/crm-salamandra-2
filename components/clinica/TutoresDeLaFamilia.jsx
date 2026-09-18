"use client";

/**
 * TutoresDeLaFamilia — «Padres y tutores» en la ficha del PACIENTE.
 *
 * ── DE DÓNDE VIENE ──────────────────────────────────────────────────────────
 * Nació el 02/09/2026 (AV-0023 y AV-0024 de Aumenta) dentro de la propia
 * pantalla y de SOLO LECTURA: en Organízate cada paciente tenía su apartado de
 * tutores y en el CRM «solo aparece un cliente por paciente y desaparecen el
 * resto de datos». Los datos estaban —1.924 tutores en producción—, pero solo
 * en la ficha de la familia, a la que las terapeutas no entran.
 *
 * El 18/09/2026 el centro volvió sobre lo mismo (ficha «Datos tutor»): «que se
 * le pueda añadir más de un progenitor» y «que desde pacientes en la ficha de
 * pacientes se le pueda añadir el tutor/tutores». Lo primero ya se podía —hay
 * 843 familias con dos o más—, pero solo desde Clientes. Así que esto pasa a
 * escribir, contra `/api/pacientes/[id]/tutores`, que es la puerta con las
 * reglas de ESTA pantalla.
 *
 * Qué NO se enseña aquí, a propósito: el DNI de los tutores y quién firma el
 * contrato del centro. Los conserva el servidor al fusionar; esta pantalla ni
 * los ve ni los puede tocar (`fusionarTutoresDeFicha`, lib/clients/guardians.js).
 *
 * El TITULAR de la ficha sale el primero, marcado. Si nunca se apuntó dentro
 * de `guardians` no tiene `id` y no se puede editar desde aquí: su nombre y su
 * teléfono son los de la familia y se cambian en Clientes. Lo que sí se puede
 * es añadirle al OTRO progenitor sin salir de la ficha del paciente, que es lo
 * que se pidió.
 */

import { useState } from "react";
import HelpTooltip from "../ui/HelpTooltip.jsx";
import { GUARDIAN_RELATIONSHIPS, GUARDIAN_RELATIONSHIP_LABEL, MAX_TUTORES } from "../../lib/clients/guardians.js";

const inputCls =
  "w-full px-2.5 py-1.5 text-[11px] border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--color-primary,#1B3A2D)]";

const NUEVO = { id: null, name: "", relationship: "tutor", phone: "", email: "", titular: false };

export default function TutoresDeLaFamilia({ patientId, tutores, onSaved }) {
  const lista = Array.isArray(tutores) ? tutores : [];
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // El titular sin `id` no vive en `guardians`: no entra en el borrador ni se
  // manda, o el servidor lo daría de alta como un tutor más y saldría dos veces.
  const titularFijo = lista.find((t) => t.titular && !t.id) ?? null;
  const editables = lista.filter((t) => t.id);

  const abrir = () => {
    setBorrador(editables.map((t) => ({ ...t, phone: t.phone ?? "", email: t.email ?? "" })));
    setError(null);
    setEditando(true);
  };

  const cambiar = (i, campos) => setBorrador((b) => b.map((t, j) => (j === i ? { ...t, ...campos } : t)));

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch(`/api/pacientes/${patientId}/tutores`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tutores: borrador.map((t) => ({
            id: t.id,
            name: t.name,
            relationship: t.relationship,
            phone: t.phone,
            email: t.email,
          })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudieron guardar los tutores");
      setEditando(false);
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5" data-testid="padres-y-tutores">
      <div className="eyebrow mb-3 flex items-center gap-1.5">
        Padres y tutores
        <HelpTooltip title="Padres y tutores" placement="bottom" className="tracking-normal">
          Los padres o tutores de la familia de este paciente, con su teléfono y su correo, para poder
          llamarles sin pasar por Clientes.{" "}
          <strong className="text-white">El correo de un tutor le da acceso al área privada</strong> de su
          familia. El DNI y quién firma el contrato se ven y se cambian en Clientes.
        </HelpTooltip>
        {!editando && (
          <button
            type="button"
            onClick={abrir}
            className="ml-auto text-[10px] font-normal tracking-normal text-neutral-500 hover:text-neutral-800 underline"
          >
            Editar
          </button>
        )}
      </div>

      {!editando ? (
        lista.length ? (
          <ul className="space-y-2">
            {lista.map((g, i) => (
              <li key={g.id ?? `titular-${i}`} className="text-[11px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-neutral-800">{g.name}</span>
                  {g.relationshipLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-500">
                      {g.relationshipLabel}
                    </span>
                  )}
                  {g.titular && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                      titular de la ficha
                    </span>
                  )}
                </div>
                <div className="text-neutral-600 flex items-center gap-3 flex-wrap mt-0.5">
                  {g.phone && (
                    <a href={`tel:${g.phone}`} className="hover:underline">
                      <span className="text-neutral-400">☎</span> {g.phone}
                    </a>
                  )}
                  {g.email && (
                    <a href={`mailto:${g.email}`} className="hover:underline break-all">
                      <span className="text-neutral-400">✉</span> {g.email}
                    </a>
                  )}
                  {!g.phone && !g.email && (
                    <span className="text-neutral-400">sin teléfono ni correo apuntados</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-neutral-400">La familia no tiene padres ni tutores apuntados.</p>
        )
      ) : (
        <div className="space-y-3">
          {titularFijo && (
            <div className="rounded-lg bg-neutral-50 border border-neutral-100 p-2.5 text-[11px]">
              <span className="font-medium text-neutral-800">{titularFijo.name}</span>
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                titular de la ficha
              </span>
              <p className="text-neutral-400 mt-0.5">Sus datos son los de la familia: se cambian en Clientes.</p>
            </div>
          )}

          {borrador.map((t, i) => (
            <div key={t.id ?? `nuevo-${i}`} className="rounded-lg border border-neutral-200 p-2.5 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  placeholder="Nombre y apellidos"
                  value={t.name}
                  onChange={(e) => cambiar(i, { name: e.target.value })}
                />
                <select
                  className={inputCls}
                  value={t.relationship}
                  onChange={(e) => cambiar(i, { relationship: e.target.value })}
                >
                  {GUARDIAN_RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {GUARDIAN_RELATIONSHIP_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  placeholder="Teléfono"
                  value={t.phone}
                  onChange={(e) => cambiar(i, { phone: e.target.value })}
                />
                <input
                  className={inputCls}
                  placeholder="Email"
                  value={t.email}
                  onChange={(e) => cambiar(i, { email: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-neutral-400">
                  {t.titular ? "Titular de la ficha" : "El correo le da acceso al área privada"}
                </span>
                <button
                  type="button"
                  onClick={() => setBorrador((b) => b.filter((_, j) => j !== i))}
                  className="text-[10px] text-rose-600 hover:underline"
                >
                  Quitar
                </button>
              </div>
            </div>
          ))}

          {borrador.length < MAX_TUTORES && (
            <button
              type="button"
              onClick={() => setBorrador((b) => [...b, { ...NUEVO }])}
              className="w-full text-[11px] py-1.5 rounded-lg border border-dashed border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"
            >
              + Añadir tutor
            </button>
          )}

          {error && <p className="text-[11px] text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditando(false)}
              disabled={guardando}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="px-3 py-1.5 rounded-lg text-white text-[11px] font-medium disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

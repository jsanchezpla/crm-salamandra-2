"use client";

import { useEffect, useState } from "react";

/**
 * El selector de equipo con casillas: «¿quién?» (01/09/2026, Rodrigo).
 *
 * Nació para elegir a quién se le pide LEER un documento y sirve ya para otra
 * cosa: quién ve una carpeta del archivo. Por eso aquí no hay ni una palabra
 * sobre lecturas ni sobre carpetas — el rótulo de encima lo pone cada pantalla.
 *
 * Lo usan tres puertas: el modal de un bloqueo de la agenda (que ya trae el
 * equipo en la respuesta del listado de bloqueos), el archivo central y las
 * carpetas. Por eso `equipo` es opcional: si no llega, se busca en `/api/team`,
 * que devuelve la lista recortada a quien no tenga el módulo Equipo en sus
 * accesos — suficiente para un desplegable.
 *
 * ── LOS DOS BOTONES DE ARRIBA (encargo del 01/09/2026) ─────────────────────
 * «Debería haber dentro de los selectores de equipo dos botones más: todo el
 * equipo y todos menos Administración (Olga y Rosa).» Son eso, ni más ni menos:
 * dos atajos que MARCAN casillas, no dos modos distintos — después se puede
 * tocar cualquiera a mano y el botón no se queda «puesto».
 *
 * Quién es administración lo decide el SERVIDOR (`lib/team/departamentos.js`,
 * por `TeamMember.department`) y llega como una lista de ids: el navegador no
 * recibe el departamento de nadie. Sin nadie en administración el segundo botón
 * no se enseña — haría exactamente lo mismo que el primero.
 *
 * Marcar a alguien es PEDIRLE la lectura; desmarcarlo es retirársela, pero solo
 * si aún no la ha hecho: un acuse ya firmado no se borra desde una pantalla
 * (lo respeta el servidor, en `lib/documents/lecturas.js`). Aquí eso se enseña
 * con el «leído» al lado del nombre, para que se entienda por qué ese sigue.
 */
export default function LectoresPicker({
  equipo = null,
  administracion = null,
  valor = [],
  onChange,
  disabled = false,
  leidos = [],
}) {
  // El equipo que traiga quien nos monta MANDA; `remoto` es solo el de repuesto
  // que se busca cuando no llega ninguno (así el efecto no pisa la prop).
  const [remoto, setRemoto] = useState(null);
  const [adminRemoto, setAdminRemoto] = useState([]);
  const [cargando, setCargando] = useState(!equipo);
  const lista = equipo ?? remoto;
  const admin = administracion ?? adminRemoto;

  useEffect(() => {
    if (equipo) return undefined;
    let cancelado = false;
    fetch("/api/team?status=default&limit=200", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelado) return;
        setRemoto(j.ok ? (j.data.members ?? []).map((m) => ({ id: m.id, displayName: m.displayName })) : []);
        setAdminRemoto(j.ok ? j.data.administracion ?? [] : []);
      })
      .catch(() => { if (!cancelado) setRemoto([]); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [equipo]);

  if (cargando) return <p className="text-[11px] text-neutral-400">Cargando el equipo…</p>;
  if (!lista?.length) {
    return <p className="text-[11px] text-neutral-400">No hay nadie en el equipo a quien elegir.</p>;
  }

  const yaLeyo = new Set(leidos);
  const marcados = new Set(valor);
  const esAdmin = new Set(admin ?? []);
  const alterna = (id) => {
    if (disabled) return;
    const siguiente = new Set(marcados);
    if (siguiente.has(id)) siguiente.delete(id);
    else siguiente.add(id);
    onChange?.([...siguiente]);
  };

  const todos = lista.map((m) => m.id);
  const sinAdministracion = todos.filter((id) => !esAdmin.has(id));
  // El segundo botón solo tiene sentido si de verdad quita a alguien.
  const hayAdministracion = sinAdministracion.length > 0 && sinAdministracion.length < todos.length;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        <button
          type="button"
          onClick={() => !disabled && onChange?.(todos)}
          disabled={disabled}
          className="text-[10px] font-semibold rounded-full border border-neutral-200 px-2 py-0.5 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-40 transition-colors"
        >
          Todo el equipo
        </button>
        {hayAdministracion && (
          <button
            type="button"
            onClick={() => !disabled && onChange?.(sinAdministracion)}
            disabled={disabled}
            className="text-[10px] font-semibold rounded-full border border-neutral-200 px-2 py-0.5 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-40 transition-colors"
          >
            Todos menos Administración
          </button>
        )}
        {marcados.size > 0 && (
          <button
            type="button"
            onClick={() => !disabled && onChange?.([])}
            disabled={disabled}
            className="text-[10px] rounded-full px-2 py-0.5 text-neutral-400 hover:text-neutral-700 disabled:opacity-40 transition-colors"
          >
            Quitar todos
          </button>
        )}
      </div>
      <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100 max-h-44 overflow-y-auto">
        {lista.map((m) => (
          <label
            key={m.id}
            className={`flex items-center gap-2 px-2.5 py-1.5 text-xs ${
              disabled ? "opacity-60" : "cursor-pointer hover:bg-neutral-50"
            }`}
          >
            <input
              type="checkbox"
              checked={marcados.has(m.id)}
              onChange={() => alterna(m.id)}
              disabled={disabled}
              className="accent-[var(--color-primary,#1B3A2D)]"
            />
            <span className="flex-1 min-w-0 truncate text-neutral-800">{m.displayName}</span>
            {yaLeyo.has(m.id) && (
              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 rounded-full px-1.5 py-0.5">
                Leído
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

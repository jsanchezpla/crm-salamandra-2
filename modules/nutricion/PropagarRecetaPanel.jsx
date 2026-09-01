"use client";

/**
 * PropagarRecetaPanel — «acabas de corregir esta receta: ¿a quién se la llevo?»
 *
 * ── EL PROBLEMA QUE RESUELVE ────────────────────────────────────────────────
 * Una receta metida en un menú se guarda como COPIA congelada, y eso está bien:
 * lo que se le entregó a un paciente es un documento y no debe cambiar solo.
 * Pero entonces corregir «200 g» por «20 g» no le llega a nadie que ya tenga la
 * pauta, y «Re-aplicar menú origen» tampoco —recopia las copias viejas—.
 *
 * Este panel aparece justo después de guardar una receta que YA está usada en
 * algún sitio, y ofrece la tercera vía: propagar a propósito y sabiendo a quién.
 *
 * ── DECISIONES ──────────────────────────────────────────────────────────────
 * · Si no hay nada desactualizado, NO se enseña. Guardar un cambio de
 *   descripción no tiene por qué interrumpir a nadie con una pantalla más.
 * · Las pautas de personas van ARRIBA y marcadas por defecto: son las que
 *   duelen si se quedan mal. Los menús plantilla también se marcan, porque un
 *   menú sin corregir vuelve a repartir el error la próxima vez que se asigne.
 * · «Ahora no» es una salida de primera clase, no un enlace escondido: quien
 *   corrige una falta de ortografía no quiere tocar catorce pautas.
 * · Se dice CUÁNTAS pautas y de QUIÉN antes de tocar nada. Reescribir de golpe
 *   lo que ya se entregó a diez personas no puede ser un botón a ciegas.
 */

import { useCallback, useEffect, useRef, useState } from "react";

function fmtFecha(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

export default function PropagarRecetaPanel({ recipeId, recipeName, onDone }) {
  const [items, setItems] = useState(null); // null = cargando
  const [total, setTotal] = useState(0); // en cuántos sitios está, al día o no
  const [marcados, setMarcados] = useState(() => new Set());
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  // `onDone` llega como una arrow nueva en cada render del modal padre. Si
  // entrara en las dependencias del efecto, cualquier repintado del padre
  // volvería a lanzar la consulta —y con ella el `onDone()` del camino «no hay
  // nada que propagar»—. Por eso se guarda en una ref: el efecto depende solo
  // de la receta, que es de lo que de verdad depende.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/nutricion/recipes/${recipeId}/propagate`);
      const j = await r.json();
      if (!j?.ok) {
        // Si no se puede saber dónde está usada, no se bloquea el guardado: la
        // receta YA se guardó bien, esto es un extra.
        onDoneRef.current?.();
        return;
      }
      const todos = j.data?.items || [];
      const desactualizados = todos.filter((i) => i.desactualizado);
      if (desactualizados.length === 0) {
        onDoneRef.current?.();
        return;
      }
      setTotal(todos.length);
      setItems(desactualizados);
      setMarcados(new Set(desactualizados.map((i) => i.planId)));
    } catch {
      onDoneRef.current?.();
    }
  }, [recipeId]);

  useEffect(() => { cargar(); }, [cargar]);

  function alternar(planId) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(planId)) s.delete(planId);
      else s.add(planId);
      return s;
    });
  }

  async function propagar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch(`/api/nutricion/recipes/${recipeId}/propagate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planIds: [...marcados] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) {
        setError(j?.error || "No se pudo actualizar");
        setEnviando(false);
        return;
      }
      onDone?.();
    } catch (e) {
      setError(e.message || "Error de red");
      setEnviando(false);
    }
  }

  // Mientras se averigua, no se pinta nada: en el caso normal —receta sin usar
  // o ya al día— este componente se va sin que nadie lo haya visto.
  if (items === null) return null;

  const pautas = items.filter((i) => i.tipo === "assigned");
  const menus = items.filter((i) => i.tipo !== "assigned");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85dvh] flex flex-col">
        <header className="px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Receta guardada</div>
          <h2 className="text-lg font-semibold text-gray-900 mt-0.5">
            {items.length} {items.length === 1 ? "copia" : "copias"} de «{recipeName}»{" "}
            {items.length === 1 ? "se ha quedado" : "se han quedado"} con la versión anterior
          </h2>
          <p className="text-sm text-gray-500 mt-1.5">
            Cada menú y cada pauta guardan su propia copia de la receta, y no cambian solas.
            {total > items.length && ` (Está en ${total} en total; el resto ya está al día.)`}{" "}
            Marca dónde quieres que entre la corrección.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {pautas.length > 0 && (
            <section>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">
                Pautas de pacientes
              </div>
              <ul className="space-y-1.5">
                {pautas.map((i) => (
                  <Fila key={i.planId} item={i} marcado={marcados.has(i.planId)} onToggle={() => alternar(i.planId)} />
                ))}
              </ul>
            </section>
          )}

          {menus.length > 0 && (
            <section>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">Menús</div>
              <p className="text-xs text-gray-500 mb-2">
                Si no se corrigen aquí, el error vuelve a repartirse la próxima vez que se asigne
                el menú.
              </p>
              <ul className="space-y-1.5">
                {menus.map((i) => (
                  <Fila key={i.planId} item={i} marcado={marcados.has(i.planId)} onToggle={() => alternar(i.planId)} />
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
            Las pautas archivadas no se tocan: son el registro de lo que se entregó aquel día.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onDone}
            disabled={enviando}
            className="px-4 py-2 text-sm rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Ahora no
          </button>
          <button
            type="button"
            onClick={propagar}
            disabled={enviando || marcados.size === 0}
            className="px-4 py-2 text-sm rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {enviando
              ? "Actualizando…"
              : `Actualizar ${marcados.size} de ${items.length}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Fila({ item, marcado, onToggle }) {
  const fecha = fmtFecha(item.asignadaEl);
  const titulo = item.tipo === "assigned" ? item.cliente || "Paciente sin nombre" : item.nombre;
  const sub =
    item.tipo === "assigned"
      ? [item.nombre, fecha && `asignada el ${fecha}`].filter(Boolean).join(" · ")
      : "Menú reutilizable";

  return (
    <li>
      <label className="flex items-start gap-3 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
        <input
          type="checkbox"
          checked={marcado}
          onChange={onToggle}
          className="mt-0.5 accent-[var(--color-primary)]"
        />
        <span className="min-w-0">
          <span className="block text-sm text-gray-900 truncate">{titulo}</span>
          <span className="block text-xs text-gray-500 truncate">{sub}</span>
        </span>
      </label>
    </li>
  );
}

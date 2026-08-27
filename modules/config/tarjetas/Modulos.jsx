"use client";

// modules/config/tarjetas/Modulos.jsx — pestaña «Módulos» de Configuración:
// ajustes que solo aplican a ciertos módulos (derivaciones, categorías
// externas y el candado de IA para empleados).


import { useCallback, useEffect, useState } from "react";
export function DerivacionesCard() {
  const [lineas, setLineas] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    fetch("/api/clinica/derivaciones", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.data) return; // 403: el cliente no tiene Clínica → la tarjeta no se pinta
        setLineas((j.data.especialidades ?? []).map((e) => e.label).join("\n"));
      })
      .catch(() => {});
  }, []);

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/clinica/derivaciones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ especialidades: lineas.split("\n").map((l) => l.trim()).filter(Boolean) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      setLineas((j.data.especialidades ?? []).map((e) => e.label).join("\n"));
      setAviso("Catálogo guardado");
    } catch (e) {
      setAviso(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (lineas === null) return null;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Especialidades de derivación</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        A qué especialistas EXTERNOS deriva el centro (no son las especialidades propias). Una por
        línea; es lo que se puede elegir al crear un informe de derivación.
      </p>
      <textarea
        rows={8}
        value={lineas}
        onChange={(e) => setLineas(e.target.value)}
        className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-neutral-400"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={guardar}
          disabled={guardando}
          className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-50"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {guardando ? "Guardando…" : "Guardar catálogo"}
        </button>
        {aviso && <span className="text-[11px] text-neutral-500">{aviso}</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Renombrar una línea cambia solo la etiqueta: los informes ya escritos siguen apuntando a la
        misma especialidad. Quitar una no borra los informes que la usaban.
      </p>
    </div>
  );
}

/**
 * Cómo consigue su enlace una cita online. Por defecto MANUAL: la cita nace
 * sin enlace, la profesional lo pega y pulsa «Guardar y enviar». Automático es
 * para quien tiene sala de videollamada contratada y la ha puesto en el tipo
 * de cita: la cita lo hereda sola.
 */
/**
 * Recordatorio automático la víspera de la cita. APAGADO por defecto: al
 * encenderlo empiezan a salir correos hacia pacientes reales, y esa decisión
 * es del cliente, no del CRM.
 */
/**
 * Las empresas con las que hay acuerdo, para clasificar las consultas externas
 * (07/08/2026, Rodrigo).
 *
 * Va en Configuración y no en una pantalla propia porque es una lista de
 * nombres y nada más; y se enseña a TODOS los clientes, usen o no las consultas
 * externas, porque la Configuración es universal (regla 14).
 *
 * Quitar una empresa de aquí NO se la quita a los pacientes que ya la tenían:
 * su ficha conserva el texto. Es una lista para teclear más rápido, no un
 * catálogo cerrado — y se dice en pantalla, para que nadie borre pensando que
 * está limpiando fichas.
 */
export function CategoriasExternasCard({ categorias, readOnly, onChange }) {
  const [nueva, setNueva] = useState("");
  const lista = Array.isArray(categorias) ? categorias : [];

  function anadir() {
    const t = nueva.trim();
    if (!t) return;
    // Se compara sin mayúsculas: «Empresa A» y «empresa a» son la misma.
    if (lista.some((c) => c.toLocaleLowerCase("es") === t.toLocaleLowerCase("es"))) {
      setNueva("");
      return;
    }
    onChange([...lista, t]);
    setNueva("");
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Empresas con acuerdo</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        Para clasificar las consultas externas: pacientes que atiendes por un acuerdo con una
        empresa. Aparecen como desplegable en su ficha. Quitar una de aquí no se la quita a los
        pacientes que ya la tienen puesta.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {lista.length === 0 && (
          <span className="text-xs text-neutral-400">Todavía no has añadido ninguna.</span>
        )}
        {lista.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 text-xs bg-neutral-100 text-neutral-700 rounded-lg pl-2.5 pr-1.5 py-1">
            {c}
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(lista.filter((x) => x !== c))}
                className="text-neutral-400 hover:text-red-600"
                aria-label={`Quitar ${c}`}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Rodrigo, 23/08/2026: «no hay una forma de añadir, al igual que sí que
          hay en el elemento de encima». La había —este campo y su botón—, pero
          no se leía como tal: el botón iba en negro al 40 % con el campo vacío,
          que es aspecto de botón roto, y nada decía para qué servía el hueco.
          Ahora lleva su etiqueta y el MISMO botón verde que «Guardar catálogo»
          justo encima, para que las dos tarjetas se parezcan en lo que hacen. */}
      {!readOnly && (
        <div className="mt-4">
          <label className="block text-[11px] font-medium text-neutral-500 mb-1">Añadir una empresa</label>
          <div className="flex gap-2">
            <input
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anadir(); } }}
              placeholder="Nombre de la empresa"
              maxLength={80}
              className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
            <button
              type="button"
              onClick={anadir}
              disabled={!nueva.trim()}
              className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-50 shrink-0"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              Añadir
            </button>
          </div>
          <p className="text-[11px] text-neutral-400 mt-1.5">
            Escribe el nombre y pulsa Añadir (o Intro). Se guarda al momento.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Permisos de IA — el candado para empleados.
 *
 * Con el candado puesto (aiAccess = "restringido"), un empleado que dispare
 * una acción de IA genera una solicitud que cae aquí: el admin la concede
 * (para siempre o para una sola vez), la deniega, o revoca lo concedido.
 * Los avisos van por la campana en ambos sentidos.
 */
export function AiPermissionsCard({ aiAccess, readOnly, onToggle }) {
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const restringido = aiAccess === "restringido";

  const cargar = useCallback(() => {
    fetch("/api/ai-permisos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setDatos(j.data); else setErr(j.error || "Error"); })
      .catch(() => setErr("No se pudieron cargar los permisos"));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function decidir(id, decision) {
    setBusyId(id); setErr(null);
    try {
      const r = await fetch(`/api/ai-permisos/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la decisión");
      cargar();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const btn = "px-2.5 py-1 rounded-md text-[11px] font-semibold border transition disabled:opacity-40";

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Permisos de IA del equipo</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-md">
            La IA consume tu clave (cuesta dinero). Con el candado puesto, los empleados
            necesitan tu permiso para usarla: al intentarlo te llega una solicitud a la campana
            y decides si es para siempre o para una sola vez. Los administradores nunca lo necesitan.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onToggle(restringido ? "libre" : "restringido")}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${restringido ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={restringido ? "Quitar el candado de la IA" : "Poner candado a la IA"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${restringido ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {restringido
          ? <span className="text-amber-700">Candado puesto: los empleados piden permiso.</span>
          : <span className="text-neutral-400">Sin candado: todo el equipo puede usar la IA.</span>}
      </div>

      {err && <div className="mt-3 text-xs text-red-600">{err}</div>}

      {datos && (datos.pendientes.length > 0 || datos.concedidos.length > 0) && (
        <div className="mt-4 space-y-4">
          {datos.pendientes.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
                Solicitudes pendientes
              </div>
              <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-lg overflow-hidden">
                {datos.pendientes.map((p) => (
                  <li key={p.id} className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap bg-amber-50/40">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-neutral-800 truncate">{p.usuario}</div>
                      <div className="text-[11px] text-neutral-500">
                        {p.accion || "usar la IA"} · {new Date(p.solicitadaEl).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button disabled={busyId === p.id} onClick={() => decidir(p.id, "conceder-general")}
                        className={`${btn} text-white border-transparent`} style={{ background: "var(--color-primary, #1B3A2D)" }}>
                        Siempre
                      </button>
                      <button disabled={busyId === p.id} onClick={() => decidir(p.id, "conceder-una-vez")}
                        className={`${btn} border-neutral-300 text-neutral-700 hover:bg-neutral-50`}>
                        Solo una vez
                      </button>
                      <button disabled={busyId === p.id} onClick={() => decidir(p.id, "denegar")}
                        className={`${btn} border-red-200 text-red-600 hover:bg-red-50`}>
                        Denegar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {datos.concedidos.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
                Permisos concedidos
              </div>
              <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-lg overflow-hidden">
                {datos.concedidos.map((p) => (
                  <li key={p.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-neutral-800 truncate">{p.usuario}</div>
                      <div className="text-[11px] text-neutral-500">
                        {p.scope === "general" ? "Para siempre" : "Un solo uso (sin gastar)"}
                        {p.decididaPor ? ` · concedido por ${p.decididaPor}` : ""}
                      </div>
                    </div>
                    <button disabled={busyId === p.id} onClick={() => decidir(p.id, "revocar")}
                      className={`${btn} border-red-200 text-red-600 hover:bg-red-50 shrink-0`}>
                      Revocar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {restringido && datos && datos.pendientes.length === 0 && datos.concedidos.length === 0 && (
        <p className="mt-3 text-[11px] text-neutral-400">
          Nadie ha pedido permiso todavía. Cuando un empleado intente usar la IA, su solicitud aparecerá aquí.
        </p>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import CredentialsModal from "./CredentialsModal.jsx";

/**
 * "Acceso al CRM" — sección de la ficha del empleado (solo admin).
 *
 * Sustituye a la antigua ModulesSection decorativa: aquí los checkboxes SÍ
 * mandan. Si el empleado no tiene login, se le puede crear (usuario + módulos
 * → contraseña generada que se enseña una vez). Si lo tiene, los checkboxes
 * editan su moduleAccess real (lo que ve al entrar), y hay restablecer
 * contraseña y quitar acceso.
 *
 * Las cuentas admin no se gestionan desde aquí (el endpoint las rechaza y la
 * UI lo explica).
 */

export const MODULE_LABELS = {
  clients: "Clientes", leads: "Leads", outreach: "Captación", referidos: "Referidos",
  calendar: "Calendario", citas: "Citas", nutricion: "Nutrición", projects: "Proyectos",
  orders: "Pedidos", billing: "Facturación", documents: "Documentos", clinica: "Clínica",
  pacientes: "Pacientes", team: "Equipo", inventory: "Inventario", training: "Formación",
  cuestionarios: "Cuestionarios", support: "Soporte", formularios: "Formularios",
  planning: "Planificación", analytics: "Analítica", ai: "IA",
  automations: "Automatizaciones", integrations: "Integraciones",
};
export const moduleLabel = (key) => MODULE_LABELS[key] || key;

/** Propuesta de usuario a partir del nombre: "María López" → "maria_{slug}". */
export function suggestUsername(displayName, slug) {
  const first = String(displayName ?? "").trim().split(/\s+/)[0] || "";
  const base = first.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  return base && slug ? `${base}_${slug}` : base;
}

function ModuleChecks({ modules, onToggle, disabled }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {modules.map((m) => (
        <label key={m.moduleKey} className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer py-0.5">
          <input type="checkbox" checked={m.enabled} disabled={disabled} onChange={() => onToggle(m.moduleKey)}
            className="rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]" />
          {moduleLabel(m.moduleKey)}
        </label>
      ))}
    </div>
  );
}

const btnSecondary = "text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";

export default function AccessSection({ memberId, displayName, tenantSlug, onAccessChange }) {
  const [state, setState] = useState(null); // respuesta del GET
  const [err, setErr] = useState(null);

  // Alta de usuario
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  // Edición de módulos (cuando ya hay usuario)
  const [dirty, setDirty] = useState(false);

  const [credentials, setCredentials] = useState(null); // { username, password, title }

  const load = useCallback(() => {
    setState(null); setErr(null); setCreating(false); setDirty(false);
    fetch(`/api/team/${memberId}/access`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setState(j.data); else setErr(j.error || "Error"); })
      .catch(() => setErr("No se pudo cargar el acceso"));
  }, [memberId]);

  useEffect(() => { load(); }, [load]);

  function toggle(key) {
    setState((prev) => ({
      ...prev,
      modules: prev.modules.map((m) => (m.moduleKey === key ? { ...m, enabled: !m.enabled } : m)),
    }));
    setDirty(true);
  }

  const enabledKeys = () => (state?.modules ?? []).filter((m) => m.enabled).map((m) => m.moduleKey);

  async function crearUsuario() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/team/${memberId}/access`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, modules: enabledKeys() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "No se pudo crear el usuario");
      setCredentials({ username: j.data.username, password: j.data.password, title: "Acceso creado" });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function guardarModulos() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/team/${memberId}/access`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: enabledKeys() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "No se pudo guardar");
      setState((prev) => ({ ...prev, modules: j.data.modules }));
      setDirty(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function restablecer() {
    if (!confirm(`¿Restablecer la contraseña de ${state.username}? La actual dejará de funcionar y se cerrarán sus sesiones.`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/team/${memberId}/access/password`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "No se pudo restablecer");
      setCredentials({ username: j.data.username, password: j.data.password, title: "Contraseña restablecida" });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function quitarAcceso() {
    if (!confirm(`¿Quitar el acceso al CRM de ${state.username}? Su ficha de empleado se conserva; podrás crearle un usuario nuevo cuando quieras.`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/team/${memberId}/access`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "No se pudo quitar el acceso");
      load();
      onAccessChange?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      // Sin este finally, tras quitar el acceso `busy` se quedaba en true para
      // siempre y el botón de crear usuario nuevo nacía deshabilitado: había
      // que recargar la página, justo lo contrario de lo que promete el aviso.
      setBusy(false);
    }
  }

  const ninguno = state?.hasUser && !dirty && enabledKeys().length === 0;

  return (
    <div className="pt-4 border-t border-neutral-100">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Acceso al CRM</div>
        {state?.hasUser && !state.managedElsewhere && dirty && (
          <button onClick={guardarModulos} disabled={busy} className={btnSecondary}>
            {busy ? "Guardando..." : "Guardar módulos"}
          </button>
        )}
      </div>

      {err && <div className="text-xs text-red-600 mb-2">{err}</div>}

      {state == null ? (
        !err && <div className="text-xs text-neutral-400">Cargando acceso...</div>
      ) : state.managedElsewhere ? (
        <p className="text-xs text-neutral-500">
          Esta persona entra con la cuenta de administrador <span className="font-mono">{state.username}</span>.
          Las cuentas de administración no se gestionan desde aquí.
        </p>
      ) : state.hasUser ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <div>
              <span className="text-[10px] uppercase tracking-widest text-neutral-400 mr-1.5">Usuario</span>
              <span className="text-sm font-mono text-neutral-800">{state.username}</span>
            </div>
            {state.lastLoginAt && (
              <span className="text-[11px] text-neutral-400">
                Última entrada: {new Date(state.lastLoginAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </div>

          <ModuleChecks modules={state.modules} onToggle={toggle} disabled={busy} />
          {ninguno && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
              Sin ningún módulo marcado esta persona puede entrar pero no verá nada. Para impedir la entrada del todo, usa «Quitar acceso».
            </p>
          )}
          <p className="text-[10px] text-neutral-400">
            Estos módulos controlan lo que ve y puede usar al entrar. Los cambios se aplican al momento.
          </p>

          <div className="flex flex-wrap gap-2">
            <button onClick={restablecer} disabled={busy} className={btnSecondary}>Restablecer contraseña</button>
            <button onClick={quitarAcceso} disabled={busy}
              className="text-[11px] px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
              Quitar acceso
            </button>
          </div>
        </div>
      ) : !creating ? (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">Esta persona todavía no puede entrar al CRM.</p>
          <button
            onClick={() => { setCreating(true); setUsername(suggestUsername(displayName, tenantSlug)); }}
            className="text-[11px] px-3 py-1.5 rounded-lg font-semibold text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>
            Crear usuario de acceso
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Nombre de usuario</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm font-mono text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400" />
            <p className="text-[10px] text-neutral-400">
              Con este nombre (o un email) entrará en el CRM. La contraseña se genera sola y se enseña al crear.
            </p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1.5">Módulos a los que puede acceder</div>
            <ModuleChecks modules={state.modules} onToggle={toggle} disabled={busy} />
          </div>
          <div className="flex gap-2">
            <button onClick={crearUsuario} disabled={busy || !username.trim()}
              className="text-[11px] px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {busy ? "Creando..." : "Crear usuario"}
            </button>
            <button onClick={() => { setCreating(false); setErr(null); }} disabled={busy} className={btnSecondary}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {credentials && (
        <CredentialsModal
          username={credentials.username}
          password={credentials.password}
          title={credentials.title}
          // onAccessChange avisa a la ficha de que este empleado YA tiene (o ya
          // no tiene) login: si no, su copia en memoria se queda con el userId
          // viejo y las decisiones que dependan de él salen mal.
          onClose={() => { setCredentials(null); load(); onAccessChange?.(); }}
        />
      )}
    </div>
  );
}

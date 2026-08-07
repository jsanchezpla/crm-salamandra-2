"use client";

/**
 * ClientConsultaExternaSection — «Consulta externa» en la ficha (07/08/2026,
 * Rodrigo).
 *
 * Un paciente que se atiende por un acuerdo con una empresa. Su historia
 * clínica y sus documentos se guardan aquí como los de cualquiera —Laura no
 * quiere llevar dos archivos— pero NO lleva cuenta en la web: ni área privada,
 * ni documentos compartidos, ni contratos.
 *
 * ── SOLO ADMIN ──────────────────────────────────────────────────────────────
 * La sección entera se le esconde a quien no lo sea, porque la marca decide
 * QUIÉN VE a ese paciente: si la pudiera cambiar cualquiera, la regla de
 * visibilidad no valdría nada. El endpoint lo comprueba también — esconder el
 * botón nunca es la seguridad.
 *
 * La CATEGORÍA (la empresa) se guarda por separado del interruptor, a
 * propósito: cambiar de empresa es una corrección de dato y no debería tener
 * que pasar por marcar y desmarcar nada.
 */

import { useCallback, useEffect, useState } from "react";

export default function ClientConsultaExternaSection({ clientId }) {
  const [esAdmin, setEsAdmin] = useState(null);
  const [externa, setExterna] = useState(false);
  const [categoria, setCategoria] = useState("");
  const [categorias, setCategorias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [me, ficha, cfg] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/clients/${clientId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/tenant/settings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const rol = me?.data?.role ?? me?.data?.user?.role ?? null;
      // Ante la duda, NO es admin: enseñar el interruptor a quien no puede
      // usarlo solo produce un error al guardar.
      setEsAdmin(rol === "admin" || rol === "superadmin");
      setExterna(!!ficha?.data?.esConsultaExterna);
      setCategoria(ficha?.data?.categoriaExterna ?? "");
      setCategorias(cfg?.data?.categoriasExternas ?? []);
    } catch {
      setEsAdmin(false);
    }
    setCargando(false);
  }, [clientId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(cambios, mensaje) {
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "No se ha podido guardar");
      setAviso(mensaje);
    } catch (e) {
      setError(e.message);
      cargar(); // deshace el cambio optimista de la pantalla
    }
    setGuardando(false);
  }

  if (cargando || esAdmin !== true) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Consulta externa</span>
      </div>

      <div className="p-5 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={externa}
            disabled={guardando}
            onChange={(e) => {
              const v = e.target.checked;
              setExterna(v);
              guardar(
                { esConsultaExterna: v },
                v
                  ? "Marcada como consulta externa: no se le crea cuenta en la web."
                  : "Ya no es una consulta externa: vuelve a verla todo el equipo."
              );
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span className="text-sm text-gray-700">
            Es una consulta externa
            <span className="block text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              Viene por un acuerdo con una empresa. Su historia clínica y sus documentos se guardan
              aquí, pero <b>no se le crea cuenta en la web</b> ni se le comparten documentos. Solo la
              veis tú y quien la tenga asignada; solo recibirá los avisos automáticos si le pones
              teléfono o correo.
            </span>
          </span>
        </label>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Empresa</label>
          <div className="flex gap-2">
            <select
              value={categorias.includes(categoria) || !categoria ? categoria : "__otra__"}
              disabled={guardando}
              onChange={(e) => {
                const v = e.target.value === "__otra__" ? categoria : e.target.value;
                setCategoria(v);
                guardar({ categoriaExterna: v || null }, v ? `Guardada: ${v}` : "Empresa quitada");
              }}
              className="flex-1 border border-gray-200 rounded-md px-2.5 py-1.5 text-sm bg-white"
            >
              <option value="">Sin empresa</option>
              {categorias.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              {/*
                La que ya tenía puesta pero ya no está en la lista de
                Configuración: se conserva y se puede seguir eligiendo. Quitar
                una empresa de la lista no debe borrarla de las fichas.
              */}
              {categoria && !categorias.includes(categoria) && (
                <option value="__otra__">{categoria} (ya no está en la lista)</option>
              )}
            </select>
          </div>
          {categorias.length === 0 && (
            <p className="text-[11px] text-gray-400 mt-1">
              No hay empresas configuradas. Se añaden en Configuración → Empresas con acuerdo.
            </p>
          )}
        </div>

        {aviso && <p className="text-[11px] text-emerald-700">{aviso}</p>}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

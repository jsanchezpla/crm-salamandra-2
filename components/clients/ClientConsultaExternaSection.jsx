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
  const [anadiendo, setAnadiendo] = useState(false);
  const [empresaNueva, setEmpresaNueva] = useState("");

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

  /*
   * Añadir una empresa desde aquí (07/08/2026, Rodrigo): «para no tener que ir
   * hasta Configuración para hacerlo». Se añade a la lista del cliente —la
   * misma que se edita allí, no una copia— y de paso se le pone a esta ficha,
   * que es para lo que se estaba añadiendo.
   *
   * Se manda la lista ENTERA, no solo la nueva: el endpoint de ajustes guarda
   * el array completo. Por eso se parte de `categorias`, que es lo que se leyó
   * al abrir; si alguien añadió otra desde Configuración mientras tanto, esa se
   * perdería — pero recargar aquí obligaría a pedir los ajustes en cada tecla,
   * y el caso es raro frente al coste.
   */
  async function anadirEmpresa() {
    const t = empresaNueva.trim();
    if (!t) return;
    const yaEsta = categorias.find((c) => c.toLocaleLowerCase("es") === t.toLocaleLowerCase("es"));
    if (yaEsta) {
      // Ya existía con otras mayúsculas: se usa la que hay, sin duplicarla.
      setCategoria(yaEsta);
      setEmpresaNueva("");
      setAnadiendo(false);
      guardar({ categoriaExterna: yaEsta }, `Guardada: ${yaEsta}`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      // PATCH, no PUT: el endpoint de ajustes del cliente solo expone GET y
      // PATCH, y un PUT se va en un 405 mudo (sin cuerpo) que en pantalla
      // aparecía como «no se ha podido añadir» sin más.
      const res = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoriasExternas: [...categorias, t] }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "No se ha podido añadir la empresa");
      setCategorias([...categorias, t]);
      setCategoria(t);
      setEmpresaNueva("");
      setAnadiendo(false);
      setGuardando(false);
      await guardar({ categoriaExterna: t }, `Empresa «${t}» creada y asignada.`);
      return;
    } catch (e) {
      setError(e.message);
    }
    setGuardando(false);
  }

  if (cargando || esAdmin !== true) return null;

  return (
    // El `mt-6` es para que no se pegue a la tarjeta de arriba. El ancho ya NO
    // se decide aquí (24/08/2026): lo pone el contenedor de la pestaña, en
    // modules/default/ClientDetailModule.jsx. Antes cada tarjeta llevaba el suyo
    // copiado a mano —eran veintiuna— y por eso la ficha cambiaba de ancho según
    // la pestaña que pulsaras.
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
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
          {!anadiendo ? (
            <button
              type="button"
              onClick={() => setAnadiendo(true)}
              className="text-[11px] text-[var(--color-primary)] hover:underline mt-1.5"
            >
              + Añadir una empresa nueva
            </button>
          ) : (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={empresaNueva}
                onChange={(e) => setEmpresaNueva(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); anadirEmpresa(); }
                  if (e.key === "Escape") { setAnadiendo(false); setEmpresaNueva(""); }
                }}
                placeholder="Nombre de la empresa"
                maxLength={80}
                className="flex-1 border border-gray-200 rounded-md px-2.5 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={anadirEmpresa}
                disabled={guardando || !empresaNueva.trim()}
                className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-40 shrink-0"
              >
                Añadir
              </button>
              <button
                type="button"
                onClick={() => { setAnadiendo(false); setEmpresaNueva(""); }}
                className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-800 shrink-0"
              >
                Cancelar
              </button>
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-1">
            Las empresas que añadas aquí quedan disponibles para el resto de fichas, igual que si
            las pusieras en Configuración.
          </p>
        </div>

        {aviso && <p className="text-[11px] text-emerald-700">{aviso}</p>}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

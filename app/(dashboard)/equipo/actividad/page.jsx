"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";

/**
 * Equipo → Actividad — registro legible de lo que ha hecho cada usuario.
 *
 * No es un log técnico: cada fila es una frase ("Asignó un menú a un
 * paciente"), con su módulo, su autor y su hora, agrupado por días y
 * filtrable por módulo, usuario y rango. Solo admin (la API devuelve 403 al
 * resto y aquí se enseña el aviso).
 */

// Color estable por módulo (pastillas). Paleta suave de la casa.
const COLORES = {
  Equipo: "bg-indigo-50 text-indigo-700 border-indigo-100",
  Clientes: "bg-sky-50 text-sky-700 border-sky-100",
  Proyectos: "bg-violet-50 text-violet-700 border-violet-100",
  Facturación: "bg-emerald-50 text-emerald-700 border-emerald-100",
  Citas: "bg-cyan-50 text-cyan-700 border-cyan-100",
  Clínica: "bg-rose-50 text-rose-700 border-rose-100",
  Pacientes: "bg-pink-50 text-pink-700 border-pink-100",
  Nutrición: "bg-lime-50 text-lime-700 border-lime-100",
  Captación: "bg-orange-50 text-orange-700 border-orange-100",
  Documentos: "bg-amber-50 text-amber-700 border-amber-100",
  Formación: "bg-teal-50 text-teal-700 border-teal-100",
  Formularios: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100",
  IA: "bg-purple-50 text-purple-700 border-purple-100",
  Configuración: "bg-neutral-100 text-neutral-600 border-neutral-200",
  Otros: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

const RANGOS = [
  { value: 7, label: "7 días" },
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
];

function iniciales(email) {
  const nombre = String(email || "?").split("@")[0];
  return nombre.slice(0, 2).toUpperCase();
}

// Color de avatar estable por usuario (hash simple del email).
const AVATARES = ["bg-indigo-400", "bg-emerald-400", "bg-rose-400", "bg-amber-400", "bg-sky-400", "bg-violet-400", "bg-teal-400"];
function colorAvatar(email) {
  let h = 0;
  for (const c of String(email || "")) h = (h * 31 + c.charCodeAt(0)) % 997;
  return AVATARES[h % AVATARES.length];
}

function tituloDia(fecha) {
  const d = new Date(fecha);
  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  const mismo = (a, b) => a.toDateString() === b.toDateString();
  if (mismo(d, hoy)) return "Hoy";
  if (mismo(d, ayer)) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

export default function ActividadPage() {
  const [dias, setDias] = useState(7);
  const [modulo, setModulo] = useState("");
  const [usuario, setUsuario] = useState("");
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(() => {
    setCargando(true);
    setErr(null);
    const params = new URLSearchParams({ dias: String(dias) });
    if (modulo) params.set("modulo", modulo);
    if (usuario) params.set("usuario", usuario);
    fetch(`/api/actividad?${params}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (j.ok) setDatos(j.data);
        else setErr(status === 403 ? "Esta pantalla es solo para administradores." : j.error || "Error");
      })
      .catch(() => setErr("No se pudo cargar la actividad"))
      .finally(() => setCargando(false));
  }, [dias, modulo, usuario]);

  useEffect(() => { cargar(); }, [cargar]);

  // Agrupar por día (las filas vienen ordenadas de más reciente a más antigua).
  const porDia = useMemo(() => {
    if (!datos?.filas) return [];
    const grupos = [];
    let actual = null;
    for (const f of datos.filas) {
      const clave = new Date(f.cuando).toDateString();
      if (!actual || actual.clave !== clave) {
        actual = { clave, titulo: tituloDia(f.cuando), filas: [] };
        grupos.push(actual);
      }
      actual.filas.push(f);
    }
    return grupos;
  }, [datos]);

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Equipo · Registro</div>
        <h1 className="font-display text-[26px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
          Actividad del equipo
          <HelpTooltip title="Qué se registra aquí" className="ml-2">
            Se apunta lo que cambia algo: dar de alta, editar, borrar, cobrar, enviar… y las
            entradas al CRM. Consultar una ficha, mirar la agenda o leer un informe no dejan
            rastro aquí.{" "}
            <strong className="text-white">
              Que alguien no aparezca no quiere decir que no haya trabajado.
            </strong>
          </HelpTooltip>
        </h1>
        <p className="text-xs text-neutral-400 mt-2">
          Qué ha hecho cada persona en el CRM, cuándo y en qué módulo. Solo lo ven los administradores.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex rounded-lg border border-neutral-200 overflow-hidden">
          {RANGOS.map((r) => (
            <button key={r.value} onClick={() => setDias(r.value)}
              className={`px-3 py-1.5 text-xs font-medium transition ${
                dias === r.value ? "text-white" : "bg-white text-neutral-500 hover:bg-neutral-50"
              }`}
              style={dias === r.value ? { background: "var(--color-primary, #1B3A2D)" } : {}}>
              {r.label}
            </button>
          ))}
        </div>

        {datos?.usuarios?.length > 0 && (
          <Select
            value={usuario}
            onChange={setUsuario}
            options={[{ value: "", label: "Todo el equipo" }, ...datos.usuarios.map((u) => ({ value: u.id, label: u.email }))]}
            className="rounded-lg px-3 py-1.5 text-xs bg-white border border-neutral-200"
          />
        )}
      </div>

      {/* Chips de módulo */}
      {datos?.modulos?.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          <button onClick={() => setModulo("")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
              !modulo ? "bg-neutral-800 text-white border-neutral-800" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300"
            }`}>
            Todos
          </button>
          {datos.modulos.map((m) => (
            <button key={m} onClick={() => setModulo(modulo === m ? "" : m)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                modulo === m ? "bg-neutral-800 text-white border-neutral-800" : `${COLORES[m] || COLORES.Otros} hover:opacity-80`
              }`}>
              {m}
            </button>
          ))}
        </div>
      )}

      {err && (
        <div className="bg-white border border-neutral-200 rounded-xl px-5 py-8 text-center text-sm text-neutral-500">{err}</div>
      )}

      {!err && cargando && !datos && (
        <div className="bg-white border border-neutral-200 rounded-xl px-5 py-8 text-center text-xs text-neutral-400">Cargando actividad…</div>
      )}

      {!err && datos && porDia.length === 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl px-5 py-10 text-center">
          <div className="text-sm text-neutral-500">Sin actividad registrada en este rango.</div>
          <div className="text-[11px] text-neutral-400 mt-1">Prueba a ampliar los días o a quitar los filtros.</div>
        </div>
      )}

      {!err && porDia.map((grupo) => (
        <div key={grupo.clave} className="mb-6">
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2 first-letter:uppercase">
            {grupo.titulo}
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <ul className="divide-y divide-neutral-100">
              {grupo.filas.map((f) => (
                <li key={f.id} className="px-4 py-3 flex items-center gap-3">
                  <span className="text-[11px] text-neutral-400 tabular-nums w-11 shrink-0">
                    {new Date(f.cuando).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span
                    className={`w-7 h-7 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0 ${colorAvatar(f.usuario)}`}
                    title={f.usuario}
                  >
                    {iniciales(f.usuario)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-neutral-800 leading-snug">{f.texto}</div>
                    <div className="text-[11px] text-neutral-400 truncate">{f.usuario}</div>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border ${COLORES[f.modulo] || COLORES.Otros}`}>
                    {f.modulo}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}

      {datos?.truncado && (
        <p className="text-[11px] text-neutral-400 text-center mb-6">
          Se muestran los últimos 400 movimientos del rango. Acota con los filtros para ver más detalle.
        </p>
      )}
    </div>
  );
}

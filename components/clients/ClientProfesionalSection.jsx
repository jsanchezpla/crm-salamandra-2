"use client";

/**
 * ClientProfesionalSection — «Profesional de referencia» en la ficha
 * (10/08/2026, Rodrigo: «en la ficha, debajo de consultas externas, debería
 * salir quién es su profesional de referencia y poder cambiarlo»).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 * El campo existe desde el 06/08 (`clients.assigned_team_member_id`) pero solo
 * se podía poner UNA VEZ y en un sitio: al aceptar la solicitud en la bandeja.
 * A partir de ahí no había forma de verlo ni de cambiarlo, y una asignación se
 * cambia — alguien se va, una paciente pasa de una compañera a otra, o se
 * eligió mal con las prisas.
 *
 * No es un dato decorativo: gobierna DOS cosas que ya funcionan.
 *   · La agenda pública le enseña solo los huecos de esa persona
 *     (`lib/citas/horarioProfesional.js`).
 *   · Si es una consulta externa, es QUIÉN LA VE además de los admin
 *     (`lib/clients/consultaExterna.js`).
 *
 * ── QUIÉN PUEDE CAMBIARLO ───────────────────────────────────────────────────
 * Quien pueda abrir la ficha. EXCEPTO en una consulta externa, donde solo un
 * admin: ahí elegir profesional es elegir quién ve a esa persona, y un permiso
 * no se regala a sí mismo. El endpoint lo comprueba también — esconder el
 * desplegable nunca es la seguridad.
 *
 * ── CUÁNDO NO SE PINTA ──────────────────────────────────────────────────────
 * Si el centro no tiene módulo de Equipo (la lista responde 403 y llega vacía)
 * o si no hay nadie dado de alta: un desplegable sin nadie a quien elegir es
 * una tarjeta que solo estorba. Una consulta de una sola profesional puede
 * seguir sin asignar a nadie, que es lo que ha hecho siempre.
 */

import { useCallback, useEffect, useState } from "react";

const SIN_ASIGNAR = "";

export default function ClientProfesionalSection({ clientId }) {
  const [equipo, setEquipo] = useState([]);
  const [asignado, setAsignado] = useState(SIN_ASIGNAR);
  const [esAdmin, setEsAdmin] = useState(false);
  const [esExterna, setEsExterna] = useState(false);
  const [conPacientes, setConPacientes] = useState(false);
  const [conCitas, setConCitas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/clients/${clientId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      // `status=all` a propósito: si a quien tiene asignada esta ficha le han
      // dado de baja, tiene que SALIR en el desplegable —marcada— y no
      // desaparecer dejando el hueco en blanco como si no hubiera nadie.
      fetch("/api/team?status=all&limit=200", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([me, ficha, team]) => {
        if (!vivo) return;
        const rol = me?.data?.role ?? me?.data?.user?.role ?? null;
        const modulos = new Set(me?.data?.enabledModules ?? []);
        setEsAdmin(rol === "admin" || rol === "superadmin");
        setConPacientes(modulos.has("pacientes"));
        setConCitas(modulos.has("citas"));
        setEquipo(team?.data?.members ?? []);
        setAsignado(ficha?.data?.assignedTeamMemberId ?? SIN_ASIGNAR);
        setEsExterna(!!ficha?.data?.esConsultaExterna);
      })
      .catch(() => {})
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [clientId]);

  useEffect(() => cargar(), [cargar]);

  async function elegir(valor) {
    const previo = asignado;
    setAsignado(valor); // optimista: es un desplegable, la espera se nota
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTeamMemberId: valor || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "No se ha podido guardar");
      const quien = equipo.find((m) => String(m.id) === String(valor));
      setAviso(
        valor
          ? `Su seguimiento pasa a ${quien?.displayName || quien?.email || "esa persona"}.`
          : "Sin profesional asignado: vuelve a ver la agenda del centro entera."
      );
    } catch (e) {
      setAsignado(previo); // se deshace: que el desplegable no mienta
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return null;

  // Sin módulo de Equipo (403 → lista vacía) o sin nadie dado de alta: no hay
  // nada que elegir.
  if (equipo.length === 0) return null;

  // Elegibles: quien está en activo o de baja temporal. A quien ya no está en
  // el equipo no se le puede asignar nada nuevo, pero si es el que consta en
  // ESTA ficha se sigue enseñando (abajo) para que se vea lo que hay.
  const elegibles = equipo.filter((m) => m.status !== "inactive");
  const actual = equipo.find((m) => String(m.id) === String(asignado)) ?? null;
  const yaNoEsta = Boolean(asignado) && actual != null && actual.status === "inactive";

  const puedeCambiar = esAdmin || !esExterna;
  const sinHorario = actual != null && actual.tieneHorario === false;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6 max-w-5xl">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Profesional de referencia</span>
      </div>

      <div className="p-5 space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1" htmlFor={`profesional-${clientId}`}>
            Lleva el seguimiento
          </label>
          <select
            id={`profesional-${clientId}`}
            value={asignado}
            disabled={guardando || !puedeCambiar}
            onChange={(e) => elegir(e.target.value)}
            className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-500"
          >
            <option value={SIN_ASIGNAR}>Sin asignar</option>
            {elegibles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName || m.email}
                {m.status === "on_leave" ? " (de baja)" : ""}
              </option>
            ))}
            {yaNoEsta && (
              <option value={actual.id}>
                {actual.displayName || actual.email} (ya no está en el equipo)
              </option>
            )}
          </select>
        </div>

        <p className="text-[11px] text-gray-500 leading-relaxed">
          Con quién lleva su seguimiento esta ficha.
          {conCitas && " Sin asignar, al pedir cita ve la agenda del centro entera; asignada, solo los huecos de esa persona."}
          {esExterna && " En una consulta externa es además quien la ve, junto con la dirección."}
          {conPacientes && " El terapeuta de cada paciente se pone en la ficha del paciente, no aquí."}
        </p>

        {/*
          Sin horario propio, su paciente no ve NI UN HUECO (07/08/2026). Se
          avisa aquí igual que en la bandeja, porque si no el síntoma es una
          paciente diciendo que la agenda le sale vacía y nadie relaciona una
          cosa con la otra.
        */}
        {conCitas && sinHorario && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Esta persona no tiene su horario puesto, así que quien se le asigne no verá ningún hueco al
            pedir cita. Rellénalo en Equipo → su ficha → horario.
          </p>
        )}

        {!puedeCambiar && (
          <p className="text-[11px] text-gray-400">
            Es una consulta externa: solo la dirección puede cambiar con quién va.
          </p>
        )}

        {aviso && <p className="text-[11px] text-emerald-700">{aviso}</p>}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

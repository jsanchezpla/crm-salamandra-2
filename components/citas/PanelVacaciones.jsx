"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * PanelVacaciones — «Vacaciones» y ausencias del equipo (06/08/2026, Rodrigo).
 *
 * Rodrigo lo pidió como «un tipo de cita especial que no requiere paciente,
 * con fecha y hora de inicio y de fin, asignado a un miembro del equipo».
 * Por dentro no es una cita (el porqué, en `models/tenant/TeamBlock.model.js`),
 * y desde el 12/08/2026 tampoco vive donde una: tiene pantalla propia en
 * `/citas/bloqueos`.
 *
 * ── SE PUEDEN CORREGIR (12/08/2026, Jorge) ──────────────────────────────────
 * Hasta hoy una ausencia mal puesta solo se podía quitar y volver a escribir.
 * Eso ya costó un script: las seis que en la consulta de Laura quedaron a
 * nombre de «Todo el centro» hubo que arreglarlas con
 * `scripts/reasignar-ausencias-sin-persona.js`. Ahora hay un botón de editar, y
 * DE QUIÉN ES solo lo cambia dirección — reasignar es justo la operación que le
 * cerró la agenda seis veces.
 *
 * LO USA TODO EL EQUIPO (07/08/2026, Rodrigo). Nació solo para admin, pensando
 * que bloquear la agenda era cosa de dirección, y en una consulta de dos
 * personas eso significaba que quien se va de vacaciones no puede apuntarlo:
 * tiene que pedírselo a otra. Mismo criterio que apuntar, rechazar y confirmar
 * citas, que se abrieron al equipo el 06/08.
 *
 * ── CADA UNA LAS SUYAS (10/08/2026, aviso de la consulta de Laura) ──────────
 * Se podía apuntar una ausencia A NOMBRE DE CUALQUIERA, y el desplegable venía
 * en «Todo el centro». Resultado: las SEIS ausencias que tenían apuntadas
 * cerraban la agenda entera, incluida la de Laura, cuando eran todas de Rocío.
 * Nadie lo vio venir porque el efecto —un hueco que no se ofrece— se ve igual.
 *
 *   · el desplegable arranca en UNO MISMO; cerrar el centro es una elección.
 *   · quien no es admin no ve desplegable: solo puede ponerse las suyas.
 *   · cada cual ve las suyas y las del centro, salvo con la agenda compartida
 *     encendida (Aumenta), donde se siguen viendo todas.
 *
 * El servidor impone las tres cosas por su cuenta: aquí solo se evita enseñar
 * puertas que están cerradas.
 *
 * Todo bloqueo queda en la auditoría con quién lo puso, y la tabla enseña
 * «lo apuntó Fulana» — que es la respuesta cuando alguien pregunte por qué su
 * agenda apareció cerrada un martes. En el CALENDARIO no sale (Jorge, 10/08).
 */

/*
 * La hora se manda PARTIDA (fecha + hora) y la interpreta el servidor como hora
 * de Madrid. Antes se mandaba "2026-08-17T07:00:00" de una pieza y sin zona:
 * el servidor de producción va en UTC, así que «de 7 a 9» se guardaba como «de
 * 9 a 11» de Madrid. En local no se veía, porque aquí el reloj ya es de Madrid.
 *
 * Se sigue mandando también el ISO suelto por si una versión vieja de la
 * pantalla se queda abierta; el servidor prefiere la forma partida.
 */
function iso(fecha, hora) {
  if (!fecha) return null;
  return `${fecha}T${hora || "00:00"}:00`;
}

/** "2026-08-10T09:00:00.000Z" → "10 ago, 11:00" en hora de Madrid. */
function bonito(valor) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

const HOY = () => new Date().toISOString().slice(0, 10);

/**
 * El camino de vuelta de `bonito()`: un instante → la fecha y la hora que se ven
 * en MADRID, listas para meter en los `<input type=date|time>` al editar.
 *
 * No vale `toISOString().slice(...)`, que daría la hora UTC: una ausencia de las
 * 09:00 de Madrid se abriría diciendo 07:00 y, al guardar sin tocarla, se
 * movería dos horas sola. Es el mismo enredo de zonas que ya costó el arreglo
 * del 07/08 al guardar, ahora al revés.
 */
function partirEnMadrid(valor) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return { fecha: "", hora: "00:00" };
  const fecha = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  const hora = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return { fecha, hora: hora === "24:00" ? "00:00" : hora };
}

export default function PanelVacaciones() {
  const [bloqueos, setBloqueos] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [aviso, setAviso] = useState(null);
  /** Quién soy, según el servidor: `{ esAdmin, teamMemberId }`. */
  const [yo, setYo] = useState(null);
  /** `null` = el formulario crea; un id = está corrigiendo esa ausencia. */
  const [editando, setEditando] = useState(null);

  const [form, setForm] = useState({
    teamMemberId: "", label: "Vacaciones",
    fechaIni: "", horaIni: "00:00", fechaFin: "", horaFin: "23:59",
  });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // Desde hoy: lo que ya pasó no ayuda a nadie y la lista se llenaría sola.
      const desde = new Date(`${HOY()}T00:00:00`).toISOString();
      const hasta = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(`/api/citas/bloqueos?from=${desde}&to=${hasta}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setBloqueos(json.data.bloqueos ?? []);
        const quien = json.data.yo ?? null;
        setYo(quien);
        /*
         * El desplegable arranca en UNO MISMO, no en «Todo el centro».
         *
         * Al revés es como se cerró seis veces la agenda entera de la consulta
         * de Laura: se apuntaba una ausencia propia, no se tocaba el
         * desplegable, y el valor por defecto cerraba el centro. El caso raro
         * (cerrar de verdad todo el centro) tiene que costar un clic; el de
         * todos los días, ninguno.
         *
         * Solo la primera vez: si ya hay algo elegido no se pisa.
         */
        setForm((f) => (f.teamMemberId || !quien?.teamMemberId ? f : { ...f, teamMemberId: quien.teamMemberId }));
      }
    } catch { /* la lista se queda como estaba */ }
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    let vivo = true;
    fetch("/api/team?status=active&limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j?.data?.members) setEquipo(j.data.members); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  /** Abre el formulario con una ausencia dentro, para corregirla. */
  function editar(b) {
    const ini = partirEnMadrid(b.startAt);
    const fin = partirEnMadrid(b.endAt);
    setForm({
      teamMemberId: b.teamMemberId || "",
      label: b.label || "Vacaciones",
      fechaIni: ini.fecha, horaIni: ini.hora,
      fechaFin: fin.fecha, horaFin: fin.hora,
    });
    setEditando(b.id);
    setAbierto(true);
    setFallo(null);
    setAviso(null);
  }

  /** Cierra el formulario y lo deja como estaba para crear. */
  function cerrar() {
    setAbierto(false);
    setEditando(null);
    setFallo(null);
    setForm((f) => ({
      ...f,
      teamMemberId: yo?.teamMemberId ?? "",
      label: "Vacaciones",
      fechaIni: "", horaIni: "00:00", fechaFin: "", horaFin: "23:59",
    }));
  }

  // El mismo formulario pone y corrige: lo único que cambia es a dónde va.
  async function guardar() {
    setFallo(null);
    setAviso(null);
    const fechaFin = form.fechaFin || form.fechaIni;
    const startAt = iso(form.fechaIni, form.horaIni);
    const endAt = iso(fechaFin, form.horaFin);
    if (!startAt || !endAt) { setFallo("Pon al menos la fecha de inicio"); return; }
    if (new Date(endAt) <= new Date(startAt)) { setFallo("El final tiene que ser posterior al inicio"); return; }

    setGuardando(true);
    try {
      const cuerpo = {
        label: form.label || "Vacaciones",
        startDate: form.fechaIni,
        startTime: form.horaIni || "00:00",
        endDate: fechaFin,
        endTime: form.horaFin || "23:59",
        startAt, endAt,
      };
      // De quién es solo se manda si se puede cambiar. Sin ser dirección no se
      // manda NUNCA al corregir: el servidor responde 403 al verlo, aunque sea
      // el mismo valor que ya tenía.
      if (yo?.esAdmin) cuerpo.teamMemberId = form.teamMemberId || null;

      const res = await fetch(
        editando ? `/api/citas/bloqueos?id=${editando}` : "/api/citas/bloqueos",
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido guardar");
      // Las citas que ya estaban dentro NO se cancelan: se avisa y decide el centro.
      const hecho = editando ? "Corregida" : "Bloqueado";
      if (json.data?.citasDentro > 0) {
        setAviso(`${hecho}. Ojo: hay ${json.data.citasDentro} cita(s) ya puestas dentro de ese tramo; no se han tocado.`);
      } else {
        setAviso(`${hecho}.`);
      }
      cerrar();
      cargar();
    } catch (e) {
      setFallo(e.message);
    }
    setGuardando(false);
  }

  async function quitar(id) {
    setFallo(null);
    try {
      const res = await fetch(`/api/citas/bloqueos?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se ha podido quitar");
      setBloqueos((b) => b.filter((x) => x.id !== id));
    } catch (e) {
      setFallo(e.message);
    }
  }

  return (
    <section className="border border-[var(--ink-200)] rounded-xl overflow-hidden">
      <header className="px-4 lg:px-5 py-3.5 bg-neutral-50/70 border-b border-[var(--ink-200)] flex items-center justify-between gap-3 flex-wrap">
        <div>
          {/* «Bloqueos», igual que el menú, el botón y la cabecera de la
              pantalla (14/08/2026, Rodrigo). Se llamaba «Vacaciones y
              ausencias» y era el único sitio que no lo decía así. */}
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">Bloqueos</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Tramos en los que alguien no pasa consulta. La agenda deja de ofrecer sus huecos;
            las citas que ya hubiera dentro no se tocan. Los ve todo el equipo; cada cual solo
            puede poner y quitar los suyos.
          </p>
        </div>
        <button
          onClick={() => (abierto ? cerrar() : setAbierto(true))}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] transition-colors shrink-0"
        >
          {abierto ? "Cancelar" : "Bloquear un tramo"}
        </button>
      </header>

      {abierto && (
        <div className="px-4 lg:px-5 py-4 border-b border-[var(--ink-200)] bg-white">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Quién</span>
              {yo?.esAdmin ? (
                <select
                  value={form.teamMemberId}
                  onChange={(e) => setForm((f) => ({ ...f, teamMemberId: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm bg-white"
                >
                  {equipo.map((m) => (
                    <option key={m.id} value={m.id}>{m.displayName || m.email}</option>
                  ))}
                  {/* Al final y con su nombre completo: cerrar el centro entero
                      es la excepción, no lo primero que se encuentra la mano. */}
                  <option value="">Todo el centro (cierra a todo el mundo)</option>
                </select>
              ) : (
                /* Quien no es dirección solo se pone ausencias a sí mismo, así
                   que no hay nada que elegir. El servidor lo impone igual: esto
                   es solo no enseñar una puerta que está cerrada. */
                <p className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm bg-neutral-50 text-neutral-600 truncate">
                  {equipo.find((m) => m.id === yo?.teamMemberId)?.displayName || "Tus ausencias"}
                </p>
              )}
            </label>
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Motivo</span>
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Vacaciones"
                className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Desde</span>
              <div className="flex gap-1.5">
                <input type="date" value={form.fechaIni}
                  onChange={(e) => setForm((f) => ({ ...f, fechaIni: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm" />
                <input type="time" value={form.horaIni}
                  onChange={(e) => setForm((f) => ({ ...f, horaIni: e.target.value }))}
                  className="w-24 border border-neutral-200 rounded-md px-2 py-1.5 text-sm" />
              </div>
            </label>
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Hasta</span>
              <div className="flex gap-1.5">
                <input type="date" value={form.fechaFin} min={form.fechaIni || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm" />
                <input type="time" value={form.horaFin}
                  onChange={(e) => setForm((f) => ({ ...f, horaFin: e.target.value }))}
                  className="w-24 border border-neutral-200 rounded-md px-2 py-1.5 text-sm" />
              </div>
            </label>
          </div>
          <p className="text-[11px] text-neutral-400 mt-2">
            Si dejas «Hasta» vacío se bloquea solo el día de inicio. Un día entero es de 00:00 a 23:59.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={guardar}
              disabled={guardando}
              className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Bloquear"}
            </button>
            {editando && (
              <button onClick={cerrar} className="text-xs px-3 py-1.5 rounded-md text-neutral-500 hover:text-neutral-800">
                Cancelar
              </button>
            )}
            {fallo && <span className="text-xs text-red-600">{fallo}</span>}
          </div>
        </div>
      )}

      {aviso && !abierto && (
        <p className="px-4 lg:px-5 py-2.5 text-xs text-emerald-800 bg-emerald-50 border-b border-emerald-100">{aviso}</p>
      )}

      <div className="divide-y divide-[var(--ink-100)]">
        {cargando && <p className="px-4 lg:px-5 py-4 text-xs text-neutral-400">Cargando…</p>}
        {!cargando && bloqueos.length === 0 && (
          <p className="px-4 lg:px-5 py-4 text-xs text-neutral-400">
            No hay ningún tramo bloqueado por delante.
          </p>
        )}
        {bloqueos.map((b) => (
          <div key={b.id} className="px-4 lg:px-5 py-3 flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-[var(--ink-900)] truncate">
                {b.label}
                <span className="font-normal text-neutral-500">
                  {" · "}{b.teamMemberName || "Todo el centro"}
                </span>
              </p>
              <p className="text-xs text-neutral-500">
                {bonito(b.startAt)} → {bonito(b.endAt)}
                {/* Quién lo APUNTÓ, que no siempre es de quién es. Solo aquí:
                    en el calendario no pinta nada (Jorge, 10/08). */}
                {b.createdByName && (
                  <span className="text-neutral-400">{" · lo apuntó "}{b.createdByName}</span>
                )}
              </p>
            </div>
            {/* Editar y quitar van juntos: quien puede abrir un hueco puede
                corregirlo. La condición es la misma que impone el servidor. */}
            {(yo?.esAdmin || (b.teamMemberId && b.teamMemberId === yo?.teamMemberId)) && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => editar(b)}
                  className="text-xs px-2.5 py-1 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                >
                  Editar
                </button>
                <button
                  onClick={() => quitar(b.id)}
                  className="text-xs px-2.5 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50"
                >
                  Quitar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

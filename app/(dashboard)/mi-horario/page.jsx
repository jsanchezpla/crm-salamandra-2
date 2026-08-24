"use client";

/**
 * /mi-horario — autoservicio del terapeuta: ve y edita SU horario de trabajo
 * semanal (el que usa la IA de citas para proponer huecos) y sus próximas citas.
 * El horario de otros lo gestiona el centro desde Equipo; aquí solo el propio
 * (resuelto por /api/team/me). Cada uno ve lo suyo; el centro lo ve todo.
 */

import { useEffect, useState } from "react";
import TeamHoursEditor from "@/components/team/TeamHoursEditor.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

function fmtCita(iso) {
  try {
    const dt = new Date(iso);
    const f = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(dt);
    return f.charAt(0).toUpperCase() + f.slice(1);
  } catch {
    return iso;
  }
}
function personaCita(b) {
  if (b.patient) return [b.patient.firstName, b.patient.lastName].filter(Boolean).join(" ") || "Paciente";
  return b.clientName || "Sin nombre";
}

export default function MiHorarioPage() {
  const [member, setMember] = useState(undefined); // undefined=cargando · null=sin ficha
  const [citas, setCitas] = useState([]);
  const [citasLoading, setCitasLoading] = useState(true);

  useEffect(() => {
    fetch("/api/team/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setMember(j.ok ? j.data.member : null))
      .catch(() => setMember(null));
  }, []);

  useEffect(() => {
    if (member === undefined) return;
    if (!member?.id) { setCitasLoading(false); return; }
    fetch(`/api/citas/bookings?future=true&limit=50&teamMemberId=${member.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const list = (j?.data?.bookings || [])
          .filter((b) => b.status === "confirmed" || b.status === "pending")
          .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
          .slice(0, 8);
        setCitas(list);
      })
      .catch(() => {})
      .finally(() => setCitasLoading(false));
  }, [member]);

  return (
    <div className={anchoPantalla("listado")}>
      <div className="mb-6">
        <div className="eyebrow">Citas · Autoservicio</div>
        <h1 className="font-display text-2xl text-neutral-900 mt-1">Mi horario</h1>
        <p className="text-xs text-neutral-400 mt-1">
          Tu horario de trabajo semanal y tus próximas citas. Este horario es el que usa la IA para proponer huecos.
        </p>
      </div>

      {member === undefined ? (
        <p className="text-sm text-neutral-400">Cargando…</p>
      ) : member === null ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-4 text-sm text-amber-700">
          Tu usuario no tiene ficha de equipo, así que no hay un horario personal que gestionar.
          Si crees que debería tenerla, pídeselo a administración (te dan de alta en <span className="font-medium">Equipo</span>).
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-5">
          {/* Horario semanal */}
          <div className="lg:col-span-3 bg-white border border-neutral-100 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-neutral-800">Horario de trabajo semanal</h2>
              <span className="text-[11px] text-neutral-400">{member.displayName}</span>
            </div>
            <TeamHoursEditor memberId={member.id} canEdit={true} />
          </div>

          {/* Próximas citas */}
          <div className="lg:col-span-2 bg-white border border-neutral-100 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-neutral-800 mb-4">Próximas citas</h2>
            {citasLoading ? (
              <p className="text-[12px] text-neutral-400">Cargando…</p>
            ) : citas.length === 0 ? (
              <p className="text-[12px] text-neutral-400">No tienes citas próximas.</p>
            ) : (
              <ul className="space-y-2">
                {citas.map((b) => (
                  <li key={b.id} className="flex items-start gap-2.5">
                    <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.eventType?.color || "#1B3A2D" }} />
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-neutral-800 font-medium">{fmtCita(b.scheduledAt)}</div>
                      <div className="text-[11.5px] text-neutral-500 truncate">
                        {personaCita(b)}{b.eventType?.name ? ` · ${b.eventType.name}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

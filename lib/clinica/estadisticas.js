/**
 * estadisticas — las cifras del centro en un periodo (bloque 6 del sprint
 * Aumenta, punto 10).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten TRES salidas —la pantalla, el
 * Excel y el PDF— y es justo lo que no puede divergir. Si cada una contase por
 * su cuenta, el papel que se lleva a la reunión de dirección diría una cosa y
 * el CRM otra, y a partir de ahí no se discute del centro sino de los números.)
 *
 * Tres bloques, los que pidió Rodrigo el 31/07: actividad clínica, agenda y
 * ausencias, y captación. El dinero se queda fuera a propósito: vive en
 * Facturación (cobros, morosidad) y duplicarlo aquí es duplicar la verdad.
 *
 * Todo se CUENTA en lectura sobre las filas reales del periodo. No hay
 * contadores guardados que puedan quedarse desfasados.
 */

import { Op } from "sequelize";
import { error, forbidden } from "../utils/apiResponse.js";
import { specialtyLabels } from "./specialties.js";
// El corte por hoy del recuento de sesiones vive con lo que lo hizo necesario:
// preparar una sesión antes de darla la deja en la base con fecha futura.
import { hastaHoy } from "./prepararSesion.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Portón común de las tres salidas (pantalla, Excel y PDF): módulo Clínica y
 * rol de dirección. Son datos agregados de TODO el equipo.
 */
export function gateEstadisticas(ctx) {
  if (!(ctx.hasModule("clinica") || ctx.hasModule("pacientes"))) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección ve las estadísticas del centro");
  return null;
}

/** Rango pedido en la URL, o el mes en curso. Devuelve `{ rango }` o `{ veto }`. */
export function rangoPedido(request) {
  const sp = new URL(request.url).searchParams;
  const hoy = new Date();
  const primeroDeMes = fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const rango = rangoDe(sp.get("desde") || primeroDeMes, sp.get("hasta") || fechaISO(hoy));
  if (!rango) return { veto: error("Fechas inválidas: se espera desde/hasta en formato AAAA-MM-DD", 422) };
  return { rango };
}

const CITA_ESTADOS = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const CITA_LABEL = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  completed: "Atendida",
  cancelled: "Cancelada",
  no_show: "No asistió",
};

/**
 * Fecha a 'AAAA-MM-DD' EN LOCAL.
 *
 * `toISOString()` convierte a UTC, y en España eso resta una o dos horas: el 1
 * de julio a las 00:00 se convierte en «30 de junio». Con ese desfase, el
 * periodo empezaba un día antes de lo pedido y la cabecera del PDF mentía
 * sobre sus propias fechas.
 */
export function fechaISO(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Rango [desde, hasta] en Date, tolerando strings 'AAAA-MM-DD'. */
export function rangoDe(desde, hasta) {
  const inicio = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
  const fin = new Date(`${String(hasta).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;
  if (inicio > fin) return null;
  return { inicio, fin };
}

const cuenta = (filas, clave) => {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    if (k == null) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};

const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : null);

/**
 * Bloque 1 — ACTIVIDAD CLÍNICA.
 * Altas y bajas del periodo, sesiones e informes por terapeuta, y en qué
 * especialidades está trabajando el centro.
 */
async function actividadClinica(models, { inicio, fin }) {
  const { Patient, ClinicSession, ClinicalReport, TeamMember } = models;
  if (!Patient) return null;

  const enRango = { [Op.between]: [inicio, fin] };
  // Las sesiones, además, no pasan de hoy: una preparada para el jueves está en
  // la base con fecha futura y no es trabajo hecho. Ver `hastaHoy`.
  const sesionesEnRango = { [Op.between]: [inicio, hastaHoy(fin)] };
  // Columnas DATEONLY (reportDate): se comparan con la fecha LOCAL, no la UTC.
  const enRangoFecha = { [Op.between]: [fechaISO(inicio), fechaISO(fin)] };

  const [pacientes, sesiones, informes, equipo] = await Promise.all([
    Patient.findAll({ attributes: ["id", "status", "specialties", "enrollmentDate", "dischargeDate", "mainTherapistId", "createdAt"] }),
    ClinicSession
      ? ClinicSession.findAll({ where: { sessionDate: sesionesEnRango }, attributes: ["id", "therapistId", "patientId", "sessionDate"] })
      : [],
    ClinicalReport
      ? ClinicalReport.findAll({
          where: { reportDate: enRangoFecha },
          attributes: ["id", "therapistId", "status", "reportDate", "dueDate", "deliveredAt"],
        })
      : [],
    TeamMember ? TeamMember.findAll({ attributes: ["id", "displayName", "position"] }) : [],
  ]);

  const nombres = new Map(equipo.map((t) => [String(t.id), t.displayName]));
  const dentro = (fecha) => {
    if (!fecha) return false;
    const d = new Date(fecha);
    return !Number.isNaN(d.getTime()) && d >= inicio && d <= fin;
  };

  // Alta = fecha de alta en el centro; si la ficha no la tiene, la fecha en que
  // se creó. Si no se contase eso, un centro que no rellena `enrollmentDate`
  // vería siempre cero altas y pensaría que el panel está roto.
  const altas = pacientes.filter((p) => dentro(p.enrollmentDate ?? p.createdAt)).length;
  const bajas = pacientes.filter((p) => dentro(p.dischargeDate)).length;

  const porEspecialidad = new Map();
  for (const p of pacientes) {
    if (p.status !== "active") continue;
    for (const etiqueta of specialtyLabels(p.specialties)) {
      porEspecialidad.set(etiqueta, (porEspecialidad.get(etiqueta) ?? 0) + 1);
    }
  }

  const sesionesPorTerapeuta = cuenta(sesiones, (s) => String(s.therapistId ?? ""));
  const informesPorTerapeuta = cuenta(informes, (r) => String(r.therapistId ?? ""));

  const entregados = informes.filter((r) => r.status === "delivered");
  const enPlazo = entregados.filter(
    (r) => r.dueDate && r.deliveredAt && new Date(r.deliveredAt) <= new Date(`${r.dueDate}T23:59:59`)
  ).length;
  const conPlazo = entregados.filter((r) => r.dueDate).length;

  const terapeutas = [...new Set([...sesionesPorTerapeuta.keys(), ...informesPorTerapeuta.keys()])]
    .filter(Boolean)
    .map((tid) => ({
      therapistId: tid,
      name: nombres.get(tid) ?? "Sin asignar",
      sesiones: sesionesPorTerapeuta.get(tid) ?? 0,
      informes: informesPorTerapeuta.get(tid) ?? 0,
    }))
    .sort((a, b) => b.sesiones - a.sesiones || a.name.localeCompare(b.name));

  return {
    pacientesActivos: pacientes.filter((p) => p.status === "active").length,
    pacientesEnPausa: pacientes.filter((p) => p.status === "paused").length,
    altas,
    bajas,
    sesiones: sesiones.length,
    informes: informes.length,
    informesEntregados: entregados.length,
    informesEnPlazoPct: pct(enPlazo, conPlazo),
    especialidades: [...porEspecialidad.entries()].map(([label, n]) => ({ label, pacientes: n })).sort((a, b) => b.pacientes - a.pacientes),
    terapeutas,
  };
}

/**
 * Bloque 2 — AGENDA Y AUSENCIAS.
 * La tasa de ausencias se calcula sobre las citas que LLEGARON A SU HORA
 * (atendidas + no presentadas), igual que el informe de ocupación: las
 * canceladas con aviso no cuentan, porque avisar es justo lo que se quiere
 * fomentar y penalizarlo sería absurdo.
 */
async function agenda(models, { inicio, fin }) {
  const { Booking, TeamMember } = models;
  if (!Booking) return null;

  const citas = await Booking.findAll({
    where: { scheduledAt: { [Op.between]: [inicio, fin] } },
    attributes: ["id", "status", "teamMemberId", "scheduledAt", "noShowJustified"],
  });
  const equipo = TeamMember ? await TeamMember.findAll({ attributes: ["id", "displayName"] }) : [];
  const nombres = new Map(equipo.map((t) => [String(t.id), t.displayName]));

  const porEstado = cuenta(citas, (c) => c.status);
  const faltas = citas.filter((c) => c.status === "no_show");
  const atendidas = porEstado.get("completed") ?? 0;
  const llegaronASuHora = atendidas + faltas.length;

  const porProfesional = new Map();
  for (const c of citas) {
    const tid = String(c.teamMemberId ?? "");
    const acc = porProfesional.get(tid) ?? { citas: 0, atendidas: 0, faltas: 0 };
    acc.citas++;
    if (c.status === "completed") acc.atendidas++;
    if (c.status === "no_show") acc.faltas++;
    porProfesional.set(tid, acc);
  }

  return {
    total: citas.length,
    porEstado: CITA_ESTADOS.map((k) => ({ estado: k, label: CITA_LABEL[k], citas: porEstado.get(k) ?? 0 })),
    faltas: faltas.length,
    faltasJustificadas: faltas.filter((f) => f.noShowJustified).length,
    faltasSinJustificar: faltas.filter((f) => !f.noShowJustified).length,
    tasaAusenciasPct: pct(faltas.length, llegaronASuHora),
    profesionales: [...porProfesional.entries()]
      .filter(([tid]) => tid)
      .map(([tid, a]) => ({
        therapistId: tid,
        name: nombres.get(tid) ?? "Sin asignar",
        ...a,
        tasaAusenciasPct: pct(a.faltas, a.atendidas + a.faltas),
      }))
      .sort((a, b) => b.citas - a.citas),
  };
}

/**
 * Bloque 3 — CAPTACIÓN.
 * De dónde llegan las familias y cuántas acaban entrando. La lista de espera
 * cuenta aparte: es gente que quiere entrar y no ha podido, que es un número
 * que un centro necesita mirar aunque no sea agradable.
 */
async function captacion(models, { inicio, fin }) {
  const { Lead, Client, WaitlistEntry } = models;
  const enRango = { [Op.between]: [inicio, fin] };

  const [leads, clientes, espera] = await Promise.all([
    Lead ? Lead.findAll({ where: { createdAt: enRango }, attributes: ["id", "source", "stage", "createdAt"] }) : [],
    Client ? Client.findAll({ where: { createdAt: enRango }, attributes: ["id", "customFields", "createdAt"] }) : [],
    WaitlistEntry
      ? WaitlistEntry.findAll({ attributes: ["id", "status", "createdAt", "updatedAt"] }).catch(() => [])
      : [],
  ]);

  const porOrigen = cuenta(leads, (l) => (l.source ? String(l.source) : "sin origen"));
  const origenCliente = cuenta(clientes, (c) => {
    const cf = c.customFields && typeof c.customFields === "object" ? c.customFields : {};
    if (cf.origin === "lista_espera") return "Lista de espera";
    if (cf.leadId || cf.origin === "lead") return "Lead";
    return "Alta directa";
  });

  const enEspera = espera.filter((e) => e.status === "active");
  const convertidos = espera.filter(
    (e) => e.status === "converted" && new Date(e.updatedAt) >= inicio && new Date(e.updatedAt) <= fin
  );
  // Días entre que entró en la lista y que se convirtió. `updatedAt` es lo más
  // cercano a la fecha de conversión que hay guardado; se dice en el rótulo
  // para que nadie lo lea como un dato exacto.
  const esperas = convertidos.map((e) => Math.max(0, Math.round((new Date(e.updatedAt) - new Date(e.createdAt)) / 86400000)));
  const esperaMedia = esperas.length ? Math.round(esperas.reduce((a, b) => a + b, 0) / esperas.length) : null;

  return {
    leads: leads.length,
    leadsPorOrigen: [...porOrigen.entries()].map(([origen, n]) => ({ origen, leads: n })).sort((a, b) => b.leads - a.leads),
    clientesNuevos: clientes.length,
    clientesPorOrigen: [...origenCliente.entries()].map(([origen, n]) => ({ origen, clientes: n })).sort((a, b) => b.clientes - a.clientes),
    listaEspera: { enEspera: enEspera.length, convertidos: convertidos.length, esperaMediaDias: esperaMedia },
  };
}

/** Las tres partes juntas. Cada una puede venir a null si al tenant le falta su módulo. */
export async function calcularEstadisticas(models, rango) {
  const [clinica, citas, entrada] = await Promise.all([
    actividadClinica(models, rango),
    agenda(models, rango),
    captacion(models, rango),
  ]);
  return {
    desde: fechaISO(rango.inicio),
    hasta: fechaISO(rango.fin),
    clinica,
    agenda: citas,
    captacion: entrada,
  };
}

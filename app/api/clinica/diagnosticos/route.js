import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, errorConDatos, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { puedeDarBonos } from "../../../../lib/citas/quienDaBonos.js";
import { productoDe, conceptoDeProducto, cobroDelProducto, cobroDeLaEntrevista, ESTADOS_ABIERTOS } from "../../../../lib/clinica/diagnostico.js";
import { filtroDeEstado, UUID_RE } from "../../../../lib/clinica/diagnosticoFila.js";
import {
  tablaAusente,
  catalogoDelCentro,
  equipoActivo,
  filasDe,
  productosParaLaPantalla,
} from "../../../../lib/clinica/diagnosticoDb.js";

/**
 * GET/POST /api/clinica/diagnosticos — los expedientes de diagnóstico del
 * centro (12/09/2026, Rodrigo con Isa, Aumenta).
 *
 * Un diagnóstico es un producto cerrado de horas (simple 10 h, completo 20 h)
 * con un terapeuta asignado y una barra que se CUENTA desde las citas
 * (`lib/clinica/diagnostico.js`). Aquí se listan con su barra y se abren.
 *
 * GET  — la lista con filtros `?estado=en_curso|cerrado|todos` (en_curso son
 *        los abiertos: entrevista pendiente o en curso), `?mios=1` (los que
 *        llevo yo) y `?paciente=<id>` (los de una ficha). Trae además `equipo`
 *        y `productos` para los desplegables y `tipoDiagnostico`, para que la
 *        pantalla diga si el centro aún no tiene ese tipo de cita.
 * POST — abrir un expediente: paciente + producto (+ terapeuta). Nace en
 *        `entrevista`, sin dinero: el cobro llega al parar o al seguir.
 *
 * Lo ve todo el equipo con `clinica`; abre expediente cualquiera; parar,
 * seguir y desbloquear son de dirección o de quien lleve Facturación
 * (`puedeDarBonos`), que es lo que `permisos.puedeDecidir` le dice a la
 * pantalla.
 */

const limpiaTexto = (v, max = 4000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export const GET = withTenant(async (request, _ctx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();

  const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
  const productos = productosParaLaPantalla(tenant);
  const vacio = (extra = {}) => ok({ expedientes: [], total: 0, equipo: [], productos, tipoDiagnostico: null, permisos: { puedeDecidir }, ...extra });

  try {
    const { Diagnostico, Patient, TeamMember } = tenantModels;
    if (!Diagnostico) return vacio({ sinMigrar: true });

    const { searchParams } = new URL(request.url);
    const where = {};
    const estados = filtroDeEstado(searchParams.get("estado"));
    if (estados) where.status = { [Op.in]: estados };

    const paciente = searchParams.get("paciente");
    if (paciente) {
      if (!UUID_RE.test(paciente)) return error("Ese paciente no es válido", 422);
      where.patientId = paciente;
    }

    // «Mis pacientes»: los expedientes cuyo terapeuta asignado soy yo. Sin
    // ficha de equipo (dirección que no da consulta) no hay «míos».
    if (searchParams.get("mios") === "1") {
      const yo = await resolveCurrentTeamMemberId(request, tenantModels);
      if (!yo) return vacio({ equipo: await equipoActivo(tenantModels), sinFichaDeEquipo: true });
      where.therapistId = yo;
    }

    const [expedientes, equipo, catalogo] = await Promise.all([
      Diagnostico.findAll({
        where,
        include: [
          ...(Patient ? [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false }] : []),
          ...(TeamMember ? [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"], required: false }] : []),
        ],
        order: [["createdAt", "DESC"]],
      }),
      equipoActivo(tenantModels),
      catalogoDelCentro(tenantModels),
    ]);

    const filas = await filasDe({ tenantModels, expedientes, puedeDecidir, catalogo });
    const tipo = catalogo.tipoDiagnostico;

    return ok({
      expedientes: filas,
      total: filas.length,
      equipo,
      // Cada producto con el cobro que nacería al «Seguir» (concepto del
      // catálogo o precio de caída), y el de la entrevista al «Parar»: la
      // pantalla lo dice en la confirmación con el MISMO cálculo que hará el
      // POST, para no anunciar 50 € y apuntar 60.
      productos: productos.map((p) => ({ ...p, cobro: cobroDelProducto(p, conceptoDeProducto(p, catalogo.conceptos)) })),
      cobroEntrevista: cobroDeLaEntrevista(catalogo.conceptoEntrevista),
      tipoDiagnostico: tipo ? { id: tipo.id, name: tipo.name, duration: tipo.duration } : null,
      permisos: { puedeDecidir },
    });
  } catch (err) {
    // Un centro al que aún no le ha llegado la migración ve la pantalla
    // vacía, no un error rojo.
    if (tablaAusente(err)) return vacio({ sinMigrar: true });
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();

  try {
    const { Diagnostico, Patient, TeamMember } = tenantModels;
    if (!Diagnostico || !Patient) return error("Este centro no tiene pacientes: hace falta el módulo de Pacientes", 422);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const patientId = typeof body?.patientId === "string" ? body.patientId : "";
    if (!UUID_RE.test(patientId)) return error("Falta el paciente", 422);

    const producto = productoDe(tenant, body?.productoKey);
    if (!producto) return error("Ese producto de diagnóstico no existe (simple o completo)", 422);

    const paciente = await Patient.findByPk(patientId, { attributes: ["id", "clientId", "firstName", "lastName"] });
    if (!paciente) return error("Ese paciente no existe", 422);

    let therapistId = null;
    if (body?.therapistId) {
      if (!UUID_RE.test(String(body.therapistId)) || !TeamMember) return error("Ese terapeuta no es válido", 422);
      const tm = await TeamMember.findByPk(body.therapistId, { attributes: ["id"] });
      if (!tm) return error("Ese terapeuta no existe", 422);
      therapistId = tm.id;
    }

    /*
     * Un paciente con un diagnóstico ABIERTO no abre otro sin decirlo: lo
     * normal es que sea un doble clic o alguien que no vio el que ya está. Con
     * `permitirOtro: true` se abre igual (un simple que se cierra y un completo
     * que empieza son dos expedientes, y los dos tienen que existir).
     */
    const abierto = await Diagnostico.findOne({
      where: { patientId, status: { [Op.in]: ESTADOS_ABIERTOS } },
      attributes: ["id", "status", "productoNombre"],
    });
    if (abierto && body?.permitirOtro !== true) {
      return errorConDatos(
        `Este paciente ya tiene un diagnóstico abierto (${abierto.productoNombre || "sin nombre"})`,
        409,
        { id: abierto.id, status: abierto.status }
      );
    }

    const catalogo = await catalogoDelCentro(tenantModels);
    const concepto = conceptoDeProducto(producto, catalogo.conceptos);
    const creador = await resolveCurrentTeamMemberId(request, tenantModels);

    const expediente = await Diagnostico.create({
      patientId,
      // Foto de la familia que paga, como en las sesiones: `client_id` del paciente al abrirlo.
      clientId: paciente.clientId ?? null,
      therapistId,
      productoKey: producto.key,
      productoNombre: producto.nombre,
      horasMax: producto.horas,
      eventTypeId: catalogo.tipoDiagnostico?.id ?? null,
      conceptId: concepto?.id ?? null,
      status: "entrevista",
      notes: limpiaTexto(body?.notes),
      createdById: creador,
    });

    // Auditoría DESPUÉS de mutar, con un resumen: nada clínico viaja a master.
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "diagnostico.abierto",
      entity: "Diagnostico",
      entityId: expediente.id,
      after: resumen(expediente, ["id", "patientId", "clientId", "therapistId", "productoKey", "horasMax", "status"]),
    });

    const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
    const [fila] = await filasDe({ tenantModels, expedientes: [expediente], puedeDecidir, catalogo });

    // Avisos, nunca cortes: el expediente ya existe y la pantalla tiene que
    // decir qué le falta al centro para que el flujo llegue hasta el final.
    const avisos = [];
    if (!catalogo.tipoDiagnostico) {
      avisos.push("Este centro no tiene un tipo de cita DIAGNÓSTICO: no se podrá abrir la entrevista desde aquí hasta crearlo (Configuración → Citas).");
    }
    if (!concepto) {
      const caida = cobroDelProducto(producto, null).importeEuros;
      avisos.push(
        caida !== null
          ? `No hay concepto «${producto.nombre}» en el catálogo: al seguir, el cobro saldrá de ${caida} €.`
          : `No hay concepto «${producto.nombre}» en el catálogo ni precio de caída: al seguir, el bono nacerá sin cobro.`
      );
    }
    if (!paciente.clientId) avisos.push("El paciente no tiene ficha de familia: sin ella no se le podrá cobrar la entrevista ni el diagnóstico.");

    return created({ expediente: fila, avisos });
  } catch (err) {
    if (tablaAusente(err)) return error("Este centro aún no tiene la tabla de diagnósticos: falta la migración", 503);
    return serverError(err);
  }
});

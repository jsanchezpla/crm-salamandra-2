import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, errorConDatos, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { puedeDarBonos } from "../../../../lib/citas/quienDaBonos.js";
import { productoDe, conceptoDeProducto, cobroDelProducto, cobroDeLaEntrevista, estaAbierto } from "../../../../lib/clinica/diagnostico.js";
import { resumenDeAdopcion } from "../../../../lib/clinica/adoptarEnDiagnostico.js";
import { filtroDeEstado, UUID_RE } from "../../../../lib/clinica/diagnosticoFila.js";
import {
  tablaAusente,
  catalogoDelCentro,
  equipoActivo,
  filasDe,
  productosParaLaPantalla,
  mesesDeAdopcion,
  desdeHace,
  tiposDeAdopcion,
  citasAdoptablesDe,
  registrosDeEntrevistaDe,
  cobrosDeEntrevistaDe,
  adopcionDe,
  adoptarEnExpediente,
  resumenDeCobro,
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
 *        pantalla diga si el centro aún no tiene ese tipo de cita. Cada fila
 *        lleva `cobroAlSeguir`: lo que costará «Seguir» en ESE expediente, con
 *        su entrevista ya cobrada descontada.
 * POST — abrir un expediente: paciente + producto (+ terapeuta). Nace en
 *        `entrevista`, sin dinero: el cobro llega al parar o al seguir.
 *
 * ── «EMPEZAR DESDE LO QUE YA HAY» (12/09/2026, respuesta de Aumenta) ───────
 * Seis pacientes de Aumenta YA están en diagnóstico —con citas dadas, citas
 * futuras y una entrevista inicial cobrada— desde antes de que existiera el
 * expediente, y los dan de alta ellos. El POST admite
 * `adoptar: { citas, entrevistaBookingId, meses }` y, en la MISMA transacción
 * que el `create`, mete dentro lo que ya hay: las citas de los tipos de
 * diagnóstico (tramo `horas`), la entrevista (la señalada o la última de
 * tramo entrevista), los registros de esas citas y el último de entrevista
 * inicial del paciente, y el cobro de la entrevista (`entrevistaPaymentId`),
 * que al seguir se DESCUENTA del producto. El servidor RECALCULA qué citas
 * son adoptables (`lib/clinica/adoptarEnDiagnostico.js`): del navegador solo
 * se acepta `entrevistaBookingId`, y se comprueba que sea del paciente y de
 * un tipo de entrevista o de diagnóstico.
 *
 * Lo ve todo el equipo con `clinica`; abre expediente cualquiera; parar,
 * seguir y desbloquear son de dirección o de quien lleve Facturación
 * (`puedeDarBonos`), que es lo que `permisos.puedeDecidir` le dice a la
 * pantalla.
 */

const limpiaTexto = (v, max = 4000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** «50», «47,50». */
const euros = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
};

/**
 * Lo que el navegador pide adoptar, limpio, o null si no pide nada. Devuelve
 * `{ error }` si la cita señalada no es un id válido: mejor un 422 que
 * ignorarla y adoptar otra entrevista sin decirlo.
 */
function adopcionPedida(v) {
  if (!v || typeof v !== "object") return null;
  const citas = v.citas === true;
  const bruto = v.entrevistaBookingId;
  let entrevistaBookingId = null;
  if (bruto !== null && bruto !== undefined && bruto !== "") {
    if (!UUID_RE.test(String(bruto))) return { error: "Esa cita de entrevista no es válida" };
    entrevistaBookingId = String(bruto);
  }
  if (!citas && !entrevistaBookingId) return null;
  return { citas, entrevistaBookingId, meses: mesesDeAdopcion(v.meses) };
}

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

    const filas = await filasDe({ tenantModels, tenant, expedientes, puedeDecidir, catalogo });
    const tipo = catalogo.tipoDiagnostico;

    return ok({
      expedientes: filas,
      total: filas.length,
      equipo,
      // Cada producto con el cobro que nacería al «Seguir» (concepto del
      // catálogo o precio de caída), y el de la entrevista al «Parar»: el
      // panel de alta lo dice con el MISMO cálculo que hará el POST. La
      // confirmación de «Seguir» de un expediente concreto usa su
      // `cobroAlSeguir`, que ya lleva la entrevista descontada.
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
    const { Diagnostico, Patient, TeamMember, Booking } = tenantModels;
    if (!Diagnostico || !Patient) return error("Este centro no tiene pacientes: hace falta el módulo de Pacientes", 422);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const patientId = typeof body?.patientId === "string" ? body.patientId : "";
    if (!UUID_RE.test(patientId)) return error("Falta el paciente", 422);

    const producto = productoDe(tenant, body?.productoKey);
    if (!producto) return error("Ese producto de diagnóstico no existe (simple o completo)", 422);

    const pedido = adopcionPedida(body?.adoptar);
    if (pedido?.error) return error(pedido.error, 422);

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
     * que empieza son dos expedientes, y los dos tienen que existir). Se traen
     * TODOS los del paciente porque el alta que adopta necesita saber qué
     * cobros de entrevista ya son de otro expediente.
     */
    const anteriores = await Diagnostico.findAll({
      where: { patientId },
      attributes: ["id", "status", "productoNombre", "entrevistaPaymentId"],
      order: [["createdAt", "DESC"]],
    });
    const abierto = anteriores.find(estaAbierto) ?? null;
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
    const ahora = new Date();
    const avisos = [];

    // ── Qué se adopta: el servidor lo RECALCULA (decisión 13) ─────────────
    let adopcion = null;
    if (pedido) {
      if (!Booking) avisos.push("Este centro no tiene Citas: no hay citas que meter en el expediente.");
      const tipos = await tiposDeAdopcion(tenantModels);
      const desde = desdeHace(pedido.meses, ahora);
      const [citasPP, sesionesPP, cobrosPP] = await Promise.all([
        citasAdoptablesDe(tenantModels, { patientIds: [patientId], tipos, desde }),
        registrosDeEntrevistaDe(tenantModels, { patientIds: [patientId], desde }),
        cobrosDeEntrevistaDe(tenantModels, { patientIds: [patientId], conceptoEntrevistaId: catalogo.conceptoEntrevista?.id ?? null }),
      ]);
      adopcion = adopcionDe({
        citas: citasPP.get(patientId) ?? [],
        sesiones: sesionesPP.get(patientId) ?? [],
        cobros: cobrosPP.get(patientId) ?? [],
        tipos,
        entrevistaBookingId: pedido.entrevistaBookingId,
        conHoras: pedido.citas,
        cobrosUsados: anteriores.map((e) => e.entrevistaPaymentId).filter(Boolean),
        ahora,
      });
      if (!adopcion.entrevistaPedidaValida) {
        return error("Esa cita no es de este paciente o no es una entrevista inicial que se pueda meter en el expediente", 422);
      }
    }

    // El expediente y lo que adopta nacen en la MISMA transacción: un
    // expediente con la mitad de sus citas no se arregla desde ninguna
    // pantalla.
    let adoptadas = { citas: 0, entrevista: false, registros: 0 };
    const expediente = await Diagnostico.sequelize.transaction(async (t) => {
      const nuevo = await Diagnostico.create({
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
        entrevistaBookingId: adopcion?.entrevista?.id ?? null,
        entrevistaPaymentId: adopcion?.cobroEntrevista?.id ?? null,
      }, { transaction: t });
      if (adopcion) adoptadas = await adoptarEnExpediente(tenantModels, { expediente: nuevo, adopcion, transaction: t });
      return nuevo;
    });

    const cobroEntrevista = resumenDeCobro(adopcion?.cobroEntrevista);

    // Auditoría DESPUÉS de mutar, con un resumen: nada clínico viaja a master.
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "diagnostico.abierto",
      entity: "Diagnostico",
      entityId: expediente.id,
      after: {
        ...resumen(expediente, ["id", "patientId", "clientId", "therapistId", "productoKey", "horasMax", "status"]),
        adoptadas: adopcion
          ? { citas: adoptadas.citas, entrevista: adoptadas.entrevista, registros: adoptadas.registros, cobroEntrevistaId: cobroEntrevista?.id ?? null }
          : null,
      },
    });

    const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
    const [fila] = await filasDe({ tenantModels, tenant, expedientes: [expediente], puedeDecidir, catalogo, ahora });

    // Avisos, nunca cortes: el expediente ya existe y la pantalla tiene que
    // decir qué le falta al centro para que el flujo llegue hasta el final.
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
    if (adopcion) {
      if (!adopcion.hayAlgo) avisos.push("No había citas ni entrevista que meter en el expediente: nace vacío.");
      else if (!adoptadas.entrevista && adopcion.entrevista) avisos.push("La entrevista señalada ya era de otro expediente: no se ha metido.");
      if (adopcion.hayAlgo && (adopcion.entrevista || adopcion.sesionEntrevista) && !cobroEntrevista) {
        avisos.push("La entrevista no tiene cobro apuntado: al seguir no se descontará nada del producto.");
      }
      if (cobroEntrevista) avisos.push(`Al seguir se descontarán los ${euros(cobroEntrevista.importe)} € de la entrevista del precio del producto.`);
    }

    return created({
      expediente: fila,
      avisos,
      adoptado: adopcion
        ? {
            citas: adoptadas.citas,
            hechas: adopcion.resumen.hechas,
            horasHechas: adopcion.resumen.horasHechas,
            futuras: adopcion.resumen.futuras,
            horasReservadas: adopcion.resumen.horasReservadas,
            entrevista: adoptadas.entrevista,
            entrevistaBookingId: adoptadas.entrevista ? adopcion.entrevista?.id ?? null : null,
            registros: adoptadas.registros,
            cobroEntrevista,
            resumen: resumenDeAdopcion({ resumen: adopcion.resumen, entrevista: adoptadas.entrevista ? adopcion.entrevista : null, cobroEntrevista }),
          }
        : null,
    });
  } catch (err) {
    if (tablaAusente(err)) return error("Este centro aún no tiene la tabla de diagnósticos: falta la migración", 503);
    return serverError(err);
  }
});

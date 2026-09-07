import { Op } from "sequelize";

import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, resumenImporte, datosPeticion } from "../../../../../lib/billing/audit.js";
import { citasDelMesParaCuotas } from "../../../../../lib/billing/citasParaProrrateo.js";
import {
  planDeCuotasDelMes,
  mesValido,
  mesLegible,
  mesVigente,
  metodoValido,
  cobroSePuedeRehacer,
} from "../../../../../lib/billing/cuotas.js";
import {
  HORIZONTE_MESES,
  mesesDesde,
  porQueNoCuadra,
  repartirACuenta,
} from "../../../../../lib/billing/pagoACuenta.js";

/**
 * EL PAGO A CUENTA: la familia que paga varios meses de golpe (07/09/2026,
 * tarea del Registro del 06/09).
 *
 *   GET  ?clientId=…&importe=240[&desde=AAAA-MM]  → vista previa del reparto
 *   POST { clientId, amount, method, paidAt, notes? } → lo registra
 *
 * ── POR QUÉ UNA RUTA APARTE Y NO EL POST DE /payments ──────────────────────
 * Porque no es «un cobro»: son VARIOS, uno por mes, y lo que hay que enseñar
 * antes de guardarlos es el reparto entero. Metido en el POST de siempre, el
 * mismo endpoint devolvería a veces un cobro y a veces cinco, y la vista previa
 * no tendría dónde vivir. El reparto en sí es puro y se prueba sin base
 * (`lib/billing/pagoACuenta.js`); aquí está la mitad que necesita Sequelize.
 *
 * ── LA REGLA: MESES ENTEROS, Y NUNCA DINERO INVENTADO ──────────────────────
 * El dinero entra UNA vez: cada euro que trae la familia acaba en un cobro de
 * un mes, con la fecha y el método del día en que lo trajeron. Por eso la caja
 * de ese día no cambia por repartirlo —240 € en efectivo siguen siendo 240 €—
 * y por eso el POST se niega si el importe no cubre meses completos: lo dice
 * con los importes de al lado en vez de dejar un mes futuro a medias que
 * después nadie vería.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 42P01 = la tabla no existe en este schema (migración sin aplicar). */
function esTablaAusente(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

/**
 * Qué vale cada mes que viene para esta familia y qué se ha cobrado ya.
 *
 * El coste sale de `planDeCuotasDelMes`, el MISMO sitio del que sale la
 * generación mensual: si aquí se calculara aparte, el pago a cuenta y el mes
 * generado dirían importes distintos para el mismo mes (la lección de
 * `filtrosGasto.js` y `resumenCaja.js`).
 *
 * Un mes puede quedar BLOQUEADO —y entonces corta la lista— por tres motivos,
 * todos escritos abajo con su frase. La idea es la misma en los tres:
 * saltárselo en silencio dejaría un mes a deber por debajo de meses ya
 * pagados, que es la peor forma de que nadie lo vea.
 */
async function mesesDeLaFamilia({ tenantModels, clientId, desde }) {
  const { Cuota, Payment, BillingConcept } = tenantModels;
  if (!Cuota || !Payment) return { meses: [], bloqueo: null, cuotas: [] };

  /*
   * Las cuotas que PAGA esta ficha: las suyas y aquellas en las que es la
   * pagadora (07/09/2026, `billing_cuotas.payer_client_id`). Una fundación que
   * paga la cuota de un niño puede adelantar meses igual que una familia, y a
   * la familia apadrinada no se le pueden cobrar meses que no paga ella.
   * `planDeCuotasDelMes` ya pone en `fila.clientId` a quien paga, así que el
   * filtro de abajo se encarga de quedarse solo con lo de esta ficha.
   */
  const cuotas = (
    await Cuota.findAll({ where: { [Op.or]: [{ clientId }, { payerClientId: clientId }] } })
  ).map((c) => c.toJSON());
  if (!cuotas.length) return { meses: [], bloqueo: null, cuotas: [] };

  let conceptos = [];
  if (BillingConcept) {
    try {
      const filas = await BillingConcept.findAll({ attributes: ["id", "name", "unitPrice"] });
      conceptos = filas.map((c) => ({ id: c.id, name: c.name, unitPrice: c.unitPrice }));
    } catch (err) {
      if (!esTablaAusente(err)) throw err;
    }
  }

  const lista = mesesDesde(desde, HORIZONTE_MESES);
  /*
   * TODOS los cobros de esos meses, con factura o sin ella. Filtrar por
   * `invoice_id IS NULL` dejaba fuera los meses ya facturados («Facturar el mes»
   * pone la factura en el cobro), así que un mes cobrado Y facturado salía con
   * «ya cobrado 0» y el reparto lo ofrecía entero: la familia que trae dinero
   * para octubre habría vuelto a pagar septiembre.
   */
  const cobros = await Payment.findAll({
    where: {
      clientId,
      periodMonth: { [Op.in]: lista.map((m) => `${m}-01`) },
    },
  });

  /*
   * Las citas solo hacen falta en el PRIMER mes. Son para prorratear por
   * sesiones el mes del alta (AV-0062), y eso solo pasa cuando la cuota empieza
   * o acaba dentro del mes; los meses de más adelante se cobran enteros. Doce
   * consultas de citas para nada serían doce consultas de más.
   */
  const citasPorClave = await citasDelMesParaCuotas({ tenantModels, mes: lista[0], cuotas });

  const meses = [];
  let bloqueo = null;

  for (const mes of lista) {
    const { aGenerar } = planDeCuotasDelMes({
      mes,
      cuotas,
      conceptos,
      yaGenerados: [],
      citasPorClave: mes === lista[0] ? citasPorClave : null,
    });
    const filas = aGenerar.filter((f) => String(f.clientId) === String(clientId));
    const coste = round2(filas.reduce((s, f) => s + Number(f.importe || 0), 0));

    const delMes = cobros.filter((p) => String(p.periodMonth).slice(0, 7) === mes);
    const yaCobrado = round2(
      delMes.filter((p) => p.status === "completed").reduce((s, p) => s + Number(p.amount || 0), 0)
    );
    const todosPendientes = delMes.filter((p) => p.status === "pending");
    const pendientes = todosPendientes.filter((p) => cobroSePuedeRehacer(p).ok);
    const pendiente = round2(pendientes.reduce((s, p) => s + Number(p.amount || 0), 0));
    const falta = round2(Math.max(0, coste - yaCobrado));

    /*
     * Tres motivos para NO poder repartir sobre un mes. En los tres se corta la
     * lista aquí: saltárselo dejaría un mes a deber por debajo de meses ya
     * pagados, que es la peor forma de que nadie lo vea.
     */
    const motivo =
      coste > 0 && yaCobrado > 0 && falta > 0 && !todosPendientes.length
        ? // Pagado a medias y sin pendiente: eso se cobra desde su mes, que
          // rellena el resto solo (`restoDelMes.js`).
          `está pagado a medias (faltan ${falta.toFixed(2).replace(".", ",")} €) y ya no tiene cobro pendiente`
        : todosPendientes.length && todosPendientes.length !== pendientes.length
          ? // Un pendiente facturado, con Stripe o casado con el banco no se
            // toca desde aquí.
            `tiene un cobro pendiente que no se puede tocar desde aquí (factura, Stripe o banco)`
          : todosPendientes.length && pendiente !== falta
            ? // El pendiente no vale lo que vale el mes: la cuota cambió después
              // de generarlo. Cobrarlo o crear otro encima taparía el desajuste.
              `tiene un cobro pendiente de ${pendiente.toFixed(2).replace(".", ",")} € que no cuadra con lo que vale el mes (${falta.toFixed(2).replace(".", ",")} €)`
            : null;

    if (motivo) {
      bloqueo = { mes, mesLegible: mesLegible(mes), coste, yaCobrado, falta, motivo };
      break;
    }

    meses.push({
      mes,
      mesLegible: mesLegible(mes),
      coste,
      yaCobrado,
      pendiente,
      // Las líneas de ese mes: una por cuota (dos hermanos, dos filas). Es lo
      // que se convierte en cobros, cada uno con su paciente y su concepto.
      filas,
      pendientes: pendientes.map((p) => p.id),
    });
  }

  return { meses, bloqueo, cuotas };
}

/** La vista previa y el POST hablan lo mismo: una sola forma de contarlo. */
function respuesta({ importe, meses, bloqueo, desde }) {
  const reparto = repartirACuenta({ importe, meses });
  const porMes = new Map(meses.map((m) => [m.mes, m]));
  return {
    desde,
    importe: round2(importe),
    ...reparto,
    aplicaciones: reparto.aplicaciones.map((a) => ({
      ...a,
      mesLegible: porMes.get(a.mes)?.mesLegible ?? a.mes,
    })),
    bloqueo,
    // La frase que explica por qué no cuadra (o null si cuadra). La misma en la
    // vista previa y en el error del POST: quien cobra lee dos veces lo mismo.
    aviso: bloqueo
      ? `${bloqueo.mesLegible} ${bloqueo.motivo}: revísalo en Cobros y vuelve a intentarlo.`
      : porQueNoCuadra(reparto),
  };
}

/** Lo común a las dos: cliente que existe e importe que se puede repartir. */
async function preparar({ tenantModels, hasModule, clientId, importe, desde }) {
  if (!hasModule("billing")) return { fallo: forbidden("Módulo billing no activo") };
  const { Client } = tenantModels;
  if (!clientId || !UUID_RE.test(String(clientId))) return { fallo: error("Falta el cliente") };
  const total = Number(importe);
  if (!Number.isFinite(total) || total <= 0) return { fallo: error("El importe debe ser mayor que 0") };
  if (Client) {
    const cliente = await Client.findByPk(clientId, { attributes: ["id"] });
    if (!cliente) return { fallo: notFound("Cliente no encontrado") };
  }
  const mes = mesValido(desde) ? desde : mesVigente();
  const { meses, bloqueo } = await mesesDeLaFamilia({ tenantModels, clientId, desde: mes });
  return { datos: respuesta({ importe: total, meses, bloqueo, desde: mes }), meses };
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    const { searchParams } = new URL(request.url);
    const { fallo, datos } = await preparar({
      tenantModels,
      hasModule,
      clientId: searchParams.get("clientId"),
      importe: searchParams.get("importe"),
      desde: searchParams.get("desde"),
    });
    if (fallo) return fallo;
    return ok(datos);
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    const body = await request.json();
    const { clientId, amount, method, paidAt, notes, desde } = body || {};

    if (!method || !metodoValido(method)) return error("method es obligatorio");
    if (!paidAt) return error("paidAt es obligatorio");

    const { fallo, datos, meses } = await preparar({ tenantModels, hasModule, clientId, importe: amount, desde });
    if (fallo) return fallo;

    // Si no cubre meses enteros, no se guarda NADA: se contesta con la misma
    // frase que ya enseñaba la vista previa.
    if (datos.aviso) return error(datos.aviso, 409, { reparto: datos });

    const { Payment } = tenantModels;
    const fecha = new Date(String(paidAt).length <= 10 ? `${String(paidAt).slice(0, 10)}T12:00:00` : paidAt);
    if (Number.isNaN(fecha.getTime())) return error("La fecha del cobro no se entiende");

    const rotulo = `Pago a cuenta del ${fecha.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}`;
    const porMes = new Map(meses.map((m) => [m.mes, m]));
    const creados = [];
    const cobrados = [];
    // Los cobros tocados EN ORDEN de mes, para poder dejar la nota escrita a
    // mano en el primero (el mes más cercano), que es donde se busca.
    const tocados = [];

    for (const aplicacion of datos.aplicaciones) {
      const mes = porMes.get(aplicacion.mes);
      const periodMonth = `${aplicacion.mes}-01`;

      /*
       * Si ese mes ya tiene sus cobros PENDIENTES (el mes generado y sin
       * pagar), se cobran esos en vez de crear otros: es el mismo dinero y
       * mantiene el `cuota_id` con el que nacieron. Solo cuando suman
       * exactamente lo que falta, que si no estaríamos cambiando importes por
       * la espalda.
       */
      if (mes.pendientes.length && round2(mes.pendiente) === aplicacion.importe) {
        for (const id of mes.pendientes) {
          const p = await Payment.findByPk(id);
          if (!p) continue;
          const antes = resumenImporte(p);
          await p.update({
            status: "completed",
            paidAt: fecha,
            method,
            notes: [p.notes, rotulo].filter(Boolean).join(" — "),
          });
          cobrados.push(p.id);
          tocados.push(p.id);
          await logBillingAudit({
            tenantId: tenant.id,
            ...datosPeticion(request),
            action: "payment.updated",
            entity: "Payment",
            entityId: p.id,
            before: antes,
            after: resumenImporte(p),
          });
        }
        continue;
      }

      /*
       * Si no, se crea el cobro de ese mes: UNO POR CUOTA (dos hermanos, dos
       * cobros), con su paciente, su concepto y —lo que evita el duplicado— su
       * `cuota_id`. Cuando llegue el día 1 y se genere el mes, esa cuota ya
       * tiene cobro y no se genera otro.
       *
       * El reparto por cuota solo se sabe con el mes SIN cobrar (`yaCobrado`
       * 0); un mes a medias sin pendientes no llega hasta aquí, lo corta el
       * bloqueo de `mesesDeLaFamilia`.
       */
      for (const fila of mes.filas) {
        const p = await Payment.create({
          invoiceId: null,
          clientId: fila.clientId,
          patientId: fila.patientId ?? null,
          conceptId: fila.conceptId ?? null,
          cuotaId: fila.cuotaId ?? null,
          periodMonth,
          amount: round2(fila.importe),
          paidAt: fecha,
          method,
          status: "completed",
          notes: [fila.notes, rotulo].filter(Boolean).join(" — "),
        });
        creados.push(p.id);
        tocados.push(p.id);
        await logBillingAudit({
          tenantId: tenant.id,
          ...datosPeticion(request),
          action: "payment.created",
          entity: "Payment",
          entityId: p.id,
          before: null,
          after: resumenImporte(p),
        });
      }
    }

    // La nota que escriba quien cobra va en el PRIMER cobro del reparto —el
    // mes más cercano—: es donde se busca («me dijo que…»), y repetirla en
    // cinco no explica más.
    const primero = tocados[0] ?? null;
    if (primero && typeof notes === "string" && notes.trim()) {
      const p = await Payment.findByPk(primero);
      if (p) await p.update({ notes: [p.notes, notes.trim()].filter(Boolean).join(" — ") });
    }

    return created({
      cobrosCreados: creados,
      cobrosCobrados: cobrados,
      meses: datos.aplicaciones.map((a) => ({ mes: a.mes, mesLegible: a.mesLegible, importe: a.importe })),
      repartido: datos.repartido,
    });
  } catch (err) {
    return serverError(err);
  }
});

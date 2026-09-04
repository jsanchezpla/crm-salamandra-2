import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { forbidden, error, serverError } from "../../../../../lib/utils/apiResponse.js";
import { xlsxResponse, MONEY_FMT, fmtDateEs } from "../../../../../lib/billing/exportXlsx.js";
import { construirResumenCaja, rangoDelResumen } from "../../../../../lib/billing/resumenCaja.js";

/**
 * GET /api/arqueo/exports/resumen?desde=&hasta=[&cajaId=] — el resumen de caja
 * a Excel (04/09/2026, Rodrigo: «en la caja debería poder exportar a Excel del
 * resumen por día elegido»).
 *
 * Dos hojas, porque son dos preguntas distintas sobre el mismo dato y en dos
 * ficheros no se podrían cruzar:
 *
 *   · «Resumen por día» — una fila por día, igual que la tabla de la pantalla:
 *     efectivo, tarjeta, banco, total y el neto de los apuntes de caja. Es lo
 *     que se pega en la contabilidad del mes.
 *   · «Cobros» — una fila por cobro, con su día, hora, quién pagó y cómo. Es lo
 *     que se usa para cuadrar el cajón cuando el total del día no sale.
 *
 * Los números salen de `lib/billing/resumenCaja.js`, el MISMO sitio del que
 * come la pantalla: un Excel que no cuadre con lo que se ve en pantalla es peor
 * que no tener Excel.
 */

const METODO = { card: "Tarjeta", transfer: "Transferencia", cash: "Efectivo", direct_debit: "Domiciliación" };

/** La hora del cobro, en Madrid: el servidor va en UTC y el cajón, no. */
const horaMadrid = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })
    : "—";

export const GET = withTenant(async (request, _ctx, { tenantModels, tenant, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { searchParams } = new URL(request.url);
    const rango = rangoDelResumen(searchParams);
    if (rango.error) return error(rango.error, 422);

    const data = await construirResumenCaja({
      tenantModels,
      hasModule,
      desde: rango.desde,
      hasta: rango.hasta,
      cajaId: searchParams.get("cajaId") || null,
    });

    // Los días sin nada se van del Excel: en pantalla son la casilla «Ocultar
    // los días sin nada» —marcada de fábrica—, y una hoja de cálculo con 20
    // filas a cero no se lee mejor por tenerlas.
    const conAlgo = data.dias.filter(
      (d) => d.cobrado !== 0 || d.movimientos.entradas !== 0 || d.movimientos.salidas !== 0
    );

    const columns = [
      { header: "Día", key: "dia", width: 14 },
      { header: "Efectivo", key: "efectivo", width: 14, numFmt: MONEY_FMT },
      { header: "Tarjeta", key: "tarjeta", width: 14, numFmt: MONEY_FMT },
      { header: "Banco", key: "banco", width: 14, numFmt: MONEY_FMT },
      { header: "Total cobrado", key: "total", width: 16, numFmt: MONEY_FMT },
      { header: "Nº de cobros", key: "n", width: 13 },
      { header: "Caja (+/−)", key: "caja", width: 14, numFmt: MONEY_FMT },
    ];
    const rows = conAlgo.map((d) => ({
      dia: fmtDateEs(d.fecha),
      efectivo: d.efectivo.importe,
      tarjeta: d.tarjeta.importe,
      banco: d.banco.importe,
      total: d.cobrado,
      n: d.lista.length,
      caja: d.movimientos.neto,
    }));
    // La fila de totales, como el pie de la tabla en pantalla.
    rows.push({
      dia: "TOTAL",
      efectivo: data.total.efectivo.importe,
      tarjeta: data.total.tarjeta.importe,
      banco: data.total.banco.importe,
      total: data.total.cobrado,
      n: conAlgo.reduce((s, d) => s + d.lista.length, 0),
      caja: data.total.movimientos.neto,
    });

    const cobros = conAlgo.flatMap((d) =>
      d.lista.map((c) => ({
        dia: fmtDateEs(d.fecha),
        hora: horaMadrid(c.paidAt),
        paciente: c.patientName ?? "—",
        cliente: c.clientName ?? "—",
        metodo: METODO[c.method] ?? c.method,
        factura: c.invoiceNumber ?? (c.periodMonth ? `sin factura · ${c.periodMonth}` : "sin factura"),
        nota: c.notes ?? "",
        importe: c.amount,
      }))
    );

    return await xlsxResponse({
      filename: `caja-${tenant.slug}-${rango.desde}_${rango.hasta}.xlsx`,
      sheetName: "Resumen por día",
      columns,
      rows,
      hojasExtra: [
        {
          name: "Cobros",
          columns: [
            { header: "Día", key: "dia", width: 14 },
            { header: "Hora", key: "hora", width: 9 },
            { header: "Paciente", key: "paciente", width: 26 },
            { header: "Cliente / pagador", key: "cliente", width: 28 },
            { header: "Método", key: "metodo", width: 16 },
            { header: "Factura", key: "factura", width: 24 },
            { header: "Nota", key: "nota", width: 40 },
            { header: "Importe", key: "importe", width: 14, numFmt: MONEY_FMT },
          ],
          rows: cobros,
        },
      ],
      filters: [
        { label: "Desde", value: fmtDateEs(rango.desde) },
        { label: "Hasta", value: fmtDateEs(rango.hasta) },
        { label: "Caja", value: searchParams.get("cajaId") ? "Una caja concreta" : "Todas" },
        {
          label: "Cobros pendientes (no contados)",
          value: String(conAlgo.reduce((s, d) => s + (d.pendientes?.cobros ?? 0), 0)),
        },
        { label: "Generado", value: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) },
      ],
    });
  } catch (err) {
    return serverError(err);
  }
});

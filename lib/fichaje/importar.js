/**
 * lib/fichaje/importar.js — leer el Excel, enseñarlo, aplicarlo y deshacerlo.
 *
 * Aquí vive lo que hace que volcar un mes sea seguro. Las rutas de API son una
 * cáscara: validan permisos y llaman aquí.
 *
 * ── LAS TRES GARANTÍAS ──────────────────────────────────────────────────────
 *
 * 1. EL PREVIEW NO ESCRIBE NADA. Ni una fila, ni un alias, ni el lote. Se puede
 *    subir el fichero equivocado veinte veces sin consecuencias. (Patrón
 *    copiado del importador de Formación, que es el bueno del repo; el de
 *    Leads crea fila a fila sin transacción y si revienta en la 400 de 1.000
 *    deja 399 creadas y nadie sabe cuáles.)
 *
 * 2. APLICAR ES UNA SOLA TRANSACCIÓN. O entra el mes entero o no entra nada.
 *
 * 3. VOLCAR DOS VECES EL MISMO MES NO DUPLICA. El volcado nuevo marca el
 *    anterior de ese periodo como `superseded` y da de baja SUS filas — solo
 *    las que vinieron de un import. Lo corregido a mano sobrevive, y el preview
 *    lo dice antes de tocar nada.
 *
 * Y la regla que las sostiene: **una fila que no case con una persona no se
 * importa jamás**. Ni por parecido, ni «por esta vez». Sale en el preview y se
 * mapea ahí.
 */

import { createHash } from "node:crypto";
import { Op } from "sequelize";

import { parserDeTenant } from "./parsers/index.js";
import { resolverNombres, customFieldsConAlias } from "./mapeo.js";
import { rangoDelPeriodo } from "./totales.js";

/** sha256 del fichero: el aviso barato de «esto ya lo has subido». */
export function hashDeFichero(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Lee el Excel y cuenta qué pasaría. NO escribe.
 *
 * @returns preview completo para la pantalla
 */
export async function previsualizar({ workbook, periodo, slug, tenantModels, fileHash = null }) {
  const { TeamMember, Fichaje, FichajeImport } = tenantModels;
  const parser = parserDeTenant(slug);

  const leido = await parser.parse(workbook, { periodo });
  const personas = await TeamMember.findAll({
    where: { status: "active" },
    attributes: ["id", "displayName", "email", "customFields"],
    order: [["displayName", "ASC"]],
  });

  const { resueltos, pendientes } = resolverNombres(leido.nombres, personas);

  // Filas listas vs filas que no se pueden importar todavía.
  const listas = [];
  const bloqueadas = [];
  for (const f of leido.filas) {
    const teamMemberId = resueltos.get(f.nombreExcel) || null;
    if (f.errores?.length) {
      bloqueadas.push({ ...f, teamMemberId, motivo: f.errores.join("; ") });
    } else if (!teamMemberId) {
      bloqueadas.push({ ...f, teamMemberId: null, motivo: `«${f.nombreExcel}» no está mapeado a nadie del equipo` });
    } else {
      listas.push({ ...f, teamMemberId });
    }
  }

  // Qué se va a reemplazar y qué se va a respetar.
  const anterior = await FichajeImport.findOne({
    where: { periodo, status: "applied" },
    order: [["appliedAt", "DESC"]],
  });
  const rango = rangoDelPeriodo(periodo);
  const [aReemplazar, correccionesQueSobreviven] = rango
    ? await Promise.all([
        Fichaje.count({
          where: { fecha: { [Op.between]: [rango.desde, rango.hasta] }, origen: "import", deletedAt: null },
        }),
        Fichaje.count({
          where: {
            fecha: { [Op.between]: [rango.desde, rango.hasta] },
            origen: { [Op.ne]: "import" },
            deletedAt: null,
          },
        }),
      ])
    : [0, 0];

  const yaSubido = fileHash
    ? await FichajeImport.findOne({ where: { fileHash, status: { [Op.ne]: "reverted" } }, order: [["appliedAt", "DESC"]] })
    : null;

  const minutosPorPersona = new Map();
  for (const f of listas) {
    minutosPorPersona.set(f.teamMemberId, (minutosPorPersona.get(f.teamMemberId) || 0) + (f.minutos || 0));
  }
  const nombrePorId = new Map(personas.map((p) => [p.id, p.displayName]));

  return {
    periodo,
    parser: { ...parser.meta },
    totales: {
      filasLeidas: leido.filas.length,
      listas: listas.length,
      bloqueadas: bloqueadas.length,
      personas: new Set(listas.map((f) => f.teamMemberId)).size,
      minutos: listas.reduce((a, f) => a + (f.minutos || 0), 0),
    },
    // Lo que hay que resolver ANTES de poder aplicar.
    pendientesDeMapeo: pendientes,
    equipo: personas.map((p) => ({ id: p.id, nombre: p.displayName })),
    bloqueadas: bloqueadas.slice(0, 200),
    anotaciones: leido.anotaciones,
    avisosDelFichero: leido.avisos,
    reemplazo: {
      hayVolcadoPrevio: Boolean(anterior),
      volcadoPrevioId: anterior?.id || null,
      volcadoPrevioFecha: anterior?.appliedAt || null,
      filasQueSeReemplazan: aReemplazar,
      correccionesQueSobreviven,
    },
    ficheroRepetido: yaSubido ? { id: yaSubido.id, fecha: yaSubido.appliedAt, nombre: yaSubido.fileName } : null,
    resumenPorPersona: [...minutosPorPersona.entries()]
      .map(([id, minutos]) => ({ teamMemberId: id, nombre: nombrePorId.get(id) || "(?)", minutos }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    // `puedeAplicarse` es lo que gobierna el botón: no se aplica un mes con
    // nombres sin mapear, porque esas horas se perderían en silencio.
    puedeAplicarse: listas.length > 0 && pendientes.length === 0,
  };
}

/**
 * Aplica el volcado. Una transacción, todo o nada.
 *
 * `mapeos` es {nombreExcel: teamMemberId} confirmado por la persona; se guarda
 * como alias para que el mes que viene case solo.
 */
export async function aplicar({
  workbook,
  periodo,
  slug,
  tenantModels,
  tenantSequelize,
  fileName,
  fileHash,
  mapeos = {},
  importedByTeamId = null,
  importedByUserId = null,
}) {
  const { TeamMember, Fichaje, FichajeImport } = tenantModels;
  const parser = parserDeTenant(slug);

  // 1. Guardar los alias confirmados ANTES de leer, para que la resolución los
  // vea. Va fuera de la transacción del volcado a propósito: un alias es una
  // decisión de la persona y no tiene por qué deshacerse si el volcado falla.
  const personasPrevias = await TeamMember.findAll({ attributes: ["id", "displayName", "email", "customFields"] });
  const porId = new Map(personasPrevias.map((p) => [p.id, p]));
  for (const [nombreExcel, teamMemberId] of Object.entries(mapeos || {})) {
    const persona = porId.get(teamMemberId);
    if (!persona) continue;
    const nuevos = customFieldsConAlias(persona, nombreExcel);
    if (nuevos) await persona.update({ customFields: nuevos });
  }

  // 2. Releer el equipo con los alias ya puestos y resolver.
  const personas = await TeamMember.findAll({
    where: { status: "active" },
    attributes: ["id", "displayName", "email", "customFields"],
  });
  const leido = await parser.parse(workbook, { periodo });
  const { resueltos, pendientes } = resolverNombres(leido.nombres, personas);

  if (pendientes.length > 0) {
    const err = new Error(
      `Quedan nombres sin asignar: ${pendientes.map((p) => p.nombre).join(", ")}. No se ha importado nada.`
    );
    err.code = "mapeo_incompleto";
    throw err;
  }

  const listas = leido.filas.filter((f) => !f.errores?.length && resueltos.get(f.nombreExcel));
  if (listas.length === 0) {
    const err = new Error("No hay ni una jornada que se pueda importar. No se ha tocado nada.");
    err.code = "sin_filas";
    throw err;
  }

  const rango = rangoDelPeriodo(periodo);

  // 3. La transacción.
  const resultado = await tenantSequelize.transaction(async (t) => {
    // 3a. El lote anterior de este periodo pasa a superseded y sus filas se dan
    // de baja. SOLO las de origen 'import': lo corregido a mano se queda.
    const anteriores = await FichajeImport.findAll({ where: { periodo, status: "applied" }, transaction: t });
    let reemplazadas = 0;
    if (anteriores.length) {
      reemplazadas = await Fichaje.update(
        { deletedAt: new Date() },
        {
          where: {
            fecha: { [Op.between]: [rango.desde, rango.hasta] },
            origen: "import",
            deletedAt: null,
          },
          transaction: t,
        }
      ).then((r) => r[0] ?? 0);
      await FichajeImport.update(
        { status: "superseded" },
        { where: { id: anteriores.map((a) => a.id) }, transaction: t }
      );
    }

    // 3b. El lote nuevo.
    const lote = await FichajeImport.create(
      {
        periodo,
        fileName,
        fileHash,
        parser: parser.meta.key,
        rowsTotal: leido.filas.length,
        rowsOk: listas.length,
        rowsError: leido.filas.length - listas.length,
        status: "applied",
        importedByTeamId,
        importedByUserId,
        appliedAt: new Date(),
        resumen: {
          // La foto del momento: totales por persona y las anotaciones que
          // venían escritas en el Excel. Si dentro de tres meses alguien
          // discute una nómina, esto es lo que decía el sistema el día que se
          // pagó, aunque después se hayan corregido filas.
          porPersona: [...listas.reduce((m, f) => {
            const id = resueltos.get(f.nombreExcel);
            m.set(id, (m.get(id) || 0) + (f.minutos || 0));
            return m;
          }, new Map())].map(([teamMemberId, minutos]) => ({ teamMemberId, minutos })),
          anotaciones: leido.anotaciones,
          avisos: leido.avisos,
        },
      },
      { transaction: t }
    );

    // 3c. Las filas.
    await Fichaje.bulkCreate(
      listas.map((f) => ({
        teamMemberId: resueltos.get(f.nombreExcel),
        fecha: f.fecha,
        entradaAt: f.entrada,
        salidaAt: f.salida,
        entradaPrevistaAt: f.entradaPrevista,
        salidaPrevistaAt: f.salidaPrevista,
        minutos: f.minutos,
        minutosPrevistos: f.minutosPrevistos,
        minutosOriginal: f.minutos,
        tipo: "trabajo",
        origen: "import",
        importId: lote.id,
        hojaExcel: f.hoja,
        filaExcel: f.fila,
        nota: f.nota || null,
      })),
      { transaction: t }
    );

    return { loteId: lote.id, creadas: listas.length, reemplazadas };
  });

  return { ...resultado, periodo, anotaciones: leido.anotaciones.length };
}

/**
 * Deshace un volcado ENTERO.
 *
 * Da de baja sus filas y marca el lote como `reverted`. NO resucita el lote
 * anterior: dejar el mes vacío es un estado que se ve y se arregla volviendo a
 * subir el fichero bueno; resucitar por detrás un volcado que alguien había
 * sustituido sería devolver datos viejos sin que nadie lo haya pedido.
 */
export async function revertir({ importId, tenantModels, tenantSequelize }) {
  const { Fichaje, FichajeImport } = tenantModels;
  return await tenantSequelize.transaction(async (t) => {
    const lote = await FichajeImport.findByPk(importId, { transaction: t });
    if (!lote) {
      const e = new Error("Volcado no encontrado");
      e.code = "no_encontrado";
      throw e;
    }
    if (lote.status === "reverted") {
      const e = new Error("Ese volcado ya estaba deshecho");
      e.code = "ya_revertido";
      throw e;
    }
    const [bajas] = await Fichaje.update(
      { deletedAt: new Date() },
      { where: { importId, deletedAt: null }, transaction: t }
    );
    await lote.update({ status: "reverted", revertedAt: new Date() }, { transaction: t });
    return { bajas, periodo: lote.periodo };
  });
}

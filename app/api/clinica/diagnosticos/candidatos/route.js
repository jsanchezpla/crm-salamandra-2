import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { filtroPorNombre } from "../../../../../lib/utils/busquedaDb.js";
import { estaAbierto } from "../../../../../lib/clinica/diagnostico.js";
import { agrupaPor, nombreDe } from "../../../../../lib/clinica/diagnosticoFila.js";
import {
  tablaAusente,
  catalogoDelCentro,
  mesesDeAdopcion,
  desdeHace,
  tiposDeAdopcion,
  citasAdoptablesDe,
  registrosDeEntrevistaDe,
  cobrosDeEntrevistaDe,
  filaDeCandidato,
  terapeutasPorId,
} from "../../../../../lib/clinica/diagnosticoDb.js";

/**
 * GET /api/clinica/diagnosticos/candidatos?q=&meses=12 — «Empezar desde lo
 * que ya hay»: los pacientes que YA están en diagnóstico y no tienen
 * expediente (12/09/2026, respuesta de Aumenta; Isa por Rodrigo).
 *
 * Aumenta tiene seis pacientes con citas de diagnóstico dadas y futuras, y
 * alguno con la entrevista inicial hecha y cobrada como entrevista de
 * terapia, desde antes de que existiera el expediente. Los dan de alta ellos:
 * «lo único que hay que saber cómo hacerlo». Esta lista es ese cómo: una
 * tabla con buscador desde la que abrir el expediente metiendo dentro lo que
 * ya hay (`POST /api/clinica/diagnosticos` con `adoptar`).
 *
 * Es candidato el paciente SIN expediente abierto (`entrevista`/`en_curso`)
 * que en los últimos `meses` (12 por defecto, 36 como mucho) tiene (a) citas
 * de tipos con `informe_tipo = 'diagnostico'` sin expediente, y/o (b) una
 * cita de un tipo con `is_initial_assessment` sin expediente, y/o (c) un
 * registro con plantilla `entrevista_inicial` sin expediente. Nada a fuego:
 * la regla es POR ESAS COLUMNAS (`lib/clinica/adoptarEnDiagnostico.js`).
 *
 * UNA consulta por tabla —tipos, citas, registros, expedientes, pacientes,
 * cobros, equipo— y el reparto en memoria: nunca una por paciente. `q`
 * filtra por nombre en el servidor (palabras, sin tildes: `filtroPorNombre`).
 * Tope de 300 filas, ordenadas por apellido; `truncado` avisa si hay más.
 *
 * Cada fila lleva `resumen` (la frase de la casilla, `resumenDeAdopcion`) y
 * `adoptar` (el cuerpo que el alta espera), para que la pantalla no tenga
 * que volver a calcular ninguna de las dos cosas.
 *
 * Lo ve todo el equipo con `clinica`: es clínico, no dinero.
 */

// No se exporta: Next solo admite los verbos como exports de un route.js.
const TOPE_CANDIDATOS = 300;

export const GET = withTenant(async (request, _ctx, ctx) => {
  const { tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const meses = mesesDeAdopcion(searchParams.get("meses"));
  const vacio = (extra = {}) => ok({ candidatos: [], total: 0, meses, tope: TOPE_CANDIDATOS, truncado: false, q, ...extra });

  try {
    const { Diagnostico, Patient } = tenantModels;
    if (!Diagnostico) return vacio({ sinMigrar: true });
    if (!Patient) return vacio();

    const ahora = new Date();
    const desde = desdeHace(meses, ahora);

    const [tipos, catalogo] = await Promise.all([tiposDeAdopcion(tenantModels), catalogoDelCentro(tenantModels)]);
    const [citasPP, sesionesPP] = await Promise.all([
      citasAdoptablesDe(tenantModels, { tipos, desde }),
      registrosDeEntrevistaDe(tenantModels, { desde }),
    ]);

    const ids = [...new Set([...citasPP.keys(), ...sesionesPP.keys()])];
    if (!ids.length) return vacio();

    // Sus expedientes, de una vez: fuera quien ya tiene uno abierto; los
    // cerrados se cuentan en la fila y sus cobros de entrevista no se adoptan
    // dos veces.
    const expedientesPP = agrupaPor(
      await Diagnostico.findAll({
        where: { patientId: { [Op.in]: ids } },
        attributes: ["id", "patientId", "status", "entrevistaPaymentId"],
        raw: true,
      }),
      "patientId"
    );
    const sinAbierto = ids.filter((id) => !(expedientesPP.get(id) ?? []).some(estaAbierto));
    if (!sinAbierto.length) return vacio();

    // Los pacientes, con el buscador aplicado en la base: una ficha borrada
    // no sale (no hay a quién abrirle el expediente).
    const where = { id: { [Op.in]: sinAbierto } };
    if (q) {
      const porNombre = await filtroPorNombre(Patient.sequelize, q, ["Patient.first_name", "Patient.last_name"]);
      if (porNombre) where[Op.and] = [porNombre];
    }
    const pacientes = await Patient.findAll({
      where,
      attributes: ["id", "firstName", "lastName", "clientId"],
      order: [["lastName", "ASC"], ["firstName", "ASC"]],
      raw: true,
    });
    if (!pacientes.length) return vacio();

    const cobrosPP = await cobrosDeEntrevistaDe(tenantModels, {
      patientIds: pacientes.map((p) => p.id),
      conceptoEntrevistaId: catalogo.conceptoEntrevista?.id ?? null,
    });

    const filas = pacientes
      .map((p) =>
        filaDeCandidato({
          paciente: p,
          citas: citasPP.get(String(p.id)) ?? [],
          sesiones: sesionesPP.get(String(p.id)) ?? [],
          cobros: cobrosPP.get(String(p.id)) ?? [],
          expedientes: expedientesPP.get(String(p.id)) ?? [],
          tipos,
          ahora,
          meses,
        })
      )
      .filter(Boolean);

    const total = filas.length;
    const recortadas = filas.slice(0, TOPE_CANDIDATOS);

    // Los nombres de los terapeutas sugeridos, en una consulta y solo para
    // las filas que salen.
    const terapeutas = await terapeutasPorId(tenantModels, recortadas.map((f) => f.terapeutaSugerido?.id));
    for (const f of recortadas) {
      if (!f.terapeutaSugerido) continue;
      const t = terapeutas.get(String(f.terapeutaSugerido.id));
      f.terapeutaSugerido = { id: f.terapeutaSugerido.id, nombre: t ? nombreDe(t) : "(sin nombre)" };
    }

    return ok({ candidatos: recortadas, total, meses, tope: TOPE_CANDIDATOS, truncado: total > TOPE_CANDIDATOS, q });
  } catch (err) {
    if (tablaAusente(err)) return vacio({ sinMigrar: true });
    return serverError(err);
  }
});

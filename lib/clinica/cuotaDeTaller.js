/**
 * lib/clinica/cuotaDeTaller.js — apuntar a un niño a un taller le da de alta su
 * cuota; darlo de baja se la cierra (01/09/2026, Aumenta por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: lo usan el alta de una inscripción, la baja
 * y la pantalla que enseña quién está pagando. Son tres sitios y una sola
 * regla: si se copia, el día que cambie el criterio quedarán familias cobradas
 * por un taller al que su hijo ya no va.)
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Asimismo estos pacientes tendrán que estar relacionados entre sí dentro de
 * una misma cuota de talleres. Así se complementan la zona de pago, las citas y
 * los registros de sesiones.»
 *
 * ── QUÉ SIGNIFICA «UNA MISMA CUOTA» ─────────────────────────────────────────
 * No una fila compartida: una cuota se le cobra a UNA familia (`client_id` es
 * NOT NULL y es el destinatario de la factura), y los ocho niños de un grupo
 * son ocho familias. Lo que comparten es el CONCEPTO del catálogo —«Taller de
 * habilidades sociales · 45 €»—, que es lo que hace que se cobren igual, se
 * suban de precio a la vez y se puedan listar juntos.
 *
 * Así que apuntar a un niño hace exactamente esto: buscarle a su familia una
 * cuota viva con el concepto del taller y, si no la tiene, creársela desde este
 * mes. La inscripción se queda con el id de esa cuota
 * (`taller_inscripciones.cuota_id`), que es lo que permite cerrarla al darlo de
 * baja sin adivinar cuál de las cuotas de la familia era la del taller.
 *
 * ── POR QUÉ REUTILIZA UNA CUOTA QUE YA EXISTA ───────────────────────────────
 * Porque el caso real es un niño al que ya se le cobraba el taller por fuera
 * —de las 274 cuotas de Aumenta, 259 vienen del volcado de Organízate— y
 * apuntarlo ahora en el CRM no puede duplicarle el recibo. Si la familia ya
 * paga ese concepto por ese paciente, la inscripción se ENGANCHA a esa cuota en
 * vez de crear otra. Es la diferencia entre ordenar lo que ya se cobra y
 * cobrarlo dos veces.
 *
 * ── NADA DE ESTO PUEDE TUMBAR LA INSCRIPCIÓN ────────────────────────────────
 * Best-effort, como `incidenciaPorFalta.js`: apuntar al niño al grupo es la
 * operación principal. Si el centro no tiene Facturación, si el taller no tiene
 * concepto de cobro o si falla la escritura, se apunta igual y aquí se devuelve
 * `{ cuotaId: null, motivo }`. La pantalla lo dice, y alguien lo arregla.
 */

/** 42P01 = la tabla no existe en este schema (tenant sin Facturación). */
const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

const hoyISO = () => new Date().toISOString().slice(0, 10);

/**
 * El concepto con el que se cobra un grupo: el suyo si lo tiene, y si no el de
 * la actividad. Es el orden natural —«los talleres cuestan X, salvo este
 * grupo»— y evita repetir el concepto en cada grupo del mismo taller.
 */
export function conceptoDeGrupo(taller, grupo) {
  return grupo?.conceptId || taller?.conceptId || null;
}

/**
 * Da de alta (o reutiliza) la cuota de un paciente por un grupo de taller.
 *
 * @returns {{ cuotaId: string|null, creada: boolean, motivo: string|null }}
 *   `motivo` explica en castellano por qué no hay cuota, para poder enseñarlo.
 */
export async function asegurarCuotaDeTaller({ tenantModels, taller, grupo, patientId, clientId }) {
  const { Cuota } = tenantModels;
  if (!Cuota) return { cuotaId: null, creada: false, motivo: "Este centro no tiene Facturación." };

  const conceptId = conceptoDeGrupo(taller, grupo);
  if (!conceptId) {
    return {
      cuotaId: null,
      creada: false,
      motivo: "El taller no tiene concepto de cobro: no se ha creado ninguna cuota.",
    };
  }
  if (!clientId) {
    return {
      cuotaId: null,
      creada: false,
      motivo: "El paciente no tiene familia pagadora: la cuota hay que crearla a mano.",
    };
  }

  try {
    /*
     * ¿Ya le cobran este taller? Se busca por FAMILIA y CONCEPTO, entre las
     * vigentes. El paciente NO entra en la búsqueda a propósito: las cuotas del
     * volcado de Organízate son de la familia y no tienen paciente (259 de
     * 274), así que exigirlo crearía una cuota nueva justo donde ya existe una.
     */
    const vivas = await Cuota.findAll({ where: { clientId, active: true } });
    const yaLaTiene = vivas.find((c) => {
      const ids = Array.isArray(c.conceptIds) ? c.conceptIds : [];
      if (!ids.includes(conceptId)) return false;
      // Si la cuota es de OTRO hermano, no vale: es la suya.
      return !c.patientId || c.patientId === patientId;
    });
    if (yaLaTiene) return { cuotaId: yaLaTiene.id, creada: false, motivo: null };

    const cuota = await Cuota.create({
      clientId,
      // Con paciente, siempre: es lo que hace que la cuota del taller se sepa
      // de quién es aunque la familia tenga tres hijos apuntados a tres cosas.
      patientId: patientId || null,
      conceptIds: [conceptId],
      // Importe NULL = «lo que diga su concepto» (ver Cuota.model.js): así
      // subir el precio del taller se hace en el catálogo, una vez, y no en
      // cuarenta y cinco filas.
      amount: null,
      startDate: hoyISO(),
      active: true,
      notes: `Taller: ${taller?.name ?? ""}${grupo?.name ? ` · ${grupo.name}` : ""}`.trim(),
    });
    return { cuotaId: cuota.id, creada: true, motivo: null };
  } catch (err) {
    if (tablaAusente(err)) {
      return { cuotaId: null, creada: false, motivo: "Este centro no tiene Facturación." };
    }
    process.stderr.write(`[clinica:cuotaDeTaller] no se pudo crear la cuota: ${err.message}\n`);
    return { cuotaId: null, creada: false, motivo: "No se pudo crear la cuota; créala a mano." };
  }
}

/**
 * Cierra la cuota de una inscripción que se da de baja.
 *
 * NO la borra: se le pone fecha de fin y se desactiva, que es como se dan de
 * baja las cuotas en todo el CRM. Una cuota borrada se lleva por delante la
 * explicación de por qué se cobró lo que se cobró.
 *
 * ── LO QUE NO HACE, Y ES DELIBERADO ─────────────────────────────────────────
 * Si esa misma cuota cubre además otra cosa —tiene más conceptos dentro— NO se
 * toca: cerrarla dejaría a la familia sin cobrar la logopedia por haber sacado
 * al niño del taller. En ese caso se devuelve `{ cerrada: false, motivo }` y lo
 * decide una persona.
 */
export async function cerrarCuotaDeTaller({ tenantModels, cuotaId }) {
  const { Cuota } = tenantModels;
  if (!Cuota || !cuotaId) return { cerrada: false, motivo: null };

  try {
    const cuota = await Cuota.findByPk(cuotaId);
    if (!cuota || !cuota.active) return { cerrada: false, motivo: null };

    const conceptos = Array.isArray(cuota.conceptIds) ? cuota.conceptIds : [];
    if (conceptos.length > 1) {
      return {
        cerrada: false,
        motivo: "Su cuota cubre además otras cosas: revísala en Facturación antes de darla de baja.",
      };
    }

    await cuota.update({ endDate: hoyISO(), active: false });
    return { cerrada: true, motivo: null };
  } catch (err) {
    if (tablaAusente(err)) return { cerrada: false, motivo: null };
    process.stderr.write(`[clinica:cuotaDeTaller] no se pudo cerrar la cuota: ${err.message}\n`);
    return { cerrada: false, motivo: "No se pudo cerrar la cuota; revísala en Facturación." };
  }
}

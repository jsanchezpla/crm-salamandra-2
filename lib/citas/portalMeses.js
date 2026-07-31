/**
 * portalMeses — bloqueo mensual por impago del área privada
 * (sprint Aumenta 2026-07, punto 2.3).
 *
 * (Fichero nuevo en /lib, regla #2: lo usan el listado de documentos del
 * portal, la descarga individual y la pantalla del CRM que abre meses a mano.
 * La regla tiene que ser LA MISMA en los tres sitios o la familia vería en el
 * listado algo que luego no puede descargar.)
 *
 * REGLA: los documentos que comparte el equipo se ven por MES. El mes M está
 * abierto si existe un cobro completado con `periodMonth` = M para esa familia,
 * o si administración lo ha abierto a mano (`Client.portalUnlockedMonths`).
 *
 * NUNCA se bloquea lo que ha subido la propia familia (`uploadedByClient`): es
 * suyo, y retenerle sus propias analíticas por un recibo pendiente no es
 * palanca de cobro, es quitarle sus cosas.
 *
 * APAGADO POR DEFECTO (`settings.citas.portalBloqueoImpago`). Encenderlo sin
 * querer en un tenant que no registra cobros por mes escondería de golpe TODA
 * la documentación de TODAS las familias — y nutri_laura es un CRM en uso real
 * con pacientes reales mirando su portal.
 */

/** ¿Está encendido el bloqueo por impago en este tenant? */
export function bloqueoImpagoActivo(tenant) {
  return tenant?.settings?.citas?.portalBloqueoImpago === true;
}

/** 'YYYY-MM' de una fecha (o null si no hay fecha válida). */
export function mesDe(fecha) {
  if (!fecha) return null;
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Meses abiertos a mano en la ficha, normalizados a 'YYYY-MM'. */
export function mesesManuales(client) {
  const arr = Array.isArray(client?.portalUnlockedMonths) ? client.portalUnlockedMonths : [];
  return arr.map((m) => String(m).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m));
}

/**
 * Conjunto de meses abiertos para una familia: los cobrados + los abiertos a
 * mano. Si la tabla de cobros no existe en el schema (tenant sin facturación),
 * solo cuentan los manuales — y nunca revienta por eso.
 */
export async function mesesAbiertos(tenantModels, client) {
  const abiertos = new Set(mesesManuales(client));
  const { Payment } = tenantModels;
  if (!Payment || !client?.id) return abiertos;
  try {
    const filas = await Payment.findAll({
      where: { clientId: client.id, status: "completed" },
      attributes: ["periodMonth"],
    });
    for (const f of filas) {
      const m = f.periodMonth ? String(f.periodMonth).slice(0, 7) : null;
      if (m) abiertos.add(m);
    }
  } catch (err) {
    if (err?.parent?.code !== "42P01" && err?.original?.code !== "42P01") throw err;
  }
  return abiertos;
}

/**
 * Reparte los documentos entre los que la familia puede ver y los meses que le
 * quedan cerrados. Se devuelven los meses (no los nombres de fichero): saber
 * que «hay 2 documentos de junio pendientes de pago» es información suya; el
 * título de un informe clínico, ya no.
 */
export function filtrarPorMes(documentos, abiertos) {
  const visibles = [];
  const bloqueados = new Map();
  for (const doc of documentos) {
    const propio = !!(doc.uploadedByClient ?? doc.uploaded_by_client);
    const mes = mesDe(doc.createdAt ?? doc.created_at);
    if (propio || !mes || abiertos.has(mes)) {
      visibles.push(doc);
      continue;
    }
    bloqueados.set(mes, (bloqueados.get(mes) ?? 0) + 1);
  }
  return {
    visibles,
    mesesBloqueados: [...bloqueados.entries()]
      .map(([mes, documentos]) => ({ mes, documentos }))
      .sort((a, b) => b.mes.localeCompare(a.mes)),
  };
}

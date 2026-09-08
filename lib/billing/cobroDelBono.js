/**
 * lib/billing/cobroDelBono.js — el cobro PENDIENTE que nace al dar un bono
 * (08/09/2026, AV-0070 de Aumenta).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Rosa: «Cuando doy de alta el bono, la opción que me da es importe cobrado...
 * al no haberlo cobrado se queda en blanco. Pero posteriormente en cobros no me
 * sale que tiene ningún importe pendiente. Los bonos se dan de alta con
 * anticipación y deben de salir en pendiente para que cuando venga el cliente a
 * su primera sesión lo abone, y en caso de que no lo haga, que suele ocurrir,
 * nos salte como pendiente».
 *
 * Y el agujero era mayor que el que ella describe: dar un bono no creaba NINGÚN
 * cobro, y a la vez cada cita enganchada al bono nace con importe 0 y el texto
 * «ya está pagada» (`lib/citas/packs.js`, `cobroDeBono`). O sea que las
 * sesiones se marcaban como pagadas mientras nadie había pagado, y la deuda no
 * estaba en Cobros, ni en Morosidad, ni en la ficha.
 *
 * ── LA REGLA, QUE ES LA MISMA QUE LA DE LAS CUOTAS ─────────────────────────
 * **Dar un bono no es cobrarlo.** El cobro nace `pending`, igual que el de
 * «Generar el mes», y pasa a cobrado cuando alguien recibe el dinero. Así
 * Morosidad y la ficha dicen la verdad desde el primer día.
 *
 * ── POR QUÉ SIN IMPORTE NO SE CREA NADA ────────────────────────────────────
 * Un cobro pendiente de importe desconocido no es una deuda: es una fila que
 * ensucia Cobros y que nadie puede saldar. Si no se sabe cuánto vale el bono,
 * lo honesto es no apuntar nada — y el formulario ahora lo pide con su nombre
 * («Importe del bono»), que es justo lo que llevó a Rosa a dejarlo en blanco
 * cuando se llamaba «Importe cobrado».
 *
 * ── LA COSTURA: LOS BONOS VAN EN CÉNTIMOS Y LOS COBROS EN EUROS ────────────
 * Aquí se cruzan dos módulos con dos unidades distintas, y la primera versión
 * (08/09/2026) pasó el número tal cual: un bono de 150 € nacía con un cobro
 * pendiente de **15.000 €**. No llegó a pasarle a nadie —los dos bonos dados
 * ese día se dieron sin importe—, pero estaba puesto.
 *
 * · `session_packs.amount` está en CÉNTIMOS enteros: es la regla del módulo de
 *   citas y de Stripe (`lib/payments/money.js`), y el formulario manda
 *   `eurosToCents(importe)`.
 * · `payments.amount` es DECIMAL(12,2) en EUROS: la cuota de 145 € se guarda
 *   como 145.00, y así lo suman Cobros, Morosidad y las facturas.
 *
 * La conversión vive aquí, en la frontera, y no en quien llama: es el único
 * sitio por el que pasan los dos mundos.
 */

/** Los métodos que admite un cobro; el del bono se elige al cobrarlo. */
export const METODO_POR_DEFECTO = "transfer";

/**
 * ¿Hay que crear cobro por este bono? Solo con un importe de verdad.
 *
 * Un bono regalado (importe 0) tampoco genera cobro: no se le debe nada a
 * nadie, y una fila de 0 € en Cobros es ruido que hay que explicar cada mes.
 */
export function bonoLlevaCobro(amount) {
  return Number.isInteger(amount) && amount > 0;
}

/**
 * Cómo se llama ese cobro en Cobros y en la ficha.
 *
 * Lleva el tipo de cita y cuántas sesiones porque es lo que permite reconocerlo
 * sin abrir el bono, igual que el cobro de una cuota dice de qué mes es.
 */
export function textoDelCobroDeBono({ nombre, sesiones } = {}) {
  const n = Number(sesiones) || 0;
  const que = nombre ? `«${String(nombre).trim()}»` : "de sesiones";
  const cuantas = n > 0 ? ` · ${n} ${n === 1 ? "sesión" : "sesiones"}` : "";
  return `Bono ${que}${cuantas}`.slice(0, 200);
}

/** Céntimos del bono → euros del cobro. Ver la costura, arriba. */
export function eurosDelBono(cents) {
  return Math.round(cents) / 100;
}

/**
 * La fila de cobro que sale de un bono, o `null` si no lleva.
 *
 * `amount` entra en CÉNTIMOS (lo que guarda el bono) y sale en EUROS (lo que
 * guarda el cobro).
 *
 * Devuelve el objeto y no escribe: quien llama lo mete en SU transacción, la
 * misma en la que nace el bono. Si el cobro se creara aparte podrían quedar
 * bonos sin deuda o deudas sin bono, que es peor que no tener ninguna de las
 * dos cosas.
 *
 * `periodMonth` va a null a propósito: un bono no es de un mes, y ponerle uno
 * lo metería en el bloqueo del portal y en «Facturar el mes» de ese mes como
 * si fuera una cuota.
 */
export function cobroPendienteDeBono({
  amount,
  clientId,
  patientId = null,
  packId = null,
  nombre = null,
  sesiones = null,
  compradoEl = null,
  metodo = METODO_POR_DEFECTO,
} = {}) {
  if (!bonoLlevaCobro(amount)) return null;
  if (!clientId) return null; // sin ficha no hay a quién cobrarle

  return {
    clientId,
    patientId: patientId || null,
    packId: packId || null,
    // Un bono no es de un mes: ver arriba.
    periodMonth: null,
    conceptId: null,
    cuotaId: null,
    // En EUROS, que es lo que entiende `payments.amount`.
    amount: eurosDelBono(amount),
    paidAt: compradoEl ? new Date(compradoEl) : new Date(),
    method: metodo || METODO_POR_DEFECTO,
    // PENDIENTE: dar un bono no es cobrarlo.
    status: "pending",
    notes: textoDelCobroDeBono({ nombre, sesiones }),
  };
}

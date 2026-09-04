/**
 * lib/productos/servicios.js — lo que el centro VENDE cuando lo que vende son
 * sesiones: cada cuota del catálogo con quién está apuntado y cuánto suma.
 *
 * (Fichero nuevo en /lib, regla #2: el endpoint lee la base y esto compone la
 * tabla; la composición es pura y se prueba sin levantar nada, como
 * `productos/ventas.js` con las ventas del catálogo.)
 *
 * ── DE DÓNDE VIENE (Rodrigo, 04/09/2026, Aumenta) ──────────────────────────
 * «Lo que hacía antes Aumenta era que en lugar de tener citas con títulos
 * propios directamente iban a la cuota. Nosotros hemos añadido la capacidad de
 * que todo vaya por citas, lo que pasa es que lo que no está conectado son las
 * distintas cuotas a cada tipo de cita, y eso hay que dejarlo reflejado en la
 * pestaña de producto. Ahí saldrán todas las citas y las cuotas asignadas a
 * cada cita para medir de forma tanto terapéutica como económica a qué están
 * apuntados los pacientes y qué deben pagar.»
 *
 * Así que una fila por CUOTA del catálogo (`billing_concepts`), y en la misma
 * fila las dos medidas:
 *
 *   · terapéutica — qué tipos de cita la cubren y cuántos pacientes están
 *     apuntados a ella;
 *   · económica  — cuánto suma al mes y cuántas citas la llevan puesta.
 *
 * ── LO QUE SE MIDE Y LO QUE NO ─────────────────────────────────────────────
 * `alMes` es lo que ESE servicio debería facturar según el catálogo: las cuotas
 * vivas que lo llevan, por su precio. No es lo cobrado —eso son los cobros— ni
 * lo pactado: una familia puede tener un precio acordado distinto (`amount` de
 * su cuota), y por eso la pantalla lo dice en vez de sumarlo por su cuenta.
 * Mezclar tarifa y precio pactado en una sola cifra daría un número que no es
 * ninguno de los dos.
 *
 * `pacientes` cuenta pacientes DISTINTOS, no cuotas: dos hermanos con la misma
 * terapia son dos pacientes y una cuota cada uno. Una cuota sin paciente —la de
 * la familia entera— cuenta como paciente desconocido y se apunta aparte
 * (`sinPaciente`), porque es justo lo que hay que repasar.
 */

/** Redondeo a céntimo, para que la suma de decimales no arrastre. */
const dosDecimales = (n) => Math.round((Number(n) || 0) * 100) / 100;

const texto = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Una fila por cuota del catálogo.
 *
 * @param conceptos  `billing_concepts` activos: { id, name, unitPrice }
 * @param cuotas     `billing_cuotas` activas: { id, clientId, patientId, conceptIds, amount }
 * @param tipos      `event_types` activos: { id, name, conceptId }
 * @param citasPorConcepto  Map/objeto { conceptId: nº de citas del periodo }
 *
 * Devuelve `{ servicios, totales, sinCuota }`:
 *   · `servicios` ordenado de más dinero al mes a menos;
 *   · `totales` con lo que suma todo y cuántos pacientes distintos hay;
 *   · `sinCuota` son los TIPOS de cita que no tienen cuota puesta — la lista de
 *     lo que queda por conectar, que es la mitad del encargo.
 */
export function componerServicios({ conceptos = [], cuotas = [], tipos = [], citasPorConcepto = {} } = {}) {
  const citasDe = (id) => Number(citasPorConcepto?.[id] ?? citasPorConcepto?.get?.(id) ?? 0) || 0;

  const porConcepto = new Map();
  for (const c of conceptos) {
    const j = c?.toJSON ? c.toJSON() : c;
    if (!j?.id) continue;
    porConcepto.set(String(j.id), {
      id: String(j.id),
      nombre: texto(j.name) || "Sin nombre",
      precio: dosDecimales(j.unitPrice ?? j.unit_price),
      tipos: [],
      cuotas: 0,
      pacientes: 0,
      sinPaciente: 0,
      citas: citasDe(String(j.id)),
      alMes: 0,
    });
  }

  // Qué tipos de cita cubre cada cuota.
  const sinCuota = [];
  for (const t of tipos) {
    const j = t?.toJSON ? t.toJSON() : t;
    if (!j?.id) continue;
    const fila = j.conceptId ? porConcepto.get(String(j.conceptId)) : null;
    if (fila) fila.tipos.push({ id: String(j.id), nombre: texto(j.name) });
    else sinCuota.push({ id: String(j.id), nombre: texto(j.name) });
  }

  // Quién está apuntado. Los pacientes se cuentan una vez por servicio aunque
  // tengan dos cuotas con el mismo concepto.
  const pacientesPorConcepto = new Map();
  for (const c of cuotas) {
    const j = c?.toJSON ? c.toJSON() : c;
    const ids = Array.isArray(j?.conceptIds) ? j.conceptIds : [];
    for (const bruto of ids) {
      const fila = porConcepto.get(String(bruto));
      if (!fila) continue; // concepto borrado del catálogo: no inventamos fila
      fila.cuotas += 1;
      if (j.patientId) {
        if (!pacientesPorConcepto.has(fila.id)) pacientesPorConcepto.set(fila.id, new Set());
        pacientesPorConcepto.get(fila.id).add(String(j.patientId));
      } else {
        fila.sinPaciente += 1;
      }
    }
  }
  for (const [id, set] of pacientesPorConcepto) porConcepto.get(id).pacientes = set.size;

  const servicios = [...porConcepto.values()].map((f) => ({
    ...f,
    // Lo que debería facturar al mes: las cuotas vivas que lo llevan, a tarifa.
    alMes: dosDecimales(f.cuotas * f.precio),
  }));
  servicios.sort((a, b) => b.alMes - a.alMes || a.nombre.localeCompare(b.nombre, "es"));

  const todosLosPacientes = new Set();
  for (const set of pacientesPorConcepto.values()) for (const p of set) todosLosPacientes.add(p);

  return {
    servicios,
    sinCuota: sinCuota.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    totales: {
      servicios: servicios.length,
      conCuotaViva: servicios.filter((s) => s.cuotas > 0).length,
      pacientes: todosLosPacientes.size,
      alMes: dosDecimales(servicios.reduce((s, f) => s + f.alMes, 0)),
      citas: servicios.reduce((s, f) => s + f.citas, 0),
      tiposSinCuota: sinCuota.length,
    },
  };
}

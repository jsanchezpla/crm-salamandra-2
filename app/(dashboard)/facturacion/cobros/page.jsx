"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hoyVigente, mesVigente, reservaDeLasCuotas } from "@/lib/billing/cuotas.js";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import Link from "next/link";
import StatusBadge from "../_components/StatusBadge.jsx";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../_components/tableSort.jsx";
import Select from "@/components/ui/Select.jsx";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";
import ExportButtons from "@/components/billing/ExportButtons.jsx";
import FacturarMesDrawer from "../_components/FacturarMesDrawer.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import { partesConProrrateo } from "../../../../lib/billing/prorrateo.js";
import { cuotasQueEntran, conceptosDeCuotas, importePactado, tramosDeCuotas } from "../../../../lib/billing/cuotaParaRellenar.js";
import { restoDelMes, generadoDelMes, restoQueSeQuedaPendiente, cobrosDeOtroServicio } from "../../../../lib/billing/restoDelMes.js";
import { explicaCobro } from "../../../../lib/billing/motivoDelCobro.js";
import { etiquetaDeMoroso, filtrarMorosos, repartirMorosos, resumenDeMorosidad } from "../../../../lib/billing/morosidad.js";
import { exigeMetodo } from "../../../../lib/billing/caja.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const METHOD_LABELS = {
  card: "Tarjeta",
  transfer: "Transferencia",
  cash: "Efectivo",
  direct_debit: "Domiciliación",
};
const METODOS_OPCIONES = Object.entries(METHOD_LABELS).map(([k, v]) => ({ value: k, label: v }));
/*
 * «Sin decidir» (10/09/2026, Rodrigo). Un cobro PENDIENTE puede no tener
 * método: el de la cuota del mes y el del bono nacen así, porque dar la deuda
 * por escrita no es cobrarla. Solo vale para un pendiente — el servidor se
 * niega a dar por cobrado un importe que no dice por dónde entró.
 */
const SIN_DECIDIR = { value: "", label: "Sin decidir" };

export default function CobrosPage() {
  const [payments, setPayments] = useState([]);
  // Los totales de todo lo que casa con el filtro, del servidor (07/09/2026).
  const [totales, setTotales] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [me, setMe] = useState(null);
  /*
   * Facturar lo hace quien tiene el MÓDULO de Facturación, no solo quien manda
   * (14/08/2026, Rodrigo — la regla, en lib/auth/permisos.js). En Aumenta son
   * Olga y Rosa: rol `user`, y son las que llevan la contabilidad. Esto era
   * `me.role === "admin"` y las dejaba mirando la pantalla entera sin poder
   * pulsar un botón — ni siquiera apuntar un cobro.
   *
   * `Boolean(me)` y no `true`: mientras /api/auth/me va y viene no hay que
   * enseñar botones que a lo mejor luego se quitan.
   */
  const puedeFacturar = Boolean(me);

  // Eliminar un cobro no tiene vuelta atrás: se pregunta con el diálogo del
  // CRM, no con el del navegador (que Chrome deja silenciar y devuelve `false`
  // siempre — ver components/ui/Dialogo.jsx).
  const { confirmar, dialogo } = useDialogo();

  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  // `modo`: "factura" (cobro de una factura emitida) o "cuota" (el flujo real
  // del centro: se cobra la mensualidad y se factura después). El mes es lo que
  // abre los documentos de esa familia en su área privada.
  // `patientId`: de QUIÉN es la cuota que se cobra (01/09/2026, Rodrigo). Vacío
  // = de la familia entera, que es como funcionaba hasta hoy.
  // `method` en blanco a propósito (10/09/2026): registrar un cobro es decir
  // por dónde entró el dinero, y proponer «Transferencia» hacía que se quedara
  // puesta por inercia. Lo elegido se conserva para el siguiente cobro del rato.
  // Y `modo` empieza en «cuota» (10/09/2026, Rodrigo): el centro cobra la
  // mensualidad y factura al cierre, así que la factura es la excepción.
  const [form, setForm] = useState({ modo: "cuota", invoiceId: "", clientId: "", patientId: "", periodMonth: mesVigente(), amount: "", method: "", paidAt: hoyVigente(), notes: "" });
  // Los pacientes de la familia elegida, para poder cobrar lo de UNO. Vacío
  // cuando el centro no tiene módulo asistencial (el endpoint responde 403) o
  // cuando esa ficha no tiene pacientes: entonces el selector no se enseña.
  const [pacientesFamilia, setPacientesFamilia] = useState([]);
  const [editing, setEditing] = useState(null); // cobro que se está editando
  // Facturas abiertas del cliente del cobro que se edita, para poder ASOCIAR
  // un cobro suelto a la factura que se emitió después (31/08/2026).
  const [facturasCliente, setFacturasCliente] = useState([]);
  // Los pacientes de la familia del cobro que se edita, para corregir de QUIÉN
  // es (07/09/2026, Registro: «Editar cobro» no dejaba cambiar ni el mes ni el
  // hijo). Vacío sin módulo asistencial (403) o sin pacientes.
  const [pacientesEdicion, setPacientesEdicion] = useState([]);
  const [showFacturarMes, setShowFacturarMes] = useState(false);
  const [morosidad, setMorosidad] = useState(null);
  const [mesMorosidad, setMesMorosidad] = useState(mesVigente());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  // Cuota compuesta desde el catálogo (31/08/2026, formación con Rosa): la
  // cuota puede llevar VARIOS conceptos (dos hermanos, cuota + descuento) y,
  // si la familia empieza a mitad de mes, la parte proporcional se calcula
  // sola (lib/billing/prorrateo.js). Los conceptos van por índice, no por Set:
  // el mismo concepto dos veces es legítimo (dos hermanos, misma cuota).
  // La fecha de inicio va POR CONCEPTO (31/08/2026, Rodrigo): empezó el 13
  // con logopedia y el 17 con psicología, y cada servicio paga lo suyo.
  const [conceptosCatalogo, setConceptosCatalogo] = useState([]);
  // `fin` desde el 10/09/2026: el tramo del mes tiene dos extremos. Ver el
  // «Acabó el» del cajón, más abajo.
  const [lineasCuota, setLineasCuota] = useState([]); // [{ id, inicio, fin }]
  /*
   * De dónde salió lo que hay puesto (04/09/2026): `{ fuente: "citas", citas: n,
   * mes }` cuando lo han dicho las CITAS de ese mes. Se enseña bajo los
   * conceptos porque un importe que aparece solo, sin decir de dónde sale, no se
   * puede ni confirmar ni corregir.
   */
  const [origenCuota, setOrigenCuota] = useState(null);
  /*
   * ── DE QUÉ CITA SE VIENE (10/09/2026, Rodrigo) ────────────────────────────
   *
   * «Cuando voy a pagar el mes desde la cita de Diagnóstico (60 min) va a pagar
   * automáticamente Pedagogía 60x1 en lugar de Diagnóstico de 650 euros.»
   *
   * El cajón rellenaba siempre con la cuota MENSUAL de la familia, así que daba
   * igual desde qué cita se hubiera pulsado «Cobrar». `citaOrigen` es la cita de
   * la que se viene (`?cita=` del enlace) y `cuotaDeLaCita` lo que se cobra por
   * ELLA cuando su cuota NO es de las mensuales de la familia: un diagnóstico,
   * un informe, una valoración. Entonces el cobro es SUELTO —no salda el
   * pendiente del mes ni se mide contra la cuota— y la pantalla lo dice.
   *
   * Se sueltan en cuanto se cambia de familia o de paciente a mano: a partir de
   * ahí ya no se está cobrando lo de esa cita.
   */
  const [citaOrigen, setCitaOrigen] = useState(null);
  const [cuotaDeLaCita, setCuotaDeLaCita] = useState(null); // { conceptId, fuente, nombre }
  /*
   * El reparto de un pago a cuenta (07/09/2026): qué meses cubre el dinero que
   * traen. Lo calcula el SERVIDOR (`GET /api/billing/payments/a-cuenta`) con la
   * misma función que luego lo guarda — si la pantalla hiciera su propia cuenta,
   * la vista previa y lo guardado podrían no coincidir, que es justo lo que no
   * se puede permitir cuando lo que se enseña es dinero de una familia.
   */
  const [reparto, setReparto] = useState(null);
  const [repartoCargando, setRepartoCargando] = useState(false);
  /*
   * Las citas de esa familia en ese mes (07/09/2026, AV-0068). Solo fechas, y
   * solo para que el prorrateo del mes de alta salga POR SESIONES, que es lo
   * que hace la generación: sin ellas, teclear la cuota daba un importe y
   * generarla otro.
   */
  const [citasDelMes, setCitasDelMes] = useState([]);
  /*
   * ── LA RESERVA DE PLAZA NO SE PRORRATEA (10/09/2026, Rodrigo) ─────────────
   *
   * «Debía 145 de logopedia. Hizo la reserva, por tanto se descontaron 30
   * euros. Como ha empezado tarde se ha partido en varias sesiones y debía
   * 108,75 − 30 de reserva. El CRM no ha contado la reserva.»
   *
   * Los 30 € que la familia adelantó en verano viven en la CUOTA
   * (`reservaAbonada`) y la generación mensual los resta ENTEROS después de
   * prorratear (`planDeCuotasDelMes`). Este cajón prorrateaba la tarifa del
   * catálogo y los dejaba por el camino: al teclear «Empezó el» proponía
   * 108,75 € donde el mes valía 78,75 €.
   *
   * Aquí se guarda lo que le queda por descontar a ESTE mes; la resta va donde
   * se calcula el importe y nunca deja el total por debajo de cero.
   */
  const [reservaDelMes, setReservaDelMes] = useState(0);

  const conceptosElegidos = lineasCuota
    .map(({ id, inicio, fin }) => {
      const c = conceptosCatalogo.find((c2) => String(c2.id) === String(id));
      return c ? { c, inicio, fin: fin ?? "" } : null;
    })
    .filter(Boolean);
  const cuentaCuota = partesConProrrateo(
    // Con el concepto de cada línea: la parte proporcional de una terapia se
    // cuenta con SUS sesiones y no con las del hermano ni las de la otra
    // terapia de la misma cuota (08/09/2026, Rosa).
    conceptosElegidos.map(({ c, inicio, fin }) => ({ importe: Number(c.unitPrice || 0), inicio, fin, conceptId: c.id })),
    { mes: form.periodMonth, citas: citasDelMes }
  );
  /*
   * Y menos la reserva de plaza ya abonada, entera y fuera del prorrateo: es la
   * misma cuenta que hace la generación del mes. Nunca por debajo de cero (una
   * cuota de 25 € con 30 € de reserva no se cobra en negativo).
   */
  const sinLaReserva = (total, reserva = reservaDelMes) => {
    const bruto = Number(total) || 0;
    const cabe = Math.min(Number(reserva) || 0, Math.max(0, bruto));
    return Math.max(0, Math.round((bruto - cabe) * 100) / 100);
  };
  const totalCuota = sinLaReserva(cuentaCuota.total);

  // El importe se rellena solo al tocar conceptos o fecha de inicio, desde el
  // HANDLER (no un efecto): así un importe retocado a mano solo se pisa cuando
  // el usuario vuelve a tocar la composición de la cuota.
  // Devuelve el total además de escribirlo: el efecto de abajo necesita el
  // importe ESPERADO del mes para restarle lo que ya se cobró (04/09/2026).
  function totalDeItems(items, reserva = reservaDelMes) {
    const partes = (items ?? [])
      .map(({ id, inicio, fin }) => {
        const c = conceptosCatalogo.find((c2) => String(c2.id) === String(id));
        return c ? { importe: Number(c.unitPrice || 0), inicio, fin: fin ?? "", conceptId: c.id } : null;
      })
      .filter(Boolean);
    if (!partes.length) return null;
    // `reserva` viaja a mano porque el efecto que carga las cuotas llama a esto
    // en el mismo turno en que la calcula: el estado todavía no se ha asentado.
    return sinLaReserva(partesConProrrateo(partes, { mes: form.periodMonth, citas: citasDelMes }).total, reserva);
  }
  function aplicarImporteCuota(items, reserva = reservaDelMes) {
    const total = totalDeItems(items, reserva);
    if (total === null) return null;
    setForm((f) => ({ ...f, amount: String(total) }));
    return total;
  }
  // Recomponer a mano vuelve al cálculo por catálogo: si venía un importe
  // pactado con la familia, deja de mandar (y el aviso de pantalla se va).
  function addConceptoCuota(id) {
    if (!id) return;
    const items = [...lineasCuota, { id, inicio: "", fin: "" }];
    setLineasCuota(items);
    setCuotaDeLaFamilia(null);
    aplicarImporteCuota(items);
  }
  function quitarConceptoCuota(idx) {
    const items = lineasCuota.filter((_, i) => i !== idx);
    setLineasCuota(items);
    setCuotaDeLaFamilia(null);
    aplicarImporteCuota(items);
  }
  // Las dos fechas del tramo por la misma puerta: «Empezó el» y «Acabó el»
  // hacen exactamente lo mismo por sus dos extremos (10/09/2026).
  function cambiarFechaConcepto(idx, campo, fecha) {
    const items = lineasCuota.map((it, i) => (i === idx ? { ...it, [campo]: fecha } : it));
    setLineasCuota(items);
    setCuotaDeLaFamilia(null);
    aplicarImporteCuota(items);
  }

  // ── LA CUOTA DE LA FAMILIA ELEGIDA ─────────────────────────────────────────
  //
  // Al cambiar de familia la composición se BORRA SIEMPRE y se vuelve a montar
  // desde cero (01/09/2026, Rodrigo: «cuando cambio de paciente se queda fija
  // la cuota del paciente anterior»). El fallo era salir por la puerta de atrás
  // —familia sin cuota conocida, o con conceptos que ya no existen— sin haber
  // limpiado antes: en pantalla se quedaban los conceptos Y EL IMPORTE del
  // paciente anterior, y ese importe es el que se cobra. Con 827 de las 1.087
  // fichas de Aumenta sin cuota conocida, tocaba a cada paso.
  //
  // De dónde sale, por este orden:
  //   1. Sus cuotas ASIGNADAS vigentes (`billing_cuotas`) — TODAS, no una: una
  //      familia puede tener una cuota por hijo, y entonces paga las dos. Es la
  //      única fuente que sabe el importe PACTADO con esa familia, que manda
  //      sobre la tarifa del catálogo.
  //   2. Si no tiene ninguna asignada, la aprendida del último cobro
  //      (`clients.cuota_concept_ids`), que es lo único que hay en las familias
  //      a las que nadie ha asignado cuota todavía.
  //
  // Se preguntan aquí —y no por `onFicha` del selector— para que no haya
  // carrera: la respuesta que llega tarde de una familia que ya no está
  // elegida se descarta por el turno. La aprendida solo se pide si NO tiene
  // cuota asignada, que es cuando de verdad se usa.
  const [cuotaDeLaFamilia, setCuotaDeLaFamilia] = useState(null); // { n, pactado, delPaciente }
  /*
   * ── A DÓNDE LLEVA «CAMBIAR EL IMPORTE» (10/09/2026, Rodrigo) ─────────────
   *
   * Qué cuotas tiene la familia, aparte de lo que se esté tecleando: esto NO se
   * borra al recomponer los conceptos a mano —`cuotaDeLaFamilia` sí, porque
   * deja de describir lo que hay en pantalla—, y el botón tiene que seguir ahí
   * justo cuando alguien está peleándose con el importe.
   *
   * Con UNA cuota lleva a su ficha (`?cuota=<id>`), que se abre sola al llegar.
   * Con varias no se puede adivinar cuál se quiere tocar, así que deja la lista
   * de Cuotas filtrada por el nombre de la familia y se elige a la vista. Sin
   * cuota conocida no hay botón: no habría nada que abrir.
   */
  const [cuotasFamilia, setCuotasFamilia] = useState(null); // { ids, nombre }
  const enlaceALaCuota = (() => {
    const ids = cuotasFamilia?.ids ?? [];
    if (ids.length === 1) return `/facturacion/cuotas?cuota=${encodeURIComponent(ids[0])}`;
    if (!ids.length) return null;
    const nombre = cuotasFamilia?.nombre;
    return nombre ? `/facturacion/cuotas?busca=${encodeURIComponent(nombre)}` : "/facturacion/cuotas";
  })();

  /*
   * ── LO QUE YA SE COBRÓ DE ESTE MES (04/09/2026, Rodrigo) ──────────────────
   * «Si alguien hace un pago parcial y se registra el cobro del pago parcial,
   * cuando se vuelva a registrar un cobro suyo en ese mismo mes debe salir el
   * resto del dinero automáticamente que debe.»
   *
   * El drawer rellenaba la cuota ENTERA mirara o no lo ya cobrado, así que con
   * los pagos partidos —constantes: la familia deja 50 € y trae el resto la
   * semana siguiente— había que restar a mano contra la lista de Cobros, y
   * cuando no se restaba se cobraba el mes dos veces. Qué cobros cuentan y por
   * qué el resto nunca es negativo, en `lib/billing/restoDelMes.js`.
   */
  const [parcialDelMes, setParcialDelMes] = useState(null); // { yaCobrado, resto, hayParcial, completo }
  // Los cobros PENDIENTES de cuota de ese mes (06/09/2026): al registrar, el
  // servidor los pasa a cobrados en vez de crear otro, y hay que decirlo antes
  // de pulsar — si no, la contable cree que va a salir una fila nueva.
  const [pendientesDelMes, setPendientesDelMes] = useState([]);
  /*
   * ── LO QUE EL CRM GENERÓ PARA ESE MES (08/09/2026, AV-0086) ────────────
   *
   * Rosa: «hago el cobro por el importe que refleja y luego crea otro por 30
   * €». No creaba ninguno —en todo septiembre no hay ni un cobro de 30 €—:
   * lo OFRECÍA, porque el mes cobrado se medía contra la TARIFA del catálogo
   * y no contra el cobro que el propio CRM había generado, que ya llevaba la
   * reserva de plaza descontada. Pasaba en 112 familias de septiembre y sumaba
   * 4.515 € ofrecidos que nadie debe.
   *
   * `cobradosDelMes` guarda esos cobros para poder enseñar sus motivos, y
   * `esperadoDeLaCuota` la tarifa contra la que se comparó, para decirlo sin
   * inventarse el porqué.
   */
  const [cobradosDelMes, setCobradosDelMes] = useState([]);
  const [esperadoDeLaCuota, setEsperadoDeLaCuota] = useState(null); // { tarifa, generado, pactado }
  /*
   * Lo que este mes se le cobró de OTRO servicio (10/09/2026, Rodrigo): la
   * entrevista inicial de Leo. No cuenta contra la cuota, pero se nombra: un
   * cobro que desaparece de la cuenta sin decir nada se lee como un cobro
   * perdido. Ver `lib/billing/restoDelMes.js`.
   */
  const [aparteDelMes, setAparteDelMes] = useState([]);

  /*
   * ── DE DÓNDE SALE CADA CIFRA (08/09/2026, AV-0085 y AV-0086) ─────────────
   *
   * El porqué de cada importe estaba escrito en la nota del cobro y no llegaba
   * a los ojos de quien cobra. `explicaCobro` parte esa nota en «concepto +
   * motivos»; el nombre del catálogo manda cuando el cobro trae `conceptId`
   * (122 de los 159 pendientes de septiembre lo traen) y la nota es el respaldo
   * para las cuotas compuestas, que nacen sin él a propósito.
   *
   * Nada de esto pega a la base: `conceptosCatalogo` ya está cargado.
   */
  const nombreDelConcepto = (conceptId) =>
    conceptosCatalogo.find((c) => String(c.id) === String(conceptId))?.name ?? null;
  const explicado = (p) => ({
    ...p,
    ...explicaCobro({ notes: p.notes, concepto: nombreDelConcepto(p.conceptId) }),
  });
  const pendientesExplicados = pendientesDelMes.map(explicado);
  const cobradosExplicados = cobradosDelMes.filter((c) => c.deCuota).map(explicado);
  const aparteExplicados = aparteDelMes.map(explicado);
  const sumaAparte =
    Math.round(aparteDelMes.reduce((s, c) => s + Number(c.amount || 0), 0) * 100) / 100;
  const sumaPendientes =
    Math.round(pendientesDelMes.reduce((t, p) => t + Number(p.amount || 0), 0) * 100) / 100;

  /*
   * ── EL MES PASA A VALER LO QUE SE ACABA DE PRORRATEAR (10/09/2026) ────────
   *
   * Con «Empezó el» (o «Acabó el») puesto, este importe NO es «una parte de lo
   * que la familia debe»: es lo que ese mes cuesta de verdad. El cobro que el
   * CRM generó el día 1 no podía saberlo —la cuota empieza el 1 y nadie le dijo
   * que el paciente entró el 10—, así que pide de más.
   *
   * Si se cobra sin corregirlo, la fila se PARTE (`cobroParcial.js`) y queda
   * pendiente una diferencia que nadie debe: eso es lo que dejó a cinco
   * familias de Aumenta debiendo entre 6,25 € y 95 € en septiembre. Va al
   * servidor como `importeDelMes` y allí se corrige el pendiente ANTES de
   * cobrarlo.
   */
  const mesProrrateado =
    form.modo === "cuota" && !cuotaDeLaCita && cuentaCuota.hayProrrateo && totalCuota > 0 ? totalCuota : null;
  // Solo a la baja, igual que el servidor: un tramo tecleado corrige de menos
  // lo que se pidió de más, pero nunca le sube sola la deuda a una familia.
  const corrigeElPendiente =
    mesProrrateado != null &&
    pendientesDelMes.length === 1 &&
    sumaPendientes - mesProrrateado >= 0.005;
  const loQuePideElMes = corrigeElPendiente ? mesProrrateado : sumaPendientes;

  /*
   * ── SI TRAEN MENOS, EL RESTO SE QUEDA PENDIENTE (10/09/2026, Rodrigo: «si me
   *    pagan la mitad, debería quedar pendiente de pago lo restante») ─────────
   *
   * Con un cobro pendiente detrás esto ya lo hace el servidor: la fila se parte
   * y el resto sigue pendiente (`lib/billing/cobroParcial.js`), y entonces aquí
   * no hay nada que preguntar. Lo que faltaba es el otro camino, que es el de
   * todo lo que no viene de una cuota generada: un diagnóstico de 650 € del que
   * traen 325, o el primer mes de una familia recién dada de alta. Ahí el cobro
   * se guardaba por lo que traían y lo que faltaba no quedaba en ninguna parte.
   *
   * `loQueTocaba` es contra lo que se compara: el resto del mes si ya había algo
   * cobrado, o la suma de los conceptos que hay puestos.
   */
  const loQueTocaba = (() => {
    if (form.modo !== "cuota") return 0;
    // Ya había algo cobrado este mes: lo que falta ya está calculado, y con el
    // importe de verdad (el generado, el pactado o la tarifa).
    if (parcialDelMes && !parcialDelMes.completo && parcialDelMes.resto > 0) return parcialDelMes.resto;
    /*
     * EL PRECIO PACTADO MANDA SOBRE EL CATÁLOGO. Sin esto, una familia con
     * 175 € pactados y 190 € de tarifa salía debiendo 15 € en CADA cobro
     * normal: la casilla se ofrecía sola por la diferencia. Se vio en la demo
     * a la primera prueba.
     */
    if (esperadoDeLaCuota?.pactado && esperadoDeLaCuota.tarifa != null) return esperadoDeLaCuota.tarifa;
    // Si no, lo que suman los conceptos que se están viendo, con su prorrateo:
    // es lo que el usuario tiene delante y lo que puede corregir con la ✕.
    return Number(totalCuota) || 0;
  })();
  const restoQueQueda = restoQueSeQuedaPendiente({
    esperado: loQueTocaba,
    importe: form.amount,
    // Con un pendiente detrás lo parte el servidor; con un cobro suelto de una
    // cita, ese pendiente es de la mensualidad y no cuenta contra esto.
    hayPendiente: !cuotaDeLaCita && pendientesDelMes.length > 0,
  });
  // Puesto de serie: es lo que pidió que pasara. Se puede quitar para el cobro
  // de menos que se pactó (un descuento, una sesión que no se cobra).
  const [dejarResto, setDejarResto] = useState(true);

  /*
   * Los pacientes de la familia elegida (01/09/2026, Rodrigo: «cuando un tutor
   * tiene dos pacientes y cada uno está en una cuota distinta, al poner a uno
   * me salen las dos»). Se piden aparte de las cuotas porque contestan a
   * preguntas distintas —quiénes son sus hijos vs. qué paga— y porque el
   * módulo asistencial puede no estar: entonces esto vuelve vacío (403) y el
   * selector no se enseña, como hasta hoy.
   */
  useEffect(() => {
    if (form.modo !== "cuota" || !form.clientId) { setPacientesFamilia([]); return; }
    let vivo = true;
    fetch(`/api/pacientes?clientId=${encodeURIComponent(form.clientId)}&limit=100`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setPacientesFamilia(j?.data?.patients ?? []); })
      .catch(() => { if (vivo) setPacientesFamilia([]); });
    return () => { vivo = false; };
  }, [form.clientId, form.modo]);

  // La vista previa del pago a cuenta, con un respiro para no pedirla en cada
  // tecla del importe.
  useEffect(() => {
    if (form.modo !== "cuenta" || !form.clientId || !(Number(form.amount) > 0)) { setReparto(null); return; }
    let vivo = true;
    setRepartoCargando(true);
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ clientId: form.clientId, importe: String(Number(form.amount)) });
      if (/^\d{4}-\d{2}$/.test(form.periodMonth)) qs.set("desde", form.periodMonth);
      fetch(`/api/billing/payments/a-cuenta?${qs}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (vivo) setReparto(j?.ok ? j.data : null); })
        .catch(() => { if (vivo) setReparto(null); })
        .finally(() => { if (vivo) setRepartoCargando(false); });
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [form.modo, form.clientId, form.amount, form.periodMonth]);

  const turnoCuota = useRef(0);
  useEffect(() => {
    if (form.modo !== "cuota") return;
    const turno = ++turnoCuota.current;
    // Primero limpiar, siempre: más vale el importe en blanco que el de otra familia.
    setLineasCuota([]);
    setCuotaDeLaFamilia(null);
    setCuotasFamilia(null);
    setOrigenCuota(null);
    setCuotaDeLaCita(null);
    setParcialDelMes(null);
    setPendientesDelMes([]);
    setCobradosDelMes([]);
    setEsperadoDeLaCuota(null);
    setAparteDelMes([]);
    setCitasDelMes([]);
    setReservaDelMes(0);
    setForm((f) => (f.amount === "" ? f : { ...f, amount: "" }));
    if (!form.clientId || !conceptosCatalogo.length) return;

    const pedir = (url) =>
      fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    (async () => {
      const jCuotas = await pedir(`/api/billing/cuotas?clientId=${encodeURIComponent(form.clientId)}`);
      if (turno !== turnoCuota.current) return; // ya hay otra familia elegida
      const todas = jCuotas?.data?.cuotas ?? [];
      /*
       * CON PACIENTE ELEGIDO, SOLO LA SUYA (01/09/2026, Rodrigo). Un tutor con
       * dos hijos en cuotas distintas veía las dos sumadas aunque estuviera
       * cobrando lo de uno: el importe salía del doble. La regla —y qué pasa
       * cuando NINGUNA cuota es del paciente— vive en `cuotaParaRellenar.js`,
       * con su prueba; Facturas ya la usaba.
       */
      const cuotas = cuotasQueEntran(todas, form.patientId);
      // Lo que la reserva de plaza ya abonada le quita a este mes (10/09/2026).
      const reserva = reservaDeLasCuotas(cuotas, form.periodMonth);
      setReservaDelMes(reserva);
      // Aparte y para el botón «Cambiar el importe»: ver `enlaceALaCuota`.
      setCuotasFamilia(
        cuotas.length
          ? { ids: cuotas.map((c) => String(c.id)), nombre: cuotas[0]?.client?.name ?? null }
          : null
      );
      let ids = conceptosDeCuotas(cuotas);
      /*
       * Y CON SUS FECHAS (10/09/2026, Rodrigo). La cuota de Leo empieza el 10
       * de septiembre y así está guardada: el cajón pedía 145 € de un mes que
       * vale 116 € porque el prorrateo solo saltaba si alguien se acordaba de
       * teclear «Empezó el». Va en el mismo orden que `ids` y solo trae las
       * fechas que prorratean de verdad (`tramosDeCuotas`).
       */
      let tramos = tramosDeCuotas(cuotas, form.periodMonth);
      let deLasCitas = null;
      /*
       * ── LO QUE DICEN SUS CITAS DE ESE MES (04/09/2026, Aumenta) ───────────
       *
       * Desde que cada cita nace atada a una cuota, el mes que se está cobrando
       * ya sabe lo que lleva: se pregunta a la agenda en vez de reconstruirlo.
       * Va DESPUÉS de la cuota asignada —que es lo pactado con la familia y
       * manda— y ANTES de la cuota «aprendida» del último cobro, que es una
       * suposición a partir del pasado: si en octubre empezó logopedia, las
       * citas de octubre lo saben y el cobro de septiembre no.
       */
      /*
       * Y SE PREGUNTA TAMBIÉN CUANDO SE VIENE DE UNA CITA (10/09/2026): no para
       * rellenar el mes, sino para saber qué se cobra por ESA cita. Es la misma
       * ruta y el mismo viaje.
       */
      let suelta = null;
      if (!cuotas.length || citaOrigen) {
        const jCitas = await pedir(
          `/api/citas/cobro-del-mes?clientId=${encodeURIComponent(form.clientId)}` +
            `&mes=${encodeURIComponent(form.periodMonth)}` +
            (form.patientId ? `&patientId=${encodeURIComponent(form.patientId)}` : "") +
            (citaOrigen ? `&booking=${encodeURIComponent(citaOrigen)}` : "")
        );
        if (turno !== turnoCuota.current) return;
        const conCuota = (jCitas?.data?.cuotas ?? []).filter((l) => l.conceptId);
        if (!cuotas.length && conCuota.length) {
          ids = conCuota.map((l) => l.conceptId);
          deLasCitas = { fuente: "citas", citas: jCitas?.data?.citas ?? 0, mes: form.periodMonth };
        }
        /*
         * LA CUOTA DE ESA CITA MANDA CUANDO NO ES UNA DE LAS MENSUALES. Un
         * diagnóstico de 650 € no está en la cuota de pedagogía de la familia,
         * y es lo que se viene a cobrar. Si SÍ está (se pulsó «Cobrar» en una
         * sesión de su terapia de siempre), no se toca nada: se cobra el mes,
         * que es lo de antes.
         */
        const laCita = jCitas?.data?.deLaCita ?? null;
        const enCatalogo = laCita
          ? conceptosCatalogo.find((c) => String(c.id) === String(laCita.conceptId))
          : null;
        if (enCatalogo && !ids.some((id) => String(id) === String(laCita.conceptId))) {
          ids = [String(laCita.conceptId)];
          deLasCitas = null;
          tramos = null; // un diagnóstico no es el mes de la cuota: no se prorratea
          suelta = { conceptId: String(laCita.conceptId), fuente: laCita.fuente, nombre: enCatalogo.name };
        }
      }
      setCuotaDeLaCita(suelta);
      // El respaldo es para quien NO tiene cuota asignada. Una cuota asignada
      // con importe pero sin conceptos manda igual: rellenarla con lo que se
      // le cobró hace meses sería contar otra historia.
      if (!cuotas.length && !deLasCitas && !suelta) {
        const jFicha = await pedir(`/api/billing/fichas?id=${encodeURIComponent(form.clientId)}`);
        if (turno !== turnoCuota.current) return;
        ids = Array.isArray(jFicha?.data?.cuotaConceptIds) ? jFicha.data.cuotaConceptIds : [];
      }
      setOrigenCuota(deLasCitas);

      const items = ids
        .map((id, i) => ({ id: String(id), inicio: "", fin: "", ...(tramos?.[i] ?? {}) }))
        .filter((it) => conceptosCatalogo.some((c) => String(c.id) === String(it.id)));
      setLineasCuota(items);

      // El importe pactado (`amount` escrito en la cuota) manda sobre la suma
      // del catálogo: es el precio acordado con esa familia. Solo se toma si
      // TODAS sus cuotas lo tienen escrito; mezclado con las que van «a lo que
      // digan sus conceptos» no se puede sumar sin mentir, y ahí manda el
      // catálogo — que es lo que el usuario ve línea a línea.
      // Con un cobro suelto de una cita NO manda el pactado: lo pactado es la
      // mensualidad, y esto es un diagnóstico. Su precio es el del catálogo.
      const pactado = suelta ? null : importePactado(cuotas);
      let esperado;
      if (pactado !== null) { esperado = pactado; setForm((f) => ({ ...f, amount: String(pactado) })); }
      else esperado = aplicarImporteCuota(items, reserva);

      /*
       * Y AHORA SE LE RESTA LO QUE YA ENTRÓ ESTE MES. Va al final a propósito:
       * primero se sabe cuánto es la cuota (pactada o de catálogo) y solo
       * entonces se puede decir qué falta. Best-effort — si la consulta falla,
       * queda el importe entero, que es lo que había antes de hoy.
       */
      const jMes = await pedir(
        `/api/billing/payments/mes?clientId=${encodeURIComponent(form.clientId)}` +
          `&mes=${encodeURIComponent(form.periodMonth)}` +
          (form.patientId ? `&patientId=${encodeURIComponent(form.patientId)}` : "")
      );
      if (turno !== turnoCuota.current) return;
      // Las citas llegan aquí, antes de que nadie pueda teclear un «Empezó
      // el»: el prorrateo solo salta al escribir esa fecha (AV-0068).
      setCitasDelMes(Array.isArray(jMes?.data?.citas) ? jMes.data.citas : []);
      const cobrosDelMes = jMes?.data?.cobros ?? [];
      setCobradosDelMes(cobrosDelMes);
      // La misma regla que el POST de payments: con paciente elegido, solo los
      // pendientes de ese paciente; sin él, todos los de la familia.
      const pendientes = (jMes?.data?.pendientes ?? []).filter(
        (p) => !form.patientId || String(p.patientId || "") === String(form.patientId)
      );
      setPendientesDelMes(pendientes);

      /*
       * ── EL COBRO GENERADO MANDA (08/09/2026, AV-0086) ────────────────────
       *
       * Si el CRM ya generó el cobro de este mes, ESE es el importe de verdad:
       * lleva dentro el prorrateo, el precio pactado y la reserva de plaza
       * descontada. Medir contra la tarifa del catálogo es lo que hacía ofrecer
       * un resto que nadie debe.
       *
       * Pero solo si CUBRE todas las cuotas de la familia. Si de dos cuotas el
       * CRM solo generó una, medir contra esa mitad le diría «este mes ya está
       * cobrado entero» a quien debe la otra terapia. Sin cobertura se queda la
       * tarifa, que es lo de siempre, y la pantalla lo dice.
       */
      /*
       * NADA DE ESTO VALE PARA UN COBRO SUELTO (10/09/2026). Lo cobrado y lo
       * pendiente del mes son de la CUOTA MENSUAL; medir contra ellos los
       * 650 € de un diagnóstico diría «ya cobrado este mes: 145 €, queda 505»,
       * que no es ni verdad ni entendible. El importe se queda en el del
       * catálogo y la pantalla explica que esto va aparte.
       */
      if (suelta) {
        setParcialDelMes(null);
        setEsperadoDeLaCuota(null);
        if (cuotas.length) {
          setCuotaDeLaFamilia({
            n: cuotas.length,
            pactado: importePactado(cuotas),
            delPaciente: Boolean(form.patientId) && cuotas.length < todas.length,
            deLaFamiliaEntera: Boolean(form.patientId) && cuotas.every((c) => !c.patientId),
          });
        }
        return;
      }

      const tarifaDelCatalogo = esperado;
      const generado = generadoDelMes([...cobrosDelMes, ...pendientes], form.patientId || null);
      const cubre = generado != null && cuotas.length > 0 && generado.cuotas >= cuotas.length;
      if (cubre) esperado = generado.importe;
      setEsperadoDeLaCuota({
        tarifa: Number(tarifaDelCatalogo) > 0 ? Number(tarifaDelCatalogo) : null,
        generado: cubre ? generado.importe : null,
        pactado: pactado !== null,
        cuotasSinGenerar: generado != null && cuotas.length > 0 ? Math.max(0, cuotas.length - generado.cuotas) : 0,
      });

      /*
       * Y SOLO LO QUE PAGA ESTA CUOTA (10/09/2026): los 50 € de una entrevista
       * inicial son de otro servicio y no van saldando la mensualidad.
       */
      const conceptosDelCobro = items.map((it) => it.id);
      setAparteDelMes(cobrosDeOtroServicio(cobrosDelMes, form.patientId || null, conceptosDelCobro));
      const parcial = restoDelMes({
        esperado,
        cobros: cobrosDelMes,
        patientId: form.patientId || null,
        conceptIds: conceptosDelCobro,
      });
      if (pendientes.length) {
        // EL PENDIENTE MANDA (06/09/2026). Ese cobro ya lleva su importe de
        // verdad —prorrateado, pactado o el de la tarifa—, así que se propone
        // él (o la suma, que es lo único que cobra varios a la vez) y no la
        // resta contra la cuota entera, que con un taller empezado a mitad de
        // mes daba 127,50 € para un pendiente de 120 €.
        const suma = Math.round(pendientes.reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;
        setParcialDelMes(null);
        setForm((f) => ({ ...f, amount: String(suma) }));
      } else {
        // Solo con una cuota conocida (06/09/2026): sin importe esperado, «queda
        // 0,00 €» con el campo en blanco era un aviso que mentía.
        setParcialDelMes(Number(esperado) > 0 && parcial.yaCobrado > 0 ? parcial : null);
        // Solo se pisa el importe cuando hay algo que restar. Si el mes ya está
        // cubierto NO se rellena un 0 —el formulario no lo aceptaría y no se
        // entendería—: se deja vacío y el aviso de abajo lo explica.
        if (parcial.hayParcial) setForm((f) => ({ ...f, amount: String(parcial.resto) }));
        else if (parcial.completo) setForm((f) => ({ ...f, amount: "" }));
      }
      // (Sin `return` aquí: lo de abajo pinta «la cuota de la familia» y tiene
      // que correr también con pendiente; un atajo dejó el cajón diciendo
      // «Sin cuota asignada» a una familia con cuatro cuotas.)
      if (cuotas.length) {
        setCuotaDeLaFamilia({
          n: cuotas.length,
          pactado,
          // Si se ha dejado fuera alguna cuota de la familia, decirlo: es lo que
          // explica por qué no sale lo del hermano.
          delPaciente: Boolean(form.patientId) && cuotas.length < todas.length,
          /*
           * Y si con un paciente elegido lo que sale es la cuota SIN paciente
           * —la de la familia entera, 35 de las 279 de Aumenta—, también hay
           * que decirlo (04/09/2026): si no, se lee como «esta es la cuota de
           * este niño» y puede llevar dentro las terapias de sus hermanos.
           */
          deLaFamiliaEntera: Boolean(form.patientId) && cuotas.every((c) => !c.patientId),
        });
      }
    })();
  }, [form.clientId, form.patientId, form.modo, form.periodMonth, conceptosCatalogo, citaOrigen]); // eslint-disable-line react-hooks/exhaustive-deps

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Ver el efecto que escribe la dirección: la primera pasada no escribe.
  const primeraUrl = useRef(true);
  const [filterMethod, setFilterMethod] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  /*
   * Entre dos fechas, igual que en Gastos (10/09/2026, Rodrigo). El endpoint ya
   * entendía `from`/`to` sobre `paidAt` —de ahí los sacaba el Excel—, pero la
   * pantalla no los ofrecía: para saber lo cobrado del 1 al 15 había que bajarse
   * el Excel o sumar a ojo. Filtra por el DÍA DEL COBRO, no por el mes al que
   * corresponde la cuota.
   */
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const { sortKey, sortDir, toggle: toggleSort } = useSortState("paidAt", "desc");

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // «Cobrar» desde el menú contextual de la agenda (31/08/2026) y «Cobrar mes»
  // desde la ficha de la cita (03/09/2026): llega como
  // /facturacion/cobros?abrir=cuota&cliente=<id>[&paciente=<id>][&mes=AAAA-MM]
  // y el drawer se abre solo en modo cuota con la familia, el paciente y el
  // MES DE LA CITA puestos (el enlace lo arma lib/citas/cobrarMes.js). Sin
  // `mes` se queda el vigente, que es lo de siempre. window.location y no
  // useSearchParams: se lee UNA vez al montar y no obliga a suspender la página.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("abrir") !== "cuota") return;
    const clientId = sp.get("cliente") || "";
    const patientId = sp.get("paciente") || "";
    const mes = sp.get("mes") || "";
    // De qué CITA se viene (10/09/2026): lo que se cobra por ella puede no ser
    // la cuota mensual de la familia. Ver `cuotaDeLaCita`.
    if (clientId && sp.get("cita")) setCitaOrigen(sp.get("cita"));
    setForm((f) => ({
      ...f,
      modo: "cuota",
      clientId: clientId || f.clientId,
      patientId: clientId ? patientId : f.patientId,
      periodMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : f.periodMonth,
    }));
    setShowForm(true);
  }, []);

  /*
   * ── LA PANTALLA SE GUARDA EN SU DIRECCIÓN (09/09/2026) ───────────────────
   * Rosa: «interesante sería poder mantener una parte de CRM abierta mientras
   * consultas algo (ej. incidencia sin salirte poder abrir otro menú)». El caso
   * es el de recepción: estás en Cobros con una familia delante, te preguntan
   * por una incidencia y, para mirarla, pierdes lo que tenías puesto.
   *
   * Con el buscador, los filtros y el mes de la morosidad escritos en la
   * dirección pasan dos cosas, y las dos son justo lo que ella pedía:
   *
   *   · el botón de ATRÁS del navegador te devuelve la pantalla tal como la
   *     dejaste, no en blanco;
   *   · Ctrl+clic en cualquier entrada del menú abre lo otro en una pestaña
   *     nueva y esta se queda intacta, con su filtro puesto.
   *
   * `replaceState` y no `push`: escribir cada tecla en el historial dejaría el
   * botón de atrás inservible, que es lo contrario de lo que se busca.
   *
   * No toca el enlace de «Cobrar el mes» que llega con `abrir=cuota`: ese lo lee
   * el efecto de arriba UNA vez al montar, y para entonces esto aún no ha
   * escrito nada.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    /*
     * ⚠️ LA PRIMERA PASADA NO ESCRIBE, Y ES LO QUE HACE QUE ESTO FUNCIONE.
     * Al montar, este efecto corre con el estado todavía en blanco, así que
     * escribiría una dirección VACÍA encima de la que traía los filtros — y el
     * efecto de al lado, que es quien los lee, ya no encontraría nada. Visto
     * pasar en producción: entrar con `?q=vega` dejaba la URL pelada y el
     * buscador en blanco. Se salta esa pasada y se escribe de la segunda en
     * adelante, cuando el estado ya es el de verdad.
     */
    if (primeraUrl.current) { primeraUrl.current = false; return; }
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("abrir")) return; // llegó con una orden; no se pisa
    const pon = (k, v) => (v ? sp.set(k, v) : sp.delete(k));
    pon("q", searchInput.trim());
    pon("metodo", filterMethod);
    pon("estado", filterStatus);
    pon("desde", filterFrom);
    pon("hasta", filterTo);
    pon("morosidad", mesMorosidad === mesVigente() ? "" : mesMorosidad);
    const cadena = sp.toString();
    window.history.replaceState(null, "", cadena ? `?${cadena}` : window.location.pathname);
  }, [searchInput, filterMethod, filterStatus, filterFrom, filterTo, mesMorosidad]);

  // …y se lee al entrar, que es la otra mitad: sin esto la dirección guardada
  // no serviría de nada al abrirla en una pestaña nueva.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("q");
    if (q) { setSearchInput(q); setSearch(q.trim().toLowerCase()); }
    if (sp.get("metodo")) setFilterMethod(sp.get("metodo"));
    if (sp.get("estado")) setFilterStatus(sp.get("estado"));
    // Con el formato comprobado: un `?desde=ayer` dejaría el recuadro en blanco
    // (el navegador no lo pinta) pero el filtro viajaría igual al servidor.
    const dia = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
    if (dia(sp.get("desde"))) setFilterFrom(sp.get("desde"));
    if (dia(sp.get("hasta"))) setFilterTo(sp.get("hasta"));
    const m = sp.get("morosidad");
    if (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) setMesMorosidad(m);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    // Las fichas ya no se bajan aquí (28/08/2026). Este `limit=300` recibía 200,
    // porque /api/clients corta por su cuenta: con las 1.083 de Aumenta se
    // quedaban fuera 883 familias y no había forma de llegar a ellas. Ahora
    // pregunta SelectorCliente al servidor según se escribe.
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({ limit: 100, sortBy: sortKey, sortDir });
      if (filterMethod) params.set("method", filterMethod);
      if (filterStatus) params.set("status", filterStatus);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);
      // La búsqueda va al SERVIDOR (31/08/2026): filtrar aquí solo veía los
      // 100 cargados y un cobro antiguo no aparecía por mucho que se buscara.
      if (search) params.set("q", search);
      const res = await fetch(`/api/billing/payments?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setPayments(json.data?.payments ?? []);
      setTotales(json.data?.totales ?? null);
    } catch (e) {
      setErrorMsg(e.message);
    } finally { setLoading(false); }
  }, [sortKey, sortDir, filterMethod, filterStatus, filterFrom, filterTo, search]);

  useEffect(() => { load(); }, [load]);

  // Cargar facturas pendientes para el selector
  useEffect(() => {
    if (!showForm) return;
    Promise.all([
      fetch("/api/billing/invoices?status=issued&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=sent&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=partially_paid&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=overdue&limit=100", { cache: "no-store" }).then((r) => r.json()),
    ]).then((results) => {
      const merged = [];
      for (const r of results) merged.push(...(r.data?.invoices ?? []));
      // Ordenar por fecha desc
      merged.sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));
      setUnpaidInvoices(merged);
    }).catch(() => {});
  }, [showForm]);

  // El catálogo de conceptos, para componer la cuota. Si está vacío o el
  // fetch falla, el bloque no se enseña y el formulario queda como siempre:
  // importe a mano.
  useEffect(() => {
    if (!showForm) return;
    fetch("/api/billing/conceptos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setConceptosCatalogo(j.data?.conceptos ?? []))
      .catch(() => {});
  }, [showForm]);

  // Al abrir la edición de un cobro SIN factura, se cargan las facturas
  // abiertas de su cliente para el desplegable de «Asociar a factura». Solo
  // las suyas: asociar a la de otro cliente lo rechaza igualmente el PATCH.
  useEffect(() => {
    if (!editing || editing.invoice?.id || !editing.clientId) { setFacturasCliente([]); return; }
    Promise.all(
      ["issued", "sent", "partially_paid", "overdue"].map((st) =>
        fetch(`/api/billing/invoices?clientId=${editing.clientId}&status=${st}&limit=100`, { cache: "no-store" }).then((r) => r.json())
      )
    ).then((results) => {
      const merged = [];
      for (const r of results) merged.push(...(r.data?.invoices ?? []));
      merged.sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));
      setFacturasCliente(merged);
    }).catch(() => setFacturasCliente([]));
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editing || editing.invoice?.id || !editing.clientId) { setPacientesEdicion([]); return; }
    let vivo = true;
    fetch(`/api/pacientes?clientId=${encodeURIComponent(editing.clientId)}&limit=100`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setPacientesEdicion(j?.data?.patients ?? []); })
      .catch(() => { if (vivo) setPacientesEdicion([]); });
    return () => { vivo = false; };
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // method y status se filtran en backend; aquí solo búsqueda libre por texto
  // La búsqueda ya la hizo el SERVIDOR (31/08/2026, lib/billing/busquedaCobros):
  // volver a filtrar aquí solo podía QUITAR resultados que el servidor sí
  // encontró (p. ej. por el nombre del cliente de la factura, que esta lista
  // no siempre trae plano).
  const filtered = payments;

  // El total lo dice el servidor sobre TODO lo que casa con el filtro
  // (07/09/2026); la suma de las filas cargadas es solo la caída de un
  // servidor viejo sin `totales`.
  const totalCollected = useMemo(
    () => (totales && Number.isFinite(Number(totales.cobrado))
      ? Number(totales.cobrado)
      : filtered.filter((p) => p.status === "completed").reduce((s, p) => s + Number(p.amount || 0), 0)),
    [filtered, totales]
  );

  const loadMorosidad = useCallback(() => {
    fetch(`/api/billing/morosidad?mes=${mesMorosidad}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMorosidad(j?.data ?? null))
      .catch(() => {});
  }, [mesMorosidad]);

  useEffect(() => { loadMorosidad(); }, [loadMorosidad]);

  /*
   * ── EL BUSCADOR TAMBIÉN MUEVE LA MOROSIDAD (09/09/2026) ──────────────────
   * Rosa: «NO FUNCIONA EL BUSCADOR». Y era verdad a medias: el buscador de
   * arriba filtra los COBROS —viaja en su petición— y la morosidad se pide
   * aparte, así que escribir un apellido no cambiaba ni una de sus filas. Con
   * 683 familias en esa lista, buscar a una era bajar por todas.
   *
   * Se filtra aquí y no en el servidor porque la lista llega entera (no se
   * pagina): es instantáneo y no cuesta una petición por letra.
   */
  const morososFiltrados = useMemo(
    () => filtrarMorosos(morosidad?.morosos ?? [], search),
    [morosidad, search]
  );
  const { conCuota: debenConCuota, sinCuota: debenSinCuota } = useMemo(
    () => repartirMorosos(morososFiltrados),
    [morososFiltrados]
  );
  const textoMorosidad = useMemo(
    () => resumenDeMorosidad({
      conCuota: debenConCuota,
      sinCuota: debenSinCuota,
      alDia: morosidad?.alDia ?? 0,
      familias: morosidad?.familias ?? 0,
    }),
    [debenConCuota, debenSinCuota, morosidad]
  );

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const porFactura = form.modo === "factura";
      if (porFactura && !form.invoiceId) throw new Error("Selecciona una factura");
      if (!porFactura && !form.clientId) throw new Error("Selecciona el cliente que ha pagado");
      if (!form.method) throw new Error("Di por dónde ha entrado el dinero: efectivo, tarjeta, banco o domiciliación");

      /*
       * A CUENTA: no es un cobro, son varios —uno por mes—, así que va por su
       * propia ruta. El servidor rehace el reparto antes de guardar (la vista
       * previa es de ayuda, no es la orden) y se niega entero si el importe no
       * cubre meses completos.
       */
      if (form.modo === "cuenta") {
        const res = await fetch("/api/billing/payments/a-cuenta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: form.clientId,
            amount: Number(form.amount),
            method: form.method,
            paidAt: form.paidAt,
            desde: /^\d{4}-\d{2}$/.test(form.periodMonth) ? form.periodMonth : null,
            notes: form.notes.trim() || null,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo repartir el pago a cuenta");
        setForm((f) => ({ ...f, clientId: "", patientId: "", amount: "", notes: "" }));
        setReparto(null);
        setShowForm(false);
        load();
        loadMorosidad();
        return;
      }
      // Qué conceptos componen la cuota (y el prorrateo de cada uno, si lo
      // hay) queda escrito en la nota del cobro: es lo que Rosa lee meses
      // después.
      const notaConceptos = !porFactura && conceptosElegidos.length
        ? `Cuota: ${conceptosElegidos
            .map(({ c }, i) => {
              const r = cuentaCuota.partes[i]?.rotulo;
              return r ? `${c.name} (${r})` : c.name;
            })
            .join(" + ")}`
        : "";
      const res = await fetch("/api/billing/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: porFactura ? form.invoiceId : null,
          clientId: porFactura ? null : form.clientId,
          // De quién es la cuota que se cobra. `payments.patient_id` ya existía
          // (31/08/2026) y lo rellenaba solo la generación mensual; el cobro a
          // mano lo dejaba a NULL aunque se supiera de quién era.
          patientId: porFactura ? null : form.patientId || null,
          periodMonth: porFactura ? null : form.periodMonth,
          amount: Number(form.amount),
          method: form.method,
          paidAt: form.paidAt,
          // Con un cobro pendiente detrás, ese cobro conserva su propia nota
          // («Cuota septiembre 2026 — Psicología…»): solo viaja lo escrito a
          // mano. La composición de conceptos es para el cobro que nace aquí.
          notes: pendientesDelMes.length
            ? form.notes.trim() || null
            : [notaConceptos, form.notes].filter(Boolean).join(" — ") || null,
          // La terapia del cobro, para que «Facturar el mes» pueda agrupar por
          // concepto: solo cuando la cuota es de UN concepto (una compuesta no
          // se puede partir por terapia).
          conceptId: !porFactura && conceptosElegidos.length === 1 ? conceptosElegidos[0].c.id : null,
          // La composición entera, para que la ficha APRENDA su cuota: lo que
          // se le acaba de cobrar es lo que se le rellenará el mes que viene.
          // Un cobro SUELTO de una cita no se aprende (10/09/2026): cobrarle un
          // diagnóstico una vez no convierte el diagnóstico en su mensualidad.
          conceptIds:
            !porFactura && !cuotaDeLaCita && conceptosElegidos.length
              ? conceptosElegidos.map(({ c }) => c.id)
              : null,
          // Esto es lo de UNA cita y no la cuota del mes (un diagnóstico, un
          // informe): que no dé por cobrado el pendiente de la mensualidad.
          suelto: Boolean(cuotaDeLaCita),
          /*
           * LO QUE VALE EL MES cuando se acaba de prorratear aquí (10/09/2026):
           * el servidor corrige con esto el cobro pendiente antes de cobrarlo,
           * para que no se quede a deber una diferencia que no existe.
           */
          importeDelMes: mesProrrateado,
          // Y lo que falta, si falta y se quiere reclamar.
          restoPendiente: !porFactura && dejarResto && restoQueQueda > 0 ? restoQueQueda : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setForm((f) => ({ ...f, invoiceId: "", clientId: "", patientId: "", amount: "", notes: "" }));
      setLineasCuota([]);
      setCitaOrigen(null);
      setDejarResto(true);
      setShowForm(false);
      load();
      loadMorosidad();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      // Lo mismo que comprueba el PATCH, dicho aquí para no gastar una ida y
      // vuelta: sin método, un cobro cobrado no cae en ninguna cesta del arqueo.
      if (exigeMetodo(editing.status) && !editing.method) {
        throw new Error("Di por dónde ha entrado el dinero: efectivo, tarjeta, banco o domiciliación");
      }
      const res = await fetch(`/api/billing/payments/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(editing.amount),
          method: editing.method,
          paidAt: editing.paidAt,
          notes: editing.notes || null,
          status: editing.status,
          // La clave solo viaja si se ELIGIÓ factura: mandarla vacía sería
          // pedirle al PATCH que desasocie.
          ...(editing.asociarFacturaId ? { invoiceId: editing.asociarFacturaId } : {}),
          // El mes y el paciente solo en el cobro de cuota (sin factura); vacío
          // = quitarlo. La fecha de la devolución solo si está devuelto: el
          // servidor la borra al salir de ese estado (07/09/2026).
          ...(editing.invoice?.id ? {} : { periodMonth: editing.periodMonth || null, patientId: editing.patientId || null }),
          ...(editing.status === "refunded" && editing.refundedAt ? { refundedAt: editing.refundedAt } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo guardar");
      setEditing(null);
      load();
      loadMorosidad();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Eliminar un cobro (01/09/2026, Rodrigo: «debería poder editar un cobro o
   * revertirlo si quiero»).
   *
   * SE LLAMA «ELIMINAR», NO «REVERTIR» (10/09/2026, Rodrigo: «cuando estoy
   * editando un cobro debería poder eliminarlo»). El botón llevaba aquí desde
   * el 01/09, pero puesto como «Revertir cobro» nadie lo leía como borrar: se
   * buscaba una papelera y no la había. Ahora se llama por su nombre y lleva
   * el icono, y el porqué de borrar en vez de marcar «Devuelto» se cuenta al
   * preguntar, que es cuando hace falta saberlo.
   *
   * ELIMINAR NO ES «DEVUELTO». Son las dos formas de deshacer y significan
   * cosas distintas, así que la pantalla las separa:
   *   · «Devuelto» (el estado de arriba) = el dinero entró y se ha devuelto.
   *     El cobro se queda en el histórico, porque pasó.
   *   · «Eliminar» = el cobro NUNCA debió existir: se apuntó dos veces, o en la
   *     familia equivocada. Se borra y la factura vuelve a estar pendiente.
   * Un cobro apuntado por error que se dejara como «devuelto» ensuciaría el
   * arqueo y la morosidad de un mes que estaba bien.
   *
   * El endpoint ya lo audita (`payment.deleted`, con el importe de antes) y
   * recalcula el estado de la factura; aquí solo hace falta preguntar primero,
   * que esto no tiene vuelta atrás.
   */
  async function eliminarCobro() {
    if (!editing) return;
    const quien = editing.clientName ? ` de ${editing.clientName}` : "";
    const ok = await confirmar({
      titulo: "Eliminar el cobro",
      texto:
        `Se borrará el cobro${quien} de ${fmtMoney(editing.amount)}` +
        (editing.invoice?.number ? `, y la factura ${editing.invoice.number} volverá a quedar pendiente` : "") +
        ". Queda apuntado en el registro de actividad, pero el cobro no se puede recuperar.\n\n" +
        "Si el dinero SÍ entró y se ha devuelto, no lo elimines: cambia el estado a «Devuelto».",
      confirmar: "Eliminar",
      tono: "peligro",
    });
    if (!ok) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/billing/payments/${editing.id}`, { method: "DELETE" });
      // El DELETE responde 204 sin cuerpo: no hay JSON que leer.
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "No se pudo eliminar el cobro");
      }
      setEditing(null);
      load();
      loadMorosidad();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function selectInvoice(invId) {
    const inv = unpaidInvoices.find((i) => i.id === invId);
    if (!inv) return;
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paidAmount || 0));
    setForm((f) => ({ ...f, invoiceId: invId, amount: remaining.toFixed(2) }));
  }

  const exportParams = new URLSearchParams();
  if (filterMethod) exportParams.set("method", filterMethod);
  if (filterStatus) exportParams.set("status", filterStatus);
  if (filterFrom) exportParams.set("from", filterFrom);
  if (filterTo) exportParams.set("to", filterTo);
  const exportUrl = `/api/billing/exports/payments${exportParams.toString() ? `?${exportParams}` : ""}`;

  return (
    <div className={anchoPantalla("listado")}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Tesorería</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Cobros
            <HelpTooltip title="Cobros" placement="bottom">
              El dinero que ha entrado de verdad, factura a factura. Una factura emitida NO es
              dinero cobrado: hasta que se registra aquí, sigue debiéndose.
              {" "}
              <strong className="text-white">La morosidad está en esta misma pantalla</strong> —
              son las facturas vencidas sin cobro registrado, no una lista aparte.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Total cobrado: <span className="font-semibold text-emerald-700 tabular">{fmtMoney(totalCollected)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          <ExportButtons xlsxUrl={exportUrl} />
          {/* La factura a mano, desde donde se está siempre (07/09/2026,
              AV-0063 de Aumenta: «no veo la forma de hacerlo»). */}
          {puedeFacturar && (
            <Link
              href="/facturacion/facturas?nueva=1"
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-[var(--color-primary,#1B3A2D)] border border-[var(--color-primary,#1B3A2D)] hover:bg-neutral-50 transition-colors"
              title="Una factura escrita a mano: concepto libre, precio e IVA"
            >+ Factura a mano</Link>
          )}
          {puedeFacturar && (
            <button
              onClick={() => setShowFacturarMes(true)}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-[var(--color-primary,#1B3A2D)] border border-[var(--color-primary,#1B3A2D)] hover:bg-neutral-50 transition-colors"
            >Facturar el mes</button>
          )}
          {puedeFacturar && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >+ Registrar cobro</button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por paciente, cliente, nº factura, método, notas..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <Select value={filterMethod} onChange={(v) => setFilterMethod(v)}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
          options={[
            { value: "", label: "Todos los métodos" },
            ...METODOS_OPCIONES,
          ]}
        />
        <Select value={filterStatus} onChange={(v) => setFilterStatus(v)}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
          options={[
            { value: "", label: "Todos los estados" },
            { value: "completed", label: "Completado" },
            { value: "pending", label: "Pendiente" },
            { value: "failed", label: "Fallido" },
            { value: "refunded", label: "Reembolsado" },
          ]}
        />
        {/* Del día al día, por fecha de cobro. Los mismos dos recuadros que Gastos. */}
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
          title="Cobrado desde" aria-label="Cobrado desde"
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400" />
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
          title="Cobrado hasta" aria-label="Cobrado hasta"
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400" />
        {(searchInput || filterMethod || filterStatus || filterFrom || filterTo) && (
          <button onClick={() => { setSearchInput(""); setFilterMethod(""); setFilterStatus(""); setFilterFrom(""); setFilterTo(""); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors">Limpiar</button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      {/* ── Morosidad ── quién no ha pagado el mes. Mismo criterio que abre los
          documentos del portal, para que Cobros y el área privada no se
          contradigan.

          DOS LISTAS Y NO UNA (09/09/2026, Rosa): quien tiene cuota escrita y no
          la ha pagado es morosidad, y de esa se dice el importe y de qué es;
          quien tiene paciente activo y NINGUNA cuota no debe nada que nadie haya
          escrito, así que va aparte y con su nombre. El reparto y las etiquetas
          viven en `lib/billing/morosidad.js`. */}
      {morosidad?.aplicable && (
        <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-neutral-100 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-neutral-800">Morosidad</span>
            <input
              type="month"
              value={mesMorosidad}
              onChange={(e) => setMesMorosidad(e.target.value)}
              className="rounded-lg px-2.5 py-1 text-xs border border-neutral-200"
            />
            <span className="text-[11px] text-neutral-400">{textoMorosidad.alDia}</span>
            {search && (
              <span className="text-[11px] text-neutral-500 bg-neutral-100 rounded-full px-2 py-0.5">
                filtrado por «{search}»
              </span>
            )}
          </div>
          {morosidad.sinCobros ? (
            <div className="px-4 py-5 text-xs text-amber-800 bg-amber-50/60">
              Aún no hay ningún cobro registrado en el CRM, así que aquí no se acusa a nadie:
              la morosidad empezará a decir la verdad con los primeros cobros que registres
              (a mano o con «Facturar el mes»).
            </div>
          ) : morosidad.morosos.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-neutral-400">Nadie debe este mes.</div>
          ) : morososFiltrados.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-neutral-400">Nadie que coincida con «{search}».</div>
          ) : (
            <>
              {debenConCuota.length > 0 && (
                <>
                  <div className="px-4 py-1.5 bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500">
                    {textoMorosidad.conCuota}
                  </div>
                  <ul className="divide-y divide-neutral-50 max-h-64 overflow-y-auto">
                    {debenConCuota.map((m) => <FilaMoroso key={m.clientId} m={m} />)}
                  </ul>
                </>
              )}
              {debenSinCuota.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-amber-50/60 border-t border-amber-100">
                    <div className="text-[10px] uppercase tracking-wider text-amber-800">
                      {textoMorosidad.sinCuota}
                    </div>
                    {/* Sin cuota el CRM no sabe cuánto esperaba cobrar, y decirlo
                        es más útil que pintar «1 mes» junto a una deuda de
                        verdad. Es además la lista para ir completándolas. */}
                    <div className="text-[10px] text-amber-700/80 mt-0.5">
                      No deben un importe: es que aún no tienen cuota, así que el CRM no sabe qué esperaba cobrarles.
                      Se arreglan asignándoles una en Facturación → Cuotas.
                    </div>
                  </div>
                  <ul className="divide-y divide-neutral-50 max-h-64 overflow-y-auto">
                    {debenSinCuota.map((m) => <FilaMoroso key={m.clientId} m={m} />)}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-neutral-100">
                {/* Sin onClick = cabecera no ordenable (así lo decide
                    SortableTh). El cliente llega por dos caminos —enlace
                    directo del cobro o su factura— y un solo ORDER BY no puede
                    con los dos: antes que una flecha que ordena mal, ninguna. */}
                <SortableTh k="clientName" label="Paciente / cliente" />
                <SortableTh k="invoice.number" label="Factura" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="method" label="Método" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="paidAt" label="Fecha" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="status" label="Estado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="amount" label="Importe" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                {/* El salto al dinero de verdad (29/08/2026): el movimiento del
                    banco casado (módulo Banco) o la página del cobro en Stripe.
                    Sin ordenar: es un enlace, no un dato. */}
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Movimiento</th>
                {/* La columna iba sin rótulo y el «Editar» quedaba al final de
                    una tabla ancha: en Aumenta llegaron a corregir un método de
                    pago por otra vía creyendo que no se podía (01/09/2026). */}
                {puedeFacturar && <th className="px-4 py-3 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Sin cobros{(search || filterMethod || filterStatus || filterFrom || filterTo) ? " que coincidan con los filtros" : " registrados"}</td></tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                  {/* El paciente ARRIBA y el pagador debajo (03/09/2026,
                      Aumenta: «que aparezca siempre primero el paciente»).
                      Sin paciente —un cobro de la familia entera— queda el
                      cliente solo, como siempre. */}
                  <td className="px-4 py-3 text-neutral-800 text-xs">
                    {p.patientName ? (
                      <>
                        {p.patientName}
                        <div className="text-[11px] text-neutral-400 mt-0.5">{p.clientName ?? "—"}</div>
                      </>
                    ) : (
                      p.clientName ?? "—"
                    )}
                  </td>
                  {/* Enlace a la factura: el flujo real es cobro → factura, y
                      desde el cobro hay que poder saltar a la suya. Un cobro
                      registrado antes de facturar todavía no tiene ninguna. */}
                  <td className="px-4 py-3 font-mono text-xs">
                    {p.invoice?.id ? (
                      <Link href={`/facturacion/facturas?id=${p.invoice.id}`} className="text-[var(--color-primary,#1B3A2D)] hover:underline">
                        {p.invoice.number}
                      </Link>
                    ) : (
                      <span className="text-amber-600" title="Cobro registrado sin factura todavía">
                        sin factura{p.periodMonth ? ` · ${String(p.periodMonth).slice(0, 7)}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 text-xs">
                    {METHOD_LABELS[p.method] ?? p.method ?? <span className="text-neutral-300">Sin decidir</span>}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{fmtDate(p.paidAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} kind="payment" /></td>
                  <td className="px-4 py-3 text-right font-semibold text-neutral-900 tabular">{fmtMoney(p.amount)}</td>
                  {/* De un cobro al dinero de verdad, en un clic: el movimiento
                      del banco si está conciliado, y la página de Stripe si el
                      cobro entró por tarjeta online. Un cobro a mano sin
                      conciliar no tiene a dónde saltar todavía. */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {p.bankTransactionId && (
                        <Link
                          href={`/facturacion/banco?mov=${p.bankTransactionId}`}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                          title="Ver el movimiento del banco con el que está conciliado"
                        >
                          Banco
                        </Link>
                      )}
                      {p.stripeUrl && (
                        <a
                          href={p.stripeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                          title="Ver este cobro en el panel de Stripe"
                        >
                          Stripe ↗
                        </a>
                      )}
                      {!p.bankTransactionId && !p.stripeUrl && <span className="text-neutral-300 text-xs">—</span>}
                    </div>
                  </td>
                  {puedeFacturar && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing({
                          ...p,
                          // Vacío y no null: es lo que casa con «Sin decidir».
                          method: p.method ?? "",
                          paidAt: String(p.paidAt).slice(0, 10),
                          periodMonth: p.periodMonth ? String(p.periodMonth).slice(0, 7) : "",
                          patientId: p.patientId ?? "",
                          refundedAt: p.refundedAt ? String(p.refundedAt).slice(0, 10) : hoyVigente(),
                        })}
                        className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline"
                      >
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DRAWER */}
      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowForm(false)} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Registrar</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1">Nuevo cobro</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreate} className="px-6 py-5 space-y-3">
              {/* El centro cobra la cuota y factura después: obligar a elegir
                  factura dejaba ese dinero sin registrar. */}
              <FormRow label="¿De qué es el cobro?">
                <div className="flex gap-2">
                  {/* LA CUOTA DEL MES, PRIMERA Y PUESTA (10/09/2026, Rodrigo:
                      «debería salir antes CUOTA DEL MES que DE UNA FACTURA…,
                      la default debería ser CUOTA DEL MES»). Es el flujo real
                      del centro —se cobra la mensualidad y se factura al
                      cierre—, así que era el botón que había que pulsar
                      siempre antes de empezar. */}
                  {[["cuota", "Cuota del mes"], ["factura", "De una factura"], ["cuenta", "A cuenta"]].map(([k, lbl]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, modo: k }))}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition ${form.modo === k ? "border-transparent text-white" : "bg-white border-neutral-200 text-neutral-500"}`}
                      style={form.modo === k ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </FormRow>

              {form.modo === "cuota" && (
                <>
                  <FormRow label="Paciente o cliente *">
                    {/* fuente billing: Rosa y Olga cobran sin el módulo de
                        fichas — /api/billing/fichas abre con `billing` y
                        busca también por el nombre del NIÑO (31/08/2026). */}
                    {/* La cuota se rellena en el efecto de arriba, mirando el
                        clientId: por `onFicha` llegaba tarde y descolocada. */}
                    <SelectorCliente
                      fuente="billing"
                      value={form.clientId}
                      onChange={(v) => { setCitaOrigen(null); setForm((f) => ({ ...f, clientId: v, patientId: "" })); }}
                      className={inputCls}
                      opcionesFijas={[{ value: "", label: "Selecciona cliente..." }]}
                    />
                  </FormRow>
                  {/*
                   * De QUIÉN es la cuota (01/09/2026, Rodrigo). Solo sale si la
                   * familia tiene pacientes: en un centro sin módulo asistencial
                   * la lista vuelve vacía y el cobro es de la familia, como
                   * siempre. Con un solo hijo también se enseña —es la forma de
                   * que el cobro quede apuntado a él— pero no hace falta tocarlo.
                   */}
                  {pacientesFamilia.length > 0 && (
                    <FormRow label="¿De qué paciente?">
                      <Select
                        value={form.patientId}
                        onChange={(v) => { setCitaOrigen(null); setForm((f) => ({ ...f, patientId: v })); }}
                        className={inputCls}
                        options={[
                          { value: "", label: "Toda la familia" },
                          ...pacientesFamilia.map((p) => ({
                            value: p.id,
                            label: [p.firstName, p.lastName].filter(Boolean).join(" "),
                          })),
                        ]}
                      />
                    </FormRow>
                  )}
                  <FormRow label="Mes que se paga *">
                    <input type="month" required value={form.periodMonth}
                      onChange={(e) => setForm((f) => ({ ...f, periodMonth: e.target.value }))} className={inputCls} />
                  </FormRow>
                  <p className="text-[10px] text-neutral-400 -mt-1">
                    Al registrarlo, si el centro tiene activado el bloqueo por impago, la familia
                    pasa a ver los documentos de ese mes en su área privada.
                  </p>
                  {conceptosCatalogo.length > 0 && (
                    <FormRow label="Conceptos de la cuota">
                      <div className="space-y-1.5">
                        {conceptosElegidos.map(({ c, inicio, fin }, i) => {
                          const parte = cuentaCuota.partes[i];
                          return (
                            <div key={i} className="text-xs bg-neutral-50 border border-neutral-100 rounded-lg px-2.5 py-1.5 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-neutral-700 truncate">{c.name}</span>
                                <span className="flex items-center gap-2 shrink-0">
                                  <span className="text-neutral-500">{fmtMoney(parte.importe)}</span>
                                  {/*
                                   * QUITAR ESTA CUOTA DEL COBRO (visible desde el
                                   * 04/09/2026, Rodrigo: «no me deja eliminar una
                                   * cuota del cobro, estaría bien que hubiera una X
                                   * al lado por si el niño solo va a pagar una de
                                   * las dos terapias»). El botón ya estaba, pero en
                                   * `text-neutral-300` sobre blanco no se veía: una
                                   * acción que existe y no se ve es una que no
                                   * existe. Ahora lleva su círculo, su tamaño de
                                   * dedo y dice lo que hace al pasar por encima.
                                   */}
                                  <button
                                    type="button"
                                    onClick={() => quitarConceptoCuota(i)}
                                    title="Quitar esta cuota del cobro"
                                    className="shrink-0 grid place-items-center w-5 h-5 rounded-full border border-neutral-200 text-neutral-500 text-[10px] leading-none hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                                    aria-label="Quitar esta cuota del cobro"
                                  >
                                    ✕
                                  </button>
                                </span>
                              </div>
                              {/* Cada servicio con SU tramo: empezó el 13 con logopedia,
                                  el 17 con psicología… y cada uno paga lo suyo. Y «Acabó
                                  el» para el que deja de venir a mitad de mes (10/09/2026,
                                  Rodrigo: «para los pacientes que fallan a final de mes
                                  pero han empezado bien»). */}
                              <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1.5 flex-1 min-w-0">
                                  <span className="text-[10px] text-neutral-400 shrink-0">Empezó el</span>
                                  <input type="date" value={inicio} max={fin || undefined}
                                    onChange={(e) => cambiarFechaConcepto(i, "inicio", e.target.value)}
                                    className="flex-1 min-w-0 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 focus:outline-none focus:border-neutral-400" />
                                </label>
                                <label className="flex items-center gap-1.5 flex-1 min-w-0">
                                  <span className="text-[10px] text-neutral-400 shrink-0">Acabó el</span>
                                  <input type="date" value={fin} min={inicio || undefined}
                                    onChange={(e) => cambiarFechaConcepto(i, "fin", e.target.value)}
                                    className="flex-1 min-w-0 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 focus:outline-none focus:border-neutral-400" />
                                </label>
                              </div>
                              {/*
                               * LO QUE DE VERDAD HA DIVIDIDO (10/09/2026, Rodrigo: «no me
                               * divide por la cantidad de citas que tiene el niño ese mes
                               * sino por la cantidad de días»). El importe ya salía por
                               * sesiones desde el 07/09 —cuando hay citas de ese servicio
                               * en el tramo—, pero esta línea decía «20/30 días» pasara lo
                               * que pasara, así que la cuenta que se leía nunca era la que
                               * se había hecho. Ahora dice la que se hizo, y cuando cae en
                               * los días teniendo citas delante, dice por qué.
                               */}
                              {parte.prorrateo && (
                                <p className="text-[10px] text-neutral-400">
                                  {parte.prorrateo.sesiones
                                    ? `${parte.prorrateo.sesiones.enElTramo} de ${parte.prorrateo.sesiones.enElMes} sesiones`
                                    : `${parte.prorrateo.diasCobrados}/${parte.prorrateo.diasDelMes} días`}
                                  {" "}(de {fmtMoney(parte.importeCompleto)})
                                  {!parte.prorrateo.sesiones && citasDelMes.length > 0 && (
                                    <> · por días: en ese tramo no hay citas suyas suficientes para contar sesiones</>
                                  )}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        <Select
                          value=""
                          onChange={addConceptoCuota}
                          className={inputCls}
                          options={[
                            { value: "", label: conceptosElegidos.length ? "Añadir otro concepto..." : "Elegir del catálogo (rellena el importe)..." },
                            ...conceptosCatalogo.map((c) => ({ value: String(c.id), label: `${c.name} · ${fmtMoney(c.unitPrice)}` })),
                          ]}
                        />
                        {conceptosElegidos.length > 0 && (
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[10px] text-neutral-400">
                              Las fechas solo hacen falta si ese servicio empezó —o acabó— a mitad de mes:
                              su parte se prorratea sola.
                            </p>
                            {/*
                             * EL BOTÓN QUE LLEVA A LA CUOTA (10/09/2026, Rodrigo: «un
                             * botoncito pequeño que lleve a configuración dentro de
                             * facturación y a la cuota concreta para editarle el
                             * valor»). Aquí es donde se ve que el importe está mal, y
                             * hasta hoy había que salir a Cuotas y buscar la familia a
                             * mano entre 278. Con una sola cuota abre su ficha; con
                             * varias no se puede adivinar cuál, y deja la lista
                             * filtrada por el nombre de la familia.
                             */}
                            {enlaceALaCuota && <BotonCuota href={enlaceALaCuota} />}
                          </div>
                        )}
                        {/*
                         * DONDE NACE LA CUENTA DE CABEZA (08/09/2026, AV-0085).
                         * Rosa sumó 145 + 145 = 290 aquí arriba y abajo le salían
                         * 375. Los dos números eran correctos y ninguno decía qué
                         * era. Esta línea corta la suma antes de que se haga, y
                         * solo sale cuando de verdad no coinciden.
                         */}
                        {pendientesDelMes.length > 0 && !cuotaDeLaCita &&
                          Math.abs(cuentaCuota.total - sumaPendientes) >= 0.01 && (
                            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                              Estos son los precios de <strong>tarifa</strong> y suman{" "}
                              <span className="tabular">{fmtMoney(cuentaCuota.total)}</span>. No es lo que se cobra
                              este mes: abajo, en el importe, está{" "}
                              {pendientesDelMes.length === 1
                                ? "su cobro pendiente"
                                : `sus ${pendientesDelMes.length} cobros pendientes`}{" "}
                              y por qué {pendientesDelMes.length === 1 ? "es" : "son"}{" "}
                              <span className="tabular">{fmtMoney(sumaPendientes)}</span>.
                            </p>
                          )}
                      </div>
                    </FormRow>
                  )}
                  {/*
                   * SE VIENE DE UNA CITA QUE NO ES LA CUOTA MENSUAL (10/09/2026).
                   * Lo que se rellena es el diagnóstico, no la pedagogía de todos
                   * los meses, y eso hay que decirlo con todas las letras: son dos
                   * importes muy distintos y el de arriba se cobra tal cual.
                   */}
                  {cuotaDeLaCita && (
                    <div className="text-[11px] rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2 -mt-1 space-y-1">
                      <p className="text-neutral-700">
                        Vienes de una cita de <strong>{cuotaDeLaCita.nombre}</strong>: se ha puesto{" "}
                        <strong>su</strong> importe, no la cuota mensual de la familia.
                        {cuotaDeLaCita.fuente === "tipo" && " Sale de su tipo de cita, que es donde está puesta esa cuota."}
                      </p>
                      <p className="text-neutral-500">
                        Va como un cobro aparte: ni salda el cobro del mes ni cuenta contra su cuota.
                      </p>
                      <button
                        type="button"
                        onClick={() => setCitaOrigen(null)}
                        className="underline text-neutral-500 hover:text-neutral-800"
                      >
                        Cobrar su cuota del mes en vez de esto
                      </button>
                    </div>
                  )}
                  {/* De dónde ha salido lo que se acaba de rellenar. Callarlo era
                      lo que dejaba dudar de si salían TODAS sus cuotas o solo una. */}
                  {!cuotaDeLaCita && form.clientId && conceptosCatalogo.length > 0 && (
                    <p className="text-[10px] text-neutral-400 -mt-1">
                      {cuotaDeLaFamilia ? (
                        <>
                          {cuotaDeLaFamilia.delPaciente
                            ? `Se ha puesto solo la cuota de ese paciente (${cuotaDeLaFamilia.n === 1 ? "1 cuota" : `${cuotaDeLaFamilia.n} cuotas`}); las de sus hermanos quedan fuera`
                            : cuotaDeLaFamilia.n === 1
                              ? "Tiene 1 cuota asignada"
                              : `Tiene ${cuotaDeLaFamilia.n} cuotas asignadas y se han sumado todas`}
                          {cuotaDeLaFamilia.deLaFamiliaEntera && (
                            <> · está a nombre de la <strong className="text-neutral-600">familia</strong>, no de ese paciente: repásala y quita con la ✕ lo que no se cobre</>
                          )}
                          {cuotaDeLaFamilia.pactado !== null
                            ? <> · importe <strong className="text-neutral-600">pactado con la familia</strong>, no la tarifa del catálogo.</>
                            : "."}{" "}
                          <Link href="/facturacion/cuotas" className="underline hover:text-neutral-600">Ver sus cuotas</Link>
                        </>
                      ) : origenCuota ? (
                        /* Lo han dicho sus CITAS de ese mes (04/09/2026). Se
                           dice cuántas para que se pueda contrastar de un
                           vistazo con la agenda. */
                        <>
                          Sin cuota asignada: se ha rellenado con lo que dicen sus{" "}
                          <strong className="text-neutral-600">
                            {origenCuota.citas === 1 ? "1 cita" : `${origenCuota.citas} citas`}
                          </strong>{" "}
                          de ese mes.
                        </>
                      ) : conceptosElegidos.length ? (
                        "Sin cuota asignada: se ha rellenado con lo último que se le cobró."
                      ) : (
                        "Esta familia no tiene cuota asignada ni cobros anteriores: elige sus conceptos."
                      )}
                    </p>
                  )}
                  {cuentaCuota.hayProrrateo && (
                    <p className="text-[10px] text-neutral-400 -mt-1">
                      Con la parte proporcional: <strong className="text-neutral-600">{fmtMoney(cuentaCuota.total)}</strong>
                      {" "}(el mes entero serían {fmtMoney(cuentaCuota.totalCompleto)}).
                      El importe se ha rellenado solo; puedes retocarlo.
                    </p>
                  )}
                </>
              )}

              {/* A CUENTA (07/09/2026): la familia que paga varios meses de
                  golpe. Se elige la familia y el importe, y el CRM enseña qué
                  meses cubre ANTES de guardar; al registrar crea el cobro de
                  cada mes con su cuota, así que cuando llegue el día 1 ese mes
                  ya está pagado y la generación no lo duplica. */}
              {form.modo === "cuenta" && (
                <>
                  <FormRow label="Familia *">
                    <SelectorCliente
                      fuente="billing"
                      value={form.clientId}
                      onChange={(v) => setForm((f) => ({ ...f, clientId: v, patientId: "" }))}
                      className={inputCls}
                      opcionesFijas={[{ value: "", label: "Selecciona cliente..." }]}
                    />
                  </FormRow>
                  <FormRow label="Desde el mes">
                    <input type="month" value={form.periodMonth}
                      onChange={(e) => setForm((f) => ({ ...f, periodMonth: e.target.value }))} className={inputCls} />
                    <p className="text-[10px] text-neutral-400 mt-1">
                      El primer mes que se paga. Los que ya estén cobrados se saltan solos.
                    </p>
                  </FormRow>
                </>
              )}

              {form.modo === "factura" && (
              <FormRow label="Factura *">
                <Select
                  value={form.invoiceId}
                  onChange={(v) => selectInvoice(v)}
                  className={inputCls}
                  options={[
                    { value: "", label: "Selecciona factura pendiente..." },
                    ...unpaidInvoices.map((i) => {
                      const remaining = Math.max(0, Number(i.total) - Number(i.paidAmount || 0));
                      return {
                        value: i.id,
                        label: `${i.number} · ${i.client?.name ?? "?"} · pendiente ${fmtMoney(remaining)}`,
                      };
                    }),
                  ]}
                />
              </FormRow>
              )}
              <FormRow label="Importe (€) *">
                <input required type="number" min="0.01" step="0.01" value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={inputCls} />
                {/* Lo que ya entró de este mes (04/09/2026, Rodrigo): con un
                    pago parcial detrás, el importe que sale es EL RESTO, y hay
                    que decir de dónde sale o parece que la cuota ha cambiado.
                    Ver `lib/billing/restoDelMes.js`. */}
                {/* TRAEN MENOS DE LO QUE SE LES PIDIÓ (10/09/2026). Lo que falta
                    se queda pendiente de este mes, que es lo que hace que salga
                    en Cobros y en Morosidad en vez de evaporarse. */}
                {form.modo === "cuota" && restoQueQueda > 0 && (
                  <label className="mt-2 flex items-start gap-2 text-[11px] text-neutral-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dejarResto}
                      onChange={(e) => setDejarResto(e.target.checked)}
                      className="mt-0.5 shrink-0"
                    />
                    <span>
                      Traen <span className="tabular">{fmtMoney(Number(form.amount))}</span> de{" "}
                      <span className="tabular">{fmtMoney(loQueTocaba)}</span>: dejar los{" "}
                      <strong className="tabular">{fmtMoney(restoQueQueda)}</strong> que faltan{" "}
                      <strong>pendientes</strong> de este mes.
                      <span className="block text-neutral-400">
                        Quítalo si el resto no se va a cobrar (un descuento, una sesión que no se cobra).
                      </span>
                    </span>
                  </label>
                )}
                {/* Con un cobro suelto de una cita, el pendiente del mes NO es lo
                    que se está cobrando: se nombra para que nadie lo dé por
                    saldado, y ahí se queda (10/09/2026). */}
                {form.modo === "cuota" && cuotaDeLaCita && pendientesDelMes.length > 0 && (
                  <p className="mt-2 text-[11px] text-neutral-500">
                    Aparte de esto, su cuota del mes sigue con{" "}
                    {pendientesDelMes.length === 1 ? "un cobro pendiente" : `${pendientesDelMes.length} cobros pendientes`}{" "}
                    de <span className="tabular">{fmtMoney(sumaPendientes)}</span>. Este cobro no lo toca.
                  </p>
                )}
                {form.modo === "cuota" && !cuotaDeLaCita && pendientesDelMes.length > 0 && (
                  <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <p className="text-[11px] text-neutral-500 mb-1.5">
                      {pendientesDelMes.length === 1
                        ? "Este mes ya tiene su cobro pendiente en Cobros. Esto es lo que se cobra:"
                        : `Este mes ya tiene sus ${pendientesDelMes.length} cobros pendientes en Cobros. Esto es lo que se cobra:`}
                    </p>
                    <ul className="space-y-1">
                      {pendientesExplicados.map((p) => (
                        <li key={p.id}>
                          <div className="flex justify-between gap-3 text-[12px] text-neutral-700">
                            <span className="truncate">{p.concepto ?? "Cuota del mes"}</span>
                            <span className="tabular font-medium shrink-0">{fmtMoney(p.amount)}</span>
                          </div>
                          {p.motivos.length > 0 && (
                            <p className="text-[10px] text-neutral-500 leading-snug">{p.motivos.join(" · ")}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                    {pendientesDelMes.length > 1 && (
                      <div className="flex justify-between gap-3 text-[12px] text-neutral-700 mt-1.5 pt-1.5 border-t border-neutral-200">
                        <span>Total pendiente</span>
                        <span className="tabular font-semibold">{fmtMoney(sumaPendientes)}</span>
                      </div>
                    )}
                    {/* El tramo que se acaba de teclear cambia lo que vale el
                        mes: se dice ANTES de registrar, con las dos cifras
                        delante, porque lo que se corrige es un cobro que ya
                        estaba escrito (10/09/2026). */}
                    {corrigeElPendiente && (
                      <p className="text-[11px] text-neutral-700 mt-1.5">
                        Con el tramo que has puesto, este mes vale{" "}
                        <strong className="tabular">{fmtMoney(mesProrrateado)}</strong> y no{" "}
                        <span className="tabular">{fmtMoney(sumaPendientes)}</span>: al registrar se corrige el cobro
                        pendiente, así que no queda a deber la diferencia.
                      </p>
                    )}
                    {/* La frase dice QUÉ HACER, no qué pasa: «pone que si se cambia
                        el importe se genera un cobro nuevo y se deja el antiguo????»
                        (Rosa, 08/09/2026). Lo que asusta va después y como
                        consecuencia, no como amenaza. */}
                    <p className="text-[11px] text-neutral-700 font-medium mt-1.5">
                      {pendientesDelMes.length === 1
                        ? `Para saldarlo, deja los ${fmtMoney(loQuePideElMes)} y pulsa Registrar.`
                        : `Para saldar los ${pendientesDelMes.length}, deja los ${fmtMoney(sumaPendientes)} y pulsa Registrar.`}
                    </p>
                    <p className="text-[10px] text-neutral-500 mt-0.5">
                      {pendientesDelMes.length === 1
                        ? "Si la familia trae menos, escribe lo que trae: se cobra eso y el resto se queda pendiente de este mes, así que sigue saliendo en Morosidad."
                        : "Si la familia paga solo uno, escribe justo lo que pide ese y se salda ese; con una cifra que no sea la de ninguno se apunta un cobro aparte y estos siguen pendientes."}
                    </p>
                  </div>
                )}
                {/* Lo que cubre el pago a cuenta, antes de guardarlo: la queja
                    de la tarea era que «nadie lo ve venir». */}
                {form.modo === "cuenta" && (
                  <div className="mt-2">
                    {repartoCargando && <p className="text-[11px] text-neutral-400">Calculando qué meses cubre…</p>}
                    {!repartoCargando && reparto && reparto.aplicaciones.length > 0 && (
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                        <p className="text-[11px] text-neutral-500 mb-1.5">
                          Cubre {reparto.aplicaciones.length === 1 ? "este mes" : `estos ${reparto.aplicaciones.length} meses`}:
                        </p>
                        <ul className="space-y-0.5">
                          {reparto.aplicaciones.map((a) => (
                            <li key={a.mes} className="flex justify-between text-[12px] text-neutral-700">
                              <span>{a.mesLegible}</span>
                              <span className="tabular font-medium">{fmtMoney(a.importe)}</span>
                            </li>
                          ))}
                        </ul>
                        {reparto.saltados.length > 0 && (
                          <p className="text-[10px] text-neutral-400 mt-1.5">
                            {reparto.saltados.length === 1 ? "Un mes ya estaba cobrado y se salta." : `${reparto.saltados.length} meses ya estaban cobrados y se saltan.`}
                          </p>
                        )}
                      </div>
                    )}
                    {!repartoCargando && reparto?.aviso && (
                      <p className="text-[11px] mt-1.5 text-amber-700">{reparto.aviso}</p>
                    )}
                  </div>
                )}
                {form.modo === "cuota" && parcialDelMes && (
                  <div className={`text-[11px] mt-1.5 ${parcialDelMes.completo ? "text-neutral-600" : "text-neutral-500"}`}>
                    {parcialDelMes.completo ? (
                      <>
                        <p className="text-neutral-700">
                          Este mes ya está cobrado entero:{" "}
                          <span className="tabular font-medium">{fmtMoney(parcialDelMes.yaCobrado)}</span>
                          {esperadoDeLaCuota?.generado != null && ", que es el cobro que generó el CRM para este mes"}.
                        </p>
                        {/*
                         * Los motivos REALES del cobro, no una causa inventada.
                         * De las 112 familias a las que el CRM ofrecía un resto,
                         * en 6 no había ninguna reserva de plaza: escribir «ya
                         * llevaba el descuento» habría vuelto a decir un porqué
                         * que no cuadra, que es justo lo que hace escribir otra
                         * vez a quien cobra.
                         */}
                        {cobradosExplicados.some((c) => c.motivos.length > 0) && (
                          <ul className="mt-1 space-y-0.5">
                            {cobradosExplicados
                              .filter((c) => c.motivos.length > 0)
                              .map((c) => (
                                <li key={c.id} className="text-[10px] text-neutral-500 leading-snug">
                                  {c.concepto ? `${c.concepto} — ` : ""}
                                  {c.motivos.join(" · ")}
                                </li>
                              ))}
                          </ul>
                        )}
                        {esperadoDeLaCuota?.generado != null &&
                          esperadoDeLaCuota?.tarifa != null &&
                          Math.abs(esperadoDeLaCuota.tarifa - esperadoDeLaCuota.generado) >= 0.01 && (
                            <p className="text-[10px] text-neutral-400 mt-1">
                              Su {esperadoDeLaCuota.pactado ? "precio pactado" : "tarifa de catálogo"} son{" "}
                              <span className="tabular">{fmtMoney(esperadoDeLaCuota.tarifa)}</span>: el cobro de este
                              mes salió por otra cifra, y arriba está por qué.
                            </p>
                          )}
                        <p className="text-[10px] text-neutral-400 mt-1">
                          Si aun así hay que apuntar otro cobro, escribe el importe a mano.
                        </p>
                      </>
                    ) : (
                      <p>
                        Ya cobrado este mes: <span className="tabular">{fmtMoney(parcialDelMes.yaCobrado)}</span>.
                        Queda <span className="tabular font-medium text-neutral-700">{fmtMoney(parcialDelMes.resto)}</span>,
                        que es lo que se ha puesto arriba
                        {esperadoDeLaCuota?.generado == null && esperadoDeLaCuota?.tarifa != null
                          ? ` para llegar a su ${esperadoDeLaCuota.pactado ? "precio pactado" : "tarifa"} (${fmtMoney(esperadoDeLaCuota.tarifa)})`
                          : ""}
                        .
                      </p>
                    )}
                    {/* Con el mes generado a medias no se puede decir que esté
                        saldado: falta el cobro de la otra cuota. */}
                    {esperadoDeLaCuota?.cuotasSinGenerar > 0 && (
                      <p className="text-[10px] text-amber-700 mt-1">
                        Ojo: de sus cuotas, {esperadoDeLaCuota.cuotasSinGenerar === 1 ? "una" : esperadoDeLaCuota.cuotasSinGenerar}{" "}
                        no {esperadoDeLaCuota.cuotasSinGenerar === 1 ? "tiene" : "tienen"} cobro generado este mes, así que
                        esta cuenta va contra la tarifa.
                      </p>
                    )}
                  </div>
                )}
                {/* LO QUE SE COBRÓ APARTE (10/09/2026, Rodrigo). No cuenta
                    contra la cuota —una entrevista inicial no es media
                    mensualidad— pero se nombra, o parece que ese cobro se ha
                    perdido. Ver `lib/billing/restoDelMes.js`. */}
                {form.modo === "cuota" && aparteExplicados.length > 0 && (
                  <p className="text-[11px] text-neutral-500 mt-1.5">
                    Este mes ya se le cobraron{" "}
                    <span className="tabular">{fmtMoney(sumaAparte)}</span> de{" "}
                    {aparteExplicados.map((c) => c.concepto ?? "otro servicio").join(", ")}: va aparte y no
                    descuenta de esta cuota.
                  </p>
                )}
              </FormRow>
              <FormRow label="Método de pago *">
                <Select value={form.method} onChange={(v) => setForm((f) => ({ ...f, method: v }))}
                  className={inputCls} placeholder="¿Por dónde ha entrado?"
                  options={METODOS_OPCIONES}
                />
              </FormRow>
              <FormRow label="Fecha *">
                <input required type="date" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} className={inputCls} />
              </FormRow>
              <FormRow label="Notas">
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls + " resize-y"} />
              </FormRow>

              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-neutral-100">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Guardando..." : "Registrar"}</button>
              </div>
            </form>
          </aside>
        </>
      )}
      {/* DRAWER DE EDICIÓN — un cobro mal tecleado se corregía antes a mano en
          la base de datos. Queda auditado por el PATCH. */}
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !saving && setEditing(null)} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100">
              <div className="eyebrow">Editar</div>
              <h2 className="font-display text-xl text-neutral-900 mt-1">Cobro de {editing.clientName ?? "—"}</h2>
              <p className="text-[11px] text-neutral-400 mt-1">
                {editing.invoice?.number ? `Factura ${editing.invoice.number}` : "Sin factura asociada"}
              </p>
            </div>
            <form onSubmit={guardarEdicion} className="px-6 py-5 space-y-3">
              <FormRow label="Importe (€) *">
                <input required type="number" min="0.01" step="0.01" value={editing.amount}
                  onChange={(e) => setEditing((p) => ({ ...p, amount: e.target.value }))} className={inputCls} />
                {/*
                 * Y desde aquí también se llega a la cuota (10/09/2026): este
                 * cajón es el que se abre cuando el importe de un cobro no
                 * cuadra, y cambiarlo aquí arregla ESTE mes pero no el que
                 * viene. El que viene sale de la cuota.
                 */}
                {editing.cuotaId && (
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <p className="text-[10px] text-neutral-400">
                      Esto cambia solo este cobro. Para los meses siguientes, cambia la cuota.
                    </p>
                    <BotonCuota href={`/facturacion/cuotas?cuota=${encodeURIComponent(editing.cuotaId)}`} />
                  </div>
                )}
              </FormRow>
              <FormRow label="Método de pago">
                <Select value={editing.method ?? ""} onChange={(v) => setEditing((p) => ({ ...p, method: v }))}
                  className={inputCls}
                  options={[SIN_DECIDIR, ...METODOS_OPCIONES]} />
              </FormRow>
              <FormRow label="Fecha *">
                <input required type="date" value={editing.paidAt}
                  onChange={(e) => setEditing((p) => ({ ...p, paidAt: e.target.value }))} className={inputCls} />
              </FormRow>
              <FormRow label="Estado">
                <Select value={editing.status} onChange={(v) => setEditing((p) => ({ ...p, status: v }))}
                  className={inputCls}
                  options={[
                    { value: "completed", label: "Cobrado" },
                    { value: "pending", label: "Pendiente" },
                    { value: "failed", label: "Fallido" },
                    { value: "refunded", label: "Devuelto" },
                  ]} />
              </FormRow>
              {/* Un cobro devuelto son dos apuntes: entró el día del cobro y
                  salió el día de la devolución, que es lo que resta en la caja
                  de ESE día (07/09/2026). */}
              {editing.status === "refunded" && (
                <FormRow label="Devuelto el *">
                  <input required type="date" value={editing.refundedAt ?? ""}
                    onChange={(e) => setEditing((p) => ({ ...p, refundedAt: e.target.value }))} className={inputCls} />
                  <p className="text-[10px] text-neutral-400 mt-1">
                    El dinero sale de la caja ese día; el cobro sigue contando el día que entró.
                  </p>
                </FormRow>
              )}
              {/* El mes y el paciente de un cobro de cuota también se corrigen
                  (07/09/2026): apuntarlo al mes o al hermano equivocado ya no
                  obliga a revertirlo y registrarlo de nuevo. */}
              {!editing.invoice?.id && (
                <FormRow label="Mes que se paga">
                  <input type="month" value={editing.periodMonth ?? ""}
                    onChange={(e) => setEditing((p) => ({ ...p, periodMonth: e.target.value }))} className={inputCls} />
                </FormRow>
              )}
              {!editing.invoice?.id && pacientesEdicion.length > 0 && (
                <FormRow label="¿De qué paciente?">
                  <Select
                    value={editing.patientId ?? ""}
                    onChange={(v) => setEditing((p) => ({ ...p, patientId: v }))}
                    className={inputCls}
                    options={[
                      { value: "", label: "Toda la familia" },
                      ...pacientesEdicion.map((p) => ({
                        value: p.id,
                        label: [p.firstName, p.lastName].filter(Boolean).join(" "),
                      })),
                    ]}
                  />
                </FormRow>
              )}
              {/* Un cobro suelto se puede enganchar a la factura que se emitió
                  después (31/08/2026): la factura pasa a cobrada y el cobro
                  deja de salir como «sin factura». El mes de cuota no se toca. */}
              {!editing.invoice?.id && facturasCliente.length > 0 && (
                <FormRow label="Asociar a factura (opcional)">
                  <Select
                    value={editing.asociarFacturaId ?? ""}
                    onChange={(v) => setEditing((p) => ({ ...p, asociarFacturaId: v }))}
                    className={inputCls}
                    options={[
                      { value: "", label: "Dejar sin factura" },
                      ...facturasCliente.map((i) => {
                        const remaining = Math.max(0, Number(i.total) - Number(i.paidAmount || 0));
                        return { value: i.id, label: `${i.number} · pendiente ${fmtMoney(remaining)}` };
                      }),
                    ]}
                  />
                </FormRow>
              )}
              <FormRow label="Notas">
                <textarea rows={3} value={editing.notes ?? ""}
                  onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} className={inputCls + " resize-y"} />
              </FormRow>
              {formError && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>}
              <div className="flex gap-2 justify-between items-center pt-3 border-t border-neutral-100 flex-wrap">
                {/* Deshacer del todo, a la izquierda y separado de Guardar: es
                    lo único de este cajón que borra algo. Con papelera, que es
                    lo que se busca con la vista cuando se quiere borrar algo. */}
                <button type="button" onClick={eliminarCobro} disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-600 uppercase tracking-wide hover:bg-red-50 rounded-lg disabled:opacity-50">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  Eliminar cobro
                </button>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setEditing(null)}
                    className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700">Cancelar</button>
                  <button type="submit" disabled={saving}
                    className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
                    style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Guardando..." : "Guardar"}</button>
                </div>
              </div>
            </form>
          </aside>
        </>
      )}

      {/* FACTURAR EL MES — la Facturación múltiple de Organízate: las cuotas
          cobradas del mes se convierten en facturas de una pasada. */}
      <FacturarMesDrawer
        open={showFacturarMes}
        onClose={() => setShowFacturarMes(false)}
        onDone={() => { load(); loadMorosidad(); }}
      />

      {dialogo}
    </div>
  );
}

/**
 * Una familia de la lista de morosidad (09/09/2026).
 *
 * Lo mismo para las dos poblaciones: quien lo mira quiere el nombre, cómo
 * llamarle y cuánto (o, si no se sabe, por qué no se sabe). Lo que cambia es la
 * etiqueta, y esa la decide `etiquetaDeMoroso`, con su prueba.
 */
function FilaMoroso({ m }) {
  const etiqueta = etiquetaDeMoroso(m);
  const color = {
    importe: "bg-red-50 text-red-700",
    grave: "bg-red-50 text-red-700",
    medio: "bg-amber-50 text-amber-700",
    leve: "bg-neutral-100 text-neutral-600",
    sinCuota: "bg-amber-50 text-amber-700",
  }[etiqueta.tono];
  return (
    <li className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <Link href={`/clientes/${m.clientId}`} className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline min-w-0 flex-1 truncate">
        {m.name}
      </Link>
      {/* De qué es lo que debe, que es la otra mitad de lo que pedía Rosa. Solo
          cuando hay cuota: sin ella no hay concepto que enseñar. */}
      {m.conceptos?.length > 0 && (
        <span className="text-[11px] text-neutral-400 truncate max-w-[220px]" title={m.conceptos.join(" · ")}>
          {m.conceptos.join(" · ")}
        </span>
      )}
      <span className="text-[11px] text-neutral-500">{m.phone || m.email || "sin contacto"}</span>
      <span className={`text-[11px] px-2 py-0.5 rounded-full ${color}`}>{etiqueta.texto}</span>
    </li>
  );
}

/**
 * El botoncito que abre la cuota para cambiarle el importe (10/09/2026,
 * Rodrigo). Sale en los dos cajones —registrar y editar— porque el importe
 * raro se ve en los dos, y hasta hoy había que salir a Cuotas y buscar la
 * familia a mano entre las 278 del centro.
 *
 * En una pestaña nueva a propósito: quien está cobrando no puede perder lo que
 * lleva tecleado por ir a mirar una tarifa.
 */
function BotonCuota({ href, children = "Cambiar el importe" }) {
  return (
    <Link
      href={href}
      target="_blank"
      title="Abrir la cuota para cambiarle el importe"
      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 transition-colors"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3 h-3">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
      </svg>
      {children}
    </Link>
  );
}

function FormRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}

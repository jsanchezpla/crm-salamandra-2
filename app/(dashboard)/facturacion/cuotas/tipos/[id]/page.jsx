"use client";

/**
 * /facturacion/cuotas/tipos/[id] — la ficha de UN tipo de cuota (09/09/2026,
 * petición de Aumenta, en papel y con sus tres pestañas):
 *
 *   · PACIENTES — «pacientes asignados donde se pueda agregar o quitar».
 *   · FICHA — «paciente a nivel facturación, donde aparezca la cuota, precio y
 *     concepto de factura».
 *   · MESES DEL CURSO — «donde se puedan crear, modificar o eliminar cuotas de
 *     todos los meses del curso escolar (SEP-JUN)», y cada mes enseña LA
 *     FACTURA en la que acabó.
 *
 * Son tres vistas de las MISMAS filas, y por eso se piden de una vez
 * (`/api/billing/cuotas/tipos/[id]`): tres consultas distintas acabarían
 * enseñando tres números distintos del mismo dinero.
 *
 * Lo que aquí no se decide: quitar a alguien de esta cuota cuando paga más
 * cosas no es darle de baja (`lib/billing/tiposDeCuota.js`), y el curso va de
 * septiembre a junio (`lib/billing/cursoEscolar.js`). Las dos, con prueba.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import Select from "@/components/ui/Select.jsx";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import SelectorDestinatarios from "@/components/billing/SelectorDestinatarios.jsx";
import CobroDrawer from "../../../_components/CobroDrawer.jsx";
import { fmtMoney } from "../../../_components/Kpi.jsx";
import { cursoVigente, cursosParaElegir, rotuloCurso, mesCorto } from "@/lib/billing/cursoEscolar.js";
import { comoQuitarElTipo } from "@/lib/billing/tiposDeCuota.js";
import { hoyVigente } from "@/lib/billing/cuotas.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const METODOS = [
  { value: "transfer", label: "Banco (transferencia)" },
  { value: "direct_debit", label: "Domiciliación" },
  { value: "card", label: "Tarjeta" },
  { value: "cash", label: "Efectivo" },
];
const METODO_CORTO = { transfer: "Banco", direct_debit: "Domiciliación", card: "Tarjeta", cash: "Efectivo" };
// Una cuota puede no tener método: es lo que sale de salida (10/09/2026).
const SIN_METODO = { value: "", label: "Ninguno" };

/** El color de la casilla del mes dice en qué estado está ese cobro. */
const ESTADO = {
  completed: { clase: "bg-emerald-50 text-emerald-800 border-emerald-200", rotulo: "Cobrado" },
  pending: { clase: "bg-amber-50 text-amber-800 border-amber-200", rotulo: "Pendiente" },
  failed: { clase: "bg-red-50 text-red-700 border-red-200", rotulo: "Fallido" },
  refunded: { clase: "bg-neutral-100 text-neutral-500 border-neutral-200 line-through", rotulo: "Devuelto" },
};

const fmtFecha = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

export default function TipoDeCuotaPage() {
  const { id } = useParams();
  const [curso, setCurso] = useState(() => cursoVigente());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);
  const [pestana, setPestana] = useState("pacientes");
  const [verBajas, setVerBajas] = useState(false);
  const [showAnadir, setShowAnadir] = useState(false);
  const [cobroAbierto, setCobroAbierto] = useState(null);
  const { confirmar, dialogo } = useDialogo();

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/cuotas/tipos/${id}?curso=${curso}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar esta cuota");
      setDatos(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [id, curso]);

  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(
    () => (datos?.filas ?? []).filter((f) => verBajas || !f.deBaja),
    [datos, verBajas]
  );
  const bajas = (datos?.filas ?? []).filter((f) => f.deBaja).length;

  /** PATCH a una cuota, con el mensaje de siempre. */
  async function guardarCuota(cuotaId, cuerpo, mensaje) {
    setErrorMsg(null);
    setOkMsg(null);
    try {
      const r = await fetch(`/api/billing/cuotas/${cuotaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      setOkMsg(mensaje);
      await cargar();
      return true;
    } catch (e) {
      setErrorMsg(e.message);
      return false;
    }
  }

  /**
   * Quitar a un paciente de ESTA cuota. Si paga más cosas se le quita solo
   * esta; si es lo único que paga, es una baja —nunca un borrado, que se hace
   * desde Cuotas y con su aviso—. La regla vive en `lib/billing/tiposDeCuota.js`.
   */
  async function quitar(fila) {
    const plan = comoQuitarElTipo({ conceptIds: fila.conceptos.map((c) => c.id) }, id);
    const quien = fila.paciente || fila.familia || "esta familia";
    if (plan.accion === "nada") { setErrorMsg("Esta cuota ya no lleva este tipo."); return; }

    if (plan.accion === "quitar-concepto") {
      const otras = fila.conceptos.filter((c) => String(c.id) !== String(id)).map((c) => c.name).join(", ");
      const seguro = await confirmar({
        titulo: `Quitar «${datos.tipo.name}» a ${quien}`,
        texto: `Deja de pagar esta cuota y sigue con el resto: ${otras}. El cobro pendiente de este mes se pone al día solo.`,
        confirmar: "Quitársela",
        cancelar: "Volver",
        tono: "peligro",
      });
      if (!seguro) return;
      await guardarCuota(fila.cuotaId, { conceptIds: plan.conceptIds }, `${quien} ya no paga esta cuota.`);
      return;
    }

    const seguro = await confirmar({
      titulo: `Dar de baja a ${quien}`,
      texto: "Es la única cuota que paga, así que se le da de baja con fecha de hoy: el mes se cobra prorrateado hasta hoy y se conserva por qué se cobró lo que se cobró. Para borrarla del todo, hazlo desde Cuotas.",
      confirmar: "Dar de baja",
      cancelar: "Volver",
      tono: "peligro",
    });
    if (!seguro) return;
    await guardarCuota(fila.cuotaId, { endDate: hoyVigente(), active: false }, `${quien} queda de baja hoy.`);
  }

  /** Crear (o rehacer) el cobro de un mes suelto de una cuota. */
  async function generarMes(fila, mes) {
    setErrorMsg(null);
    setOkMsg(null);
    try {
      const r = await fetch(`/api/billing/cuotas/${fila.cuotaId}/mes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo generar el mes");
      const quien = fila.paciente || fila.familia || "esta familia";
      const dicho = {
        creado: `Cobro de ${j.data.mesLegible} creado para ${quien}, pendiente de cobrar.`,
        actualizado: `Cobro de ${j.data.mesLegible} puesto al día.`,
        retirado: `El cobro de ${j.data.mesLegible} se ha retirado: ${j.data.motivo}.`,
        "al-dia": `El cobro de ${j.data.mesLegible} ya estaba al día.`,
        intocable: `No se toca: ${j.data.motivo}.`,
        "sin-importe": `No se puede generar: ${j.data.motivo}.`,
        "fuera-del-mes": `${quien} no tenía esta cuota en ${j.data.mesLegible}.`,
      }[j.data.estado] ?? `Hecho: ${j.data.estado}.`;
      setOkMsg(dicho);
      await cargar();
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  if (!datos && cargando) {
    return <div className="p-4 lg:p-8 text-sm text-neutral-400">Cargando…</div>;
  }
  if (!datos) {
    return (
      <div className="p-4 lg:p-8 space-y-3">
        <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
          {errorMsg || "No se encontró esta cuota."}
        </div>
        <Link href="/facturacion/cuotas/tipos" className="text-xs text-neutral-500 hover:underline">← Tipos de cuota</Link>
      </div>
    );
  }

  const t = datos.tipo;

  return (
    <div className="p-4 lg:p-8">
      {dialogo}

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div className="min-w-0">
          <div className="eyebrow">Operativa · Tipo de cuota</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            {t.name}
            <HelpTooltip title={t.name} placement="bottom">
              Todo lo de esta cuota en un sitio: quién la paga, con qué precio y{" "}
              <strong className="text-white">qué se le ha cobrado cada mes del curso</strong>.
              Los cobros que se crean aquí nacen <strong className="text-white">pendientes</strong>:
              se pasan a cobrado desde Cobros cuando el dinero entra.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {t.unitPrice !== null && <><span className="tabular">{fmtMoney(t.unitPrice)}</span> de catálogo · </>}
            En la factura sale «{t.textoFactura}»
            {t.periodicity && <> · {t.periodicity}</>}
            {t.active === false && <> · <span className="text-amber-700">apagada en el catálogo</span></>}
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <Link href="/facturacion/cuotas/tipos" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Tipos de cuota
          </Link>
          <button
            onClick={() => setShowAnadir(true)}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >+ Añadir pacientes</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {/* Pacientes, o familias cuando las cuotas van a nombre de la casa y
            esa familia no tiene pacientes dados de alta (09/09/2026). */}
        <Tarjeta
          titulo={datos.totales.pacientes > 0 ? "Pacientes" : "Familias"}
          valor={datos.totales.pacientes || datos.totales.familias}
          pie={`${datos.totales.cuotas} ${datos.totales.cuotas === 1 ? "cuota activa" : "cuotas activas"}${bajas ? ` · ${bajas} de baja` : ""}`}
        />
        <Tarjeta titulo="Al mes" valor={fmtMoney(datos.totales.alMes)} pie="solo las cuotas de este tipo a secas" />
        <Tarjeta titulo={`Cobrado ${datos.cursoRotulo}`} valor={fmtMoney(datos.totales.cobrado)} pie="del curso elegido" />
        <Tarjeta titulo="Pendiente" valor={fmtMoney(datos.totales.pendiente)} pie="apuntado y sin cobrar" />
      </div>

      {errorMsg && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-0.5">
          {[
            ["pacientes", "Pacientes"],
            ["ficha", "Ficha"],
            ["meses", "Cuota mes a mes"],
          ].map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setPestana(k)}
              className={`text-[12.5px] px-3 py-1 rounded-md transition ${
                pestana === k ? "bg-[var(--color-primary,#1B3A2D)] text-white font-medium" : "text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {pestana === "meses" && (
          <Select
            value={String(curso)}
            onChange={(v) => setCurso(Number(v))}
            options={cursosParaElegir().map((c) => ({ value: String(c), label: `Curso ${rotuloCurso(c)}` }))}
            className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200"
          />
        )}

        {bajas > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
            <input
              type="checkbox"
              checked={verBajas}
              onChange={(e) => setVerBajas(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
            />
            Ver también las {bajas} de baja
          </label>
        )}
        {cargando && <span className="text-[11.5px] text-neutral-400">Actualizando…</span>}
      </div>

      {filas.length === 0 ? (
        <div className="bg-white border border-neutral-100 rounded-xl px-4 py-12 text-center text-xs text-neutral-400">
          Todavía no la paga nadie. Añade pacientes y aparecerán aquí con sus meses.
        </div>
      ) : pestana === "pacientes" ? (
        <PestanaPacientes filas={filas} onQuitar={quitar} />
      ) : pestana === "ficha" ? (
        <PestanaFicha filas={filas} tipo={t} onGuardar={guardarCuota} />
      ) : (
        <PestanaMeses
          filas={filas}
          meses={datos.meses}
          onGenerar={generarMes}
          onAbrirCobro={(fila, celda) =>
            setCobroAbierto({ id: celda.id, patientName: fila.paciente, clientName: fila.familia })
          }
        />
      )}

      {showAnadir && (
        <CajonAnadir
          tipo={t}
          onClose={() => setShowAnadir(false)}
          onHecho={(mensaje) => { setShowAnadir(false); setOkMsg(mensaje); cargar(); }}
        />
      )}

      {cobroAbierto && (
        <CobroDrawer
          cobroId={cobroAbierto.id}
          resumen={cobroAbierto}
          onClose={() => setCobroAbierto(null)}
          onCambiado={cargar}
        />
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, pie }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400">{titulo}</div>
      <div className="text-lg font-semibold text-neutral-800 tabular">{valor}</div>
      {pie && <div className="text-[11px] text-neutral-400 mt-0.5">{pie}</div>}
    </div>
  );
}

/* ── Pestaña 1: los pacientes asignados ───────────────────────────────────── */

function PestanaPacientes({ filas, onQuitar }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
              {/* El paciente DELANTE de la familia (03/09/2026, Aumenta: «en todo
                  lo relativo a facturación que aparezca siempre primero el
                  paciente»). */}
              <th className="px-4 py-3 font-medium">Paciente</th>
              <th className="px-4 py-3 font-medium">Familia</th>
              <th className="px-4 py-3 font-medium">Desde</th>
              <th className="px-4 py-3 font-medium">Hasta</th>
              <th className="px-4 py-3 font-medium">Cómo</th>
              <th className="px-4 py-3 font-medium text-right">Al mes</th>
              <th className="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.cuotaId} className={`border-b border-neutral-50 ${f.deBaja ? "bg-neutral-50/60 text-neutral-400" : ""}`}>
                <td className="px-4 py-3 text-neutral-800">
                  {f.paciente || "—"}
                  {f.pacienteEsDeLaFamilia && f.paciente && (
                    <span className="text-[10.5px] text-neutral-400"> (toda la familia)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500">
                  <Link href={`/clientes/${f.clientId}`} className="hover:underline">{f.familia || "—"}</Link>
                  {f.pagador && <div className="text-[10.5px] text-neutral-400">paga {f.pagador}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500">{fmtFecha(f.startDate)}</td>
                <td className="px-4 py-3 text-xs text-neutral-500">
                  {f.endDate ? fmtFecha(f.endDate) : <span className="text-neutral-300">sin fin</span>}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500">
                  {METODO_CORTO[f.method] || "—"}
                  {f.dayOfMonth ? <span className="text-neutral-400"> · día {f.dayOfMonth}</span> : null}
                </td>
                <td className="px-4 py-3 text-right tabular text-neutral-800">{fmtMoney(f.importe)}</td>
                <td className="px-4 py-3 text-right">
                  {f.deBaja ? (
                    <span className="text-[11px] text-neutral-400">de baja</span>
                  ) : (
                    <button
                      onClick={() => onQuitar(f)}
                      className="text-[11px] px-2 py-1 rounded border border-neutral-200 text-neutral-600 hover:border-rose-200 hover:text-rose-600 transition"
                    >
                      Quitar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Pestaña 2: el paciente a nivel facturación ───────────────────────────── */

function PestanaFicha({ filas, tipo, onGuardar }) {
  const [editando, setEditando] = useState(null); // { cuotaId, valor }

  async function guardar(f) {
    const v = editando.valor.trim();
    // Vacío = «lo que digan sus conceptos», que es como nace una cuota del
    // catálogo: así una subida de precio se hace en un sitio y no en 300 filas.
    const amount = v === "" ? null : Number(v.replace(",", "."));
    if (amount !== null && !Number.isFinite(amount)) return;
    const ok = await onGuardar(f.cuotaId, { amount }, `Precio de ${f.paciente || f.familia} guardado.`);
    if (ok) setEditando(null);
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Familia</th>
                <th className="px-4 py-3 font-medium">Qué paga</th>
                <th className="px-4 py-3 font-medium">Concepto de factura</th>
                <th className="px-4 py-3 font-medium text-right">Precio</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.cuotaId} className={`border-b border-neutral-50 ${f.deBaja ? "bg-neutral-50/60 text-neutral-400" : ""}`}>
                  <td className="px-4 py-3 text-neutral-800">{f.paciente || "—"}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    <Link href={`/clientes/${f.clientId}`} className="hover:underline">{f.familia || "—"}</Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-600">
                    {f.conceptos.map((c) => c.name).join(" + ")}
                    {f.conceptosPerdidos.length > 0 && (
                      <div className="text-[10.5px] text-amber-700">
                        {f.conceptosPerdidos.length} concepto(s) ya no están en el catálogo
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    {/* Lo que ve la familia impreso: el «Texto en la factura» del
                        catálogo, que en Aumenta NUNCA nombra la terapia — y por
                        eso dos conceptos suelen tener el MISMO texto: se dice una
                        vez, que es como sale en el papel. */}
                    {[...new Set(f.conceptos.map((c) => c.textoFactura).filter(Boolean))].join(" + ") || tipo.textoFactura}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editando?.cuotaId === f.cuotaId ? (
                      <input
                        autoFocus
                        value={editando.valor}
                        onChange={(e) => setEditando({ ...editando, valor: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") guardar(f); if (e.key === "Escape") setEditando(null); }}
                        placeholder={String(f.conceptos.reduce((s, c) => s + (c.unitPrice ?? 0), 0))}
                        className="w-24 rounded-lg px-2 py-1 text-sm text-right tabular border border-neutral-300 focus:outline-none focus:border-neutral-500"
                      />
                    ) : (
                      <>
                        <span className="tabular text-neutral-800">{fmtMoney(f.importe)}</span>
                        <div className="text-[10.5px] text-neutral-400">
                          {f.importeDe === "pactado" ? "pactado con la familia" : "precio del catálogo"}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editando?.cuotaId === f.cuotaId ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => guardar(f)} className="text-[11px] px-2 py-1 rounded bg-[var(--color-primary,#1B3A2D)] text-white">Guardar</button>
                        <button onClick={() => setEditando(null)} className="text-[11px] px-2 py-1 rounded border border-neutral-200 text-neutral-600">Cancelar</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditando({ cuotaId: f.cuotaId, valor: f.importePactado === null ? "" : String(f.importePactado) })}
                        className="text-[11px] px-2 py-1 rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition"
                      >
                        Cambiar precio
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11.5px] text-neutral-400">
        Dejar el precio en blanco devuelve la cuota al precio del catálogo, y entonces una subida
        se hace en un sitio y no familia por familia. El cobro pendiente de este mes se pone al día solo.
      </p>
    </div>
  );
}

/* ── Pestaña 3: la cuota mes a mes del curso (sep-jun) ────────────────────── */

function PestanaMeses({ filas, meses, onGenerar, onAbrirCobro }) {
  const totalMes = (mes) =>
    filas.reduce((s, f) => s + (f.meses[mes] && f.meses[mes].estado !== "refunded" ? f.meses[mes].importe : 0), 0);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3 font-medium sticky left-0 bg-white">Paciente</th>
                {meses.map((m) => (
                  <th key={m} className="px-2 py-3 font-medium text-center">{mesCorto(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.cuotaId} className={`border-b border-neutral-50 ${f.deBaja ? "bg-neutral-50/60" : ""}`}>
                  {/* Fondo OPACO, no heredado: la columna se queda quieta al
                      desplazar los meses y con fondo transparente los importes
                      pasarían por debajo del nombre. */}
                  <td className={`px-4 py-2 sticky left-0 ${f.deBaja ? "bg-neutral-50" : "bg-white"}`}>
                    <span className="text-neutral-800">{f.paciente || f.familia || "—"}</span>
                    <div className="text-[10.5px] text-neutral-400">
                      {f.paciente && f.familia ? f.familia : ""}
                      {f.deBaja && <span className="text-neutral-400"> · de baja</span>}
                    </div>
                  </td>
                  {meses.map((m) => {
                    const c = f.meses[m];
                    if (!c) {
                      return (
                        <td key={m} className="px-1 py-2 text-center">
                          <button
                            onClick={() => onGenerar(f, m)}
                            title={`Crear el cobro de ${mesCorto(m)}`}
                            className="w-full rounded-md border border-dashed border-neutral-200 text-neutral-300 text-[11px] py-1.5 hover:border-neutral-400 hover:text-neutral-600 transition"
                          >
                            +
                          </button>
                        </td>
                      );
                    }
                    const estilo = ESTADO[c.estado] ?? ESTADO.pending;
                    return (
                      <td key={m} className="px-1 py-2 text-center relative group">
                        <button
                          onClick={() => onAbrirCobro(f, c)}
                          title={`${estilo.rotulo}${c.facturaNumero ? ` · factura ${c.facturaNumero}` : ""}`}
                          className={`w-full rounded-md border text-[11.5px] py-1.5 tabular transition hover:opacity-80 ${estilo.clase}`}
                        >
                          {fmtMoney(c.importe)}
                          {c.facturaNumero && <span className="block text-[9.5px] opacity-70 truncate">{c.facturaNumero}</span>}
                        </button>
                        {/*
                          REHACER ESE MES (09/09/2026, AV-0082 de Aumenta). Rosa se
                          encontró un cobro de 36,42 € que había calculado el CRM con
                          una regla vieja: «eso ha salido solo, yo no lo he puesto».
                          Arreglada la regla, el cobro viejo se quedaba con su número
                          y había que rehacerlo a mano con la calculadora. Esto lo
                          vuelve a calcular con lo que dice la cuota HOY. Solo sale
                          mientras el cobro no es dinero ni papel: en cuanto está
                          cobrado o facturado, el servidor no lo toca.
                        */}
                        {c.sePuedeRehacer && (
                          <button
                            type="button"
                            onClick={() => onGenerar(f, m)}
                            title="Rehacer este mes con lo que dice la cuota hoy"
                            className="absolute top-0 right-0 w-4 h-4 rounded-full bg-white border border-neutral-300 text-[9px] leading-none text-neutral-500 opacity-0 group-hover:opacity-100 hover:text-neutral-800 hover:border-neutral-500 transition"
                          >
                            ↻
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold text-neutral-800 text-[12px]">
                <td className="px-4 py-2 sticky left-0 bg-neutral-50">Total del mes</td>
                {meses.map((m) => (
                  <td key={m} className="px-1 py-2 text-center tabular">{totalMes(m) ? fmtMoney(totalMes(m)) : "—"}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-neutral-500">
        <Leyenda clase={ESTADO.completed.clase} texto="Cobrado" />
        <Leyenda clase={ESTADO.pending.clase} texto="Pendiente" />
        <Leyenda clase={ESTADO.failed.clase} texto="Fallido" />
        <Leyenda clase={ESTADO.refunded.clase} texto="Devuelto" />
        <span className="text-neutral-400">
          · Pulsa un mes para ver, corregir o borrar su cobro; el «+» lo crea, y el ↻ de la esquina
          lo vuelve a calcular con lo que dice la cuota hoy.
        </span>
      </div>
      <p className="text-[11.5px] text-neutral-400">
        Debajo del importe sale el número de la factura en la que acabó ese mes. Un mes sin nada es un
        mes sin cobro apuntado: crearlo lo deja PENDIENTE, no cobrado. El curso va de septiembre a
        junio; julio y agosto no aparecen porque el centro no cobra cuota.
      </p>
    </div>
  );
}

function Leyenda({ clase, texto }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-3 h-3 rounded border ${clase}`} />
      {texto}
    </span>
  );
}

/* ── Añadir pacientes a esta cuota ────────────────────────────────────────── */

function CajonAnadir({ tipo, onClose, onHecho }) {
  const [destinatarios, setDestinatarios] = useState([]);
  const [form, setForm] = useState({
    // Ninguno de salida: dar el alta no es decidir cómo se le cobra.
    method: "",
    dayOfMonth: "",
    startDate: hoyVigente(),
    amount: "",
    notes: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    if (!destinatarios.length) { setError("Elige a quién se le pone esta cuota"); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/billing/cuotas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptIds: [tipo.id],
          amount: form.amount === "" ? null : Number(form.amount),
          method: form.method || null,
          dayOfMonth: form.dayOfMonth === "" ? null : Number(form.dayOfMonth),
          startDate: form.startDate,
          notes: form.notes || null,
          destinatarios: destinatarios.map((d) => ({ clientId: d.clientId, patientId: d.patientId })),
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo dar de alta");
      const { creadas, omitidas = [] } = j.data;
      if (!creadas) {
        // Nadie entró: casi siempre porque ya tenían una cuota activa. Se dice
        // aquí y no se cierra el cajón, para poder corregir sin volver a empezar.
        setResultado({ creadas, omitidas });
        return;
      }
      const extra = omitidas.length ? ` (${omitidas.length} se saltaron: ${omitidas[0].motivo})` : "";
      onHecho(`${creadas} ${creadas === 1 ? "paciente añadido" : "pacientes añadidos"} a esta cuota${extra}. Su cobro de este mes ya está en Cobros, pendiente.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const precio = Number(tipo.unitPrice) || 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose()} />
      <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[460px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
        <form onSubmit={guardar} className="p-6 space-y-4">
          <div>
            <div className="eyebrow">Cuotas · Añadir</div>
            <h2 className="font-display text-xl text-neutral-900 mt-1">{tipo.name}</h2>
            <p className="text-[11.5px] text-neutral-400 mt-1">
              Se crea una cuota por paciente, con este precio y desde esta fecha. Quien ya la tenga se salta.
            </p>
          </div>

          {error && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>}

          {resultado && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800 space-y-1">
              <p>No se ha dado de alta a nadie.</p>
              <ul className="list-disc pl-4">
                {resultado.omitidas.map((o, i) => (
                  <li key={i}>{o.nombre ?? "esa ficha"}: {o.motivo}</li>
                ))}
              </ul>
            </div>
          )}

          <SelectorDestinatarios valores={destinatarios} onChange={setDestinatarios} />

          <label className="block">
            <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Importe al mes</span>
            <input
              type="number" step="0.01" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder={precio ? `${precio} (el del catálogo)` : "el del catálogo"}
              className={inputCls}
            />
            <span className="mt-1 block text-[11px] text-neutral-400">
              En blanco = el precio del catálogo, y una subida se aplica sola. Escríbelo solo si con
              esta familia se pactó otro.
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cómo se cobra</span>
              <Select
                value={form.method}
                onChange={(v) => setForm({ ...form, method: v })}
                options={[SIN_METODO, ...METODOS]}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Día del mes</span>
              <input
                type="number" min="1" max="31" value={form.dayOfMonth}
                onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                placeholder="—" className={inputCls}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Desde</span>
            <input
              type="date" value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className={inputCls}
            />
            <span className="mt-1 block text-[11px] text-neutral-400">
              El mes del alta se cobra prorrateado por las sesiones que queden.
            </span>
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Notas</span>
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Opcional" className={inputCls}
            />
          </label>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit" disabled={guardando}
              className="flex-1 rounded-lg text-white text-sm font-medium py-2.5 disabled:opacity-40"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {guardando ? "Guardando…" : `Añadir ${destinatarios.length || ""}`.trim()}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg border border-neutral-200 text-neutral-600 text-sm">
              Cancelar
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

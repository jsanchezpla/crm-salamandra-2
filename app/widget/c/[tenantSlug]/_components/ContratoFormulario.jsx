"use client";

/**
 * ContratoFormulario — el contrato con DATOS y ANEXOS (sprint tunutrilaura
 * 2026-08-04).
 *
 * Tres pasos en una sola pantalla, como el ejemplo que mandó Laura: los datos,
 * los documentos (desplegables, con una casilla cada uno) y la firma. No se
 * pagina a propósito: quien firma tiene que poder subir a releer una cláusula
 * sin perder lo que ya escribió.
 *
 * Cada anexo lleva SU casilla porque el contrato dice que «se firman de forma
 * independiente al documento principal». Una sola casilla para todo el paquete
 * no acredita la aceptación de ninguno — y el Anexo I es el que renuncia a la
 * devolución del importe.
 *
 * El documento en blanco no se enseña en PDF aparte: el texto está aquí, y el
 * PDF que se genera al firmar ya lo lleva entero con los datos dentro.
 */

import { useMemo, useState } from "react";
import SignaturePad from "./SignaturePad.jsx";
import { edadDesde } from "../../../../../lib/clients/formularioAlta.js";

const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

const INPUT =
  "w-full px-3 py-2.5 text-[15px] rounded-lg border border-[var(--widget-border)] bg-[var(--widget-card)] " +
  "text-[var(--widget-text)] placeholder:text-[var(--widget-text-faint)] focus:outline-none " +
  "focus:ring-2 focus:ring-[var(--widget-focus)] focus:border-transparent";

// El tipo del campo decide el teclado que sale en el móvil. Un DNI con teclado
// de texto y un teléfono con teclado de letras se rellenan fatal con una mano.
const HTML_TYPE = { email: "email", tel: "tel", date: "date", dni: "text", text: "text" };

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Constante de módulo, no `[]` en línea: un array nuevo en cada render haría
// inútil el useMemo de los grupos.
const VACIO = [];

/**
 * Valores de partida: lo que ya está en la ficha viene resuelto del servidor, y
 * la fecha de la firma es hoy, que es lo que va a poner.
 */
function valoresIniciales(campos) {
  const base = {};
  for (const c of campos) {
    if (c.valor) base[c.key] = c.valor;
    else base[c.key] = c.type === "date" && /fechaFirma/i.test(c.key) ? hoyISO() : "";
  }
  return base;
}

/** Fecha en cristiano para el resumen de datos. */
function fmtFecha(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function CampoTexto({ campo, valor, onChange, disabled }) {
  const comun = {
    id: `campo-${campo.key}`,
    value: valor ?? "",
    onChange: (e) => onChange(campo.key, e.target.value),
    disabled,
    placeholder: campo.placeholder ?? undefined,
    className: INPUT,
    required: campo.required,
  };

  return (
    <div>
      <label htmlFor={comun.id} className="block text-[13px] font-medium text-[var(--widget-text)] mb-1.5">
        {campo.label} {campo.required && <span className="text-[var(--widget-text-faint)]">*</span>}
      </label>

      {campo.type === "textarea" ? (
        <textarea {...comun} rows={3} />
      ) : campo.type === "select" ? (
        <select {...comun}>
          <option value="">Selecciona…</option>
          {(campo.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input {...comun} type={HTML_TYPE[campo.type] ?? "text"} inputMode={campo.type === "dni" ? "text" : undefined} />
      )}

      {campo.help && <p className="mt-1 text-[12px] text-[var(--widget-text-faint)]">{campo.help}</p>}
    </div>
  );
}

/** Un documento del paquete: se despliega para leerlo y se acepta con su casilla. */
function Bloque({ bloque, aceptado, onToggle, disabled }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="rounded-xl border border-[var(--widget-border)] overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--widget-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
      >
        <span className="text-[14px] font-medium text-[var(--widget-text)]">{bloque.title}</span>
        <span className="text-[12px] text-[var(--widget-text-muted)] shrink-0">
          {abierto ? "Ocultar" : "Leer"}
        </span>
      </button>

      {abierto && (
        <div className="px-4 pb-3 max-h-72 overflow-y-auto border-t border-[var(--widget-border)] pt-3">
          <p className="text-[13px] leading-relaxed text-[var(--widget-text-muted)] whitespace-pre-line">
            {bloque.body}
          </p>
        </div>
      )}

      <label className="flex items-start gap-2.5 px-4 py-3 border-t border-[var(--widget-border)] bg-[var(--widget-bg)] cursor-pointer">
        <input
          type="checkbox"
          checked={!!aceptado}
          onChange={(e) => onToggle(bloque.id, e.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-primary,var(--widget-button))]"
        />
        <span className="text-[13px] leading-relaxed text-[var(--widget-text)]">{bloque.acceptLabel}</span>
      </label>
    </div>
  );
}

export default function ContratoFormulario({
  plantilla,
  quedan,
  enviando,
  error,
  onFirmar,
  onMasTarde,
  profesional,
}) {
  const campos = plantilla.fields ?? VACIO;
  const bloques = plantilla.blocks ?? VACIO;

  // Nada se prerrellena del documento anterior a propósito: en el contrato los
  // datos son de la PACIENTE y en el consentimiento parental los de su tutor.
  const [datos, setDatos] = useState(() => valoresIniciales(campos));
  const [aceptados, setAceptados] = useState({});
  const [firma, setFirma] = useState(null);
  const [firmaSecundaria, setFirmaSecundaria] = useState(null);

  // Lo que YA está en la ficha se enseña, no se vuelve a preguntar: se rellenó
  // en la pantalla anterior o lo tenía puesto la nutricionista. Lo que se sigue
  // preguntando aquí es lo del acto de firmar (la localidad, la fecha) y, en el
  // consentimiento parental, los datos del tutor, que no están en la ficha.
  const yaSabidos = useMemo(() => campos.filter((c) => c.desdeFicha && c.valor), [campos]);
  const porPedir = useMemo(() => campos.filter((c) => !(c.desdeFicha && c.valor)), [campos]);

  // Los campos se pintan agrupados («Datos del tutor», «de la persona menor»),
  // que es como los separa el propio consentimiento parental.
  const grupos = useMemo(() => {
    const out = [];
    for (const campo of porPedir) {
      const titulo = campo.group ?? null;
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.titulo === titulo) ultimo.campos.push(campo);
      else out.push({ titulo, campos: [campo] });
    }
    return out;
  }, [porPedir]);

  const faltanDatos = porPedir.filter((c) => c.required && !String(datos[c.key] ?? "").trim());
  const faltanBloques = bloques.filter((b) => b.required && !aceptados[b.id]);

  /*
   * FIRMAR ES OPCIONAL SI ES MENOR Y ES SU PROPIO CONTRATO (06/08/2026, Rodrigo).
   *
   * Depende de su edad y de su madurez, y quien autoriza de verdad es su tutor
   * legal en el consentimiento parental que viene justo después. Se le ofrece
   * firmar —a los 16 muchas quieren, y está bien que lo hagan— pero no se le
   * exige: exigirlo dejaba encallada a una familia con una niña de 8 años.
   *
   * En el consentimiento parental NO aplica: ese lo firma el tutor y ahí la
   * firma no se perdona. El servidor comprueba lo mismo con la fecha de la
   * FICHA, así que esto es comodidad de pantalla, no la puerta.
   */
  const campoNacimiento = campos.find((c) => c.ficha === "cliente.birthDate");
  const nacimiento =
    String(datos[campoNacimiento?.key] ?? "").trim() || String(campoNacimiento?.valor ?? "").trim() || null;
  const edad = edadDesde(nacimiento);
  const firmaOpcional = !plantilla.onlyMinors && edad != null && edad < 18;

  const listo = !faltanDatos.length && !faltanBloques.length && (!!firma || firmaOpcional);

  function cambiar(key, valor) {
    setDatos((d) => ({ ...d, [key]: valor }));
  }

  function alternar(id, valor) {
    setAceptados((a) => ({ ...a, [id]: valor }));
  }

  function enviar(e) {
    e.preventDefault();
    if (!listo || enviando) return;
    onFirmar({
      templateKey: plantilla.key,
      datos,
      aceptaciones: Object.keys(aceptados).filter((k) => aceptados[k]),
      signature: firma,
      firmaSecundaria: firmaSecundaria ?? undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--widget-bg)]">
      <div className="min-h-full flex items-start justify-center px-4 py-8">
        <form
          onSubmit={enviar}
          className="w-full max-w-2xl bg-[var(--widget-card)] rounded-2xl border border-[var(--widget-border)] p-6 lg:p-8 shadow-sm"
        >
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-2">
            {quedan > 1 ? `Documento 1 de ${quedan}` : "Antes de entrar"}
          </div>
          <h1
            className="text-[24px] lg:text-[28px] leading-tight text-[var(--widget-text)] tracking-tight mb-3"
            style={headingStyle}
          >
            {plantilla.title}
          </h1>
          {plantilla.intro && (
            <p className="text-[14px] text-[var(--widget-text-muted)] leading-relaxed mb-6">{plantilla.intro}</p>
          )}

          {/* 1 · Datos */}
          <section className="mb-7">
            <h2 className="text-[13px] font-semibold text-[var(--widget-text)] mb-3">1 · Tus datos</h2>

            {/* Lo que ya consta. Se enseña porque va a salir impreso en el
                documento que firma: tiene derecho a verlo antes, y a avisar si
                algo no cuadra. */}
            {yaSabidos.length > 0 && (
              <div className="mb-5 rounded-xl border border-[var(--widget-border)] bg-[var(--widget-bg)] px-4 py-3">
                <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {yaSabidos.map((c) => (
                    <div key={c.key}>
                      <dt className="text-[11px] uppercase tracking-[0.1em] text-[var(--widget-text-faint)]">
                        {c.label}
                      </dt>
                      <dd className="text-[14px] text-[var(--widget-text)]">
                        {c.type === "date" ? fmtFecha(c.valor) : c.valor}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2.5 text-[11px] text-[var(--widget-text-faint)] leading-relaxed">
                  Son los datos que constan en tu ficha y los que aparecerán en el documento. Si algo no
                  está bien, díselo a {profesional || "tu profesional"} antes de firmar.
                </p>
              </div>
            )}

            {grupos.map((grupo, i) => (
              <div key={grupo.titulo ?? i} className={i > 0 ? "mt-5" : ""}>
                {grupo.titulo && (
                  <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--widget-text-faint)] mb-2.5">
                    {grupo.titulo}
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {grupo.campos.map((campo) => (
                    <div key={campo.key} className={campo.type === "textarea" ? "sm:col-span-2" : undefined}>
                      <CampoTexto campo={campo} valor={datos[campo.key]} onChange={cambiar} disabled={enviando} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* 2 · Documentos */}
          <section className="mb-7">
            <h2 className="text-[13px] font-semibold text-[var(--widget-text)] mb-1">2 · Lo que aceptas</h2>
            <p className="text-[12px] text-[var(--widget-text-muted)] mb-3">
              Despliega cada apartado para leerlo entero antes de aceptarlo.
            </p>
            <div className="flex flex-col gap-2.5">
              {bloques.map((b) => (
                <Bloque key={b.id} bloque={b} aceptado={aceptados[b.id]} onToggle={alternar} disabled={enviando} />
              ))}
            </div>
          </section>

          {/* 3 · Firma */}
          <section className="mb-2">
            <h2 className="text-[13px] font-semibold text-[var(--widget-text)] mb-3">
              3 · Tu firma
              {firmaOpcional && (
                <span className="ml-1.5 font-normal text-[var(--widget-text-faint)]">(opcional)</span>
              )}
            </h2>
            {firmaOpcional && (
              <p className="text-[12.5px] text-[var(--widget-text-muted)] leading-relaxed mb-3">
                Como todavía eres menor de edad, puedes firmar si quieres, pero no hace falta: quien autoriza
                es tu madre, padre o tutor legal, y lo hará en el documento siguiente. Puedes continuar sin
                firmar.
              </p>
            )}
            <SignaturePad onChange={setFirma} disabled={enviando} />

            {plantilla.secondSignatureLabel && (
              <div className="mt-6">
                <p className="text-[13px] font-medium text-[var(--widget-text)] mb-1">
                  {plantilla.secondSignatureLabel}
                </p>
                <p className="text-[12px] text-[var(--widget-text-muted)] mb-2">
                  Es opcional. Puedes dejarlo en blanco si no procede.
                </p>
                <SignaturePad onChange={setFirmaSecundaria} disabled={enviando} />
              </div>
            )}
          </section>

          {error && (
            <div className="mt-4 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Se dice lo que falta ANTES de que pulse: un botón apagado sin
              explicación es la forma más rápida de que alguien abandone. */}
          {!listo && !error && (
            <p className="mt-4 text-[12px] text-[var(--widget-text-faint)] leading-relaxed">
              {faltanDatos.length
                ? `Te faltan datos por rellenar: ${faltanDatos.map((c) => c.label).join(", ")}.`
                : faltanBloques.length
                  ? `Te falta aceptar: ${faltanBloques.map((b) => b.title).join(", ")}.`
                  : "Solo falta tu firma en el recuadro."}
            </p>
          )}
          {/* La firma opcional necesita su propia frase: con la de arriba, quien
              no va a firmar no entiende por qué el botón ya está encendido. */}
          {listo && firmaOpcional && !firma && !error && (
            <p className="mt-4 text-[12px] text-[var(--widget-text-faint)] leading-relaxed">
              Puedes continuar sin firmar. Tu madre, padre o tutor legal firmará el consentimiento en el
              siguiente paso.
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="submit"
              disabled={!listo || enviando}
              className="w-full px-5 py-3 text-sm font-semibold rounded-xl text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              {enviando ? "Guardando tu firma…" : firmaOpcional && !firma ? "Continuar sin firmar" : "Firmar"}
            </button>
            {onMasTarde && (
              <button
                type="button"
                onClick={onMasTarde}
                disabled={enviando}
                className="w-full px-5 py-2.5 text-sm font-medium rounded-xl border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
              >
                Lo firmo más tarde
              </button>
            )}
          </div>

          <p className="mt-4 text-[11px] text-[var(--widget-text-faint)] leading-relaxed">
            Al firmar guardamos la fecha, la hora y desde dónde firmas como constancia, y te dejamos una copia en
            PDF en «Mis documentos».
          </p>
        </form>
      </div>
    </div>
  );
}

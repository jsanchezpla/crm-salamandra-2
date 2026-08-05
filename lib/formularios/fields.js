/**
 * lib/formularios/fields.js — el contrato de las preguntas.
 *
 * El módulo Formularios es genérico: las preguntas viven en `forms.fields`
 * (JSONB) y NO en el código. Este fichero es el único sitio que sabe leer ese
 * contrato, así que lo comparten el formulario público, el endpoint que recibe
 * las respuestas y la bandeja del CRM.
 *
 * Un campo:
 *   { key, label, type, required, order, placeholder, help, options,
 *     maxLength, min, max, mapTo, linkUrl, linkLabel }
 *
 * `mapTo` dice a qué parte de la ficha de cliente sube la respuesta al aceptar
 * la solicitud. Los destinos son fijos a propósito: son EXACTAMENTE los que la
 * ficha de cliente ya pinta hoy, así que aceptar no obliga a tocar la UI.
 */

export const TIPOS = Object.freeze([
  "text",
  "textarea",
  "tel",
  "dni",
  "email",
  "number",
  "select",
  "checkbox",
  "date",
  "consent",
]);

export const DESTINOS = Object.freeze(["name", "email", "phone", "age", "reason", "taxId"]);

/** Tope de longitud por defecto según el tipo, si el campo no declara uno. */
const MAX_POR_TIPO = { text: 200, textarea: 1000, tel: 30, dni: 30, email: 160, select: 120, date: 20, number: 12 };

import { letraDocumentoCorrecta } from "../clients/contratoFirma.js";

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Campos ordenados y sin basura. Tolera un JSONB corrupto sin reventar. */
export function camposDe(form) {
  const lista = Array.isArray(form?.fields) ? form.fields : [];
  return lista
    .filter((f) => f && typeof f.key === "string" && f.key && TIPOS.includes(f.type))
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

/** Normaliza un teléfono español a 9 dígitos; devuelve null si no lo parece. */
export function normalizarTelefono(valor) {
  const limpio = String(valor || "").replace(/[\s.\-()]/g, "").replace(/^\+?34/, "");
  return /^\d{9}$/.test(limpio) ? limpio : null;
}

function textoPlano(valor) {
  // Nada de HTML en las respuestas: se guardan y se pintan como texto.
  return String(valor ?? "").replace(/<[^>]*>/g, "").trim();
}

/**
 * Valida el cuerpo recibido contra la definición del formulario.
 *
 * Devuelve { ok:true, answers, destinos, consentimiento } o
 * { ok:false, errores:[{ key, mensaje }] }.
 *
 *   - `answers`  → [{ key, label, type, value }] listo para guardar. Lleva el
 *                  ENUNCIADO dentro para que el histórico no mienta si mañana
 *                  se reformula la pregunta.
 *   - `destinos` → { name, email, phone, age, reason } con lo que sube a la ficha.
 */
export function validarRespuestas(form, cuerpo) {
  const campos = camposDe(form);
  const errores = [];
  const answers = [];
  const destinos = {};
  let consentimiento = null;

  for (const campo of campos) {
    const bruto = cuerpo?.[campo.key];
    const tope = Number(campo.maxLength) > 0 ? Number(campo.maxLength) : (MAX_POR_TIPO[campo.type] || 500);

    // ── Consentimiento: es una casilla, pero su valor probatorio es el texto ──
    if (campo.type === "consent") {
      const aceptado = bruto === true || bruto === "true" || bruto === "on" || bruto === 1;
      if (campo.required !== false && !aceptado) {
        errores.push({ key: campo.key, mensaje: "Hay que aceptar para poder enviar la solicitud." });
        continue;
      }
      if (aceptado) consentimiento = { texto: String(campo.label || "").slice(0, 2000) };
      answers.push({ key: campo.key, label: campo.label || "", type: "consent", value: aceptado ? "Sí" : "No" });
      continue;
    }

    if (campo.type === "checkbox") {
      const marcado = bruto === true || bruto === "true" || bruto === "on" || bruto === 1;
      if (campo.required && !marcado) {
        errores.push({ key: campo.key, mensaje: `Marca "${campo.label}".` });
        continue;
      }
      answers.push({ key: campo.key, label: campo.label || "", type: "checkbox", value: marcado ? "Sí" : "No" });
      continue;
    }

    const valor = textoPlano(bruto);

    if (!valor) {
      if (campo.required) {
        errores.push({ key: campo.key, mensaje: `"${campo.label}" es obligatorio.` });
        continue;
      }
      answers.push({ key: campo.key, label: campo.label || "", type: campo.type, value: "" });
      continue;
    }

    if (valor.length > tope) {
      errores.push({ key: campo.key, mensaje: `"${campo.label}" no puede pasar de ${tope} caracteres.` });
      continue;
    }

    let normalizado = valor;

    if (campo.type === "email") {
      normalizado = valor.toLowerCase();
      if (!RE_EMAIL.test(normalizado)) {
        errores.push({ key: campo.key, mensaje: "El email no parece válido." });
        continue;
      }
    }

    if (campo.type === "tel") {
      const tel = normalizarTelefono(valor);
      if (!tel) {
        errores.push({ key: campo.key, mensaje: "El teléfono debe tener 9 dígitos." });
        continue;
      }
      normalizado = tel;
    }

    // DNI/NIE del TUTOR (05/08/2026). Se pide en el formulario previo porque en
    // esta consulta el paciente puede ser menor y quien firma —y por tanto quien
    // tiene que estar identificado— es el adulto responsable.
    //
    // Se reutiliza el validador del contrato a propósito: es el mismo documento
    // el que se comprueba aquí y el que luego se firma, y tener dos validadores
    // distintos acaba con uno aceptando lo que el otro rechaza. Solo se mira la
    // letra de lo que TIENE forma de DNI o NIE; un pasaporte o un documento
    // extranjero pasa tal cual (`null`), porque rechazarlo dejaría fuera a una
    // paciente extranjera antes siquiera de poder contar lo que le pasa.
    if (campo.type === "dni") {
      normalizado = valor.toUpperCase().replace(/[\s-]/g, "");
      if (letraDocumentoCorrecta(normalizado) === false) {
        errores.push({
          key: campo.key,
          mensaje: "Revisa el DNI: la letra no corresponde con los números.",
        });
        continue;
      }
    }

    if (campo.type === "number") {
      const n = Number(valor);
      if (!Number.isFinite(n)) {
        errores.push({ key: campo.key, mensaje: `"${campo.label}" tiene que ser un número.` });
        continue;
      }
      if (campo.min != null && n < Number(campo.min)) {
        errores.push({ key: campo.key, mensaje: `"${campo.label}" no puede ser menor que ${campo.min}.` });
        continue;
      }
      if (campo.max != null && n > Number(campo.max)) {
        errores.push({ key: campo.key, mensaje: `"${campo.label}" no puede ser mayor que ${campo.max}.` });
        continue;
      }
      normalizado = String(n);
    }

    if (campo.type === "select") {
      const opciones = Array.isArray(campo.options) ? campo.options.map(String) : [];
      if (opciones.length && !opciones.includes(normalizado)) {
        errores.push({ key: campo.key, mensaje: `Elige una opción válida en "${campo.label}".` });
        continue;
      }
    }

    answers.push({ key: campo.key, label: campo.label || "", type: campo.type, value: normalizado });

    if (campo.mapTo && DESTINOS.includes(campo.mapTo)) {
      destinos[campo.mapTo] = normalizado;
    }
  }

  if (errores.length) return { ok: false, errores };
  return { ok: true, answers, destinos, consentimiento };
}

/**
 * Texto libre que NO tiene destino en la ficha, listo para volcarlo en
 * `customFields.info_adicional` con formato "Pregunta:\nRespuesta".
 */
export function infoAdicional(form, answers) {
  const conDestino = new Set(camposDe(form).filter((c) => c.mapTo).map((c) => c.key));
  return (answers || [])
    .filter((a) => !conDestino.has(a.key) && a.type !== "consent" && String(a.value || "").trim())
    .map((a) => `${a.label}:\n${a.value}`)
    .join("\n\n");
}

/**
 * Versión de la definición que puede ver el público: sin `settings` (que lleva
 * los correos de aviso internos) y sin nada que no haga falta para pintar.
 */
export function formPublico(form) {
  return {
    slug: form.slug,
    title: form.title,
    introText: form.introText || null,
    submitLabel: form.submitLabel || "Enviar",
    thankYouMessage: form.thankYouMessage || "¡Gracias! Hemos recibido tu solicitud.",
    privacyUrl: form.settings?.privacyUrl || null,
    fields: camposDe(form).map((c) => ({
      key: c.key,
      label: c.label || "",
      type: c.type,
      required: c.required !== false,
      placeholder: c.placeholder || null,
      help: c.help || null,
      options: Array.isArray(c.options) ? c.options : [],
      maxLength: Number(c.maxLength) > 0 ? Number(c.maxLength) : (MAX_POR_TIPO[c.type] || 500),
      min: c.min ?? null,
      max: c.max ?? null,
      linkUrl: c.linkUrl || null,
      linkLabel: c.linkLabel || null,
    })),
  };
}

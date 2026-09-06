"use client";

/**
 * EditorTexto — el bloque de texto del correo: negrita, cursiva, subrayado,
 * enlace y lista. Nada más a propósito (decisión 1.3 del plan: bloques con
 * HTML probado, nunca lienzo libre). Lo que se escribe aquí lo sanea el
 * servidor a la misma lista blanca al guardar (lib/mailing/bloques.js), así
 * que pegar desde Word o desde la web no cuela estilos ni scripts.
 *
 * Es un `contentEditable` con `document.execCommand`: obsoleto en la
 * especificación, pero es lo que siguen usando Gmail y medio internet para
 * seis botones, y no mete ninguna dependencia.
 */

import { useEffect, useRef } from "react";

const BOTONES = [
  { cmd: "bold", label: "N", title: "Negrita", cls: "font-bold" },
  { cmd: "italic", label: "C", title: "Cursiva", cls: "italic" },
  { cmd: "underline", label: "S", title: "Subrayado", cls: "underline" },
  { cmd: "insertUnorderedList", label: "• Lista", title: "Lista" },
];

export default function EditorTexto({ html, onChange, pedirEnlace, disabled = false }) {
  const ref = useRef(null);
  const ultimoEmitido = useRef(html ?? "");

  // El HTML inicial (ya saneado por el servidor) se pinta una vez; después
  // manda lo que la persona escribe. Si llega otro distinto desde fuera
  // (cargar una plantilla), se vuelve a pintar.
  useEffect(() => {
    if (!ref.current) return;
    if ((html ?? "") !== ultimoEmitido.current) {
      ref.current.innerHTML = html || "<p></p>";
      ultimoEmitido.current = html ?? "";
    }
  }, [html]);

  useEffect(() => {
    if (ref.current && !ref.current.innerHTML) ref.current.innerHTML = html || "<p></p>";
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* navegador sin soporte */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitir = () => {
    if (!ref.current) return;
    const v = ref.current.innerHTML;
    ultimoEmitido.current = v;
    onChange(v);
  };

  const ejecutar = (cmd, valor = null) => {
    ref.current?.focus();
    document.execCommand(cmd, false, valor);
    emitir();
  };

  const enlazar = async () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      await pedirEnlace?.({ soloAviso: true });
      return;
    }
    const rango = sel.getRangeAt(0).cloneRange();
    const url = await pedirEnlace?.();
    if (!url) return;
    const nueva = window.getSelection();
    nueva.removeAllRanges();
    nueva.addRange(rango);
    ejecutar("createLink", url.trim());
  };

  return (
    <div className={`rounded-lg border border-neutral-200 bg-white ${disabled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-100 px-2 py-1">
        {BOTONES.map((b) => (
          <button
            key={b.cmd}
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ejecutar(b.cmd)}
            title={b.title}
            className={`px-2 py-1 text-xs rounded hover:bg-neutral-100 text-neutral-700 ${b.cls ?? ""}`}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={enlazar}
          title="Enlace (selecciona texto primero)"
          className="px-2 py-1 text-xs rounded hover:bg-neutral-100 text-neutral-700"
        >
          🔗 Enlace
        </button>
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ejecutar("unlink")}
          title="Quitar enlace"
          className="px-2 py-1 text-xs rounded hover:bg-neutral-100 text-neutral-500"
        >
          Quitar enlace
        </button>
        <span className="ml-auto text-[10px] text-neutral-400 pr-1">{"{{nombre}}"} = nombre del destinatario</span>
      </div>
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emitir}
        onBlur={emitir}
        onPaste={(e) => {
          // Pegar como texto plano: lo que venga con formato de Word no aporta
          // nada que el correo pueda usar y sí basura que el servidor tendría
          // que tirar.
          e.preventDefault();
          const texto = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, texto);
        }}
        className="min-h-[96px] px-3 py-2 text-sm text-neutral-800 leading-relaxed focus:outline-none [&_a]:underline [&_a]:text-sky-700 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2"
      />
    </div>
  );
}

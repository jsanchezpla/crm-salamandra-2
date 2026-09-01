// La tarjeta de un módulo en la portada (01/09/2026, Rodrigo). UNA sola para
// todos —Proyectos, Soporte, Leads, Formación, Fichas—, porque todas dicen lo
// mismo con datos distintos: dos cifras de titular y hasta cuatro líneas de
// detalle. El servidor decide qué tarjetas hay (lib/home/summary.js); esto solo
// las pinta.
//
// Mismo lenguaje visual que el resto de la portada: caja blanca con borde
// `--ink-200`, radio de tarjeta, la cifra en `font-display` y el rótulo en
// versalitas. Nada de un estilo propio por módulo: la portada tiene que leerse
// como UNA pantalla, no como cinco widgets pegados.

const TONO_CIFRA = {
  rojo: "text-red-600",
  cobre: "text-amber-600",
};

function Linea({ item }) {
  const contenido = (
    <>
      <span className="flex-1 min-w-0 truncate text-[var(--ink-900)]">{item.titulo}</span>
      {item.sub && <span className="shrink-0 text-[10px] text-[var(--ink-400)] truncate max-w-[38%]">{item.sub}</span>}
      {item.extra && (
        <span className={`shrink-0 text-[10px] font-medium ${item.tono === "rojo" ? "text-red-600" : "text-[var(--ink-500)]"}`}>
          {item.extra}
        </span>
      )}
    </>
  );
  const clase =
    "flex items-center gap-2 py-1.5 border-t border-[var(--ink-100)] first:border-t-0 text-[12.5px]";
  return item.href ? (
    <a href={item.href} className={`${clase} hover:text-[var(--color-primary)] transition-colors`}>
      {contenido}
    </a>
  ) : (
    <div className={clase}>{contenido}</div>
  );
}

export default function TarjetaModulo({ tarjeta }) {
  if (!tarjeta) return null;
  const { titulo, href, cifras = [], lista = [], vacio, verMas } = tarjeta;

  return (
    <div className="bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-4 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[13px] font-semibold text-[var(--ink-900)]">{titulo}</div>
        {href && (
          <a
            href={href}
            className="text-[11px] text-[var(--ink-400)] hover:text-[var(--color-primary)] transition-colors shrink-0"
          >
            Abrir →
          </a>
        )}
      </div>

      {cifras.length > 0 && (
        <div className="flex items-end gap-5 mb-2">
          {cifras.map((c, i) => (
            <div key={i} className="min-w-0">
              <div className={`font-display text-[22px] leading-none tracking-tight ${TONO_CIFRA[c.tono] || "text-[var(--ink-900)]"}`}>
                {c.valor}
              </div>
              <div className={`text-[10px] mt-1 truncate ${TONO_CIFRA[c.tono] || "text-[var(--ink-500)]"}`}>{c.etiqueta}</div>
            </div>
          ))}
        </div>
      )}

      {lista.length > 0 ? (
        // `overflow-y-auto` sobre `min-h-0`: las tarjetas de una fila miden lo
        // mismo (`auto-rows-fr` en la portada) y la que traiga más líneas
        // desplaza LAS SUYAS dentro de su caja. Sin esto, la última fila se
        // cortaba por la mitad y parecía un fallo de pintado.
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {verMas && (
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-400)] mb-1">
              {verMas}
            </div>
          )}
          {lista.map((item) => (
            <Linea key={item.id} item={item} />
          ))}
        </div>
      ) : (
        vacio && <div className="text-[12px] text-[var(--ink-400)] leading-relaxed">{vacio}</div>
      )}
    </div>
  );
}

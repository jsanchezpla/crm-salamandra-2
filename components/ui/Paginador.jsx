"use client";

/**
 * Paginador — «51–100 de 1.110» con Anterior / Siguiente.
 *
 * (Componente nuevo, 02/08/2026.) Salió al importar Aumenta: las listas de
 * Clientes, Pacientes, Facturas y Gastos pedían un número fijo de filas (200 o
 * 300) y NO mandaban página. Con pocos registros no se notaba; con 1.110
 * clientes y 14.243 facturas, todo lo que pasara del corte era invisible y no
 * había forma de llegar a ello.
 *
 * Se hace componente porque son cuatro pantallas con el mismo problema, y
 * cualquier lista que crezca tendrá el mismo.
 *
 * No se pinta si solo hay una página: un paginador de "página 1 de 1" es ruido.
 */
export default function Paginador({ pagina, paginas, total, porPagina, onCambio, cargando = false }) {
  if (!paginas || paginas <= 1) return null;

  const desde = (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[var(--line,#e5e5e5)] text-xs">
      <span className="text-[var(--ink-400,#a3a3a3)]">
        {desde}–{hasta} de {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onCambio(Math.max(1, pagina - 1))}
          disabled={pagina === 1 || cargando}
          className="px-3 py-1.5 rounded-md border border-[var(--line,#e5e5e5)] text-[var(--ink-700,#404040)] hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent transition"
        >
          Anterior
        </button>
        <span className="px-2 text-[var(--ink-400,#a3a3a3)] whitespace-nowrap">
          Página {pagina} de {paginas}
        </span>
        <button
          type="button"
          onClick={() => onCambio(Math.min(paginas, pagina + 1))}
          disabled={pagina === paginas || cargando}
          className="px-3 py-1.5 rounded-md border border-[var(--line,#e5e5e5)] text-[var(--ink-700,#404040)] hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent transition"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

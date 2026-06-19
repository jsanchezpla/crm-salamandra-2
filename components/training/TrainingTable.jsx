export function TrainingTable({ headers, children, loading, empty }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
              {headers.map((h, i) => (
                <th
                  key={typeof h === "string" ? h : i}
                  className="text-left py-3 px-4 text-[11px] font-semibold text-white/70 uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <tr key={rowIndex} className="border-b border-neutral-50">
                  {headers.map((h, headerIndex) => (
                    <td key={typeof h === "string" ? h : headerIndex} className="py-3 px-4">
                      {/* Width determinista para evitar hydration mismatch
                          entre SSR y cliente. Antes usaba Math.random(). */}
                      <div
                        className="h-4 bg-neutral-100 rounded animate-pulse"
                        style={{ width: `${50 + ((headerIndex * 17 + rowIndex * 13) % 40)}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : children}
          </tbody>
        </table>
      </div>
      {!loading && !children?.length && empty && (
        <div className="py-16 text-center text-neutral-400 text-sm">{empty}</div>
      )}
    </div>
  );
}

export function Tr({ children, onClick }) {
  const interactive = typeof onClick === "function";
  return (
    <tr
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
      className={`border-b border-neutral-50 last:border-0 transition-colors ${
        interactive
          ? "cursor-pointer hover:bg-neutral-50/80 focus:outline-none focus-visible:bg-neutral-50/80 focus-visible:ring-1 focus-visible:ring-neutral-300"
          : ""
      }`}
    >
      {children}
    </tr>
  );
}

export function Td({ children, className = "" }) {
  return (
    <td className={`py-3 px-4 text-neutral-700 text-xs ${className}`}>{children}</td>
  );
}

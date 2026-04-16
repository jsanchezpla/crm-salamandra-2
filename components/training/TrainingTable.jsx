export function TrainingTable({ headers, children, loading, empty }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
              {headers.map((h) => (
                <th
                  key={h}
                  className="text-left py-3 px-4 text-[11px] font-semibold text-white/70 uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-neutral-50">
                  {headers.map((h) => (
                    <td key={h} className="py-3 px-4">
                      <div className="h-4 bg-neutral-100 rounded animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} />
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
  return (
    <tr
      onClick={onClick}
      className={`border-b border-neutral-50 last:border-0 transition-colors ${
        onClick ? "cursor-pointer hover:bg-neutral-50/80" : ""
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

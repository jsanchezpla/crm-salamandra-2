"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TrainingTable, Tr, Td } from "../../../../components/training/TrainingTable.jsx";

export default function CursosPage() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/training/courses")
      .then((r) => r.json())
      .then((json) => {
        if (!json.data) throw new Error(json.error || "Error al cargar cursos");
        setCourses(json.data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
            Cursos
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">{courses.length} cursos</p>
        </div>
        <Link href="/formacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
          ← Volver
        </Link>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <TrainingTable
        headers={["Nombre", "ID WordPress", "ID WooCommerce", "Estado", ""]}
        loading={loading}
        empty="No hay cursos registrados"
      >
        {courses.map((c) => (
          <Tr key={c.id}>
            <Td><span className="font-semibold text-neutral-900">{c.name}</span></Td>
            <Td>{c.wpCourseId ?? <span className="text-neutral-300">—</span>}</Td>
            <Td>{c.wcProductId ?? <span className="text-neutral-300">—</span>}</Td>
            <Td>
              <span className={`text-[11px] font-medium ${c.active ? "text-emerald-600" : "text-neutral-400"}`}>
                {c.active ? "Activo" : "Inactivo"}
              </span>
            </Td>
            <Td className="text-right">
              <span className="text-[10px] text-neutral-300">
                {new Date(c.createdAt).toLocaleDateString("es-ES")}
              </span>
            </Td>
          </Tr>
        ))}
      </TrainingTable>
    </div>
  );
}

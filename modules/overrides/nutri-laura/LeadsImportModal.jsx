"use client";

// modules/overrides/nutri-laura/LeadsImportModal.jsx — el importador de CSV
// del embudo de Laura: el mapa de cabeceras que entiende, la traducción de
// etapas escritas en español y el modal de importar con su vista previa.
// Pieza del override LeadsModule.jsx, solo de nutri_laura.

// ─── Parser CSV ───────────────────────────────────────────────────────────────


import { useRef, useState } from "react";
const CSV_HEADER_MAP = {
  nombre: "name",
  name: "name",
  paciente: "name",
  email: "email",
  correo: "email",
  "e-mail": "email",
  telefono: "phone",
  teléfono: "phone",
  phone: "phone",
  movil: "phone",
  móvil: "phone",
  edad: "edad",
  age: "edad",
  motivo: "motivo",
  "que te gustaria trabajar": "motivo",
  "qué te gustaría trabajar": "motivo",
  objetivo: "motivo",
  "info adicional": "info_adicional",
  "información adicional": "info_adicional",
  "informacion adicional": "info_adicional",
  "algo mas que deba saber": "info_adicional",
  "algo más que deba saber": "info_adicional",
  observaciones: "info_adicional",
  notas: "notes",
  notes: "notes",
  comentarios: "notes",
  estado: "stage",
  stage: "stage",
  fase: "stage",
  origen: "source",
  source: "source",
  fuente: "source",
};

const STAGE_MAP = {
  nuevo: "new",
  new: "new",
  "nuevo lead": "new",
  contactado: "contacted",
  contacted: "contacted",
  "consulta agendada": "consulta_agendada",
  consulta_agendada: "consulta_agendada",
  "consulta realizada": "consulta_realizada",
  consulta_realizada: "consulta_realizada",
  "paciente activo": "paciente",
  paciente: "paciente",
  descartado: "lost",
  lost: "lost",
};

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { error: "El CSV debe tener al menos una fila de cabeceras y una de datos." };
  }
  const firstLine = lines[0];
  const sep = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";

  function splitLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else inQuotes = !inQuotes;
      } else if (ch === sep && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rawHeaders = splitLine(lines[0]).map((h) => h.toLowerCase().trim());
  const mappedHeaders = rawHeaders.map((h) => CSV_HEADER_MAP[h] || h);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = splitLine(lines[i]);
    const obj = {};
    mappedHeaders.forEach((key, idx) => {
      obj[key] = values[idx] ?? "";
    });
    if (obj.stage) obj.stage = STAGE_MAP[obj.stage.toLowerCase()] || "new";
    rows.push(obj);
  }
  return { headers: mappedHeaders, rows };
}

// ─── Modal de importación (CSV + Excel) ──────────────────────────────────────

export function ImportModal({ onClose, onImported }) {
  const [tab, setTab] = useState("file");
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);
  const [fileType, setFileType] = useState("csv");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function isExcel(file) {
    const name = file.name?.toLowerCase() ?? "";
    return name.endsWith(".xlsx") || name.endsWith(".xls");
  }

  function handleFileRead(file) {
    if (!file) return;
    setCurrentFile(file);
    if (isExcel(file)) {
      setFileType("excel");
      setParsed({ isExcel: true, fileName: file.name });
    } else {
      setFileType("csv");
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        setCsvText(text);
        setParsed(parseCSV(text));
      };
      reader.readAsText(file, "UTF-8");
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileRead(file);
  }

  function handlePasteChange(e) {
    const text = e.target.value;
    setCsvText(text);
    setCurrentFile(null);
    setFileType("csv");
    setParsed(text.trim() ? parseCSV(text) : null);
  }

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    try {
      let res;
      if (fileType === "excel" && currentFile) {
        const formData = new FormData();
        formData.append("file", currentFile);
        res = await fetch("/api/leads/import/excel", { method: "POST", body: formData });
      } else {
        if (!parsed.rows?.length) return;

        const formattedLeads = parsed.rows.map((row) => ({
          name: row.name || null,
          email: row.email || null,
          phone: row.phone || null,
          stage: row.stage || "new",
          notes: row.notes || null,
          source: row.source || "importacion_csv",
          customFields: {
            edad: row.edad || null,
            motivo: row.motivo || null,
            info_adicional: row.info_adicional || null,
          },
        }));

        res = await fetch("/api/leads/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: formattedLeads }),
        });
      }
      const data = await res.json();
      setResult(data.ok ? data.data : { error: data.error || "Error desconocido" });
    } catch {
      setResult({ error: "Error de red al importar" });
    } finally {
      setImporting(false);
    }
  }

  function handleClose() {
    if (result?.imported > 0) onImported();
    else onClose();
  }

  function resetFile() {
    setParsed(null);
    setCurrentFile(null);
    setCsvText("");
    setFileType("csv");
  }

  const canImport = parsed && !parsed.error && (parsed.isExcel || (parsed.rows?.length ?? 0) > 0);

  const PREVIEW_COLS = ["name", "email", "phone", "edad", "motivo", "stage"];
  const PREVIEW_LABELS = {
    name: "Nombre",
    email: "Email",
    phone: "Teléfono",
    edad: "Edad",
    motivo: "Motivo",
    stage: "Estado",
  };
  const previewCols = parsed?.headers ? PREVIEW_COLS.filter((c) => parsed.headers.includes(c)) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-gray-900 font-semibold text-base">Importar leads</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              Excel (.xlsx) o CSV · Campos: nombre, email, teléfono, edad, motivo, info adicional
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-5 h-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="py-6 text-center">
              {result.error ? (
                <>
                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-6 h-6 text-red-500"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                      />
                    </svg>
                  </div>
                  <p className="text-red-600 font-medium">{result.error}</p>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-6 h-6 text-green-600"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  </div>
                  <p className="text-gray-900 font-semibold text-lg">
                    {result.imported} leads importados
                  </p>
                  {result.skipped > 0 && (
                    <p className="text-gray-400 text-sm mt-1">
                      {result.skipped} filas omitidas (sin datos)
                    </p>
                  )}
                  {result.errors?.length > 0 && (
                    <p className="text-red-500 text-sm mt-1">
                      {result.errors.length} errores en filas:{" "}
                      {result.errors.map((e) => e.row).join(", ")}
                    </p>
                  )}
                </>
              )}
              <button
                onClick={handleClose}
                className="mt-5 bg-[var(--color-primary)] text-white px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {result.imported > 0 ? "Ver leads" : "Cerrar"}
              </button>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
                {[
                  {
                    key: "file",
                    label: "Subir archivo",
                    icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
                  },
                  {
                    key: "paste",
                    label: "Pegar CSV",
                    icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
                  },
                ].map(({ key, label, icon }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setTab(key);
                      resetFile();
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                      tab === key
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-4 h-4"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                    </svg>
                    {label}
                  </button>
                ))}
              </div>

              {/* Zona drop archivo */}
              {tab === "file" && !parsed && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                    dragOver
                      ? "border-[var(--color-primary)] bg-green-50"
                      : "border-gray-200 hover:border-gray-300 bg-gray-50"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="w-10 h-10 text-gray-300 mx-auto mb-3"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                    />
                  </svg>
                  <p className="text-gray-500 text-sm mb-1">
                    Arrastra tu archivo o haz clic para seleccionar
                  </p>
                  <p className="text-gray-400 text-xs mt-1">Excel (.xlsx) o CSV (.csv) · UTF-8</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => handleFileRead(e.target.files[0])}
                    className="hidden"
                  />
                </div>
              )}

              {/* Pegar texto */}
              {tab === "paste" && !parsed && (
                <div>
                  <textarea
                    value={csvText}
                    onChange={handlePasteChange}
                    placeholder={`Pega aquí el CSV. Ejemplo:\n\nnombre,email,telefono,edad,motivo,info_adicional\nMarta López,marta@example.com,600123456,34,Quiero mejorar mi energía,Tengo intolerancia a la lactosa`}
                    rows={10}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:border-[var(--color-primary)] transition-colors resize-none font-mono"
                  />
                  <p className="text-gray-400 text-xs mt-2">
                    Cabeceras reconocidas en español e inglés. Separador: coma o punto y coma.
                  </p>
                </div>
              )}

              {/* Preview Excel */}
              {parsed?.isExcel && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="w-8 h-8 text-green-600 shrink-0"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 truncate">{parsed.fileName}</p>
                    <p className="text-xs text-green-600 mt-0.5">
                      Archivo Excel listo para importar
                    </p>
                  </div>
                  <button
                    onClick={resetFile}
                    className="text-green-400 hover:text-green-600 transition-colors shrink-0"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-4 h-4"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Preview CSV */}
              {parsed && !parsed.isExcel && (
                <div>
                  {parsed.error ? (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
                      {parsed.error}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm text-gray-700 font-medium">
                          {parsed.rows.length} fila{parsed.rows.length !== 1 ? "s" : ""} detectada
                          {parsed.rows.length !== 1 ? "s" : ""}
                        </p>
                        <button
                          onClick={resetFile}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          Limpiar
                        </button>
                      </div>
                      {previewCols.length > 0 && (
                        <div className="rounded-xl border border-gray-200 overflow-hidden mb-3">
                          <div className="overflow-x-auto max-h-48">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-200">
                                  {previewCols.map((c) => (
                                    <th
                                      key={c}
                                      className="text-left py-2 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
                                    >
                                      {PREVIEW_LABELS[c] ?? c}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {parsed.rows.slice(0, 5).map((row, i) => (
                                  <tr key={i} className="border-b border-gray-100">
                                    {previewCols.map((c) => (
                                      <td
                                        key={c}
                                        className="py-2 px-3 text-gray-600 max-w-[140px] truncate"
                                      >
                                        {row[c] || <span className="text-gray-300">—</span>}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {parsed.rows.length > 5 && (
                            <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-400">
                              + {parsed.rows.length - 5} filas más
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
            <button
              onClick={handleClose}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={handleImport}
              disabled={!canImport || importing}
              className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition-opacity"
            >
              {importing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Importando…
                </>
              ) : (
                <>
                  Importar
                  {!parsed?.isExcel && parsed?.rows?.length ? ` ${parsed.rows.length} leads` : ""}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

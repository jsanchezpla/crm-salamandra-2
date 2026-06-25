"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import { CuestionariosDashboard } from "./CuestionariosDashboard.jsx";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(raw) {
  if (!raw) return "—";
  return new Date(raw).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSeconds(secs) {
  if (secs == null) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function pct(earned, total) {
  if (!total) return "—";
  return `${Math.round((earned / total) * 100)}%`;
}

// ── Badge resultado ───────────────────────────────────────────────────────────

function ResultBadge({ result }) {
  if (!result) return <span className="text-neutral-300">—</span>;
  const isPass = result === "pass";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
        isPass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
      }`}
    >
      {isPass ? "Aprobado" : "Suspenso"}
    </span>
  );
}

// ── Icono por tipo de pregunta ────────────────────────────────────────────────

function QuestionTypeIcon({ type }) {
  const base = "w-7 h-7 rounded flex items-center justify-center shrink-0";
  if (type === "multiple_choice" || type === "single_choice") {
    return (
      <span className={`${base} bg-violet-500`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      </span>
    );
  }
  if (type === "true_false") {
    return (
      <span className={`${base} bg-blue-500`}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`${base} bg-neutral-400`}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white">
        <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z" />
      </svg>
    </span>
  );
}

// ── Stat chip para el resumen ─────────────────────────────────────────────────

function StatChip({ label, value, color }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider leading-none">
        {label}
      </span>
      <span className={`text-sm font-bold leading-tight ${color ?? "text-neutral-800"}`}>
        {value}
      </span>
    </div>
  );
}

// ── Vista detalle de un intento ────────────────────────────────────────────────

function AttemptDetail({ attempt, onBack }) {
  const initials = (attempt.studentName ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-5">
      {/* Botón volver */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Volver
      </button>

      {/* Título */}
      <div>
        <p className="text-xs text-neutral-400 mb-0.5">
          Curso: <span className="text-neutral-600">{attempt.courseTitle ?? "—"}</span>
        </p>
        <h2 className="text-base sm:text-lg font-bold text-neutral-900 flex items-center gap-2">
          <span>Cuestionario: {attempt.quizTitle ?? "—"}</span>
          <HelpTooltip title="Detalle del intento">
            Aquí ves toda la información de un examen concreto: quién lo hizo, cuándo, cuánto tardó,
            qué nota mínima hacía falta para aprobar y, debajo, todas las preguntas con la respuesta
            que dio el alumno y la respuesta correcta. Útil para repasar resultados con un alumno
            o para ver qué preguntas falla más gente.
          </HelpTooltip>
        </h2>
      </div>

      {/* ── Ficha resumen — móvil: card apilada / desktop: tabla ── */}

      {/* Móvil */}
      <div className="sm:hidden bg-white border border-neutral-100 rounded-xl p-4 space-y-4">
        {/* Estudiante + resultado */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-700 shrink-0">
              {initials}
            </div>
            <div>
              <div className="font-semibold text-sm text-neutral-800">{attempt.studentName ?? "—"}</div>
              <div className="text-[11px] text-neutral-400 break-all">{attempt.studentEmail ?? ""}</div>
            </div>
          </div>
          <ResultBadge result={attempt.result} />
        </div>

        {/* Fecha */}
        <div className="text-xs text-neutral-500">
          <span className="font-medium text-neutral-400 uppercase tracking-wider text-[10px]">Fecha </span>
          {formatDate(attempt.attemptDate)}
        </div>

        {/* Grid de stats 2 columnas */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1 border-t border-neutral-50">
          <StatChip label="Preguntas" value={attempt.totalQuestions ?? "—"} />
          <StatChip label="T. intento" value={formatSeconds(attempt.attemptTime)} />
          <StatChip label="Pts. totales" value={attempt.totalPoints ?? "—"} />
          <StatChip
            label="Nota aprobado"
            value={
              attempt.passingPoints != null
                ? `${attempt.passingPoints} (${pct(attempt.passingPoints, attempt.totalPoints)})`
                : "—"
            }
          />
          <StatChip label="Correctas" value={attempt.correctAnswers ?? "—"} color="text-emerald-600" />
          <StatChip label="Incorrectas" value={attempt.incorrectAnswers ?? "—"} color="text-red-500" />
          <StatChip
            label="Pts. ganados"
            value={
              attempt.earnedPoints != null
                ? `${attempt.earnedPoints} (${pct(attempt.earnedPoints, attempt.totalPoints)})`
                : "—"
            }
            color="text-[var(--color-primary)]"
          />
          <StatChip label="T. cuestionario" value={formatSeconds(attempt.quizTime)} />
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden sm:block bg-white border border-neutral-100 rounded-xl overflow-x-auto">
        <table className="w-full text-xs min-w-[700px]">
          <thead>
            <tr className="border-b border-neutral-100">
              {[
                "Intento por", "Fecha", "Preguntas", "T. cuestionario",
                "T. intento", "Pts. totales", "Nota aprobado",
                "Correctas", "Incorrectas", "Pts. ganados", "Resultado",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-[11px] font-semibold text-violet-700 shrink-0">
                    {initials}
                  </div>
                  <div>
                    <div className="font-medium text-neutral-800">{attempt.studentName ?? "—"}</div>
                    <div className="text-[10px] text-neutral-400">{attempt.studentEmail ?? ""}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-4 text-neutral-600 whitespace-nowrap">{formatDate(attempt.attemptDate)}</td>
              <td className="px-4 py-4 text-neutral-800 font-medium">{attempt.totalQuestions ?? "—"}</td>
              <td className="px-4 py-4 text-neutral-600">{formatSeconds(attempt.quizTime)}</td>
              <td className="px-4 py-4 text-neutral-600">{formatSeconds(attempt.attemptTime)}</td>
              <td className="px-4 py-4 text-neutral-800 font-medium">{attempt.totalPoints ?? "—"}</td>
              <td className="px-4 py-4 text-neutral-600">
                {attempt.passingPoints != null
                  ? `${attempt.passingPoints} (${pct(attempt.passingPoints, attempt.totalPoints)})`
                  : "—"}
              </td>
              <td className="px-4 py-4 text-emerald-700 font-medium">{attempt.correctAnswers ?? "—"}</td>
              <td className="px-4 py-4 text-red-500 font-medium">{attempt.incorrectAnswers ?? "—"}</td>
              <td className="px-4 py-4 text-neutral-800 font-medium">
                {attempt.earnedPoints != null
                  ? `${attempt.earnedPoints} (${pct(attempt.earnedPoints, attempt.totalPoints)})`
                  : "—"}
              </td>
              <td className="px-4 py-4"><ResultBadge result={attempt.result} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Preguntas ── */}
      {Array.isArray(attempt.answers) && attempt.answers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-neutral-700 mb-3 flex items-center gap-2">
            Resumen del cuestionario
            <HelpTooltip title="Resumen pregunta a pregunta">
              Cada fila es una pregunta del cuestionario. Verás qué contestó el alumno y, si falló,
              cuál era la respuesta correcta. Los iconos de la izquierda indican el tipo de pregunta
              (selección, verdadero/falso, etc.).
            </HelpTooltip>
          </h3>

          {/* Móvil: cards */}
          <div className="sm:hidden space-y-3">
            {attempt.answers.map((ans) => (
              <div
                key={ans.no}
                className={`bg-white border rounded-xl p-4 space-y-3 ${
                  ans.isCorrect ? "border-emerald-100" : "border-red-100"
                }`}
              >
                {/* Cabecera pregunta */}
                <div className="flex items-start gap-3">
                  <span className="text-[11px] font-bold text-neutral-400 w-5 shrink-0 mt-0.5">
                    {ans.no}
                  </span>
                  <QuestionTypeIcon type={ans.type} />
                  <p className="flex-1 text-xs text-neutral-700 leading-relaxed">{ans.question || "—"}</p>
                  {/* Reseña */}
                  {ans.isCorrect ? (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded border border-emerald-200 bg-emerald-50 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-emerald-600">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded border border-red-200 bg-red-50 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-red-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}
                </div>

                {/* Respuestas */}
                <div className="grid grid-cols-1 gap-2 pl-8">
                  <div>
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                      Respuesta dada
                    </span>
                    <p className={`text-xs mt-0.5 ${ans.isCorrect ? "text-emerald-700" : "text-red-600"}`}>
                      {ans.givenAnswer || "—"}
                    </p>
                  </div>
                  {!ans.isCorrect && (
                    <div>
                      <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                        Respuesta correcta
                      </span>
                      <p className="text-xs text-neutral-700 mt-0.5">{ans.correctAnswer || "—"}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: tabla */}
          <div className="hidden sm:block bg-white border border-neutral-100 rounded-xl overflow-x-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-neutral-100">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest w-10">No</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest w-12">Tipo</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Pregunta</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Respuesta dada</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Respuesta correcta</th>
                  <th className="text-center px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest w-24">Resultado</th>
                  <th className="text-center px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest w-16">Reseña</th>
                </tr>
              </thead>
              <tbody>
                {attempt.answers.map((ans) => (
                  <tr
                    key={ans.no}
                    className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/60 transition-colors"
                  >
                    <td className="px-4 py-3 text-neutral-400 font-medium">{ans.no}</td>
                    <td className="px-4 py-3"><QuestionTypeIcon type={ans.type} /></td>
                    <td className="px-4 py-3 text-neutral-700 leading-relaxed max-w-xs">{ans.question || "—"}</td>
                    <td className="px-4 py-3 text-neutral-600">{ans.givenAnswer || "—"}</td>
                    <td className="px-4 py-3 text-neutral-600">{ans.correctAnswer || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {ans.isCorrect ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700">
                          Correcto
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600">
                          Incorrecto
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {ans.isCorrect ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded border border-emerald-200 bg-emerald-50">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-emerald-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded border border-red-200 bg-red-50">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-red-500">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vista lista ───────────────────────────────────────────────────────────────

function AttemptsList({ filters, onFiltersChange, onSelect }) {
  const { search, companyName, courseId, quizId } = filters;

  const [attempts, setAttempts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [quizzesSyncUrl, setQuizzesSyncUrl] = useState(null);
  const [syncInstructionsOpen, setSyncInstructionsOpen] = useState(false);

  // Listas para los dropdowns (poblados desde endpoints auxiliares).
  const [coursesList, setCoursesList] = useState([]);
  const [quizzesList, setQuizzesList] = useState([]);
  const [companiesList, setCompaniesList] = useState([]);

  const LIMIT = 50;

  function setFilter(key, value) {
    onFiltersChange({ ...filters, [key]: value });
    setPage(0);
  }

  // Cambiar curso resetea cuestionario (otro curso → otros quizzes).
  function setCourse(value) {
    onFiltersChange({ ...filters, courseId: value, quizId: "" });
    setPage(0);
  }

  function clearQuiz() {
    onFiltersChange({ ...filters, quizId: "" });
    setPage(0);
  }

  // Cursos y empresas: sin dependencias (1 fetch al montar).
  useEffect(() => {
    fetch("/api/training/quiz-attempts/courses-list")
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setCoursesList(j.data.items || []); })
      .catch(() => { /* silencioso: dropdown queda vacío */ });
    fetch("/api/training/quiz-attempts/companies-list")
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setCompaniesList(j.data.items || []); })
      .catch(() => { /* silencioso */ });
  }, []);

  // Quizzes: refetch al cambiar curso o empresa.
  useEffect(() => {
    const params = new URLSearchParams();
    if (courseId) params.set("courseId", String(courseId));
    if (companyName) params.set("companyName", companyName);
    fetch(`/api/training/quiz-attempts/quizzes-list?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setQuizzesList(j.data.items || []); })
      .catch(() => { /* silencioso */ });
  }, [courseId, companyName]);

  // Banner de sync de cuestionarios — solo aparece si el tenant tiene
  // configurada la env var {SLUG_UPPER}_TUTOR_QUIZZES_SYNC_URL. Hoy aplica
  // a Retorika; cuando otros tenants conecten su TutorLMS y exporten
  // intentos, basta con configurar su variable.
  useEffect(() => {
    fetch("/api/training/sync-status")
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && j.data?.quizzesSyncEnabled) {
          setQuizzesSyncUrl(j.data.quizzesSyncUrl);
        }
      })
      .catch(() => {
        /* silencioso: si falla, simplemente no mostramos banner */
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: LIMIT, offset: page * LIMIT });
    if (search) params.set("search", search);
    if (companyName) params.set("companyName", companyName);
    if (courseId) params.set("courseId", String(courseId));
    if (quizId) params.set("quizId", String(quizId));

    try {
      const res = await fetch(`/api/training/quiz-attempts?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setAttempts(data.data.attempts);
        setTotal(data.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [search, companyName, courseId, quizId, page]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/formacion"
            className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors"
          >
            ← Volver
          </Link>
          <h1 className="text-xl font-extrabold text-neutral-900 flex items-center gap-2">
            Cuestionarios
            <HelpTooltip title="Cuestionarios">
              Aquí ves los exámenes que han hecho tus alumnos en cada curso. Cada línea es un intento:
              quién lo hizo, en qué cuestionario, cuánto tardó, cuántas preguntas acertó y si aprobó
              o suspendió. Pulsa una línea para abrir el detalle y ver pregunta por pregunta qué
              contestó cada alumno.
            </HelpTooltip>
          </h1>
        </div>
      </div>

      {/* Aviso de sincronización (solo si el tenant lo tiene configurado) */}
      {quizzesSyncUrl && (
        <QuizzesSyncNotice
          syncUrl={quizzesSyncUrl}
          onOpenInstructions={() => setSyncInstructionsOpen(true)}
        />
      )}

      {/* Filtros */}
      <div className="flex flex-col gap-2">
        {/* Fila 1: search + empresa */}
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <HelpTooltip title="Filtros" className="hidden sm:inline-flex">
            Acota lista y dashboard a la vez. Curso + Cuestionario son los más útiles para analizar
            preguntas concretas. Empresa filtra por el campo libre que TutorLMS adjunta al intento.
          </HelpTooltip>
          <input
            type="text"
            placeholder="Buscar estudiante, quiz, curso…"
            value={search}
            onChange={(e) => setFilter("search", e.target.value)}
            className="flex-1 text-xs px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)]"
          />
          <select
            value={companyName}
            onChange={(e) => setFilter("companyName", e.target.value)}
            className="w-full sm:w-52 text-xs px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] bg-white"
          >
            <option value="">Todas las empresas</option>
            {companiesList.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        </div>
        {/* Fila 2: curso + cuestionario */}
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <select
            value={courseId}
            onChange={(e) => setCourse(e.target.value)}
            className="w-full sm:flex-1 text-xs px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] bg-white"
          >
            <option value="">Todos los cursos</option>
            {coursesList.map((c) => (
              <option key={c.wpCourseId} value={c.wpCourseId}>
                {c.courseTitle ?? `Curso ${c.wpCourseId}`} ({c.count})
              </option>
            ))}
          </select>
          <div className="w-full sm:flex-1 flex gap-1">
            <select
              value={quizId}
              onChange={(e) => setFilter("quizId", e.target.value)}
              className="flex-1 min-w-0 text-xs px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] bg-white"
            >
              <option value="">Todos los cuestionarios</option>
              {quizzesList.map((q) => (
                <option key={q.wpQuizId} value={q.wpQuizId}>
                  {q.quizTitle ?? `Quiz ${q.wpQuizId}`} ({q.count})
                </option>
              ))}
            </select>
            {quizId && (
              <button
                type="button"
                onClick={clearQuiz}
                title="Quitar filtro de cuestionario"
                className="text-xs px-2.5 py-2 border border-neutral-200 rounded-lg text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 transition-colors shrink-0 whitespace-nowrap"
              >
                ✕ Quitar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <p className="text-neutral-400 text-sm py-8 text-center">Cargando…</p>
      ) : attempts.length === 0 ? (
        <div className="text-center py-16 text-neutral-400 text-sm">
          No hay intentos registrados.
          <br />
          <span className="text-xs">Usa «Sincronizar TutorLMS» para importar datos.</span>
        </div>
      ) : (
        <>
          {/* Vista móvil — cards */}
          <div className="sm:hidden space-y-3">
            {attempts.map((a) => (
              <div
                key={a.id}
                onClick={() => onSelect(a.id)}
                className="bg-white border border-neutral-100 rounded-xl p-4 cursor-pointer hover:border-neutral-200 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="font-semibold text-sm text-neutral-800">{a.studentName ?? "—"}</div>
                    <div className="text-[11px] text-neutral-400">{a.studentEmail ?? ""}</div>
                  </div>
                  <ResultBadge result={a.result} />
                </div>
                <div className="text-xs text-neutral-600 mb-1">
                  <span className="font-medium">{a.quizTitle ?? "—"}</span>
                </div>
                <div className="text-[11px] text-neutral-400">{a.courseTitle ?? "—"}</div>
                <div className="flex items-center justify-between mt-3 text-[11px] text-neutral-400">
                  <span>{formatDate(a.attemptDate)}</span>
                  <span>
                    {a.earnedPoints ?? "—"} / {a.totalPoints ?? "—"} pts
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Vista desktop — tabla */}
          <div className="hidden sm:block bg-white border border-neutral-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[900px]">
                <thead>
                  <tr className="border-b border-neutral-100">
                    {[
                      "ID WP",
                      "Fecha",
                      "Estudiante",
                      "Email",
                      "Quiz",
                      "Puntos",
                      "Total",
                      "Estado",
                      "Quiz ID",
                      "Curso ID",
                      "User ID",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors cursor-pointer"
                      onClick={() => onSelect(a.id)}
                    >
                      <td className="px-4 py-3 text-neutral-500">{a.wpAttemptId}</td>
                      <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">
                        {formatDate(a.attemptDate)}
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-800">
                        {a.studentName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{a.studentEmail ?? "—"}</td>
                      <td className="px-4 py-3 text-neutral-700 max-w-[160px] truncate">
                        {a.quizTitle ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-neutral-800 font-medium">
                        {a.earnedPoints ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{a.totalPoints ?? "—"}</td>
                      <td className="px-4 py-3">
                        <ResultBadge result={a.result} />
                      </td>
                      <td className="px-4 py-3 text-neutral-400">{a.wpQuizId}</td>
                      <td className="px-4 py-3 text-neutral-400">{a.wpCourseId}</td>
                      <td className="px-4 py-3 text-neutral-400">{a.wpUserId}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-[10px] font-medium text-[var(--color-primary)] hover:underline">
                          Detalles
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>
                {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} de {total}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1.5 rounded border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition-colors"
                >
                  Anterior
                </button>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition-colors"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {syncInstructionsOpen && quizzesSyncUrl && (
        <QuizzesSyncInstructionsModal
          syncUrl={quizzesSyncUrl}
          onClose={() => setSyncInstructionsOpen(false)}
        />
      )}
    </div>
  );
}

// ── Banner + modal de sync de cuestionarios ───────────────────────────────────

function QuizzesSyncNotice({ syncUrl, onOpenInstructions }) {
  return (
    <div className="px-4 py-3 rounded-lg border border-neutral-200 bg-neutral-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <p className="text-xs text-neutral-600 leading-snug">
        Para sincronizar los cuestionarios de TutorLMS, abre{" "}
        <a
          href={syncUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-neutral-800 underline decoration-dotted break-all hover:text-neutral-900"
        >
          {syncUrl}
        </a>{" "}
        estando logueado como administrador en WordPress.
      </p>
      <button
        onClick={onOpenInstructions}
        className="shrink-0 text-[11px] font-semibold text-neutral-700 underline decoration-dotted hover:text-neutral-900 transition-colors whitespace-nowrap"
      >
        ¿Cómo sincronizar?
      </button>
    </div>
  );
}

function QuizzesSyncInstructionsModal({ syncUrl, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-neutral-900 mb-3">
          Sincronizar cuestionarios desde TutorLMS
        </h2>
        <div className="text-xs text-neutral-600 leading-relaxed space-y-2">
          <p>Para sincronizar los cuestionarios publicados en TutorLMS con el CRM:</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              Accede como administrador a tu WordPress (
              <code className="bg-neutral-100 px-1 rounded">/wp-admin</code>).
            </li>
            <li>
              Abre la siguiente URL en una pestaña nueva del mismo navegador:
              <div className="mt-1 bg-neutral-50 border border-neutral-200 rounded-md px-2 py-1.5 text-[11px] font-mono text-neutral-700 break-all">
                {syncUrl}
              </div>
            </li>
            <li>Verás el resumen de la sincronización en pantalla.</li>
            <li>Vuelve aquí y recarga la página para ver los cuestionarios actualizados.</li>
          </ol>
        </div>
        <div className="flex justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition"
          >
            Cerrar
          </button>
          <a
            href={syncUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
            style={{ background: "var(--color-primary)" }}
          >
            Abrir URL de sincronización
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Módulo principal ──────────────────────────────────────────────────────────

export default function CuestionariosModule() {
  const [selectedId, setSelectedId] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Filtros lift-up: compartidos por Dashboard y AttemptsList. Nombres
  // canónicos del sprint Bloque 3 (companyName en vez de empresa).
  const [filters, setFilters] = useState({
    search: "",
    companyName: "",
    courseId: "",
    quizId: "",
  });

  async function handleSelect(id) {
    setSelectedId(id);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/training/quiz-attempts/${id}`);
      const data = await res.json();
      if (data.ok) setAttempt(data.data);
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleBack() {
    setSelectedId(null);
    setAttempt(null);
  }

  if (selectedId) {
    return (
      <div className="p-4 sm:p-8">
        {loadingDetail ? (
          <p className="text-neutral-400 text-sm py-8 text-center">Cargando detalle…</p>
        ) : attempt ? (
          <AttemptDetail attempt={attempt} onBack={handleBack} />
        ) : (
          <div className="text-center py-8 text-neutral-400 text-sm">
            No se pudo cargar el intento.{" "}
            <button onClick={handleBack} className="underline">
              Volver
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-5">
      <CuestionariosDashboard filters={filters} />
      <AttemptsList
        filters={filters}
        onFiltersChange={setFilters}
        onSelect={handleSelect}
      />
    </div>
  );
}

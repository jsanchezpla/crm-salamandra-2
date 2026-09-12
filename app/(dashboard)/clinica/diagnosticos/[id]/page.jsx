"use client";

/**
 * /clinica/diagnosticos/[id] — la ficha de un expediente de diagnóstico
 * (12/09/2026, segunda entrega; Rodrigo con Isa, Aumenta: «entradas por fecha
 * y título que al final se unen con IA en el informe completo»).
 *
 * La cabecera de la fila de la lista (paciente, producto, terapeuta asignado,
 * barra, estado, dinero y los mismos botones) y debajo tres bloques: los
 * registros de diagnóstico por fecha, las citas con su «Escribir / Seguir
 * registro» y el informe de valoración («Unir en informe» o «Abrir el
 * informe»). Todo vive en `components/clinica/ExpedienteDiagnostico.jsx`;
 * aquí solo se dice qué expediente es, como hace `/clinica/informes/[id]`.
 */

import { useParams } from "next/navigation";
import ExpedienteDiagnostico from "@/components/clinica/ExpedienteDiagnostico.jsx";

export default function ExpedienteDiagnosticoPage() {
  const { id } = useParams();
  return <ExpedienteDiagnostico id={id} />;
}

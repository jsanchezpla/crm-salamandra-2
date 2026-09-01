"use client";

/**
 * /pacientes/[id]/sesiones/nueva — estrenar el registro de una sesión.
 *
 * El formulario vive en `components/clinica/RegistroSesionEditor.jsx`, porque
 * es el MISMO con el que se sigue editando después
 * (`/pacientes/[id]/sesiones/[sesionId]`). Aquí solo se dice qué paciente es.
 *
 * Llegando desde el modal de una cita (`?preparar=1&fecha=…&cita=…`), el editor
 * mira primero si esa cita ya tiene registro y salta al suyo: una cita, un
 * registro (01/09/2026, Rodrigo).
 */

import { useParams } from "next/navigation";
import RegistroSesionEditor from "@/components/clinica/RegistroSesionEditor.jsx";

export default function NuevaSesionPage() {
  const { id } = useParams();
  return <RegistroSesionEditor patientId={id} />;
}

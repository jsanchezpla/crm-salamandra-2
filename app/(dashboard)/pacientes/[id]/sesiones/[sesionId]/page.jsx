"use client";

/**
 * /pacientes/[id]/sesiones/[sesionId] — seguir con el registro de una sesión
 * que YA existe (01/09/2026, Rodrigo: «quiero poder editar a posteriori el
 * propio registro de sesión»).
 *
 * Es la MISMA pantalla con la que se escribió —`RegistroSesionEditor`—, con sus
 * apartados, su plantilla y su material: editar y escribir no pueden ser dos
 * formularios distintos, o el día que uno cambie el otro se queda atrás.
 *
 * Aquí se llega por tres sitios: el botón «Seguir editando» de la ficha del
 * paciente, el del cajón de la sesión, y el salto automático desde el modal de
 * una cita que ya tiene registro.
 *
 * ⚠️ `nueva/` es hermana de esta ruta y gana por ser un segmento fijo: una
 * sesión no puede tener el id «nueva», así que no hay ambigüedad posible.
 */

import { useParams } from "next/navigation";
import RegistroSesionEditor from "@/components/clinica/RegistroSesionEditor.jsx";

export default function EditarSesionPage() {
  const { id, sesionId } = useParams();
  return <RegistroSesionEditor patientId={id} sessionId={sesionId} />;
}

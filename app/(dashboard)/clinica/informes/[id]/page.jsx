"use client";

/**
 * /clinica/informes/[id] — LA pantalla donde se escribe un informe clínico
 * (04/09/2026, Rodrigo: «debería ser la pantalla inicial de creación de un
 * informe tras elegir fecha, paciente y tipo, como la del Registro»).
 *
 * Aquí se llega al crear uno («Nuevo informe», desde Informes o desde la ficha
 * del paciente) y al pulsar «Editar informe» en el cajón de revisión. Es la
 * misma pantalla en los dos casos, como pasa con el registro de sesión: escribir
 * y editar no pueden ser dos formularios distintos, o el día que uno cambie el
 * otro se queda atrás.
 *
 * El formulario vive en `components/clinica/InformeEditor.jsx`; aquí solo se
 * dice qué informe es.
 */

import { useParams } from "next/navigation";
import InformeEditor from "@/components/clinica/InformeEditor.jsx";

export default function InformePage() {
  const { id } = useParams();
  return <InformeEditor reportId={id} />;
}

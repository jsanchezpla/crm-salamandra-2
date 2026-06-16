import { headers } from "next/headers";
import CursoDetailModule from "../../../../../modules/default/CursoDetailModule.jsx";

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `Curso · ${id.slice(0, 8)}` };
}

export default async function CursoDetailPage({ params }) {
  const { id } = await params;
  // Server-side: el middleware ya validó JWT. El client component se encarga
  // del fetch a /api/auth/me + check de moduleAccess.
  await headers(); // mantenemos el await por consistencia con otros wrappers
  return <CursoDetailModule courseId={id} />;
}

import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { enforceRateLimit } from "../../../../../lib/utils/rateLimit.js";
import { NextResponse } from "next/server";
import { origenPermitido } from "../../../../../lib/utils/wpOrigin.js";

// GET /api/cursos-empresas/codigos-cursos/:email
// Endpoint crítico — lo llama WordPress. Respuesta: array plano de wcProductId.
export async function GET(request, { params }) {
  try {
    const limited = enforceRateLimit(request, {
      key: "cursos-empresas-codigos",
      limit: 30,
      windowMs: 60_000,
    });
    if (limited) return limited;

    const ctx = await getTenantContext(request);

    // Este endpoint devuelve QUÉ CURSOS ha comprado un email: sin barrera,
    // cualquiera podía enumerar alumnos del cliente. Lo llama el navegador del
    // alumno desde el WordPress de Retorika, así que se exige que la petición
    // venga de ese dominio (ver lib/utils/wpOrigin.js). Respuesta idéntica a
    // "no hay nada" para no revelar si el email existe.
    if (!origenPermitido(request, ctx.tenant)) {
      return NextResponse.json([]);
    }

    const { TrainingUser, CourseEnrollment, Course } = ctx.tenantModels;

    const { email } = await params;
    const normalizedEmail = decodeURIComponent(email).trim().toLowerCase();

    const user = await TrainingUser.findOne({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return NextResponse.json([]);
    }

    const enrollments = await CourseEnrollment.findAll({
      where: { trainingUserId: user.id },
      include: [{ model: Course, as: "course", attributes: ["wcProductId"] }],
    });

    const productIds = enrollments
      .map((e) => e.course?.wcProductId)
      .filter((id) => id != null);

    return NextResponse.json(productIds);
  } catch (err) {
    return handleRouteError(err);
  }
}

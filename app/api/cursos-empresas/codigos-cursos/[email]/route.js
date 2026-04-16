import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { NextResponse } from "next/server";

// GET /api/cursos-empresas/codigos-cursos/:email
// Endpoint crítico — lo llama WordPress. Respuesta: array plano de wcProductId.
export async function GET(request, { params }) {
  try {
    const ctx = await getTenantContext(request);
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

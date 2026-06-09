import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { enforceRateLimit } from "../../../../../lib/utils/rateLimit.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-tenant",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// POST /api/usuarios/register/empresa
// Llamado por WordPress al registrar un trabajador de empresa.
// Sin JWT — el tenant se identifica por header x-tenant.
export async function POST(request) {
  try {
    const limited = enforceRateLimit(request, {
      key: "usuarios-register-empresa",
      limit: 30,
      windowMs: 60_000,
    });
    if (limited) {
      // CORS abierto en este endpoint (lo invoca el WP de Retorika); las
      // respuestas 4xx también deben llevarlo para que el navegador del
      // alumno no se quede sin ver el mensaje "demasiadas solicitudes".
      for (const [h, v] of Object.entries(CORS_HEADERS)) limited.headers.set(h, v);
      return limited;
    }

    const ctx = await getTenantContext(request);
    const { TrainingUser, Company, Course, CompanyCourse } = ctx.tenantModels;

    const body = await request.json();
    const rawEmail = body.email || body.email_1;
    const rawUsername = body.username || body.text_1;

    if (!rawEmail) {
      return NextResponse.json(
        { ok: false, error: "El email es obligatorio." },
        { status: 422, headers: CORS_HEADERS }
      );
    }

    const email = String(rawEmail).trim().toLowerCase();

    const user = await TrainingUser.findOne({
      where: { email, type: "company" },
      include: [
        {
          model: Company,
          as: "company",
          include: [{ model: Course, as: "courses", through: { attributes: [] } }],
        },
      ],
    });

    if (!user) {
      return NextResponse.json(
        { exists: false, message: "No autorizado para registrarte." },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    if (user.active) {
      return NextResponse.json(
        { exists: true, already_active: true, message: "Usuario ya activo." },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const { CourseEnrollment } = ctx.tenantModels;
    const sequelize = TrainingUser.sequelize;

    // Activación + sincronización de matrículas en una única transacción.
    // Si una de las dos falla, ambos cambios se revierten — el flag `active`
    // y la fila en `course_enrollments` quedan siempre coherentes.
    const courses = user.company?.courses ?? [];
    let newEnrollments = 0;
    let existingEnrollments = 0;

    await sequelize.transaction(async (t) => {
      await user.update({ active: true }, { transaction: t });

      for (const course of courses) {
        const [, created] = await CourseEnrollment.findOrCreate({
          where: { trainingUserId: user.id, courseId: course.id },
          defaults: {
            trainingUserId: user.id,
            courseId: course.id,
            companyId: user.companyId,
            metadata: {
              source: "register_empresa",
              activatedAt: new Date().toISOString(),
            },
          },
          transaction: t,
        });
        if (created) newEnrollments++;
        else existingEnrollments++;
      }
    });

    console.log(
      `[training] activated email=${user.email} companyId=${user.companyId} newEnrollments=${newEnrollments} existingEnrollments=${existingEnrollments}`
    );

    const productIds = courses.filter((c) => c.wcProductId != null).map((c) => c.wcProductId);

    return NextResponse.json(
      {
        exists: true,
        normalized: {
          email: user.email,
          username: rawUsername ? String(rawUsername).trim() : user.username,
        },
        name: user.name,
        product_ids: productIds,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    const response = handleRouteError(err);
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }
}

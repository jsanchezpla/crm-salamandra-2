/**
 * seed-sandbox-fix.js — Re-siembra Nutrición y Cuestionarios en sandbox
 * tras corregir dos errores del seed inicial (unit enum + wpUserId).
 * Limpia la nutrición sembrada a medias antes de recrearla.
 */
import { getTenantDb, closeAllConnections } from "../../lib/db/tenantDb.js";

const SLUG = "sandbox";
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rand(min, max, dec = 0) { const v = Math.random() * (max - min) + min; return dec ? +v.toFixed(dec) : Math.round(v); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function slugify(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
const NOMBRES = ["Carmen", "Roberto", "Lucía", "Andrés", "Mónica", "Javier", "Natalia", "Daniel", "Sara", "Pablo"];
const APELLIDOS = ["Soler", "Fuentes", "Marín", "Herrero", "Romero", "Navarro", "Jiménez", "Vázquez"];

async function main() {
  const { sequelize, models } = getTenantDb(SLUG);
  const { Food, Plan, PlanMeal, PlanMealOption, PlanMealOptionFood, QuizAttempt, Client, Course } = models;

  // 1) Limpiar nutrición sembrada a medias
  process.stdout.write("\n▶ Limpiando nutrición previa...\n");
  await sequelize.query(`TRUNCATE "crm_${SLUG}"."plan_meal_option_foods","crm_${SLUG}"."plan_meal_options","crm_${SLUG}"."plan_meals","crm_${SLUG}"."plans","crm_${SLUG}"."foods" CASCADE`);
  process.stdout.write("  ✓ tablas de nutrición vaciadas\n");

  // 2) Nutrición (unit válido: g/household/free)
  process.stdout.write("\n▶ Sembrando nutrición...\n");
  const foods = [];
  for (const [nm, u] of [["Avena", "g"], ["Plátano", "unidad"], ["Leche desnatada", "ml"], ["Pechuga de pollo", "g"], ["Arroz integral", "g"], ["Huevo", "unidad"], ["Aceite de oliva", "ml"], ["Yogur natural", "g"]]) {
    foods.push(await Food.create({ name: nm, slug: slugify(nm), defaultUnit: u, source: "custom", tags: [] }));
  }
  const clientes = await Client.findAll({ attributes: ["id"], limit: 5 });
  const mk = async (plan) => {
    for (const [mealName, order] of [["Desayuno", 0], ["Comida", 1], ["Cena", 2]]) {
      const meal = await PlanMeal.create({ planId: plan.id, name: mealName, order });
      const opt = await PlanMealOption.create({ mealId: meal.id, name: "Opción 1", order: 0, isDefault: true });
      for (let k = 0; k < 2; k++) { const f = pick(foods); await PlanMealOptionFood.create({ optionId: opt.id, foodId: f.id, amount: rand(30, 200), unit: "g", order: k }); }
    }
  };
  const tpl = await Plan.create({ name: "Plantilla · Mantenimiento", description: "Plantilla base.", type: "template", visibleToClient: false });
  await mk(tpl);
  let nPlan = 1;
  for (let i = 0; i < 3; i++) { const p = await Plan.create({ name: `Plan de ${pick(NOMBRES)}`, description: "Plan asignado.", type: "assigned", templateId: tpl.id, clientId: pick(clientes)?.id ?? null, visibleToClient: true, assignedAt: daysAgo(rand(5, 60)) }); await mk(p); nPlan++; }
  process.stdout.write(`  ✓ ${foods.length} alimentos · ${nPlan} planes\n`);

  // 3) Cuestionarios (con wpUserId)
  process.stdout.write("\n▶ Sembrando cuestionarios...\n");
  const cursos = (await Course.findAll({ attributes: ["name"], limit: 5 })).map((c) => c.name);
  const cursoNames = cursos.length ? cursos : ["Introducción a la gestión", "Ofimática avanzada"];
  let nq = 0;
  for (let i = 0; i < 18; i++) {
    const total = rand(5, 15), correct = rand(2, total), passing = Math.ceil(total * 0.6);
    await QuizAttempt.create({
      wpAttemptId: 2000 + i, wpQuizId: rand(1, 5), wpCourseId: rand(100, 999), wpUserId: rand(1, 9999),
      studentName: `${pick(NOMBRES)} ${pick(APELLIDOS)}`, studentEmail: `alumno${i}@example.com`,
      quizTitle: pick(["Test módulo 1", "Evaluación final", "Prueba intermedia"]), courseTitle: pick(cursoNames),
      empresa: pick(["Colegio Aurora", "Grupo Industrial Vega", "Particular"]), attemptDate: daysAgo(rand(1, 90)),
      totalQuestions: total, totalPoints: total, earnedPoints: correct, passingPoints: passing,
      correctAnswers: correct, incorrectAnswers: total - correct, result: correct >= passing ? "pass" : "fail", answers: [],
    });
    nq++;
  }
  process.stdout.write(`  ✓ ${nq} intentos de cuestionario\n\n`);

  await closeAllConnections();
  process.exit(0);
}
main().catch(async (e) => { process.stderr.write(`\n✗ ${e.message}\n${e.stack}\n`); try { await closeAllConnections(); } catch {} process.exit(1); });

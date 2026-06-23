import { NextResponse } from "next/server";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { searchOpenFoodFacts } from "../../../../../lib/nutricion/foods.js";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/foods/search-external?q=...
// Proxy a OpenFoodFacts. Devuelve { ok: true, items, external_error? }.
// Si la API externa falla o el feature flag está apagado, responde
// items=[] + external_error=true (200, no rompe la UI).
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { hasModule, hasFeatureFlag }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (!hasFeatureFlag("nutricion", "externalSearchEnabled")) {
      return NextResponse.json({ ok: true, items: [], external_error: true });
    }

    if (!q) {
      return NextResponse.json({ ok: true, items: [] });
    }

    const { items, external_error } = await searchOpenFoodFacts(q);
    const body = { ok: true, items };
    if (external_error) body.external_error = true;
    return NextResponse.json(body);
  } catch (err) {
    return serverError(err);
  }
});

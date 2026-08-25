import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../../../lib/utils/errors.js";
import { assertNotDemoPaidCall } from "../../../../../../../lib/demo/isDemo.js";
import { createCheckoutSession } from "../../../../../../../lib/payments/checkout.js";
import { centimos } from "../../../../../../../lib/tienda/catalogo.js";
import { fichaDelComprador, lineasDesdeCarrito } from "../../../../../../../lib/tienda/pedidoDesdeTienda.js";

/**
 * POST /api/public/c/[tenantSlug]/tienda/pedido
 *
 * Del carrito a la pasarela de pago. Lo llama la tienda pública, sin sesión.
 *
 * ── QUÉ ACEPTA DEL NAVEGADOR Y QUÉ NO ──────────────────────────────────────
 * Del carrito, SOLO qué producto y cuántas unidades. El precio se lee de la
 * base aquí dentro (`lineasDesdeCarrito`), nunca del body. Es la misma decisión
 * que tomó el cobro de las citas y por el mismo motivo: con el importe en el
 * body, cualquiera paga un céntimo por un congelador.
 *
 * ── EL PEDIDO NACE EN BORRADOR ─────────────────────────────────────────────
 * Se crea `draft` y NO se toca el almacén. Lo confirma —y descuenta stock— el
 * webhook de Stripe cuando el pago sale. Un carrito abandonado no puede
 * apartar mercancía: en una tirada de cincuenta camisetas, dos días de
 * abandonos se comen las tallas buenas.
 */
export const POST = withPublicTenant(async (request, _ctxRuta, ctx) => {
  try {
    const { tenantModels, hasModule, slug } = ctx;
    if (!hasModule("tienda")) return notFound("Aquí no hay tienda");

    // La demo es pública y da sesión de admin: con las claves de Stripe puestas,
    // esto sería un formulario de cobro abierto a internet.
    assertNotDemoPaidCall(ctx, "Comprar en la tienda");

    let body;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Body inválido");
    }

    const { carrito, comprador, envio } = body ?? {};

    // 1. Las líneas, con el precio del servidor.
    const { lineas, subtotal } = await lineasDesdeCarrito(tenantModels, carrito);

    // 2. La ficha del comprador (nueva o la de siempre).
    const { cliente } = await fichaDelComprador(tenantModels, {
      email: comprador?.email,
      nombre: comprador?.nombre,
      telefono: comprador?.telefono,
    });

    // 3. La dirección. Se guarda tal cual la escribe quien compra: normalizarla
    //    a la brava (mayúsculas, provincias «oficiales») es la forma más rápida
    //    de que un paquete acabe en otro sitio.
    const direccion = envio
      ? {
          nombre: String(envio.nombre ?? comprador?.nombre ?? "").slice(0, 200),
          calle: String(envio.calle ?? "").slice(0, 250),
          cp: String(envio.cp ?? "").slice(0, 15),
          ciudad: String(envio.ciudad ?? "").slice(0, 120),
          provincia: String(envio.provincia ?? "").slice(0, 120),
          pais: String(envio.pais ?? "ES").slice(0, 2).toUpperCase(),
          notas: String(envio.notas ?? "").slice(0, 500) || null,
        }
      : null;
    if (!direccion?.calle || !direccion?.cp || !direccion?.ciudad) {
      throw new ValidationError("Faltan datos de envío: calle, código postal y ciudad");
    }

    // 4. El pedido, en borrador.
    const { Order, OrderLine } = tenantModels;
    const pedido = await Order.create({
      clientId: cliente.id,
      status: "draft",
      subtotal: subtotal.toFixed(2),
      transportAmount: "0.00",
      total: subtotal.toFixed(2),
      origin: "tienda",
      shippingAddress: direccion,
      notes: null,
    });
    for (const l of lineas) {
      await OrderLine.create({ ...l, orderId: pedido.id });
    }

    // 5. La pasarela. `entityType: "order"` — el checkout ya era genérico.
    const base = process.env.APP_PUBLIC_URL || "";
    const checkout = await createCheckoutSession(ctx, {
      entityType: "order",
      entityId: pedido.id,
      amount: centimos(subtotal),
      description: `Pedido en ${ctx.tenant?.name ?? slug}`,
      customerEmail: cliente.email,
      successUrl: `${base}/widget/c/${slug}/tienda/gracias?pedido=${pedido.id}`,
      cancelUrl: `${base}/widget/c/${slug}/tienda`,
      metadata: { tipo: "tienda", pedidoId: pedido.id, tenant: slug },
    });

    await pedido.update({ paymentSessionId: checkout.paymentSession?.id ?? null });

    return ok({
      pedidoId: pedido.id,
      total: subtotal.toFixed(2),
      checkoutUrl: checkout.checkoutUrl,
    });
  } catch (err) {
    if (err instanceof ValidationError) return error(err.message, 422);
    return serverError(err);
  }
});

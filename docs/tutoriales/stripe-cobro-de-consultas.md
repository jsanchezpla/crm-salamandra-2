# Cobrar las consultas: cómo funciona y qué tiene que hacer Laura

Dos partes: **qué pasa por dentro** (y por qué es seguro) y **la lista de lo que
hay que hacer** para que mañana cobre de verdad.

---

# PARTE 1 — El flujo, paso a paso

## Lo que ve el paciente

1. Entra en la web de Laura y abre la agenda (el widget va incrustado allí).
2. Elige tipo de cita y hora.
3. Escribe nombre, correo y teléfono.
4. Si esa cita tiene precio, ve el importe y **una casilla que tiene que
   marcar**: se le explica que se le va a **retener** el importe, no cobrar, y
   que solo se cobrará cuando Laura confirme.
5. Aparece el **formulario de tarjeta ahí mismo**, sin salir de la web de Laura.
6. Al enviar, el banco **retiene** el dinero. Su tarjeta queda con ese importe
   bloqueado, pero **no se le ha cobrado**: no sale de su cuenta.
7. Ve una pantalla que dice, con todas las letras, que **la cita todavía no está
   confirmada** y que Laura la revisará.

> Ese último punto es deliberado. Prometer ahí una cita confirmada es
> exactamente lo que hace que alguien se plante un martes a una hora que nadie
> le dio.

## Lo que ve Laura

La solicitud le llega a su **lista de espera** en el CRM, con el dinero ya
retenido. Tiene tres salidas:

| Lo que hace | Qué pasa con el dinero |
|---|---|
| **Confirmar** la cita | Se **cobra** en ese momento y el dinero pasa a su cuenta de Stripe |
| **Rechazar** | Se **suelta** la retención. Al paciente se le libera sin cobrarle nada |
| **No hacer nada** | La retención **caduca** sola y el dinero se libera |

Si la retención caduca o el banco rechaza el cobro, la solicitud **no
desaparece**: sigue siendo la petición de una persona real. Laura puede
confirmarla igualmente (sin cobrar) o pedirle la tarjeta otra vez con un botón,
que le manda un enlace nuevo por correo.

## El plazo

Una retención no dura para siempre. Stripe da normalmente **unos 7 días** para
cobrarla, aunque el plazo exacto lo decide el banco del paciente.

**El CRM no lo calcula por su cuenta**: le pregunta a Stripe cuándo caduca cada
una concreta y avisa a Laura según se acerca la fecha. Un vigilante automático
lo revisa cada hora. Calcular "creado + 7 días" a ojo es como se pierde dinero
de gente que confió.

---

# PARTE 2 — ¿Es seguro meter los datos bancarios en el CRM?

## La respuesta corta: **Laura no mete datos bancarios en el CRM. Nunca.**

En todo el código del CRM **no existe ni un campo** para un IBAN, un número de
cuenta ni una tarjeta. Lo he comprobado buscándolo expresamente.

**Su IBAN se lo da a Stripe, en la web de Stripe**, que es una entidad de pago
regulada. Nosotros no lo vemos, no lo guardamos y no lo tocamos.

## Entonces, ¿qué se pega en el CRM?

Tres **claves de API de Stripe**, que no son datos bancarios: son credenciales
para que el CRM le pida cosas a Stripe en su nombre.

| Clave | Qué es | Cómo se guarda |
|---|---|---|
| `sk_live_…` (secreta) | Permite crear cobros en su cuenta | **Cifrada** (AES-256-GCM) |
| `whsec_…` (webhook) | Comprueba que los avisos vienen de Stripe | **Cifrada**, y no se devuelve nunca |
| `pk_live_…` (publicable) | Pinta el formulario de tarjeta | En claro **a propósito**: viaja al navegador de cada paciente, es pública por diseño |

La clave de cifrado vive **solo en el servidor**, fuera de la base de datos. Aunque
alguien se llevara una copia de la base de datos, las claves no le servirían de
nada. Y en pantalla la secreta nunca se muestra entera: solo una pista de los
últimos caracteres, para poder reconocerla.

Solo un **administrador** puede ver o cambiar esa pantalla.

## Las tarjetas de los pacientes tampoco pasan por nosotros

Esto es lo importante y conviene entenderlo bien:

- El script de Stripe se carga **desde los servidores de Stripe**, nunca
  empaquetado con nuestra app.
- Los campos donde el paciente teclea su tarjeta los pinta **un iframe de
  Stripe**, no HTML nuestro.
- El número de tarjeta **viaja directo del navegador del paciente a Stripe**. No
  pasa por nuestro servidor, no se escribe en nuestros registros, no está en
  nuestra base de datos.
- Nosotros solo recibimos un identificador del pago.

Eso es lo que nos mantiene en el régimen de cumplimiento PCI más sencillo
(SAQ A). El día que alguien "personalice un poco" ese formulario y saque un
campo de tarjeta a nuestro propio HTML, cambia el régimen entero. Está avisado
en el código.

## Lo que sí es un riesgo, dicho claro

No sería honesto decir "es seguro" y parar ahí:

- **Si le roban la clave secreta de Stripe**, quien la tenga puede crear cobros
  y reembolsos en su cuenta. **No** puede desviar el dinero a otra cuenta: los
  ingresos van al IBAN configurado en Stripe, y cambiarlo exige entrar en Stripe
  con su contraseña y su segundo factor. Mitigación: **verificación en dos pasos
  en Stripe** (imprescindible) y saber que una clave se revoca desde Stripe en
  diez segundos.
- **Quien tenga acceso de administrador al servidor** puede descifrar las claves.
  Es el modelo normal de cualquier aplicación, pero conviene saberlo.
- **La clave no se manda nunca por WhatsApp ni por chat.** Se genera en Stripe y
  se pega directamente en el CRM. Una clave que ha pasado por un chat hay que
  darla por comprometida y rotarla.
- **Pendiente de probar en un móvil de verdad**: cuando el banco pide
  confirmación (esas pantallas de "confirma en tu app"), eso ocurre dentro de un
  iframe metido en otro iframe. En ordenador funciona. En Safari de iPhone
  conviene probarlo con una tarjeta real antes de anunciarlo, porque Safari es
  especialmente estricto con los iframes anidados.

---

# PARTE 3 — Lo que hay que hacer para que mañana funcione

## A. En Stripe (lo hace Laura)

1. **Crear la cuenta** en <https://dashboard.stripe.com/register>.
2. **Activar la cuenta**: Stripe pide datos del negocio y verificar identidad
   (DNI, actividad, etc.).

   ⚠️ **Esto puede tardar.** Hasta que la cuenta no esté activada, solo se puede
   cobrar en modo prueba. Si mañana hay que cobrar de verdad, esto es lo primero
   del día.

3. **Añadir su cuenta bancaria** (el IBAN) en **Configuración → Pagos /
   Payouts**. Ahí es donde Stripe le ingresará el dinero.
4. **Activar la verificación en dos pasos** en su cuenta de Stripe. No es
   opcional: esa cuenta mueve su dinero.

## B. Las claves (las copia de Stripe, las pega en el CRM)

5. En Stripe → **Desarrolladores → Claves de API**. Comprueba arriba que **no**
   está en "modo de prueba" si quieres cobrar de verdad. Copia:
   - **Clave publicable** (`pk_live_…`)
   - **Clave secreta** (`sk_live_…`) — se enseña una sola vez

6. En Stripe → **Desarrolladores → Webhooks → Añadir endpoint**:

   - **URL**: `https://crm.salamandrasolutions.com/api/webhooks/stripe/nutri_laura`
   - **Eventos a escuchar** (estos nueve):

     ```
     payment_intent.amount_capturable_updated
     payment_intent.succeeded
     payment_intent.canceled
     payment_intent.payment_failed
     charge.refunded
     checkout.session.completed
     checkout.session.async_payment_succeeded
     checkout.session.async_payment_failed
     checkout.session.expired
     ```

   - Al crearlo, Stripe da un **secreto de firma** (`whsec_…`). Cópialo.

   > El más importante es `payment_intent.amount_capturable_updated`: es el que
   > nos dice que el dinero ha quedado retenido. Sin él, el paciente pone la
   > tarjeta y su solicitud no llega a la lista de espera.

7. En el CRM → **Configuración**, pegar las tres:
   - *Clave secreta de Stripe* → `sk_live_…`
   - *Secreto del webhook* → `whsec_…`
   - *Clave publicable de Stripe* → `pk_live_…`

   ⚠️ **Las tres del mismo entorno.** Mezclar una de prueba con una real hace
   que al paciente no le cargue el formulario, sin ningún mensaje de error.

## C. Los precios (decisión de Laura)

8. CRM → **Citas → Tipos de cita** → poner el importe a *Primera consulta* y
   *Seguimiento*.

   Hoy están **sin precio**, y eso significa que **no se cobra nada**: la reserva
   pasa directa a la lista de espera. Es un modo válido, pero mientras siga así
   todo lo del cobro está apagado.

## D. Comprobar

9. Desde el servidor:

   ```bash
   docker exec crm-salamandra-app-1 node scripts/comprobar-citas.js nutri_laura
   ```

   No puede quedar ninguna línea con `✗`.

10. **La prueba de verdad**: reservar una cita real desde la web, con una tarjeta
    real y un importe pequeño, y comprobar los cuatro puntos:
    - le sale el formulario de tarjeta dentro de la web;
    - el banco retiene (no cobra) — se ve en el extracto como retención;
    - la solicitud aparece en la lista de espera de Laura;
    - al confirmarla, el cobro se hace efectivo.

    Y después probar el otro lado: rechazar una, y ver que la retención se
    suelta.

---

## Resumen de qué depende de quién

| Cosa | Quién | ¿Bloquea mañana? |
|---|---|---|
| Activar la cuenta de Stripe | Laura | **Sí**, y es lo que más puede tardar |
| IBAN en Stripe | Laura | Sí (sin él Stripe no ingresa) |
| Doble factor en Stripe | Laura | No, pero hazlo igual |
| Las tres claves | Laura las copia, se pegan en el CRM | Sí |
| El webhook | Se configura en Stripe | Sí |
| Los precios | Decisión de Laura | Sí |
| Probar con tarjeta real | Los dos | Antes de anunciarlo |

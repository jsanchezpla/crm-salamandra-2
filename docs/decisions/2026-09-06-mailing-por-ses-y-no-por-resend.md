# El mailing sale por Amazon SES, y lo transaccional se queda en Resend

**Fecha:** 06/09/2026 (decisión tomada en el plan del módulo, 23/08/2026;
codificada con el sprint 1). **Toca a:** `mailing`, `emails.md`, configuración.

## Qué pasó

Rodrigo pidió email marketing dentro del CRM: campañas y newsletters a las
familias y clientes de cada centro. Lo obvio era mandarlas por Resend, que ya
manda las confirmaciones y los recordatorios de cita desde el dominio de cada
cliente.

## Por qué no

La reputación de envío va pegada a la **cuenta** y al dominio, no a la
dirección. Una campaña de novedades recoge quejas de spam con una facilidad
que un recordatorio de cita no tiene; si eso pasa, lo primero que empieza a
caer en «no deseado» son los recordatorios, y una familia que no recibe el
suyo se planta en la puerta a una hora en la que nadie la atiende.

Separar por subdominio (`news.cliente.com`) protege del filtro de spam pero
**no de una suspensión**: la suspensión es de la cuenta entera y se lleva los
dos dominios por delante. La única separación real es otro proveedor.

Además, el plan gratuito de Resend son 3.000 correos al mes y **100 al día**;
un centro con 1.000 familias lo revienta en la primera campaña, y el siguiente
plan es una cuota mensual, que choca con el modelo de pago único de Salamandra.

## Qué se decidió

| | Transaccional | Mailing |
| --- | --- | --- |
| Proveedor | Resend (como hasta hoy) | **Amazon SES** |
| Qué manda | confirmaciones, recordatorios, videollamada, tickets | campañas, newsletters, novedades |
| Coste | plan gratuito | 0,10 $ por cada 1.000, sin cuota mensual |
| Cuenta | del cliente (BYOK) | **del cliente (BYOK), una por cliente** |
| Si algo va mal | aislado | aislado: no puede tocar los recordatorios |

La cuenta de AWS es **una por cliente** y no una de Salamandra con la identidad
de cada cliente verificada (la decisión abierta del plan): con una cuenta
compartida, la lista mala de un cliente podría dejar sin mailing a los otros
ocho, que es el mismo error del que huimos al separar Resend de SES. Cuesta un
alta de AWS por cliente; está escrita paso a paso en la tarjeta de
Configuración y en `docs/setup-cuentas-externas.md`.

## Cómo se aplica hoy

- `lib/mailing/ses.js` lee `settings.integrations.ses*` (la secreta cifrada
  con `secretBox`) y firma con `lib/mailing/sigv4.js`: sin SDK de AWS.
- La casilla `novedades` de `lib/clients/comunicaciones.js` **es** el
  consentimiento del mailing: no se creó ninguna lista paralela.
- Todo correo del módulo lleva baja de un clic (`List-Unsubscribe` +
  `List-Unsubscribe-Post`) y pasa por `mailing_suppressions`, que alimentan
  el webhook de SES (rebotes duros y quejas) y la propia baja. AWS revisa la
  cuenta al 0,1 % de quejas y la para al 0,5 %; el módulo enseña la tasa.
- El correo transaccional no se ha tocado: `lib/email/resendClient.js` y sus
  16 plantillas siguen igual.

## Lo que queda por hacer antes de que un cliente lo use

1. Que el cliente (o nosotros con sus credenciales) **saque SES del sandbox**:
   hasta entonces solo se puede escribir a direcciones verificadas y 200/día.
2. Instalar el temporizador `crm-mailing.timer` en el VPS (una vez).
3. Medir el consumo transaccional de Resend por cliente en día punta: si
   alguno roza los 100/día, es un problema aparte del mailing y hay que
   resolverlo antes.

Ver `docs/modules/mailing.md`.

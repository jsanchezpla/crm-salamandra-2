# Google Workspace en tunutrilaura.com

Este tutorial cubre dos cosas que en la práctica van juntas:

1. Poner **Google Workspace** en el dominio (correo `laura@tunutrilaura.com`,
   Drive, y **salas de Meet permanentes**).
2. Hacer que **conviva con Resend** sin que se rompa ninguno de los dos.

> **Google Workspace no es obligatorio para que funcionen las citas.** El CRM
> manda los correos por Resend, y el modo de videollamada por defecto (manual)
> no necesita nada de Google. Esto es para si Laura quiere correo profesional y
> una sala fija de Meet.

---

## Qué aporta y qué no

| | Con Google Workspace | Sin él |
|---|---|---|
| Correo `laura@tunutrilaura.com` | Sí, en Gmail | Sigue con su Gmail personal |
| **Sala de Meet permanente** | Sí (enlace fijo reutilizable) | Solo enlaces sueltos por reunión |
| Correos automáticos del CRM | Los sigue mandando **Resend** | Los manda Resend |
| Coste | De pago por usuario y mes | 0 € |

⚠️ **Google Workspace NO hace que el CRM cree salas solo.** Para eso haría falta
la integración con Google Calendar, que no existe todavía. Lo que sí permite es
tener una sala fija y pegarla en el tipo de cita, y entonces las citas online la
heredan solas (modo *automático* en Configuración → Citas).

> Consulta el precio actual en <https://workspace.google.com/pricing>: los planes
> y las cifras cambian. Para una consulta de una persona, el plan de entrada
> sobra.

---

## Parte 0 — Comprobar quién manda en el DNS

Igual que con Resend: si el dominio no apunta a los servidores de nombres de
Hostinger, los registros hay que ponerlos donde corresponda.

hPanel → **Dominios** → `tunutrilaura.com` → **Servidores DNS / Nameservers**.
Deben ser de Hostinger (`ns1.dns-parking.com` y similares).

---

## Parte 1 — Crear la cuenta

1. Ve a <https://workspace.google.com> → **Empezar**.
2. Datos del negocio: nombre, número de empleados (**solo yo**), país
   (**España**).
3. Cuando pregunte por el dominio, elige **«Sí, tengo uno que puedo usar»** y
   escribe `tunutrilaura.com`.

   > No compres el dominio otra vez desde Google. Ya está comprado en
   > Hostinger y tenerlo en dos sitios solo trae líos.

4. Crea el usuario: `laura@tunutrilaura.com` y su contraseña.

   ⚠️ Esa contraseña **la crea y la teclea Laura**. No pasa por chat, ni por
   WhatsApp, ni la escribe nadie más. Y en cuanto entre, que active la
   verificación en dos pasos: esa cuenta va a tener el correo de sus pacientes.

---

## Parte 2 — Verificar el dominio

Google pide demostrar que el dominio es suyo, con un registro TXT.

1. En el asistente de Google, elige verificar con **registro TXT**.
2. Copia el valor, del estilo `google-site-verification=aBcDeF1234...`.
3. En hPanel → **Dominios** → `tunutrilaura.com` → **DNS / Nameservers** →
   **Registros DNS**:
   - Tipo: **TXT**
   - Nombre: **`@`** ← el dominio raíz
   - Valor: el `google-site-verification=...` completo
   - **Añadir registro**
4. Vuelve a Google y pulsa **Verificar**.

> Recuerda la norma de Hostinger: el campo **Nombre** es relativo. `@` significa
> «el dominio pelado». Nunca escribas `tunutrilaura.com` ahí.

---

## Parte 3 — Los MX (esto mueve el correo de verdad)

Este paso hace que el correo de `@tunutrilaura.com` empiece a llegar a Gmail.

⚠️ **Si ese dominio ya recibía correo en otro sitio** (un buzón de Hostinger,
por ejemplo), en cuanto cambies los MX **deja de llegar allí**. Asegúrate de que
no hay nada importante en el buzón viejo antes de tocar esto.

1. En Hostinger, **Registros DNS**: busca los registros de tipo **MX** que ya
   existan y **bórralos** (los de Hostinger suelen apuntar a `mx1.hostinger.com`
   o similar).
2. Añade el de Google. Hoy Google usa **un solo registro**:

   | Tipo | Nombre | Apunta a | Prioridad |
   |---|---|---|---|
   | `MX` | `@` | `smtp.google.com` | `1` |

   Si el asistente de Google te enseña en cambio la lista antigua de cinco
   (`ASPMX.L.GOOGLE.COM`, `ALT1...`, `ALT2...`, `ALT3...`, `ALT4...`), mete los
   cinco con las prioridades que indique. **Haz caso a lo que te enseñe tu
   pantalla**, no a este documento.

3. Vuelve al asistente de Google y pulsa **Activar Gmail**.
4. Espera. Suele ser menos de una hora, pero puede tardar hasta 24 h.

**El registro MX de Resend (`send`) no se toca.** Es de otro nombre — no
compite con este.

---

## Parte 4 — SPF: el paso donde se rompe todo

Un dominio **solo puede tener UN registro SPF** (un TXT que empiece por
`v=spf1`) para el mismo nombre. Si hay dos, los servidores de correo consideran
el dominio mal configurado y **empiezan a mandar a spam los correos de los dos
sistemas**.

Así que:

1. En Hostinger, busca si ya existe un TXT en `@` que empiece por `v=spf1`.
2. **Si no existe**, créalo:
   - Tipo: **TXT** · Nombre: **`@`** · Valor: `v=spf1 include:_spf.google.com ~all`
3. **Si ya existe**, **NO añadas otro**: edita el que hay y mete el `include` de
   Google dentro. Por ejemplo, si tenías:

   ```
   v=spf1 include:otroproveedor.com ~all
   ```

   queda:

   ```
   v=spf1 include:_spf.google.com include:otroproveedor.com ~all
   ```

   Regla: **un solo `v=spf1` al principio, un solo `~all` al final**, y todos
   los `include:` que hagan falta en medio.

### ¿Y Resend? — no hay conflicto

Resend firma desde el subdominio **`send.tunutrilaura.com`**, y su SPF va en el
nombre `send`, no en `@`. Son dos registros distintos en dos nombres distintos:
**no se pisan y no hay que fusionar nada**.

Solo tendrías que fusionarlos si algún día configuras Resend para enviar desde
el dominio raíz. Mientras uses el `send.` que te da por defecto, cada uno por su
lado.

---

## Parte 5 — DKIM de Gmail (que no es el de Resend)

Google no activa su firma DKIM sola: hay que generarla.

1. Entra en <https://admin.google.com> con `laura@tunutrilaura.com`.
2. **Aplicaciones → Google Workspace → Gmail → Autenticar correo electrónico**.
3. **Generar registro nuevo** (deja 2048 bits).
4. Google te da:
   - Nombre: `google._domainkey`
   - Valor: `v=DKIM1; k=rsa; p=MIIBIjANBg...`
5. En Hostinger:
   - Tipo: **TXT** · Nombre: **`google._domainkey`** · Valor: el que te dio
6. Espera a que propague y vuelve al panel de Google → **Iniciar autenticación**.

> Este registro **no choca** con el `resend._domainkey` del otro tutorial: son
> nombres distintos. Un dominio puede tener tantas firmas DKIM como remitentes
> tenga, cada una con su etiqueta (`google._`, `resend._`…). Es justo para lo
> que están pensadas.

---

## Parte 6 — La sala de Meet permanente (lo que interesa para el CRM)

Con Workspace, Laura puede tener un enlace de Meet que **no caduca**:

1. Con su cuenta de `@tunutrilaura.com`, entra en <https://meet.google.com>.
2. **Nueva reunión** → **Crear una reunión para más tarde**.
3. Google te da un enlace tipo `https://meet.google.com/abc-defg-hij`.
   Guárdalo: ese enlace se puede reutilizar siempre.

Para que las citas online lo hereden solas:

1. CRM → **Citas → Tipos de cita** → editar el tipo → pegar el enlace en **Sala
   fija de videollamada**.
2. CRM → **Configuración → Citas → Enlace de videollamada** → cambiar a
   **Automático**.

La tarjeta de Configuración te enseña, antes de dejarte cambiar el modo, qué
enlace se usaría en cada tipo. **Míralo**: los dos que hay hoy guardados en
producción son de un seed antiguo y no funcionan.

> Si Laura **no** va a tener Workspace, lo correcto es **vaciar** ese campo
> (ahora es opcional) y quedarse en modo **manual**: crea la reunión cuando le
> toque, pega el enlace en la cita y le da a «Guardar y enviar».

⚠️ Con una sala fija hay un detalle que conviene saber: **el enlace es siempre
el mismo para todos los pacientes**. Si alguien se conecta antes de tiempo puede
coincidir con la consulta anterior. Google Meet lo mitiga con la sala de espera
(los invitados esperan a que el anfitrión les deje entrar), pero **hay que
tenerla activada** y no dar por hecho que sí.

---

## Resumen de registros DNS al terminar

Con las dos cosas montadas, en Hostinger debería haber:

| Tipo | Nombre | Para qué |
|---|---|---|
| `MX` | `@` | Correo entrante → Gmail |
| `TXT` | `@` | SPF **único**, con `include:_spf.google.com` |
| `TXT` | `@` | Verificación de Google (`google-site-verification=…`) |
| `TXT` | `google._domainkey` | Firma DKIM de Gmail |
| `MX` | `send` | Rebotes de Resend |
| `TXT` | `send` | SPF de Resend |
| `TXT` | `resend._domainkey` | Firma DKIM de Resend |
| `TXT` | `_dmarc` | Política DMARC (`p=none` para empezar) |

Ocho registros, dos sistemas, cero conflictos. El único punto donde se tocan es
el SPF de `@`, y solo si algún día se saca a Resend del subdominio `send.`.

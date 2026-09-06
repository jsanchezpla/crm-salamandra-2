# Cuentas externas que hay que dar de alta (Resend, Google y Amazon SES)

Guía práctica para Jorge/Rodrigo. Son los dos trámites que hoy bloquean
funciones ya construidas del CRM. Ninguno lo puede hacer Claude: implican crear
cuentas, aceptar términos y tocar DNS.

---

## 1. Resend — el correo (bloquea 4 cosas ya hechas)

### Qué está bloqueado hasta que esto exista

- Recordatorio de cita la víspera (construido, apagado)
- Envío real de facturas con el PDF (construido)
- Confirmación y cancelación de cita al paciente (construido)
- «Olvidé mi contraseña» (sin construir: no tiene sentido sin correo)

Hoy el CRM entra en **modo simulacro**: no falla, escribe en el registro que
habría enviado y sigue. Por eso nadie se ha quedado sin su correo — tampoco ha
salido ninguno.

### Pasos

1. **Crear cuenta** en <https://resend.com> (el plan gratis son 3.000 correos
   al mes, de sobra para empezar).
2. **Verificar un dominio remitente**. Recomendado: un subdominio propio, por
   ejemplo `envios.salamandrasolutions.com`, para no tocar el correo normal.
   Resend da 3 registros DNS (SPF, DKIM y opcionalmente DMARC) que hay que
   añadir donde esté el dominio. La verificación tarda de minutos a unas horas.
3. **Generar una API key** (Resend → API Keys → Create).
4. **Ponerla en el servidor**, en `/opt/crm-salamandra/.env.production`:

   ```
   RESEND_API_KEY=re_xxxxxxxxxxxx
   RESEND_FROM_EMAIL=CRM Salamandra <no-reply@envios.salamandrasolutions.com>
   ```

5. Reiniciar la app: `docker compose up -d --no-deps app`.

⚠️ **La clave NO se pega en un chat.** Se escribe directamente en el servidor.

### Después de eso

- Los correos empiezan a salir **solos** en todo lo ya construido.
- Los **recordatorios** siguen apagados hasta que se enciendan cliente a cliente
  en Configuración (es una decisión de cada cliente: empieza a escribir a sus
  pacientes).
- Cada cliente puede poner **su propia** clave de Resend y su remitente en
  Configuración → IA, para que los correos salgan con su marca. Si no la pone,
  se usa la global de arriba.

---

## 2. Google — OJO, son dos cosas distintas

Es la confusión más fácil de tener, así que conviene tenerlo claro:

| | Google Places (ya funciona) | Google Calendar / Meet (pendiente) |
| --- | --- | --- |
| Qué es | Una **clave de API** | Una **app OAuth** |
| De quién | **De cada cliente** (él paga su consumo) | **De Salamandra**, una sola vez |
| Dónde se mete | Configuración → IA, la pega el cliente | En el servidor (`.env.production`) |
| Qué hace el cliente | Pegar su clave | Pulsar «Conectar mi Google» y aceptar |

**Conclusión:** para el calendario **no** hay que añadir más tarjetas de pegar
claves en Configuración. Lo que hace falta es que Salamandra cree UNA app OAuth,
y luego cada cliente conecta su cuenta con un botón.

### Pasos (una sola vez, cuenta de Salamandra)

1. Entrar en <https://console.cloud.google.com> y **crear un proyecto**
   (p. ej. «CRM Salamandra»).
2. **Activar la API**: APIs y servicios → Biblioteca → «Google Calendar API» →
   Habilitar.
3. **Pantalla de consentimiento**: APIs y servicios → Pantalla de consentimiento
   de OAuth. Tipo «Externo». Rellenar nombre de la app, correo de soporte y
   dominio (`salamandrasolutions.com`).
   - Ámbitos (permisos) a pedir: `https://www.googleapis.com/auth/calendar.events`
     (crear y editar eventos). No hace falta más.
   - Mientras esté «en pruebas», solo funcionan las cuentas que añadáis como
     usuarios de prueba. Para clientes reales hay que **publicar** la app.
     Google puede pedir una verificación si se piden permisos sensibles; con
     `calendar.events` suele bastar con la pantalla completa.
4. **Crear credenciales**: APIs y servicios → Credenciales → Crear credenciales
   → ID de cliente de OAuth → Tipo «Aplicación web».
   - URI de redirección autorizada:
     `https://crm.salamandrasolutions.com/api/integraciones/google/callback`
5. Guardar el **ID de cliente** y el **secreto** en el servidor:

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_OAUTH_REDIRECT_URI=https://crm.salamandrasolutions.com/api/integraciones/google/callback
   GOOGLE_TOKEN_ENCRYPTION_KEY=<32 bytes aleatorios en base64>
   ```

   El último se genera con:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   y cifra en reposo el permiso que cada cliente nos concede.

### Qué falta por programar (2-3 semanas)

Con esas credenciales puestas, queda construir: el botón «Conectar mi Google»
por cliente, el intercambio OAuth, el guardado cifrado del permiso, la creación
del evento con enlace de Meet al confirmar una cita, y el borrado del evento al
cancelarla.

**Mientras tanto** el enlace de videollamada se pega a mano y se manda con
«Guardar y enviar», que cubre el día a día.

---

## 3. Amazon SES — el correo del módulo Mailing (06/09/2026)

Es **por cliente**: cada centro que compre Mailing necesita su cuenta de AWS
(la decisión y el porqué, en
`decisions/2026-09-06-mailing-por-ses-y-no-por-resend.md`). Lo puede hacer el
cliente o nosotros con sus credenciales; los pasos también salen en
Configuración → Conexiones → Amazon SES → «Cómo conseguirla».

### Pasos

1. **Cuenta de AWS** en <https://aws.amazon.com> (tarjeta obligatoria; el
   gasto real son céntimos: 0,10 $ por cada 1.000 correos).
2. En la consola, **Amazon SES**, eligiendo una región europea (recomendado
   `eu-west-1`, Irlanda). Anotar la región.
3. **SES → Identities → Create identity → Domain**: el dominio desde el que va
   a enviar (`tucentro.com`). SES da 3 registros CNAME de DKIM para añadir en
   el DNS del cliente. Verificado el dominio, vale cualquier remitente suyo
   (`novedades@tucentro.com`).
4. **IAM → Users → Create user**: un usuario solo para el CRM (p. ej.
   `crm-mailing`), sin acceso a la consola, con la política
   `AmazonSESFullAccess` (o una a medida con `ses:SendEmail`, `ses:GetAccount`
   y `ses:GetEmailIdentity`). Después **Security credentials → Create access
   key** (tipo «Application running outside AWS»). Copiar Access Key ID y
   Secret Access Key: la secreta solo se enseña una vez.
5. Pegar en el CRM, **Configuración → Conexiones → Amazon SES**: la secreta en
   la tarjeta, y debajo el Access Key ID, la región y el remitente (con su
   nombre). Guardar. La tarjeta dice «Credenciales listas» y `/mailing`
   comprueba la cuenta al abrirse.
6. **Salir del modo de pruebas**: SES → Account dashboard → *Request
   production access*. Rellenar el formulario (uso: newsletters a clientes que
   han aceptado; volumen estimado; cómo se gestionan bajas y rebotes: enlace de
   baja de un clic en cada correo y supresión automática). Suelen contestar en
   24 h. Hasta entonces: 200 correos/día y solo a direcciones verificadas.
7. **Rebotes y quejas al CRM** (recomendado): SES → Configuration sets →
   Create (`crm-mailing`) → Event destinations → Add: eventos *Bounce* y
   *Complaint*, destino **Amazon SNS**, crear un tema. En SNS, en ese tema,
   **Create subscription → HTTPS** con la URL que enseña la tarjeta:
   `https://crm.salamandrasolutions.com/api/webhooks/ses/<slug>`. El CRM
   confirma la suscripción solo. Escribir `crm-mailing` en el campo
   *Configuration set* de la tarjeta.
8. En el VPS, si es el primer cliente con Mailing, instalar el temporizador
   una vez:

   ```
   cp /opt/crm-salamandra/scripts/deploy/crm-mailing.{service,timer} /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now crm-mailing.timer
   systemctl list-timers | grep crm-mailing
   ```

⚠️ **Las claves de AWS NO se pegan en un chat.** Se pegan en la tarjeta de
Configuración (cifradas en reposo) o las pone el cliente.

### Después de eso

- Activar el módulo: `docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> mailing`.
- Mandar una **prueba** desde `/mailing/[campaña]` a una dirección del equipo
  antes de la primera campaña real: si la cuenta sigue en sandbox, esa
  dirección tiene que estar verificada en SES.
- Vigilar la **tasa de quejas** en `/mailing`: AWS revisa al 0,1 % y para al 0,5 %.

---

## 3. Lo que NO hace falta

- **Verifactu**: no es una cuenta que dar de alta, es una integración por
  programar (con Facturantia). Está fuera del alcance actual por decisión de
  Rodrigo, pero es obligación legal con fecha: conviene planificarla.
- **WhatsApp**: las credenciales ya se pueden guardar en Configuración; lo que
  falta es enganchar los avisos, que es trabajo de programación, no de alta de
  cuenta.

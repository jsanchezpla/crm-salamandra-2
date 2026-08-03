# Nutri Laura — poner las citas en marcha

Estado a **03/08/2026**, verificado contra producción con
`docker exec crm-salamandra-app-1 node scripts/comprobar-citas.js nutri_laura`.

La idea de este documento: dejar por escrito qué falta, **qué es una clave suya
y qué es una decisión nuestra**, para que el día de encenderlo no haya que
averiguarlo.

**Los pasos, uno a uno, están en los tutoriales:**

- [Verificar el dominio de Resend en Hostinger](tutoriales/resend-dns-en-hostinger.md) — los correos
- [Google Workspace en tunutrilaura.com](tutoriales/google-workspace-tunutrilaura.md) — correo propio y sala de Meet fija
- [Cobrar las consultas con Stripe](tutoriales/stripe-cobro-de-consultas.md) — el dinero, y por qué es seguro

---

## Lo que YA está y no hay que tocar

| Pieza | Estado |
| --- | --- |
| Módulo `citas` activo | ✅ |
| Tipos de cita | ✅ 2 activos (Primera consulta 60′, Seguimiento 30′) |
| Horarios | ✅ 10 franjas |
| Widget de reserva + portal SSO con su WordPress | ✅ |
| Plantillas de correo (7: recibida, confirmada, rechazada, cancelada, recordatorio, enlace de Meet, pedir tarjeta) | ✅ |
| Flujo de cobro con retención de tarjeta (autorizar → confirmar → cobrar) | ✅ probado |
| Vigilancia de retenciones y recordatorios | ✅ dos timers de systemd corriendo cada hora |
| Puerta de admisión por formulario | ✅ construida, **apagada** |

---

## Lo que falta

### 1. Correo — **clave suya** · bloquea todo lo demás

**No sale ni un correo, y no de Laura: de NADIE.** `RESEND_API_KEY` no está en
`.env.production` y ningún tenant tiene clave propia, así que `sendEmail` lleva
todo este tiempo en modo simulacro. No da error: escribe la línea en el log y
sigue. Afecta también a **Aumenta**, que es un centro con familias reales.

Hay que decidir una de dos:

- **Cada cliente su cuenta (BYOK, el diseño actual).** Laura crea cuenta en
  Resend, verifica `tunutrilaura.com` con los DNS que le dé Resend, y pega en
  Configuración → Correo: la API key y el remitente (p. ej.
  `citas@tunutrilaura.com`). Los correos salen a su nombre.
- **Una cuenta nuestra de respaldo.** `RESEND_API_KEY` + `RESEND_FROM_EMAIL` en
  `.env.production`: funciona para todos de golpe, pero los pacientes reciben
  los correos desde un dominio de Salamandra.

⚠️ **La verificación del dominio en Resend es DNS y tarda.** Si se deja para
mañana por la mañana, puede no estar propagado. Es lo único de esta lista que no
se resuelve en el momento.

### 2. Precios — **decisión de Laura**

Los dos tipos de cita tienen `price` a NULL, así que **hoy no se cobra nada** y
todo el flujo de retención de tarjeta está inerte. No es un fallo: sin precio la
reserva pasa directa a la lista de espera, que es un modo válido.

Para cobrar hacen falta las dos cosas: importe en cada tipo de cita **y** las
tres claves de Stripe (secreta + secreto del webhook + publicable). Sin el
secreto del webhook no se enciende: el paciente pagaría y su cita no se
confirmaría nunca.

> **Arreglado el 03/08:** la clave **publicable** no tenía campo en Configuración
> —el endpoint la aceptaba y el widget la necesita, pero no había dónde
> escribirla—, así que pasar de claves de prueba a claves reales habría exigido
> entrar por SSH. Ya se pone desde la pantalla, como las otras dos. El
> comprobador avisa además si se mezclan entornos (una de prueba con una real),
> que es un fallo mudo: el formulario de tarjeta no carga y no dice por qué.

### 3. Recordatorios — **interruptor nuestro**

Apagados. Se encienden en Configuración → Citas, pero **solo después** de que el
correo funcione: encenderlos antes no manda nada.

### 4. El Meet — **decidido: lo pone Laura a mano en cada cita**

Laura crea la reunión de Meet cuando le toca y pega el enlace en esa cita
concreta. Eso es el **modo manual**, que es el que ya está puesto: no hace falta
ninguna clave, ni Google Workspace, ni tocar nada.

Su gesto diario es: abrir la cita → pegar el enlace → **«Guardar y enviar»**.

⚠️ **Ese botón depende del correo.** Mientras Resend no esté configurado, el
enlace **se guarda** pero **no se le manda a nadie**. El panel lo dice ahora con
todas las letras («falta configurar el correo en Configuración → Correo, mándaselo
tú mientras tanto»); antes decía «✓ enviado» y no salía nada. Hasta que el correo
funcione, Laura tiene que mandar el enlace por su cuenta.

Y como el modo es manual, **los dos enlaces de ejemplo que hay guardados en los
tipos de cita no pintan nada**: conviene vaciarlos en Citas → Tipos de cita para
que nadie los herede por error.

<details>
<summary>Si algún día quisiera sala fija (no es el caso)</summary>

### El Meet automático — no hace falta ninguna clave


Esto conviene aclararlo porque suena a integración y no lo es. Hay dos modos:

- **A mano (el actual).** La cita nace sin enlace; Laura pega el suyo en la
  ficha y pulsa «Guardar y enviar», que se lo manda al paciente.
- **Automático.** Cada tipo de cita tiene un enlace de sala fija y la cita lo
  hereda al crearse. Sirve si Laura tiene una sala permanente de Meet o Zoom.

**El modo automático NO crea salas nuevas llamando a Google.** Para eso haría
falta la integración con Google Calendar, que no existe (se descartó en su
momento a favor del `.ics`).

⚠️ **Los dos tipos de cita tienen guardado un enlace de un seed antiguo**
—`meet.google.com/nutri-laura-primera` y `…-seguimiento`—, que no son códigos
válidos de Meet. Hoy son inofensivos porque el modo es manual, pero el día que
alguien cambiara el modo a automático los pacientes recibirían salas que no
existen.

**Y no había forma de quitarlos**: la pantalla de tipos de cita exigía una URL
para cualquier tipo online («URL de reunión obligatoria si aceptas modalidad
online»). Ahí está el origen de los enlaces inventados — el campo era
obligatorio y el sistema después lo ignoraba, así que había que escribir algo
para poder guardar. Corregido el 03/08: la sala fija es **opcional**, con el
texto que explica para qué sirve. La dirección (presencial) y el teléfono siguen
siendo obligatorios, porque ahí no hay un segundo momento para darlos.

Así que ahora se vacían desde **Citas → Tipos de cita**, borrando el campo y
guardando. No hace falta tocar la base de datos.

**No existe una "sala real de Laura"** que poner en su lugar: una sala
permanente de Meet requiere Google Workspace, y lo único que hay en su tenant es
un enlace suelto (`meet.google.com/zty-xnrv-vsw`) puesto a mano en una cita del
29 de julio que además se canceló — un enlace de una reunión concreta, no una
sala. Lo correcto es dejarlo **vacío** y seguir en modo manual.

</details>

### 5. La puerta de admisión — **decisión + un enlace**

Construida y probada, apagada en producción. Al encenderla, solo puede reservar
quien tenga una solicitud del formulario **aceptada** en la bandeja; al resto se
le enseña el aviso con el enlace al formulario.

Hoy en su bandeja hay **4 aceptadas, 6 sin revisar y 24 descartadas**. En cuanto
se encienda, **esas 6 personas no podrán reservar hasta que Laura las revise** —
conviene avisarla el mismo día.

Para encenderla: Configuración → Citas → «Formulario obligatorio para pedir
cita», y pegar la dirección del formulario en su web.

---

## El orden que tiene sentido

1. Laura crea la cuenta de Resend y **lanza la verificación del dominio** (es lo
   que tarda).
2. Mientras propaga: decidir precios y si se enciende la puerta.
3. Verificado el dominio → pegar clave y remitente en Configuración.
4. Encender recordatorios.
5. Comprobar de una vez:

```bash
docker exec crm-salamandra-app-1 node scripts/comprobar-citas.js nutri_laura
```

Ese comando es la prueba: si sale sin líneas `✗`, las citas funcionan de verdad.

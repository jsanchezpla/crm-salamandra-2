# Verificar el dominio de Resend en Hostinger

Para que el CRM mande correos desde `@tunutrilaura.com` hay que demostrarle a
Resend que ese dominio es nuestro. Eso se hace añadiendo unos registros DNS en
Hostinger. Son 20 minutos de trabajo y **entre 15 minutos y 24 horas de espera**
hasta que propaga: por eso conviene empezar por aquí y no dejarlo para el final.

> Los valores concretos que aparecen abajo son **de ejemplo**. Resend genera los
> suyos para cada dominio (y cambian según la región que elijas). Copia siempre
> los que te enseñe su pantalla, no los de este documento.

---

## Parte 0 — Antes de empezar: ¿manda Hostinger en el DNS?

**Esto es lo primero y se salta casi todo el mundo.** Si el dominio apunta a
otros servidores de nombres (Cloudflare, los de la empresa que hizo la web…),
los registros que metas en Hostinger **no harán absolutamente nada** y te vas a
volver loco esperando una verificación que nunca llega.

1. Entra en <https://hpanel.hostinger.com> → **Dominios** → `tunutrilaura.com`.
2. Busca **Servidores DNS / Nameservers**.
3. Tienen que ser los de Hostinger, del estilo `ns1.dns-parking.com` y
   `ns2.dns-parking.com`.

- **Si son de Hostinger** → perfecto, sigue.
- **Si son de otro sitio** (p. ej. `*.ns.cloudflare.com`) → los registros hay
  que crearlos **allí**, no en Hostinger. Los pasos son los mismos; solo cambia
  la pantalla.

---

## Parte 1 — Dar de alta el dominio en Resend

1. Entra en <https://resend.com> y crea la cuenta (o inicia sesión).
2. Menú lateral → **Domains** → botón **Add Domain**.
3. Escribe `tunutrilaura.com`.
4. Elige la región: **`eu-west-1` (Irlanda)**.

   > Elige Europa. Son datos de pacientes: aunque el correo en sí no lleve la
   > historia clínica, el nombre y el email de alguien que va al nutricionista
   > ya es un dato personal, y mantenerlo en la UE es lo razonable con el RGPD.
   > **La región no se puede cambiar después** sin borrar el dominio y volver a
   > empezar.

5. Resend te enseña una tabla con **3 o 4 registros**. Déjala abierta en una
   pestaña: vas a ir copiando de ahí.

Tendrán esta pinta (insisto: los tuyos serán distintos):

| Tipo | Name / Host | Value / Points to | Prioridad |
|---|---|---|---|
| `MX` | `send` | `feedback-smtp.eu-west-1.amazonses.com` | `10` |
| `TXT` | `send` | `v=spf1 include:amazonses.com ~all` | — |
| `TXT` | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQ...` (cadena larguísima) | — |
| `TXT` | `_dmarc` | `v=DMARC1; p=none;` | — |

**Fíjate en que casi todo cuelga de `send`, no del dominio raíz.** Está hecho a
propósito: así el correo del CRM no pisa el correo normal del dominio. Es lo que
permite que Resend y Google Workspace convivan sin tocarse (ver el otro
tutorial).

---

## Parte 2 — Meter los registros en Hostinger

1. En hPanel: **Dominios** → `tunutrilaura.com` → **DNS / Nameservers** →
   pestaña **Registros DNS** (o *DNS Zone*).
2. Verás la lista de registros que ya existen. **No borres nada.** Solo vas a
   añadir.

### ⚠️ El error que comete todo el mundo

El campo **Nombre** de Hostinger es **relativo al dominio**. Hostinger le añade
`.tunutrilaura.com` por su cuenta.

- Resend dice: `resend._domainkey.tunutrilaura.com`
- En Hostinger escribes: **`resend._domainkey`**

Si pegas el nombre completo acabas con
`resend._domainkey.tunutrilaura.com.tunutrilaura.com`, que no existe, y la
verificación falla sin decirte por qué. **Quita siempre el `.tunutrilaura.com`
del final.** Para el dominio raíz se usa `@`.

### Registro 1 — el MX de rebotes

1. **Añadir nuevo registro** → Tipo: **MX**
2. Nombre: `send`
3. Apunta a: `feedback-smtp.eu-west-1.amazonses.com` *(el que te diga Resend)*
4. Prioridad: `10`
5. TTL: deja el que viene
6. **Añadir registro**

### Registro 2 — el SPF de ese subdominio

1. Tipo: **TXT**
2. Nombre: `send`
3. Valor: `v=spf1 include:amazonses.com ~all`
4. **Añadir registro**

> Que haya un MX y un TXT con el mismo nombre (`send`) es correcto y no se
> pisan: son tipos distintos.

### Registro 3 — la firma DKIM (la larga)

1. Tipo: **TXT**
2. Nombre: `resend._domainkey`
3. Valor: la cadena larguísima que empieza por `p=MIGfMA0...`

   **Cópiala con el botón de copiar de Resend, no a mano.** Es el registro que
   más falla:
   - No le añadas espacios ni saltos de línea.
   - No la partas en dos.
   - Si tu valor empieza por `v=DKIM1; k=rsa; p=...`, cópialo entero tal cual.

4. **Añadir registro**

### Registro 4 — DMARC (recomendado)

1. Tipo: **TXT**
2. Nombre: `_dmarc`
3. Valor: `v=DMARC1; p=none;`
4. **Añadir registro**

> `p=none` significa "solo observa, no rechaces nada". Es el modo correcto para
> empezar: endurecerlo antes de tiempo hace que tus propios correos legítimos
> acaben en spam.

---

## Parte 3 — Verificar

1. Vuelve a Resend → **Domains** → tu dominio → botón **Verify DNS Records**.
2. Cada registro se pone en verde según lo va encontrando.

**Si sigue en rojo:**

- **Espera.** Lo normal son 15–60 minutos. Puede llegar a 24 h. Dale al botón
  de verificar cada rato; no hace falta rehacer nada.
- **Comprueba el nombre duplicado.** Es el fallo número uno. Mira en Hostinger
  si aparece `send.tunutrilaura.com` (mal, porque Hostinger ya lo completa) en
  vez de `send`.
- **Comprueba desde fuera.** En <https://mxtoolbox.com/SuperTool.aspx> busca
  `resend._domainkey.tunutrilaura.com` como *TXT Lookup*. Si ahí no sale, es que
  no está publicado todavía; si sale distinto a lo que pusiste, es que el
  registro está mal escrito.
- **Comillas.** Si Hostinger te ha guardado el valor con comillas alrededor,
  quítalas.

---

## Parte 4 — Meterlo en el CRM

Con el dominio ya verificado (todo en verde):

1. En Resend: **API Keys** → **Create API Key**.
   - Nombre: `CRM Salamandra`
   - Permiso: **Sending access** (no hace falta acceso total)
   - Copia la clave. **Solo se enseña una vez.**
2. En el CRM: **Configuración → Correo**
   - *API key de Resend*: la que acabas de copiar
   - *Remitente*: `citas@tunutrilaura.com` (o `hola@`, `laura@`… lo que sea, pero
     tiene que ser **de ese dominio**; si pones un `@gmail.com` Resend lo
     rechaza)
   - *Responder a* (opcional): el correo donde quiere Laura recibir las
     respuestas de los pacientes
3. **Guardar remitente**.

> ⚠️ La API key es un secreto: da permiso para mandar correo en su nombre. No
> pasa por WhatsApp ni por chat. Que la pegue Laura directamente en el CRM, o
> se genera y se pega en el momento.

---

## Parte 5 — Comprobar que sale de verdad

Desde el servidor:

```bash
docker exec crm-salamandra-app-1 node scripts/comprobar-citas.js nutri_laura
```

La línea del correo tiene que salir en verde. Después, la prueba de verdad:
hacer una reserva de mentira en el widget y ver que llega el correo de "hemos
recibido tu solicitud".

Si no llega, míralo en **Resend → Logs**: ahí se ve si el correo salió y qué
contestó el servidor del destinatario. Y si no aparece nada en Logs, es que el
CRM no llegó a intentarlo (clave mal pegada).

---

## Lo que puede salir mal después

- **Los primeros correos van a spam.** Es normal con un dominio recién
  estrenado: no tiene reputación. Se arregla solo mandando correo legítimo unos
  días. Ayuda que Laura y algún conocido marquen "No es spam".
- **Si algún día se cambia de proveedor de correo**, hay que volver a mirar el
  SPF. Solo puede haber **un** registro `v=spf1` por nombre.

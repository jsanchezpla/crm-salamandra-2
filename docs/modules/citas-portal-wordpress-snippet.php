<?php
/**
 * REFERENCIA (no se ejecuta en el CRM) — Snippets para el WordPress de Laura.
 *
 * Registra DOS shortcodes, ambos SOLO para usuarios logueados:
 *   [crm_reservar_cita]  → widget de reserva (con el email de la cuenta
 *                          autorrellenado y bloqueado).
 *   [crm_mis_citas]      → portal "Mis citas" (ver / cancelar citas propias).
 *
 * Instalación (Code Snippets tipo PHP o mu-plugin):
 *   1. Pega este código SIN la línea `<?php` si tu gestor de snippets ya
 *      ejecuta en contexto PHP (Code Snippets, WPCode).
 *   2. El secreto debe ser EXACTAMENTE el mismo que WIDGET_SSO_SECRETS[nutri_laura]
 *      del `.env.production` del CRM.
 *   3. Coloca [crm_reservar_cita] en la página de reservas y [crm_mis_citas]
 *      en la página de "mis citas".
 *
 * ── CAMBIOS DEL 05/08/2026 (Rodrigo) ────────────────────────────────────────
 * 1) ANCHO. El widget salía encajonado con media pantalla en blanco. La culpa
 *    no era del iframe —ya iba a width:100%— sino del contenedor de contenido
 *    del theme (`.blog-article`, 760px), que limita cualquier página.
 *    Dos intentos con márgenes negativos (`100vw` primero, `translateX(-50%)`
 *    después) acabaron CORTANDO POR LA IZQUIERDA, porque ese truco necesita
 *    que el contenedor esté exactamente centrado en la ventana y aquí no lo
 *    está. Ahora se hace al revés: el widget no se mueve de su caja y lo que
 *    se ensancha es la caja. Ver `crm_wrap_ancho`.
 *
 * 2) SIN SESIÓN. Antes solo salía «inicia sesión», que es un callejón sin
 *    salida para quien entra por primera vez: si no es paciente todavía, no
 *    tiene cuenta ni la va a tener. Ahora debajo va el formulario de siempre
 *    para pedir la primera cita, que es lo que esa persona venía a hacer.
 *    Solo en [crm_reservar_cita]: en «Mis citas» no pinta nada.
 *
 * ⚠️ PENDIENTE (Jorge): el secreto está aquí a la vista y ha pasado por un
 * chat, así que hay que darlo por comprometido. Cuando se rote, lo suyo es
 * ponerlo en `wp-config.php` con `define('CRM_WIDGET_SSO_SECRET', '...')` y
 * borrar el bloque de abajo, para que deje de verse desde el escritorio de
 * WordPress.
 *
 * Seguridad:
 *   - El token `wpsso` se regenera en cada carga (TTL 5 min); el CRM lo canjea
 *     por su propio sessionToken (~60 min).
 *   - El email se firma en el token, así que el cliente no puede reservar ni
 *     ver citas con un email distinto al de su cuenta.
 */

if (!defined('ABSPATH')) { exit; }

/* ── Configuración ───────────────────────────────────────────────────────── */

if (!defined('CRM_WIDGET_SSO_SECRET')) {
    define('CRM_WIDGET_SSO_SECRET', 'PEGA_AQUI_EL_HEX_DE_WIDGET_SSO_SECRETS');
}
if (!defined('CRM_BASE_URL'))  { define('CRM_BASE_URL', 'https://crm.salamandrasolutions.com'); }
if (!defined('CRM_TENANT'))    { define('CRM_TENANT', 'nutri_laura'); }
if (!defined('CRM_LOGIN_URL')) { define('CRM_LOGIN_URL', 'https://tunutrilaura.com/login/'); }

/* Ancho máximo del widget. Es el MISMO que usa el CRM por dentro: con uno
   mayor solo se ganan franjas vacías, porque el contenido no pasa de ahí. */
if (!defined('CRM_WIDGET_MAX_WIDTH')) { define('CRM_WIDGET_MAX_WIDTH', 1440); }

/* ── Helpers ───────────────────────────────────────────────────────────── */

function crm_b64url($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/** Firma un JWT HS256 { email, tenant, iat, exp } compatible con `jose` del CRM. */
function crm_mint_wpsso($email, $ttl_seconds = 300) {
    $header  = crm_b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $now     = time();
    $payload = crm_b64url(json_encode([
        'email'  => strtolower(trim($email)),
        'tenant' => CRM_TENANT,
        'iat'    => $now,
        'exp'    => $now + $ttl_seconds,
    ]));
    $signingInput = $header . '.' . $payload;
    $sig = crm_b64url(hash_hmac('sha256', $signingInput, CRM_WIDGET_SSO_SECRET, true));
    return $signingInput . '.' . $sig;
}

/**
 * Ensancha la caja del theme para que el widget quepa a gusto.
 *
 * El widget NO se mueve de su sitio: se queda a `width:100%` dentro de su
 * contenedor. Lo que cambia es el tope de ese contenedor. El porqué, abajo.
 */
function crm_wrap_ancho($html, $max = null) {
    $max = (int) ($max ?: CRM_WIDGET_MAX_WIDTH);
    $id  = 'crm-w-' . uniqid();

    /*
     * ── POR QUÉ ENSANCHAR LA CAJA Y NO SACAR EL WIDGET DE ELLA ──────────────
     *
     * Los dos primeros intentos sacaban el bloque de su contenedor con
     * márgenes negativos (`100vw` primero, `translateX(-50%)` después) y los
     * dos acabaron CORTANDO POR LA IZQUIERDA. El motivo de fondo es el mismo:
     * cualquier truco de margen negativo depende de que el contenedor esté
     * exactamente centrado en la ventana, y aquí no lo está —cambia según haya
     * sesión iniciada o no, y el `overflow-x:clip` del body se come lo que
     * sobresalga—.
     *
     * Así que al revés: el widget se queda quieto dentro de su caja, a
     * `width:100%`, y lo que se ensancha es LA CAJA. Sin márgenes negativos no
     * hay nada que pueda salirse ni recortarse.
     *
     * El script sube por los contenedores y le levanta el tope al que lo
     * tenga. Se hace en JS y no en CSS porque las clases del theme
     * (`.blog-article`, 760px) pueden cambiar con una actualización, y esto
     * funciona sin saber cómo se llaman.
     *
     * Si el JS no llegara a ejecutarse, el widget se queda estrecho como
     * antes, pero ENTERO: el peor caso es feo, no roto.
     *
     * Medido en tunutrilaura.com/citas/ con el theme real:
     *   ventana 1900 → 1368px de ancho, 259px de margen a CADA lado, sin
     *   cortes y sin scroll lateral.
     */
    /*
     * El script hace DOS cosas, y las dos por el mismo motivo —no depender de
     * los nombres de clase del theme, que cambian al actualizarlo—:
     *
     *   1. ENSANCHA: sube por los contenedores levantando el tope al que lo
     *      tenga.
     *   2. SUBE: les quita el espacio de arriba y recorta el de abajo de la
     *      cabecera del theme, que dejaba un hueco en blanco de ~80px entre el
     *      título y el widget (05/08/2026, Rodrigo: «queda un espacio negativo
     *      que no me gustaría tener»).
     *
     * Solo toca la rama donde vive el widget, así que el resto de páginas del
     * sitio se quedan como están.
     */
    $script = '<script>(function(){try{'
        . 'var e=document.getElementById(' . wp_json_encode($id) . ');if(!e)return;'
        . 'e.style.marginTop="0";'
        . 'var n=e.parentElement,i=0;'
        . 'while(n&&i<6&&n!==document.body){'
        . 'if(getComputedStyle(n).maxWidth!=="none"){n.style.maxWidth=' . wp_json_encode($max . 'px') . ';n.style.width="100%";}'
        . 'n.style.paddingTop="0";n.style.marginTop="0";'
        // La cabecera del theme va justo encima y remata con bastante aire:
        // se le deja un respiro corto en vez de los ~48px que traía.
        . 'var p=n.previousElementSibling;'
        . 'if(p&&parseFloat(getComputedStyle(p).paddingBottom)>16){p.style.paddingBottom="16px";}'
        . 'n=n.parentElement;i++;}'
        . '}catch(err){}})();</script>';

    return '<div id="' . esc_attr($id) . '" style="width:100%;max-width:' . $max . 'px;margin:0 auto">'
        . $html
        . '</div>'
        . $script;
}

/**
 * Pantalla de "sin sesión".
 *
 * `$con_formulario` = true en la página de reservar. Quien llega ahí sin
 * cuenta no es que se haya despistado: es que todavía no es paciente, y
 * mandarlo a un login que no puede usar es dejarlo sin salida. Debajo del
 * aviso va el formulario de admisión de siempre, que es su camino de verdad.
 */
function crm_login_gate_html($con_formulario = false) {
    $current = (is_ssl() ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
    $login   = CRM_LOGIN_URL . '?redirect_to=' . rawurlencode($current);

    $aviso = '<div style="padding:1.75rem;font-family:sans-serif;border:1px solid #EADFD9;'
        . 'border-radius:16px;background:#fff;height:100%;box-sizing:border-box">'
        . '<h2 style="margin:0 0 .5rem;color:#4B3A36;font-size:1.4rem">¿Ya eres paciente?</h2>'
        . '<p style="margin:0 0 1.25rem;color:#7A6A65;line-height:1.5">Entra con tu cuenta para '
        . 'reservar tus citas y consultarlas cuando quieras.</p>'
        . '<a href="' . esc_url($login) . '" style="display:inline-block;padding:.7rem 1.4rem;'
        . 'background:#A97873;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">'
        . 'Iniciar sesión →</a></div>';

    // Sin formulario (p. ej. "Mis citas"): el aviso solo, centrado y estrecho.
    if (!$con_formulario) {
        return '<div style="max-width:520px;margin:0 auto">' . $aviso . '</div>';
    }

    // El formulario lo pinta el theme. Se comprueba que exista: si el theme
    // estuviera desactivado, WordPress escupiría el corchetazo en la página.
    $formulario = shortcode_exists('nutrilaura_formulario')
        ? do_shortcode('[nutrilaura_formulario id="fq-citas" titulo="¿Quieres reservar tu primera cita?" boton="Enviar mi solicitud"]')
        : '';

    if (!$formulario) {
        return '<div style="max-width:520px;margin:0 auto">' . $aviso . '</div>';
    }

    /*
     * Los dos caminos LADO A LADO, no uno debajo del otro (05/08/2026,
     * Rodrigo: «que no hubiera que hacer scroll y que todo ocupara la página»).
     * Apilados obligaban a bajar para descubrir que había un formulario, que es
     * justo lo que necesita quien todavía no es paciente — y es la mayoría de
     * quien llega aquí sin sesión.
     *
     * `auto-fit` + `minmax`: dos columnas cuando hay sitio y una sola en el
     * móvil, sin punto de corte que adivinar. El aviso se queda estrecho
     * (`0.8fr`) porque es cuatro líneas; el formulario se lleva el resto.
     */
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));'
        . 'gap:2rem;align-items:start">'
        . '<div style="max-width:420px">' . $aviso . '</div>'
        . '<div style="font-family:sans-serif">' . $formulario . '</div>'
        . '</div>';
}

/** Renderiza un iframe del CRM con el email del usuario firmado en ?wpsso=. */
function crm_render_iframe($path, $extra_query, $title, $gate_con_formulario = false) {
    if (!is_user_logged_in()) {
        // También envuelto: la pantalla de sin sesión necesita el mismo ancho
        // —lleva el formulario al lado— y que le quiten el hueco de arriba.
        return crm_wrap_ancho(crm_login_gate_html($gate_con_formulario));
    }
    if (!defined('CRM_WIDGET_SSO_SECRET') || !CRM_WIDGET_SSO_SECRET
        || CRM_WIDGET_SSO_SECRET === 'PEGA_AQUI_EL_HEX_DE_WIDGET_SSO_SECRETS') {
        return '<!-- CRM_WIDGET_SSO_SECRET no configurado -->';
    }
    $email = wp_get_current_user()->user_email;
    $token = crm_mint_wpsso($email, 300);
    $query = 'wpsso=' . rawurlencode($token);
    if ($extra_query) {
        $query = $extra_query . '&' . $query;
    }
    $src = CRM_BASE_URL . '/widget/c/' . CRM_TENANT . $path . '?' . $query;

    return crm_wrap_ancho(
        '<iframe src="' . esc_url($src) . '" '
        . 'style="width:100%;min-height:820px;border:0;display:block" '
        . 'title="' . esc_attr($title) . '" loading="lazy"></iframe>'
    );
}

/* ── Shortcodes ────────────────────────────────────────────────────────── */

// Reserva de cita: /widget/c/{tenant}?wpa=1&wpsso=...
// (wpa=1 desbloquea el gate del widget; wpsso pre-rellena y bloquea el email.)
// Sin sesión enseña además el formulario de admisión.
function crm_reservar_cita_shortcode() {
    return crm_render_iframe('', 'wpa=1', 'Reserva tu cita', true);
}
add_shortcode('crm_reservar_cita', 'crm_reservar_cita_shortcode');

// Mis citas: /widget/c/{tenant}/mis-citas?wpsso=...
// Aquí NO va el formulario: quien viene a ver sus citas ya es paciente.
function crm_mis_citas_shortcode() {
    return crm_render_iframe('/mis-citas', '', 'Mis citas', false);
}
add_shortcode('crm_mis_citas', 'crm_mis_citas_shortcode');

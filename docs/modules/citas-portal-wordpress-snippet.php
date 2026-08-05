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
 * Ensancha la caja del theme y quita el hueco de arriba. SOLO CSS.
 *
 * ⚠️ AQUÍ NO VA JAVASCRIPT, y no es capricho. La versión anterior lo hacía
 * con una etiqueta de guion incrustada y el cortafuegos del hosting devolvía
 * «403» al intentar GUARDAR el snippet: estos filtros bloquean cualquier
 * formulario que lleve código de navegador dentro. El código no llegaba ni a
 * entrar, y por eso la página seguía igual por mucho que se pegara.
 *
 * Por lo mismo, en este fichero no se escribe esa etiqueta ni entre
 * comentarios: el filtro mira el texto entero, no solo lo que se ejecuta.
 *
 * Se consigue lo mismo con `:has()`, que permite estilar a un elemento por lo
 * que lleva dentro. Soportado por todos los navegadores desde 2023;
 * comprobado en el navegador de Rodrigo.
 *
 * Qué hace:
 *   1. ENSANCHA los contenedores que envuelven al widget hasta 1440px. Se
 *      limita a `main` a propósito: sin eso, `:has()` alcanzaría también a
 *      `body` y `html` y estrecharía la web entera.
 *   2. QUITA la cabecera del theme, que al eliminarle el título a la página se
 *      quedó vacía ocupando 184px de aire.
 *
 * Medido en tunutrilaura.com/citas/ con el theme real:
 *   contenedor 1201px, hueco de arriba 263px → 78px, sin scroll lateral.
 *
 * Si algún día el theme renombra `.blog-hero`, lo único que pasa es que vuelve
 * el hueco: nada se rompe.
 */
function crm_wrap_ancho($html, $max = null) {
    $max = (int) ($max ?: CRM_WIDGET_MAX_WIDTH);
    static $css_puesto = false;

    $css = '';
    if (!$css_puesto) {
        $css_puesto = true;
        $css = '<style>'
            . 'main :has(> .crm-widget-wrap),'
            . 'main :has(> * > .crm-widget-wrap){'
            . 'max-width:' . $max . 'px !important;width:100% !important;'
            . 'padding-top:0 !important;margin-top:0 !important}'
            . 'main:has(.crm-widget-wrap) .blog-hero{display:none !important}'
            /*
             * El bloque, centrado en el hueco bajo la cabecera y con un respiro
             * arriba (05/08/2026, Rodrigo: «deja un poco de padding, que está
             * tocando el header»). Al quitar el hueco de 184px de la cabecera
             * vacía se quitó TODO el aire y se pasó de frenada: quedaba pegado.
             *
             * `min-height` = la ventana menos la navegación, y centrado
             * vertical: si el contenido es más corto que la pantalla queda en
             * medio en vez de arriba del todo, y si crece, empuja hacia abajo
             * con normalidad.
             */
            . '.crm-widget-wrap{width:100%;max-width:' . $max . 'px;margin:0 auto;'
            . 'padding:32px 0;box-sizing:border-box;min-height:calc(100vh - 150px);'
            . 'display:flex;flex-direction:column;justify-content:center}'
            . '</style>';
    }

    return $css . '<div class="crm-widget-wrap">' . $html . '</div>';
}

/**
 * Pantalla de "sin sesión".
 *
 * `$con_formulario` = true en la página de reservar. Quien llega ahí sin
 * cuenta no es que se haya despistado: es que todavía no es paciente, y
 * mandarlo a un login que no puede usar es dejarlo sin salida. Así que lo
 * primero es el formulario de admisión, que es su camino de verdad, y el
 * acceso para pacientes va al final, discreto.
 *
 * ── POR QUÉ EL FORMULARIO VA A TRES COLUMNAS ────────────────────────────────
 * A una columna mide 938px él solo: no cabe en ninguna pantalla y obligaba a
 * bajar. En 3+3 se queda en 522px (medido con el ancho real de la página), y
 * entonces sí entra de una vez. Se hace desde aquí y no tocando el theme para
 * que la página /formularios/ siga como está.
 *
 * Y el bloque de «¿Ya eres paciente?» deja de ser un cuadro grande —chocaba
 * con la cabecera y robaba el sitio al formulario— para ser una línea al pie,
 * pegada al final del formulario (05/08/2026, Rodrigo).
 */
function crm_login_gate_html($con_formulario = false) {
    $current = (is_ssl() ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
    $login   = CRM_LOGIN_URL . '?redirect_to=' . rawurlencode($current);

    $boton = '<a href="' . esc_url($login) . '" style="display:inline-block;padding:.6rem 1.2rem;'
        . 'background:#A97873;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;'
        . 'white-space:nowrap">Iniciar sesión →</a>';

    $acceso = '<div class="crm-gate__acceso">'
        . '<div><strong style="color:#4B3A36">¿Ya eres paciente?</strong>'
        . '<span style="color:#7A6A65"> Entra con tu cuenta para reservar tus citas y '
        . 'consultarlas cuando quieras.</span></div>'
        . $boton
        . '</div>';

    // Sin formulario (p. ej. "Mis citas"): solo el acceso, centrado.
    if (!$con_formulario) {
        return '<div class="crm-gate" style="max-width:560px;margin:0 auto">'
            . crm_gate_css() . $acceso . '</div>';
    }

    // El formulario lo pinta el theme. Se comprueba que exista: si el theme
    // estuviera desactivado, WordPress escupiría el corchetazo en la página.
    $formulario = shortcode_exists('nutrilaura_formulario')
        ? do_shortcode('[nutrilaura_formulario id="fq-citas" titulo="¿Quieres reservar tu primera cita?" boton="Enviar mi solicitud"]')
        : '';

    if (!$formulario) {
        return '<div class="crm-gate" style="max-width:560px;margin:0 auto">'
            . crm_gate_css() . $acceso . '</div>';
    }

    return '<div class="crm-gate">' . crm_gate_css() . $formulario . $acceso . '</div>';
}

/**
 * Estilos de la pantalla sin sesión. Van dentro de `.crm-gate` para que la
 * página /formularios/ —que usa el mismo formulario— no se entere de nada.
 */
function crm_gate_css() {
    static $puesto = false;
    if ($puesto) { return ''; }
    $puesto = true;

    return '<style>'
        /*
         * TRES columnas exactas, no `auto-fit` (05/08/2026, Rodrigo: «vamos a
         * dejarlo en 3 y 3»). Con `auto-fit` el número de columnas dependía del
         * ancho: en su pantalla salían cuatro arriba y dos abajo, que es
         * justo lo que se veía descuadrado.
         */
        . '.crm-gate .fq-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));'
        . 'gap:.5rem 1.5rem;align-items:start}'
        /*
         * Los cuadros de respuesta arrancan TODOS a la misma altura. Cada
         * pregunta se convierte en una rejilla de dos filas: el enunciado
         * ocupa una fila de alto fijo —una línea— y la respuesta la otra. Sin
         * esto, una pregunta de dos líneas empujaba su cuadro hacia abajo y la
         * fila entera quedaba en escalera.
         */
        . '.crm-gate .fq-field{margin:0;display:grid;grid-template-rows:1.6rem auto;align-content:start}'
        /*
         * Sin `nowrap` ni recortes: los enunciados ya caben en una línea
         * porque se acortaron en el theme. Y en un contenedor flex como este
         * label, `overflow:hidden` colapsaba la caja a 29px en vez de
         * recortar el texto — el remedio era peor.
         */
        . '.crm-gate .fq-label{margin:0;align-self:center;font-size:.92rem;line-height:1.25}'
        // Los dos textos largos ya viven dentro del cuadro; si quedara alguno
        // suelto, fuera: rompería la alineación de la fila.
        . '.crm-gate .fq-help{display:none}'
        // Cuadros más bajos: son notas breves, no redacciones.
        . '.crm-gate .fq-textarea{min-height:64px}'
        // Lo que no es una pregunta ocupa el ancho entero: partir en tres una
        // casilla de consentimiento o el botón de enviar no tiene sentido.
        . '.crm-gate .fq-form>.fq-consent,.crm-gate .fq-form>.fq-submit,'
        . '.crm-gate .fq-form>.fq-privacidad,.crm-gate .fq-form>.fq-error{grid-column:1/-1}'
        . '.crm-gate .fq-consent{margin-top:.4rem}'
        . '.crm-gate .fq-card{padding:1.25rem}'
        // El acceso de pacientes, pegado al final del formulario.
        . '.crm-gate__acceso{display:flex;gap:.75rem 1.5rem;align-items:center;'
        . 'justify-content:space-between;flex-wrap:wrap;margin-top:1rem;padding-top:1rem;'
        . 'border-top:1px solid #EADFD9;font-family:sans-serif;font-size:.95rem;line-height:1.45}'
        /*
         * En pantallas estrechas las tres columnas no caben: se pasa a una y
         * se sueltan las ataduras de altura, que ahí solo estorban.
         */
        . '@media (max-width:900px){'
        . '.crm-gate .fq-form{grid-template-columns:1fr}'
        . '.crm-gate .fq-field{display:block}'
        . '.crm-gate .fq-label{white-space:normal}}'
        . '</style>';
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

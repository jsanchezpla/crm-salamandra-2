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
 *   2. Define el secreto: en `wp-config.php` (recomendado) o en el bloque de
 *      abajo. Debe ser EXACTAMENTE el mismo que WIDGET_SSO_SECRETS[nutri_laura]
 *      del `.env.production` del CRM.
 *   3. Coloca [crm_reservar_cita] en la página de reservas y [crm_mis_citas]
 *      en la página de "mis citas".
 *
 * Seguridad:
 *   - El secreto vive server-side. El token `wpsso` se regenera en cada carga
 *     (TTL 5 min); el CRM lo canjea por su propio sessionToken (~60 min).
 *   - El email se firma en el token, así que el cliente no puede reservar ni
 *     ver citas con un email distinto al de su cuenta.
 */

if (!defined('ABSPATH')) { exit; }

/* ── Configuración ─────────────────────────────────────────────────────────
 * Recomendado: define CRM_WIDGET_SSO_SECRET en wp-config.php y borra el bloque.
 */
if (!defined('CRM_WIDGET_SSO_SECRET')) {
    define('CRM_WIDGET_SSO_SECRET', 'PEGA_AQUI_EL_HEX_DE_WIDGET_SSO_SECRETS');
}
if (!defined('CRM_BASE_URL'))  { define('CRM_BASE_URL', 'https://crm.salamandrasolutions.com'); }
if (!defined('CRM_TENANT'))    { define('CRM_TENANT', 'nutri_laura'); }
if (!defined('CRM_LOGIN_URL')) { define('CRM_LOGIN_URL', 'https://tunutrilaura.com/login/'); }

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

/** Pantalla "inicia sesión" (misma para reservar y mis-citas), con tu URL de login. */
function crm_login_gate_html() {
    $current = (is_ssl() ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
    $login   = CRM_LOGIN_URL . '?redirect_to=' . rawurlencode($current);
    return '<div style="max-width:480px;margin:2rem auto;padding:2rem;text-align:center;'
        . 'font-family:sans-serif;border:1px solid #EADFD9;border-radius:16px;background:#fff">'
        . '<h2 style="margin:0 0 .5rem;color:#4B3A36">Inicia sesión</h2>'
        . '<p style="margin:0 0 1.25rem;color:#7A6A65">Para gestionar tus citas necesitas '
        . 'iniciar sesión con tu cuenta.</p>'
        . '<a href="' . esc_url($login) . '" style="display:inline-block;padding:.7rem 1.4rem;'
        . 'background:#A97873;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">'
        . 'Iniciar sesión →</a></div>';
}

/** Renderiza un iframe del CRM con el email del usuario firmado en ?wpsso=. */
function crm_render_iframe($path, $extra_query, $title) {
    if (!is_user_logged_in()) {
        return crm_login_gate_html();
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
    return '<div style="position:relative;width:100%;max-width:1200px;margin:0 auto">'
        . '<iframe src="' . esc_url($src) . '" '
        . 'style="width:100%;min-height:820px;border:0;display:block" '
        . 'title="' . esc_attr($title) . '" loading="lazy"></iframe>'
        . '</div>';
}

/* ── Shortcodes ────────────────────────────────────────────────────────── */

// Reserva de cita: /widget/c/{tenant}?wpa=1&wpsso=...
// (wpa=1 desbloquea el gate del widget; wpsso pre-rellena y bloquea el email.)
function crm_reservar_cita_shortcode() {
    return crm_render_iframe('', 'wpa=1', 'Reserva tu cita');
}
add_shortcode('crm_reservar_cita', 'crm_reservar_cita_shortcode');

// Mis citas: /widget/c/{tenant}/mis-citas?wpsso=...
function crm_mis_citas_shortcode() {
    return crm_render_iframe('/mis-citas', '', 'Mis citas');
}
add_shortcode('crm_mis_citas', 'crm_mis_citas_shortcode');

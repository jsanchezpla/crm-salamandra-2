<?php
/**
 * REFERENCIA (no se ejecuta en el CRM) — Snippet para el WordPress de Laura.
 *
 * Genera el token `wpsso` (JWT HS256) con el email del usuario logueado y
 * renderiza el iframe del portal "Mis citas".
 *
 * Instalación en WordPress:
 *   1. Pegar este código en un mu-plugin o en functions.php del tema hijo.
 *   2. Definir el secreto en wp-config.php (NUNCA en el tema versionado):
 *        define('CRM_WIDGET_SSO_SECRET', '<el MISMO hex que WIDGET_SSO_SECRETS[nutri_laura] en el CRM>');
 *   3. Colocar el shortcode [crm_mis_citas] en la página (protegida para usuarios logueados).
 *
 * Notas de seguridad:
 *   - El secreto vive server-side (wp-config.php). El token se regenera en cada
 *     carga de la página, por eso un TTL de 5 min basta para el handoff.
 *   - El CRM cambia este `wpsso` por su propio sessionToken (~60 min) — el `wpsso`
 *     no se reutiliza.
 */

if (!defined('ABSPATH')) { exit; }

function crm_b64url($data) {
  return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/**
 * Firma un JWT HS256 { email, tenant, iat, exp } compatible con `jose` del CRM.
 */
function crm_mint_wpsso($email, $tenant, $secret, $ttl_seconds = 300) {
  $header  = crm_b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
  $now     = time();
  $payload = crm_b64url(json_encode([
    'email'  => strtolower(trim($email)),
    'tenant' => $tenant,
    'iat'    => $now,
    'exp'    => $now + $ttl_seconds,
  ]));
  $signingInput = $header . '.' . $payload;
  $sig = crm_b64url(hash_hmac('sha256', $signingInput, $secret, true));
  return $signingInput . '.' . $sig;
}

function crm_mis_citas_shortcode() {
  $crm_base = 'https://crm.salamandrasolutions.com';
  $tenant   = 'nutri_laura';

  if (!is_user_logged_in()) {
    $login = wp_login_url(get_permalink());
    return '<div style="max-width:480px;margin:2rem auto;text-align:center;font-family:sans-serif">'
      . '<p>Para ver tus citas, inicia sesión.</p>'
      . '<a href="' . esc_url($login) . '" style="display:inline-block;margin-top:.5rem;padding:.6rem 1.2rem;'
      . 'background:#A97873;color:#fff;border-radius:8px;text-decoration:none">Iniciar sesión</a>'
      . '</div>';
  }

  if (!defined('CRM_WIDGET_SSO_SECRET') || !CRM_WIDGET_SSO_SECRET) {
    return '<!-- CRM_WIDGET_SSO_SECRET no definido en wp-config.php -->';
  }

  $user  = wp_get_current_user();
  $token = crm_mint_wpsso($user->user_email, $tenant, CRM_WIDGET_SSO_SECRET, 300);
  $src   = $crm_base . '/widget/c/' . $tenant . '/mis-citas?wpsso=' . rawurlencode($token);

  return '<div style="position:relative;width:100%;max-width:1200px;margin:0 auto">'
    . '<iframe src="' . esc_url($src) . '" '
    . 'style="width:100%;min-height:820px;border:0;display:block" '
    . 'title="Mis citas" loading="lazy"></iframe>'
    . '</div>';
}
add_shortcode('crm_mis_citas', 'crm_mis_citas_shortcode');

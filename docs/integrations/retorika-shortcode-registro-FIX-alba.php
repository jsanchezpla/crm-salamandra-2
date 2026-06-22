<?php
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Retorika · CRM Salamandra — Shortcode [retorika_registro]
 * VERSIÓN: FIX-alba (sprint detección empresa inactivo en registro privado)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este archivo es el snippet PHP COMPLETO con el fix integrado.
 *
 * Jorge: cuando deploye en producción, copia este contenido (desde
 * `<?php` hasta el final) y reemplaza el snippet actual del plugin
 * "Code Snippets" del WP de Retorika (`asesoriaretorika.com`).
 * NO requiere migración BD ni cambios en el VPS más allá del nuevo
 * endpoint backend `POST /api/webhooks/retorika/check-empresa-user`.
 *
 * ─── QUÉ CAMBIA RESPECTO AL SHORTCODE ACTUAL ────────────────────────────────
 *
 * Bug observado: una alumna importada al CRM como TrainingUser empresa
 * inactiva (`type=company, active=false`, caso Trinity College) fue al form
 * de registro privado del WP. El check del shortcode actual solo mira metas
 * de WordPress (`get_user_meta(... 'tipo')`), pero esta alumna AÚN NO
 * existía en WP — solo en el CRM. Resultado: usuario creado como privado,
 * sin cursos de empresa, sin acceso al curso comprado por Trinity.
 *
 * Diff principal:
 *
 *   1. `re_register_privado_rest()`:
 *      ANTES de cualquier otra validación o creación, consulta al CRM en
 *      `POST /api/webhooks/retorika/check-empresa-user`. Si el alumno
 *      existe como empresa inactiva, devuelve `inactive_empresa: true`
 *      sin tocar WP.
 *      Si la consulta CRM falla (timeout, 5xx) → fail-open con error_log.
 *      El check actual de `get_user_meta` se mantiene como segunda
 *      defensa (alumnos que ya fueron creados en WP por imports antiguos).
 *
 *   2. JS frontend del shortcode (submit privado):
 *      Cuando llega `jsonWP.inactive_empresa: true`, además de mostrar el
 *      mensaje, el JS:
 *         a) Hace scroll suave hacia las tabs.
 *         b) Cambia programáticamente a la tab "Registro empresa".
 *         c) Pre-rellena el campo email de la tab empresa con el email
 *            que el usuario ya había escrito en la tab privado.
 *      Si el backend devolviera `link` (fallback), seguirá funcionando.
 *
 *   3. NO se modifica:
 *      - `re_register_empresa_rest()` (sin cambios).
 *      - El flujo de WC_Order auto-completado.
 *      - Los demás endpoints existentes.
 *      - Lógica de nonce de empresa.
 *
 * ─── COMPORTAMIENTO EN FALLOS ──────────────────────────────────────────────
 *
 * Si el endpoint CRM no responde (timeout 5s) o responde error, el
 * shortcode NO bloquea: continúa con la validación heredada
 * (`get_user_meta`) y crea el usuario en WP. Esto evita romper el
 * registro de alumnos legítimos si el CRM cae. Cualquier fallo se
 * registra con `error_log('[retorika:check-empresa-user] ...')` para
 * diagnóstico.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Retorika — Registro unificado (privado + empresa)
 * Shortcode: [retorika_registro]
 */

add_action('rest_api_init', function () {
  register_rest_route('retorika/v1', '/register-privado', [
    'methods'             => 'POST',
    'callback'            => 're_register_privado_rest',
    'permission_callback' => '__return_true',
  ]);
  register_rest_route('retorika/v1', '/register-empresa', [
    'methods'             => 'POST',
    'callback'            => 're_register_empresa_rest',
    'permission_callback' => '__return_true',
  ]);
});

/**
 * Consulta al CRM si el email corresponde a un TrainingUser empresa
 * inactivo. Devuelve true/false. Si la consulta falla, devuelve false
 * (fail-open) y deja constancia en error_log.
 */
function re_is_empresa_inactive_in_crm(string $email): bool {
  $email = sanitize_email($email);
  if (empty($email)) return false;

  $url = 'https://crm.salamandrasolutions.com/api/webhooks/retorika/check-empresa-user';
  $response = wp_remote_post($url, [
    'timeout' => 5,
    'headers' => [
      'Content-Type' => 'application/json',
      'x-tenant'     => 'retorika',
    ],
    'body' => wp_json_encode(['email' => strtolower($email)]),
  ]);

  if (is_wp_error($response)) {
    error_log('[retorika:check-empresa-user] error: ' . $response->get_error_message());
    return false; // fail-open
  }

  $status = wp_remote_retrieve_response_code($response);
  if ($status !== 200) {
    error_log('[retorika:check-empresa-user] CRM status=' . $status . ' — fail-open');
    return false;
  }

  $data = json_decode(wp_remote_retrieve_body($response), true);
  if (!is_array($data) || empty($data['ok'])) {
    error_log('[retorika:check-empresa-user] respuesta inesperada — fail-open');
    return false;
  }

  return !empty($data['isEmpresaInactive']);
}

function re_register_privado_rest(WP_REST_Request $request) {
  $data      = $request->get_json_params();
  $nombre    = sanitize_text_field($data['name_1'] ?? '');
  $apellidos = sanitize_text_field($data['name_2'] ?? '');
  $username  = sanitize_user($data['text_1'] ?? '');
  $email     = sanitize_email($data['email_1'] ?? '');
  $password  = (string)($data['password'] ?? '');

  if (!$email || !$username || !$password)
    return new WP_REST_Response(['ok' => false, 'message' => 'Faltan datos.'], 400);

  // ── NUEVO: primero pregunta al CRM si el email es empresa inactivo ──────
  // Esto cubre el caso "alumna importada al CRM pero aún no creada en WP".
  // El check de get_user_meta de abajo (segunda defensa) solo cubre el
  // caso "ya creada en WP por un import antiguo".
  if (re_is_empresa_inactive_in_crm($email)) {
    return new WP_REST_Response([
      'ok'               => false,
      'inactive_empresa' => true,
      'message'          => 'Detectamos que tu correo está vinculado a una empresa registrada. Cambia a la pestaña "Registro empresa" para completar tu alta.',
      'link'             => null,
    ], 400);
  }

  // ── Segunda defensa: por si el usuario empresa ya existe en WP ─────────
  $existente = get_user_by('email', $email);
  if ($existente && get_user_meta($existente->ID, 'tipo', true) === 'Empresa' && !get_user_meta($existente->ID, 'activo', true)) {
    return new WP_REST_Response([
      'ok'               => false,
      'inactive_empresa' => true,
      'message'          => 'Ya existe un usuario de empresa con este correo, pero aún no está activo. Cambia a la pestaña "Registro empresa" para completarlo.',
      'link'             => null,
    ], 400);
  }

  if (email_exists($email)) {
    $user = get_user_by('email', $email);
    wp_set_current_user($user->ID);
    wp_set_auth_cookie($user->ID, false);
    if (function_exists('wc_load_cart')) wc_load_cart();
    return new WP_REST_Response(['ok' => true, 'message' => 'Ya estás conectado.', 'redirect' => home_url('/escritorio/')]);
  }

  if (username_exists($username)) {
    $base = $username; $i = 2;
    while (username_exists($username)) $username = $base . $i++;
  }

  $user_id = wp_insert_user([
    'user_login'   => $username,
    'user_pass'    => $password,
    'user_email'   => $email,
    'display_name' => trim($nombre . ' ' . $apellidos) ?: $username,
    'first_name'   => $nombre,
    'last_name'    => $apellidos,
    'role'         => 'subscriber',
  ]);

  if (is_wp_error($user_id))
    return new WP_REST_Response(['ok' => false, 'message' => $user_id->get_error_message()], 400);

  wp_set_current_user($user_id);
  wp_set_auth_cookie($user_id, false);
  if (class_exists('WC_Customer')) (new WC_Customer($user_id))->save();
  if (function_exists('wc_load_cart')) wc_load_cart();

  return new WP_REST_Response(['ok' => true, 'message' => 'Usuario creado.', 'redirect' => home_url('/escritorio/')], 200);
}

function re_fetch_company_product_ids_by_email(string $email): array {
  $email = sanitize_email($email);
  if (empty($email)) return [];
  $url      = 'https://crm.salamandrasolutions.com/api/cursos-empresas/codigos-cursos/' . rawurlencode($email);
  $response = wp_remote_get($url, ['timeout' => 12, 'headers' => ['Accept' => 'application/json', 'x-tenant' => 'retorika']]);
  if (is_wp_error($response)) return [];
  $code = wp_remote_retrieve_response_code($response);
  $body = wp_remote_retrieve_body($response);
  if ($code < 200 || $code > 299) return [];
  $data = json_decode($body, true);
  if (!is_array($data)) return [];
  return array_values(array_filter(array_map('intval', $data), fn($n) => $n > 0));
}

function re_register_empresa_rest(WP_REST_Request $request) {
  $data      = $request->get_json_params();
  $nonce     = $data['re_nonce'] ?? '';

  if (!$nonce || !wp_verify_nonce($nonce, 're_register'))
    return new WP_REST_Response(['ok' => false, 'message' => 'Sesión inválida. Recarga la página.'], 403);

  $username  = sanitize_user($data['username'] ?? '');
  $email     = sanitize_email($data['email'] ?? '');
  $password  = (string)($data['password'] ?? '');
  $password2 = (string)($data['password_confirm'] ?? '');

  $errs = [];
  if (strlen($username) < 3)    $errs[] = 'El usuario debe tener al menos 3 caracteres.';
  if (!is_email($email))        $errs[] = 'Introduce un correo electrónico válido.';
  if (strlen($password) < 8)    $errs[] = 'La contraseña debe tener mínimo 8 caracteres.';
  if ($password !== $password2) $errs[] = 'Las contraseñas no coinciden.';

  if (email_exists($email)) {
    $user = get_user_by('email', $email);
    wp_set_current_user($user->ID);
    wp_set_auth_cookie($user->ID, false);
    return new WP_REST_Response(['ok' => true, 'message' => 'Ya estás conectado.', 'redirect' => home_url('/escritorio/')]);
  }

  if (username_exists($username)) $errs[] = 'Ese nombre de usuario ya existe.';
  if (!empty($errs)) return new WP_REST_Response(['ok' => false, 'message' => implode(' ', $errs)], 400);

  $api_url = 'https://crm.salamandrasolutions.com/api/usuarios/register/empresa';
  $payload = ['email' => strtolower($email), 'email_1' => strtolower($email), 'username' => $username, 'text_1' => $username];
  $resp    = wp_remote_post($api_url, [
    'method'  => 'POST',
    'headers' => ['Content-Type' => 'application/json', 'x-tenant' => 'retorika'],
    'timeout' => 15,
    'body'    => wp_json_encode($payload),
  ]);

  if (is_wp_error($resp))
    return new WP_REST_Response(['ok' => false, 'message' => 'No se pudo contactar con el servicio. Inténtalo más tarde.'], 502);

  $status = wp_remote_retrieve_response_code($resp);
  $json   = json_decode(wp_remote_retrieve_body($resp), true);

  if ($status < 200 || $status >= 300) {
    $msg = is_array($json) && !empty($json['message']) ? $json['message'] : 'Error en el registro.';
    return new WP_REST_Response(['ok' => false, 'message' => $msg], $status);
  }

  if (empty($json['exists'])) {
    $msg = !empty($json['message']) ? $json['message'] : 'No autorizado para registrarte.';
    return new WP_REST_Response(['ok' => false, 'message' => $msg], 403);
  }

  $normalized  = $json['normalized'] ?? [];
  $final_email = isset($normalized['email'])    ? sanitize_email($normalized['email'])   : $email;
  $final_user  = isset($normalized['username']) ? sanitize_user($normalized['username']) : $username;
  $name        = isset($json['name'])           ? sanitize_text_field($json['name'])     : '';

  if (username_exists($final_user)) {
    $base = $final_user; $i = 2;
    while (username_exists($final_user)) { $final_user = $base . $i; $i++; }
  }

  $user_id = wp_insert_user([
    'user_login'   => $final_user,
    'user_pass'    => $password,
    'user_email'   => $final_email,
    'display_name' => $name ?: $final_user,
    'first_name'   => $name,
    'role'         => 'subscriber',
  ]);

  if (is_wp_error($user_id))
    return new WP_REST_Response(['ok' => false, 'message' => $user_id->get_error_message()], 400);

  wp_set_current_user($user_id);
  wp_set_auth_cookie($user_id, false);

  $order_id = null;
  if (function_exists('wc_create_order')) {
    $product_ids = re_fetch_company_product_ids_by_email($final_email);
    $order       = wc_create_order(['customer_id' => $user_id]);
    if (!is_wp_error($order)) {
      foreach ($product_ids as $pid) {
        $product = wc_get_product($pid);
        if ($product) {
          $item_id = $order->add_product($product, 1);
          if ($item_id) {
            $item = $order->get_item($item_id);
            if ($item) { $item->set_subtotal(0); $item->set_total(0); $item->save(); }
          }
        }
      }
      $order->calculate_totals();
      $order->set_total(0);
      $order->update_status('completed', 'Auto-completado por cobertura de empresa.', true);
      $order_id = $order->get_id();
    }
  }

  return new WP_REST_Response([
    'ok'       => true,
    'message'  => 'Registro completado.',
    'user_id'  => (int)$user_id,
    'order_id' => (int)$order_id,
    'redirect' => home_url('/escritorio/'),
  ], 200);
}

// ── Shortcode ─────────────────────────────────────────────────────────────────

add_shortcode('retorika_registro', function () {

  if (is_user_logged_in()) {
    $user = wp_get_current_user();
    ob_start(); ?>
    <div style="text-align:center;padding:60px 20px;font-family:system-ui;">
      <p style="font-size:1.1rem;color:#0b234a;">
        Bienvenido de nuevo, <strong><?php echo esc_html($user->display_name); ?></strong>.
      </p>
      <a href="<?php echo esc_url(home_url('/escritorio/')); ?>"
         style="display:inline-block;margin-top:12px;padding:11px 26px;background:#174792;color:#fff;border-radius:999px;text-decoration:none;font-weight:700;">
        Ir al escritorio
      </a>
    </div>
    <?php return ob_get_clean();
  }

  $ep_privado = rest_url('retorika/v1/register-privado');
  $ep_empresa = rest_url('retorika/v1/register-empresa');

  ob_start(); ?>
  <div class="rr-wrap">
  <style>
    .rr-wrap{display:grid;place-items:center;padding:32px 16px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;}
    .rr-inner{width:min(94vw,560px);}

    .rr-tabs{display:grid;grid-template-columns:1fr 1fr;border-radius:999px;overflow:hidden;border:2px solid #174792;margin-bottom:20px;}
    .rr-tab{padding:12px 0;text-align:center;font-size:.875rem;font-weight:700;cursor:pointer;background:transparent;color:#174792;border:none;transition:background .2s,color .2s;letter-spacing:.2px;}
    .rr-tab.on{background:#174792;color:#fff;}

    .rr-card{background:linear-gradient(180deg,#174792,#1b539f);border-radius:28px;box-shadow:0 14px 40px rgba(15,49,114,.25);padding:32px 28px 28px;}
    .rr-card h2{margin:0 0 20px;font-size:1.25rem;font-weight:700;color:#fff;text-align:center;}

    .rr-panel{display:none;}.rr-panel.on{display:block;}
    .rr-form{display:grid;gap:14px;}
    .rr-field{display:flex;flex-direction:column;gap:4px;}
    .rr-field label{color:#e7efff;font-size:.85rem;font-weight:600;margin-bottom:2px;}

    .rr-input{
      appearance:none;width:100%;box-sizing:border-box;
      border:2px solid #a9c5ff;background:#ffffff;color:#0b234a;
      border-radius:0px;
      padding:12px 18px;font-size:1rem;
      outline:none;transition:border-color .15s,background .15s;
    }
    .rr-input::placeholder{color:#6f86ae;}
    .rr-input:focus{border-color:#7fb0ff;background:#f3f8ff;}
    .rr-input.invalid{border-color:#e05555 !important;background:#fff0f0 !important;}
    select.rr-input{cursor:pointer;}

    .rr-hint{font-size:.76rem;color:#ffc8c8;padding-left:4px;min-height:0;max-height:0;overflow:hidden;opacity:0;transition:max-height .2s,opacity .2s;}
    .rr-hint.show{max-height:40px;opacity:1;}

    .rr-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    @media(max-width:440px){.rr-row{grid-template-columns:1fr;}}

    .rr-strength{display:flex;gap:4px;margin-top:4px;}
    .rr-strength-bar{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.15);transition:background .3s;}

    .rr-pass-wrap{position:relative;display:flex;align-items:center;}
    .rr-pass-wrap .rr-input{padding-right:46px;}
    .rr-eye{position:absolute;right:14px;background:none;border:none;cursor:pointer;color:#3a5ea7;padding:4px;display:flex;align-items:center;justify-content:center;transition:color .15s;}
    .rr-eye:hover{color:#174792;}

    .rr-submit{margin-top:4px;width:100%;background:#fff;color:#0a2c72;border:0;border-radius:999px;padding:14px 18px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;font-size:1rem;cursor:pointer;transition:transform .06s,box-shadow .15s;box-shadow:0 8px 24px rgba(255,255,255,.18);}
    .rr-submit:hover{transform:translateY(-1px);}
    .rr-submit:active{transform:translateY(0);}
    .rr-submit:disabled{opacity:.6;cursor:not-allowed;transform:none;}

    .rr-alert{border-radius:12px;padding:10px 16px;font-size:.9rem;margin-bottom:12px;display:none;line-height:1.4;}
    .rr-alert.err{background:rgba(198,40,40,.9);color:#fff;}
    .rr-alert.ok{background:#d8f3dc;color:#0e4a1f;}
  </style>

  <div class="rr-inner">
    <div class="rr-tabs">
      <button class="rr-tab on" data-tab="privado">Registro privado</button>
      <button class="rr-tab" data-tab="empresa">Registro empresa</button>
    </div>

    <div class="rr-card">

      <!-- TAB PRIVADO -->
      <div class="rr-panel on" id="rr-privado">
        <h2>Registro de estudiante</h2>
        <div class="rr-alert ok"  id="rr-ok-p"></div>
        <div class="rr-alert err" id="rr-err-p"></div>
        <form class="rr-form" id="rr-form-p" novalidate>

          <div class="rr-row">
            <div class="rr-field">
              <label>Nombre *</label>
              <input class="rr-input" name="name_1" type="text" required placeholder="Tu nombre"/>
              <span class="rr-hint" data-msg="Introduce tu nombre"></span>
            </div>
            <div class="rr-field">
              <label>Apellidos *</label>
              <input class="rr-input" name="name_2" type="text" required placeholder="Tus apellidos"/>
              <span class="rr-hint" data-msg="Introduce tus apellidos"></span>
            </div>
          </div>

          <div class="rr-field">
            <label>Fecha de nacimiento *</label>
            <input class="rr-input" name="date_1" type="date" required/>
            <span class="rr-hint" data-msg="Selecciona tu fecha de nacimiento"></span>
          </div>

          <div class="rr-field">
            <label>País *</label>
            <select class="rr-input" name="select_1" required>
              <option value="">Selecciona tu país</option>
              <option>España</option><option>México</option>
              <option>Argentina</option><option>Colombia</option><option>Chile</option>
            </select>
            <span class="rr-hint" data-msg="Selecciona un país"></span>
          </div>

          <div class="rr-field">
            <label>Nombre de usuario *</label>
            <input class="rr-input" name="text_1" type="text" required minlength="3" placeholder="mínimo 3 caracteres"/>
            <span class="rr-hint" data-msg="Mínimo 3 caracteres"></span>
          </div>

          <div class="rr-field">
            <label>Correo electrónico *</label>
            <input class="rr-input" name="email_1" type="email" required placeholder="tuemail@dominio.com"/>
            <span class="rr-hint" data-msg="Introduce un email válido"></span>
          </div>

          <div class="rr-field">
            <label>Contraseña *</label>
            <div class="rr-pass-wrap">
              <input class="rr-input" name="password" type="password" required minlength="8" placeholder="mínimo 8 caracteres"/>
              <button type="button" class="rr-eye" aria-label="Ver contraseña">
                <svg class="eye-show" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="eye-hide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            <div class="rr-strength">
              <div class="rr-strength-bar"></div>
              <div class="rr-strength-bar"></div>
              <div class="rr-strength-bar"></div>
              <div class="rr-strength-bar"></div>
            </div>
            <span class="rr-hint" data-msg="Mínimo 8 caracteres"></span>
          </div>

          <div class="rr-field">
            <label>Confirmar contraseña *</label>
            <div class="rr-pass-wrap">
              <input class="rr-input" name="password_confirm" type="password" required placeholder="Repite la contraseña"/>
              <button type="button" class="rr-eye" aria-label="Ver contraseña">
                <svg class="eye-show" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="eye-hide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            <span class="rr-hint" data-msg="Las contraseñas no coinciden"></span>
          </div>

          <button class="rr-submit" type="submit">Crear cuenta</button>
        </form>
      </div>

      <!-- TAB EMPRESA -->
      <div class="rr-panel" id="rr-empresa">
        <h2>Registro de empresa</h2>
        <div class="rr-alert ok"  id="rr-ok-e"></div>
        <div class="rr-alert err" id="rr-err-e"></div>
        <form class="rr-form" id="rr-form-e" novalidate>
          <?php wp_nonce_field('re_register', 're_nonce_e'); ?>

          <div class="rr-field">
            <label>Nombre de usuario *</label>
            <input class="rr-input" name="username" type="text" required minlength="3" placeholder="mínimo 3 caracteres"/>
            <span class="rr-hint" data-msg="Mínimo 3 caracteres"></span>
          </div>

          <div class="rr-field">
            <label>Correo electrónico corporativo *</label>
            <input class="rr-input" name="email" type="email" required placeholder="correo@tuempresa.com"/>
            <span class="rr-hint" data-msg="Introduce un email válido"></span>
          </div>

          <div class="rr-field">
            <label>Contraseña *</label>
            <div class="rr-pass-wrap">
              <input class="rr-input" name="password" type="password" required minlength="8" placeholder="mínimo 8 caracteres"/>
              <button type="button" class="rr-eye" aria-label="Ver contraseña">
                <svg class="eye-show" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="eye-hide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            <div class="rr-strength">
              <div class="rr-strength-bar"></div>
              <div class="rr-strength-bar"></div>
              <div class="rr-strength-bar"></div>
              <div class="rr-strength-bar"></div>
            </div>
            <span class="rr-hint" data-msg="Mínimo 8 caracteres"></span>
          </div>

          <div class="rr-field">
            <label>Confirmar contraseña *</label>
            <div class="rr-pass-wrap">
              <input class="rr-input" name="password_confirm" type="password" required placeholder="Repite la contraseña"/>
              <button type="button" class="rr-eye" aria-label="Ver contraseña">
                <svg class="eye-show" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="eye-hide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            <span class="rr-hint" data-msg="Las contraseñas no coinciden"></span>
          </div>

          <button class="rr-submit" type="submit">Crear cuenta</button>
        </form>
      </div>

    </div>
  </div>
  </div>

  <script>
  (function(){
    const $  = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    // Tabs
    function switchTab(tabName) {
      $$('.rr-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tabName));
      $$('.rr-panel').forEach(p => p.classList.toggle('on', p.id === 'rr-' + tabName));
    }
    $$('.rr-tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    // Ver/ocultar contraseña
    $$('.rr-eye').forEach(btn => btn.addEventListener('click', () => {
      const input = btn.closest('.rr-pass-wrap').querySelector('input');
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      btn.querySelector('.eye-show').style.display = isPass ? 'none'   : 'inline';
      btn.querySelector('.eye-hide').style.display = isPass ? 'inline' : 'none';
    }));

    // Fortaleza contraseña
    function calcStrength(pw) {
      let s = 0;
      if (pw.length >= 8)  s++;
      if (pw.length >= 12) s++;
      if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
      if (/\d/.test(pw))   s++;
      if (/[^A-Za-z0-9]/.test(pw)) s++;
      return Math.min(s, 4);
    }
    const colors = ['#e05555','#e07a30','#e0c030','#3db86e'];
    $$('.rr-form').forEach(form => {
      const pw   = form.querySelector('input[name="password"]');
      const bars = form.querySelectorAll('.rr-strength-bar');
      if (!pw || !bars.length) return;
      pw.addEventListener('input', () => {
        const s = calcStrength(pw.value);
        bars.forEach((b, i) => b.style.background = i < s ? colors[s-1] : 'rgba(255,255,255,.15)');
      });
    });

    // Validación campo a campo
    function validateField(input) {
      const field = input.closest('.rr-field');
      if (!field) return true;
      const hint = field.querySelector('.rr-hint');
      let ok = true;
      let msg = hint?.dataset.msg || '';

      if (input.required && !input.value.trim()) ok = false;
      if (input.type === 'email' && input.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
        ok = false; msg = 'Introduce un email válido';
      }
      if (input.minLength > 0 && input.value.length > 0 && input.value.length < input.minLength) {
        ok = false; msg = `Mínimo ${input.minLength} caracteres`;
      }
      if (input.name === 'password_confirm') {
        const pw = input.closest('form').querySelector('input[name="password"]');
        if (pw && input.value && input.value !== pw.value) {
          ok = false; msg = 'Las contraseñas no coinciden';
        }
      }

      input.classList.toggle('invalid', !ok);
      if (hint) {
        hint.textContent = ok ? '' : msg;
        hint.classList.toggle('show', !ok);
      }
      return ok;
    }

    $$('.rr-input').forEach(input => {
      input.addEventListener('blur',  () => validateField(input));
      input.addEventListener('input', () => { if (input.classList.contains('invalid')) validateField(input); });
    });

    function validateForm(form) {
      let ok = true;
      form.querySelectorAll('.rr-input').forEach(inp => { if (!validateField(inp)) ok = false; });
      return ok;
    }

    function showErr(id, msg) {
      const el = document.getElementById(id);
      el.innerHTML = msg; el.style.display = 'block';
      el.scrollIntoView({behavior:'smooth', block:'nearest'});
    }
    function showOk(id, msg) {
      const el = document.getElementById(id);
      el.textContent = msg; el.style.display = 'block';
    }
    function hideAlerts(a, b) {
      document.getElementById(a).style.display = 'none';
      document.getElementById(b).style.display = 'none';
    }

    // NUEVO: empuja al usuario hacia la tab empresa cuando el CRM (o WP)
    // detecta que su email es empresa inactivo. Mostrar el mensaje + scroll
    // suave a las tabs + activar la tab empresa + prefill del email.
    function handleInactiveEmpresa(jsonWP, emailPrefill) {
      const wrap = document.querySelector('.rr-wrap');
      // Mensaje en el alert del propio formulario privado (se queda visible
      // hasta el siguiente intento). Si llega `link` lo conservamos como
      // fallback (no es lo esperado en el flujo nuevo).
      const html = jsonWP.message + (jsonWP.link
        ? ' <a href="' + jsonWP.link + '" style="color:#fff;text-decoration:underline;">Ir al registro de empresa</a>'
        : '');
      showErr('rr-err-p', html);

      // Scroll suave a las tabs y switch a la tab empresa.
      const tabs = wrap?.querySelector('.rr-tabs');
      if (tabs) tabs.scrollIntoView({ behavior:'smooth', block:'start' });
      // Pequeño delay para que el scroll arranque antes del switch visual.
      setTimeout(() => {
        switchTab('empresa');
        if (emailPrefill) {
          const eEmail = document.querySelector('#rr-form-e input[name="email"]');
          if (eEmail) {
            eEmail.value = emailPrefill;
            eEmail.dispatchEvent(new Event('input', { bubbles:true }));
            eEmail.focus();
          }
        }
      }, 250);
    }

    // Submit privado
    $('#rr-form-p').addEventListener('submit', async e => {
      e.preventDefault();
      hideAlerts('rr-ok-p', 'rr-err-p');
      if (!validateForm(e.target)) { showErr('rr-err-p', 'Corrige los errores antes de continuar.'); return; }

      const form = e.target;
      const btn  = form.querySelector('.rr-submit');
      btn.disabled = true; btn.textContent = 'Enviando...';

      const data = {
        name_1:           form.name_1.value.trim(),
        name_2:           form.name_2.value.trim(),
        text_1:           form.text_1.value.trim(),
        email_1:          form.email_1.value.trim().toLowerCase(),
        select_1:         form.select_1.value,
        date_1:           form.date_1.value,
        password:         form.password.value,
        password_confirm: form.password_confirm.value,
      };

      try {
        const resCRM  = await fetch('https://crm.salamandrasolutions.com/api/register', {
          method:'POST', headers:{'Content-Type':'application/json','x-tenant':'retorika'},
          body: JSON.stringify(data),
        });
        const jsonCRM = await resCRM.json().catch(()=>({}));
        if (!resCRM.ok) throw new Error(jsonCRM.message || 'Error al registrar.');

        const resWP  = await fetch('<?php echo esc_url($ep_privado); ?>', {
          method:'POST', headers:{'Content-Type':'application/json'},
          credentials:'same-origin', body: JSON.stringify(data),
        });
        const jsonWP = await resWP.json().catch(()=>({}));

        if (jsonWP.inactive_empresa) {
          handleInactiveEmpresa(jsonWP, data.email_1);
          btn.disabled = false; btn.textContent = 'Crear cuenta'; return;
        }
        if (!resWP.ok || !jsonWP.ok) throw new Error(jsonWP.message || 'Error en WordPress.');

        showOk('rr-ok-p', '✅ Cuenta creada correctamente. Redirigiendo...');
        setTimeout(() => window.location.href = jsonWP.redirect || '/escritorio/', 1500);

      } catch(err) {
        showErr('rr-err-p', err.message || 'Error inesperado. Inténtalo más tarde.');
        btn.disabled = false; btn.textContent = 'Crear cuenta';
      }
    });

    // Submit empresa
    $('#rr-form-e').addEventListener('submit', async e => {
      e.preventDefault();
      hideAlerts('rr-ok-e', 'rr-err-e');
      if (!validateForm(e.target)) { showErr('rr-err-e', 'Corrige los errores antes de continuar.'); return; }

      const form = e.target;
      const btn  = form.querySelector('.rr-submit');
      btn.disabled = true; btn.textContent = 'Enviando...';

      const nonce   = form.querySelector('input[name="re_nonce_e"]')?.value || '';
      const payload = {
        re_nonce:         nonce,
        username:         form.username.value.trim(),
        email:            form.email.value.trim().toLowerCase(),
        password:         form.password.value,
        password_confirm: form.password_confirm.value,
      };

      try {
        const res  = await fetch('<?php echo esc_url($ep_empresa); ?>', {
          method:'POST', headers:{'Content-Type':'application/json'},
          credentials:'same-origin', body: JSON.stringify(payload),
        });
        const data = await res.json().catch(()=>({}));
        if (!res.ok || !data.ok) throw new Error(data.message || 'Error al registrar.');

        showOk('rr-ok-e', '✅ Registro completado. Redirigiendo...');
        setTimeout(() => window.location.href = data.redirect || '/escritorio/', 1500);

      } catch(err) {
        showErr('rr-err-e', err.message || 'Error inesperado. Inténtalo más tarde.');
        btn.disabled = false; btn.textContent = 'Crear cuenta';
      }
    });

  })();
  </script>
  <?php
  return ob_get_clean();
});

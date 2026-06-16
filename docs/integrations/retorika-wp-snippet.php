<?php
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Retorika · CRM Salamandra — Snippet WP de gatekeeper "Registros previos"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este snippet vive en el WordPress de Retorika (asesoriaretorika.com).
 * Antes de que un alumno acceda al curso TutorLMS "Liderazgo Educativo"
 * (course_id=5383), pregunta al CRM si tiene un registro previo. Si no lo
 * tiene, le redirige al formulario público de registro.
 *
 * ─── INSTALACIÓN ───────────────────────────────────────────────────────────
 *
 *  1) Plugin de fragmentos de código en WP (p. ej. "Code Snippets"):
 *     - Crear un snippet PHP nuevo.
 *     - Pegar el contenido BLOQUE 1 de este archivo (sin estas instrucciones).
 *     - Tipo: "Run snippet everywhere" (o equivalente).
 *     - Activar.
 *
 *  2) Añadir el secret HMAC a wp-config.php (NUNCA en el snippet ni en BD):
 *
 *       define('RETORIKA_WEBHOOK_SECRET', 'EL_MISMO_SECRET_QUE_EL_CRM');
 *
 *     El valor exacto lo tiene Jorge — debe coincidir byte a byte con
 *     `process.env.RETORIKA_WEBHOOK_SECRET` del CRM. Si no, el GET /check
 *     devolverá 401 "Firma inválida" y este snippet NO bloqueará nada
 *     (degradación elegante).
 *
 *  3) Crear la página WordPress /registro-liderazgo-educativo/ con el
 *     shortcode del formulario:
 *
 *       [retorika_registro_form]
 *
 *     (El shortcode pinta el form HTML que hace POST a
 *      https://crm.salamandrasolutions.com/api/webhooks/retorika/registro-curso
 *      desde el navegador del alumno. Se entrega aparte.)
 *
 *  4) Verificación end-to-end:
 *     - Crea un usuario WP test sin registro previo en el CRM.
 *     - Logueate como ese usuario.
 *     - Entra en el curso /courses/liderazgo-educativo/.
 *     - Esperado: redirección automática a /registro-liderazgo-educativo/.
 *     - Rellena el form → submit → vuelves a /courses/liderazgo-educativo/
 *       y entras al curso normalmente.
 *     - Recarga la página del curso → NO te redirige (el registro ya existe).
 *
 *  5) Añadir más cursos al map en el futuro:
 *     - Buscar en BLOQUE 1 el array `$map` y añadir línea:
 *
 *         5383 => 'https://asesoriaretorika.com/registro-liderazgo-educativo/',
 *         <nuevo_course_id> => 'https://asesoriaretorika.com/<slug-del-form>/',
 *
 *     - Crear la nueva página /<slug-del-form>/ con su shortcode propio.
 *     - El CRM ya acepta cualquier productWpId si el courseWpId existe en
 *       master.courses — no hace falta tocar el backend.
 *
 * ─── COMPORTAMIENTO EN FALLOS ──────────────────────────────────────────────
 *
 *  Si el CRM no responde (timeout 5s), responde 5xx, o la firma se rechaza,
 *  el snippet NO bloquea al alumno y loguea con error_log(). El alumno
 *  puede acceder al curso aunque no haya rellenado el registro — preferimos
 *  fallar abierto antes que romper acceso a clases pagadas.
 *
 *  Para diagnosticar: tail -f /var/log/php-fpm-errors.log (o equivalente) y
 *  buscar entradas "[retorika]".
 *
 * ───────────────────────────────────────────────────────────────────────────
 */


// ╔═════════════════════════════════════════════════════════════════════════╗
// ║                          BLOQUE 1 — SNIPPET PHP                         ║
// ║         (copia desde aquí hasta el final del archivo al fragmento)      ║
// ╚═════════════════════════════════════════════════════════════════════════╝

add_action('template_redirect', function () {
    // ── 1. Aplica solo en single de TutorLMS courses ──────────────────────
    if (!is_singular('courses')) return;
    if (!is_user_logged_in()) return;
    if (!function_exists('tutor_utils')) return;

    $course_id = get_queried_object_id();
    $user_id   = get_current_user_id();
    $user      = wp_get_current_user();

    // El gatekeeper solo aplica a alumnos matriculados. No reservamos la
    // página: si no está matriculado, TutorLMS ya hará lo suyo.
    if (!tutor_utils()->is_enrolled($course_id, $user_id)) return;

    // Admins, editores e instructores SIEMPRE entran sin gatekeeper.
    // Eso permite a Belén entrar a previsualizar sin rellenar el form.
    if (current_user_can('manage_options'))   return;
    if (current_user_can('tutor_instructor')) return;
    if (current_user_can('editor'))           return;

    // ── 2. Map curso → URL del form de registro ────────────────────────────
    // Para añadir nuevos cursos, copiar la entrada y cambiar course_id + URL.
    $map = array(
        5383 => 'https://asesoriaretorika.com/registro-liderazgo-educativo/',
    );
    if (!isset($map[$course_id])) return; // curso no protegido por este flujo

    // ── 3. wpProductId asociado al curso (TutorLMS↔WooCommerce link) ──────
    $product_id = tutor_utils()->get_course_product_id($course_id);
    if (!$product_id) {
        error_log('[retorika] sin product_id para course_id=' . $course_id);
        return;
    }

    // ── 4. Verificación HMAC del secret ───────────────────────────────────
    $secret = defined('RETORIKA_WEBHOOK_SECRET') ? RETORIKA_WEBHOOK_SECRET : '';
    if (!$secret) {
        error_log('[retorika] RETORIKA_WEBHOOK_SECRET no definido en wp-config.php');
        return; // no bloqueamos: fail-open
    }

    // ── 5. Construir queryString URL-ENCODED y firmar sobre la misma ─────
    // IMPORTANTE: la firma se calcula sobre el query string CON URL-encoding
    // aplicado (urlencode → "@" se convierte en "%40", etc). El endpoint en
    // el CRM reconstruye con url.searchParams.toString() que produce el
    // mismo encoding. Cualquier desviación (firmar sobre el string sin
    // codificar) devolverá 401.
    $email      = strtolower($user->user_email);
    $query      = 'email=' . urlencode($email) . '&productId=' . intval($product_id);
    $signature  = hash_hmac('sha256', $query, $secret);

    $endpoint = 'https://crm.salamandrasolutions.com/api/webhooks/retorika/registro-curso/check?' . $query;

    // ── 6. Llamada al CRM ─────────────────────────────────────────────────
    $response = wp_remote_get($endpoint, array(
        'timeout' => 5,
        'headers' => array(
            'X-Retorika-Signature' => 'sha256=' . $signature,
            'x-tenant'             => 'retorika',
        ),
    ));

    if (is_wp_error($response)) {
        error_log('[retorika] check error: ' . $response->get_error_message());
        return; // fail-open
    }

    $status = wp_remote_retrieve_response_code($response);
    if ($status >= 500) {
        error_log('[retorika] CRM 5xx — fail-open (status=' . $status . ')');
        return; // CRM caído → permitimos acceso
    }
    if ($status === 401) {
        // Configuración rota (secret diferente al del CRM, o WP fuera del
        // allowlist). NO bloqueamos al alumno y lo dejamos pasar; mejor que
        // bloquear acceso a clases que ya pagaron.
        error_log('[retorika] CRM 401 — revisa RETORIKA_WEBHOOK_SECRET y x-tenant');
        return;
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($body) || !isset($body['has'])) {
        error_log('[retorika] CRM respuesta inesperada: ' . substr(wp_remote_retrieve_body($response), 0, 200));
        return; // fail-open
    }

    // ── 7. Si el alumno NO tiene registro previo → al form ───────────────
    if ($body['has'] === false) {
        wp_safe_redirect($map[$course_id]);
        exit;
    }

    // Si has === true, deja pasar (acceso normal al curso).
});

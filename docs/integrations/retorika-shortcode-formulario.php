<?php
/**
 * Shortcode: [retorika_registro_form]
 *
 * Formulario de registro previo al curso "Liderazgo Educativo".
 * Réplica visual del formulario original de Retorika (fondo azul corporativo).
 *
 * Uso:
 *   1. Crea una página en WordPress: /registro-liderazgo-educativo/
 *   2. Coloca dentro: [retorika_registro_form]
 *   3. Asegúrate de tener en wp-config.php:
 *        define('RETORIKA_WEBHOOK_SECRET', 'tu_secret_aqui');
 *
 * El formulario envía un POST a:
 *   https://crm.salamandrasolutions.com/api/webhooks/retorika/registro-curso
 *
 * Tras éxito redirige al curso (course_id=5383 por defecto, configurable).
 */

if (!defined('ABSPATH')) exit;

add_shortcode('retorika_registro_form', function ($atts) {
  $atts = shortcode_atts([
    'course_id'    => '5383',
    'course_url'   => '/curso-liderazgo-educativo/',
    'endpoint'     => 'https://crm.salamandrasolutions.com/api/webhooks/retorika/registro-curso',
    'tenant_slug'  => 'retorika',
  ], $atts);

  $is_logged = is_user_logged_in();
  $user      = wp_get_current_user();

  if (!$is_logged) {
    return '<div class="rrf-error-box">Necesitas iniciar sesión para acceder a este formulario.</div>';
  }

  $user_data = [
    'wpId'   => get_current_user_id(),
    'email'  => $user->user_email,
    'name'   => $user->display_name,
  ];

  $cfg = [
    'endpoint'    => esc_url($atts['endpoint']),
    'tenantSlug'  => sanitize_text_field($atts['tenant_slug']),
    'courseUrl'   => esc_url($atts['course_url']),
    'courseId'    => intval($atts['course_id']),
    'productId'   => function_exists('tutor_utils')
                       ? (int) tutor_utils()->get_course_product_id(intval($atts['course_id']))
                       : 0,
    'user'        => $user_data,
  ];

  ob_start();
  ?>

  <!-- Choices.js -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/choices.js/public/assets/styles/choices.min.css">
  <script src="https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js"></script>

  <style>
    /* ============================================
       PALETA RETORIKA (basada en capturas originales)
       ============================================ */
    .rrf-container {
      background: #234182; /* Azul corporativo de Retorika */
      border-radius: 24px;
      padding: 40px 36px;
      max-width: 900px;
      margin: 24px auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #fff;
      box-sizing: border-box;
    }
    .rrf-container *, .rrf-container *::before, .rrf-container *::after {
      box-sizing: border-box;
    }

    /* ============================================
       HEADER
       ============================================ */
    .rrf-section-heading {
      color: #fff;
      font-size: 42px;
      font-weight: 700;
      margin: 0 0 12px;
      line-height: 1.1;
    }
    .rrf-section-subheading {
      color: #fff;
      font-size: 15px;
      line-height: 1.5;
      margin: 0 0 24px;
      opacity: 0.95;
    }
    .rrf-divider {
      border: 0;
      border-top: 1px solid rgba(255,255,255,0.18);
      margin: 28px 0 20px;
    }

    /* ============================================
       INTRO DIAGNÓSTICO (texto azul/blanco encima del azul oscuro)
       ============================================ */
    .rrf-intro-block { margin-bottom: 28px; }
    .rrf-intro-block p {
      color: #fff;
      font-size: 14px;
      line-height: 1.6;
      margin: 0 0 14px;
    }
    .rrf-intro-block p strong { font-weight: 700; }

    /* ============================================
       LABELS Y CAMPOS
       ============================================ */
    .rrf-field { margin-bottom: 18px; }
    .rrf-field-label {
      display: block;
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 6px;
      line-height: 1.3;
    }
    .rrf-field-label .req { color: #ff5959; margin-left: 2px; }
    .rrf-field-label em {
      font-style: normal;
      font-weight: 400;
      font-size: 12px;
      opacity: 0.85;
    }

    /* INPUT TEXTO / NÚMERO / EMAIL */
    .rrf-input,
    .rrf-textarea {
      width: 100%;
      background: #fff;
      color: #1a1a2e;
      border: 0;
      border-radius: 999px;
      padding: 13px 22px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      box-shadow: 0 1px 0 rgba(0,0,0,0.05);
      transition: box-shadow 0.15s;
    }
    .rrf-textarea {
      border-radius: 18px;
      min-height: 110px;
      padding: 14px 20px;
      resize: vertical;
      line-height: 1.5;
    }
    .rrf-input:focus,
    .rrf-textarea:focus {
      box-shadow: 0 0 0 3px rgba(255,255,255,0.35);
    }
    .rrf-input::placeholder,
    .rrf-textarea::placeholder { color: #8a8aa0; }

    /* SELECT NATIVO (solo el de país, etc - no Choices) */
    .rrf-select {
      width: 100%;
      background: #fff;
      color: #1a1a2e;
      border: 0;
      border-radius: 999px;
      padding: 13px 22px;
      font-size: 14px;
      appearance: none;
      cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23234182' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 18px center;
      padding-right: 50px;
    }

    /* ============================================
       GRID 2 COLUMNAS
       ============================================ */
    .rrf-row { display: grid; grid-template-columns: 1fr; gap: 14px 18px; margin-bottom: 16px; }
    .rrf-row-2 { grid-template-columns: 1fr 1fr; }
    @media (max-width: 720px) {
      .rrf-row-2 { grid-template-columns: 1fr; }
      .rrf-container { padding: 28px 22px; border-radius: 18px; }
      .rrf-section-heading { font-size: 32px; }
    }

    /* ============================================
       RADIO BUTTONS — Estilo Retorika
       Círculos blancos con borde blanco, el seleccionado tiene relleno azul
       ============================================ */
    .rrf-radio-group { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; margin-top: 4px; }
    .rrf-radio-vertical { flex-direction: column; gap: 10px; align-items: flex-start; }
    .rrf-radio-item {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      color: #fff;
      font-size: 14px;
      cursor: pointer;
      user-select: none;
    }
    .rrf-radio-item input[type=radio] {
      appearance: none;
      width: 20px;
      height: 20px;
      border: 2px solid #fff;
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      position: relative;
      flex-shrink: 0;
      transition: background 0.15s;
      margin: 0;
    }
    .rrf-radio-item input[type=radio]:checked {
      background: #fff;
    }
    .rrf-radio-item input[type=radio]:checked::after {
      content: '';
      position: absolute;
      top: 50%; left: 50%;
      width: 8px; height: 8px;
      background: #234182;
      border-radius: 50%;
      transform: translate(-50%, -50%);
    }
    .rrf-radio-item input[type=radio]:focus-visible {
      outline: 2px solid rgba(255,255,255,0.7);
      outline-offset: 2px;
    }

    /* ============================================
       ERRORES Y ESTADOS
       ============================================ */
    .rrf-error {
      color: #ffb3b3;
      font-size: 12px;
      margin-top: 5px;
      display: none;
      font-weight: 500;
    }
    .rrf-field.has-error .rrf-error { display: block; }
    .rrf-field.has-error .rrf-input,
    .rrf-field.has-error .rrf-textarea,
    .rrf-field.has-error .rrf-select,
    .rrf-field.has-error .choices__inner {
      box-shadow: 0 0 0 2px #ff5959;
    }
    .rrf-field.has-error .rrf-radio-group {
      padding: 6px 10px;
      border-radius: 12px;
      background: rgba(255,89,89,0.15);
      box-shadow: 0 0 0 1px rgba(255,89,89,0.5);
    }

    /* ============================================
       OTRO CENTRO (input texto que aparece al elegir "Otro")
       ============================================ */
    .rrf-other-input { margin-top: 10px; display: none; }
    .rrf-other-input.visible { display: block; }

    /* ============================================
   CHOICES.JS — Estilizado completo
   ============================================ */
.rrf-container .choices {
  margin-bottom: 0;
  width: 100%;
  position: relative;
}
.rrf-container .choices__inner {
  background: #fff !important;
  border: 0 !important;
  border-radius: 999px !important;
  padding: 8px 18px !important;
  min-height: 50px !important;
  font-size: 14px !important;
  color: #1a1a2e !important;
}
.rrf-container .choices[data-type*="select-multiple"] .choices__inner {
  border-radius: 22px !important;
  padding: 8px 12px 8px 14px !important;
}

/* Tags multi-select (chips azules dentro del input blanco) */
.rrf-container .choices__list--multiple .choices__item {
  background: #234182 !important;
  border: 0 !important;
  border-radius: 999px !important;
  padding: 5px 28px 5px 12px !important;
  font-size: 13px !important;
  margin: 3px 4px 3px 0 !important;
  color: #fff !important;
  position: relative;
}
.rrf-container .choices__list--multiple .choices__item.is-highlighted {
  background: #1a3268 !important;
}
.rrf-container .choices__button {
  border-left: 1px solid rgba(255,255,255,0.3) !important;
  margin: 0 !important;
  padding-left: 8px !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='3' stroke-linecap='round'%3E%3Cline x1='18' y1='6' x2='6' y2='18'/%3E%3Cline x1='6' y1='6' x2='18' y2='18'/%3E%3C/svg%3E") !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 8px !important;
  opacity: 0.9 !important;
}
.rrf-container .choices__button:hover { opacity: 1 !important; }

/* Input de búsqueda dentro del select */
.rrf-container .choices__input {
  background: transparent !important;
  color: #1a1a2e !important;
  font-size: 14px !important;
  margin: 0 !important;
  padding: 4px 0 !important;
}
.rrf-container .choices__input::placeholder { color: #8a8aa0 !important; }

/* DROPDOWN — la lista que se abre debajo */
.rrf-container .choices__list--dropdown,
.rrf-container .choices__list[aria-expanded] {
  background: #fff !important;
  border: 0 !important;
  border-radius: 18px !important;
  margin-top: 4px !important;
  overflow: hidden !important;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25) !important;
  width: 100% !important;
  z-index: 100;
}
.rrf-container .choices__list--dropdown .choices__list,
.rrf-container .choices__list[aria-expanded] .choices__list {
  max-height: 280px !important;
}

/* Items dentro del dropdown — TEXTO OSCURO sobre fondo blanco */
.rrf-container .choices__list--dropdown .choices__item,
.rrf-container .choices__list[aria-expanded] .choices__item {
  background: #fff !important;
  color: #1a1a2e !important;
  padding: 11px 18px !important;
  font-size: 14px !important;
}
.rrf-container .choices__list--dropdown .choices__item--selectable,
.rrf-container .choices__list[aria-expanded] .choices__item--selectable {
  color: #1a1a2e !important;
}
.rrf-container .choices__list--dropdown .choices__item--selectable.is-highlighted,
.rrf-container .choices__list[aria-expanded] .choices__item--selectable.is-highlighted {
  background: #f0f3fa !important;
  color: #234182 !important;
}
.rrf-container .choices__list--dropdown .choices__item--disabled,
.rrf-container .choices__list[aria-expanded] .choices__item--disabled {
  color: #999 !important;
  background: #f7f7f7 !important;
}

/* Search dentro del dropdown */
.rrf-container .choices__list--dropdown .choices__input {
  background: #f7f7f7 !important;
  color: #1a1a2e !important;
  padding: 10px 14px !important;
  margin: 8px 12px !important;
  border-radius: 10px !important;
  font-size: 13px !important;
}

/* Placeholder cuando no hay selección */
.rrf-container .choices__placeholder {
  color: #8a8aa0 !important;
  opacity: 1 !important;
}

/* Flecha del dropdown (chevron) */
.rrf-container .choices[data-type*="select-one"]::after {
  border-color: #234182 transparent transparent transparent !important;
  border-width: 6px 6px 0 6px !important;
  right: 18px !important;
  top: 50% !important;
  margin-top: -3px !important;
}
.rrf-container .choices[data-type*="select-one"].is-open::after {
  border-color: transparent transparent #234182 transparent !important;
  margin-top: -3px !important;
}

/* "No hay resultados" */
.rrf-container .choices__list--dropdown .choices__item--no-results {
  color: #999 !important;
  font-style: italic;
  padding: 14px 18px !important;
}

/* "No quedan opciones" */
.rrf-container .choices__list--dropdown .choices__item--no-choices {
  color: #999 !important;
  font-style: italic;
  padding: 14px 18px !important;
}

    /* ============================================
       BOTÓN ENVIAR — Estilo del original (blanco con texto azul)
       ============================================ */
    .rrf-submit-row {
      margin-top: 32px;
      display: flex;
      align-items: center;
      gap: 18px;
      flex-wrap: wrap;
    }
    .rrf-btn {
      background: #fff;
      color: #234182;
      border: 0;
      padding: 13px 38px;
      font-size: 15px;
      font-weight: 700;
      border-radius: 999px;
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.15s, opacity 0.15s;
      font-family: inherit;
      letter-spacing: 0.2px;
    }
    .rrf-btn:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.2); transform: translateY(-1px); }
    .rrf-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
    .rrf-status {
      font-size: 14px;
      flex: 1;
      min-width: 200px;
      color: #fff;
    }
    .rrf-status.error { color: #ffb3b3; }
    .rrf-status.success { color: #b3ffc4; }

    /* ============================================
       MENSAJE NO LOGUEADO
       ============================================ */
    .rrf-error-box {
      background: #ffe9e9;
      border: 1px solid #ff5959;
      color: #8a1a1a;
      padding: 18px 24px;
      border-radius: 14px;
      max-width: 600px;
      margin: 24px auto;
      font-size: 15px;
      text-align: center;
    }
  </style>

  <div class="rrf-container">
    <h2 class="rrf-section-heading">Registro inicial del curso</h2>
    <p class="rrf-section-subheading">Completa este breve formulario antes de empezar el curso. Solo te llevará unos minutos.</p>

    <form id="rrf-form" novalidate>

      <!-- ============================================== -->
      <!-- SECCIÓN 1: Datos del centro                    -->
      <!-- ============================================== -->

      <div class="rrf-row rrf-row-2">
        <div class="rrf-field">
          <label class="rrf-field-label" for="rrf-centerType">Tipo de centro educativo <span class="req">*</span></label>
          <select id="rrf-centerType" name="centerType" required class="rrf-select-choices">
            <option value="">Selecciona…</option>
            <option value="privado">Colegio privado</option>
            <option value="concertado">Colegio concertado</option>
            <option value="publico">Colegio público</option>
            <option value="instituto">Instituto</option>
            <option value="universidad">Universidad</option>
            <option value="ninguno">Actualmente en ninguno</option>
          </select>
          <div class="rrf-error">Selecciona un tipo</div>
        </div>

        <div class="rrf-field">
          <label class="rrf-field-label" for="rrf-centerName">Nombre del centro <span class="req">*</span></label>
          <select id="rrf-centerName" name="centerName" required>
            <option value="">Busca o selecciona…</option>
            <option value="__otro__">— Otro (no aparece en la lista) —</option>
          </select>
          <div class="rrf-error">Selecciona un centro</div>
          <div class="rrf-other-input" id="rrf-otherName-wrap">
            <input type="text" id="rrf-otherName" name="otherName" class="rrf-input" placeholder="Escribe el nombre del centro" />
          </div>
        </div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-street">Dirección <span class="req">*</span></label>
        <input type="text" id="rrf-street" name="street" required maxlength="200" class="rrf-input" />
        <div class="rrf-error">Introduce la dirección</div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-apartment">Apartamento, habitación, escalera, etc.</label>
        <input type="text" id="rrf-apartment" name="apartment" maxlength="100" class="rrf-input" />
      </div>

      <div class="rrf-row rrf-row-2">
        <div class="rrf-field">
          <label class="rrf-field-label" for="rrf-city">Ciudad <span class="req">*</span></label>
          <input type="text" id="rrf-city" name="city" required maxlength="100" class="rrf-input" />
          <div class="rrf-error">Introduce la ciudad</div>
        </div>
        <div class="rrf-field">
          <label class="rrf-field-label" for="rrf-state">Estado/Provincia <span class="req">*</span></label>
          <input type="text" id="rrf-state" name="state" required maxlength="100" class="rrf-input" />
          <div class="rrf-error">Introduce la provincia</div>
        </div>
      </div>

      <div class="rrf-row rrf-row-2">
        <div class="rrf-field">
          <label class="rrf-field-label" for="rrf-postalCode">Código postal <span class="req">*</span></label>
          <input type="text" id="rrf-postalCode" name="postalCode" required maxlength="20" class="rrf-input" />
          <div class="rrf-error">Introduce el código postal</div>
        </div>
        <div class="rrf-field">
          <label class="rrf-field-label" for="rrf-country">País <span class="req">*</span></label>
          <select id="rrf-country" name="country" required class="rrf-select">
            <option value="">Seleccionar país</option>
            <option value="ES" selected>España</option>
            <option value="PT">Portugal</option>
            <option value="FR">Francia</option>
            <option value="IT">Italia</option>
            <option value="DE">Alemania</option>
            <option value="GB">Reino Unido</option>
            <option value="MX">México</option>
            <option value="AR">Argentina</option>
            <option value="CO">Colombia</option>
            <option value="CL">Chile</option>
            <option value="OTHER">Otro</option>
          </select>
          <div class="rrf-error">Selecciona país</div>
        </div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-nif">NIF/CIF <span class="req">*</span></label>
        <input type="text" id="rrf-nif" name="nif" required maxlength="20" class="rrf-input" />
        <div class="rrf-error">Introduce un NIF/CIF válido</div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-yearsExp">Años de experiencia <span class="req">*</span></label>
        <input type="number" id="rrf-yearsExp" name="yearsExp" min="0" max="60" required class="rrf-input" />
        <div class="rrf-error">Introduce los años de experiencia</div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-positions">Cargo <span class="req">*</span> <em>(selección múltiple)</em></label>
        <select id="rrf-positions" name="positions" multiple required>
          <option value="docente_infantil_primaria">Docente Infantil / Primaria</option>
          <option value="docente_eso_bachillerato">Docente ESO / Bachillerato</option>
          <option value="secretaria">Secretaría</option>
          <option value="jefatura_estudios">Jefatura de Estudios</option>
          <option value="direccion">Dirección</option>
        </select>
        <div class="rrf-error">Selecciona al menos un cargo</div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-coursesTeaching">Cursos en los que enseña <span class="req">*</span> <em>(selección múltiple)</em></label>
        <select id="rrf-coursesTeaching" name="coursesTeaching" multiple required>
          <option value="infantil">Infantil</option>
          <option value="primaria_1_3">1º - 3º de Primaria</option>
          <option value="primaria_4_6">4º - 6º de Primaria</option>
          <option value="eso_1_2">1º - 2º de ESO</option>
          <option value="eso_3_4">3º - 4º de ESO</option>
          <option value="bachillerato_1_2">1º - 2º de Bachillerato</option>
        </select>
        <div class="rrf-error">Selecciona al menos un curso</div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-subjects">Asignaturas que imparte <span class="req">*</span> <em>(selección múltiple)</em></label>
        <select id="rrf-subjects" name="subjects" multiple required>
          <option value="biologia_geologia">Biología y/o Geología</option>
          <option value="ciencias_naturales">Ciencias Naturales</option>
          <option value="dibujo_artes_plasticas">Dibujo y/o Artes Plásticas</option>
          <option value="economia">Economía</option>
          <option value="educacion_fisica">Educación Física</option>
          <option value="filosofia_etica">Filosofía y/o Ética</option>
          <option value="fisica_quimica">Física y/o Química</option>
          <option value="historia">Historia</option>
          <option value="idiomas">Idiomas</option>
          <option value="informatica">Informática</option>
          <option value="latin_griego">Latín y/o Griego</option>
          <option value="lengua_castellana_literatura">Lengua Castellana y Literatura</option>
          <option value="matematicas">Matemáticas</option>
          <option value="musica">Música</option>
          <option value="religion">Religión</option>
          <option value="tecnologia">Tecnología</option>
        </select>
        <div class="rrf-error">Selecciona al menos una asignatura</div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-topics">Temática de interés en formación <span class="req">*</span> <em>(selección múltiple)</em></label>
        <select id="rrf-topics" name="topics" multiple required>
          <option value="oratoria_retorica">Oratoria y retórica</option>
          <option value="liderazgo">Liderazgo</option>
          <option value="gestion_equipos">Gestión de equipos</option>
          <option value="resolucion_conflictos">Resolución de Conflictos</option>
          <option value="innovacion_pedagogica">Innovación Pedagógica</option>
        </select>
        <div class="rrf-error">Selecciona al menos una temática</div>
      </div>

      <!-- ============================================== -->
      <!-- SECCIÓN 2: Diagnóstico docente                 -->
      <!-- ============================================== -->
      <hr class="rrf-divider" />
      <h2 class="rrf-section-heading" style="font-size:36px;">Diagnóstico Docente</h2>

      <div class="rrf-intro-block">
        <p>Sabemos que tienes ganas de comenzar con los vídeos y la teoría, pero este primer paso es imprescindible para sacar el máximo provecho del curso. Se trata de una breve reflexión inicial que te ayudará a:</p>
        <p>Identificar tus retos como docente antes de adentrarte en los contenidos. Tomar conciencia de tus fortalezas y necesidades, de manera que el curso no sea solo teoría, sino una experiencia conectada con tu realidad. Comparar tu evolución: al final del curso volverás a hacer un segundo diagnóstico y podrás ver con claridad lo que has mejorado.</p>
        <p><strong>Tus respuestas serán tratadas de forma totalmente anónima y gestionadas por Retorika únicamente con fines formativos, estadísticos y de investigación educativa, siempre de manera agregada y sin datos personales identificativos.</strong></p>
      </div>

      <div class="rrf-row rrf-row-2">
        <div class="rrf-field">
          <label class="rrf-field-label">¿Cómo describirías tu nivel actual de motivación en la docencia? <span class="req">*</span></label>
          <div class="rrf-radio-group" data-name="motivationCurrent">
            <label class="rrf-radio-item"><input type="radio" name="motivationCurrent" value="1" required /> 1</label>
            <label class="rrf-radio-item"><input type="radio" name="motivationCurrent" value="2" /> 2</label>
            <label class="rrf-radio-item"><input type="radio" name="motivationCurrent" value="3" /> 3</label>
            <label class="rrf-radio-item"><input type="radio" name="motivationCurrent" value="4" /> 4</label>
            <label class="rrf-radio-item"><input type="radio" name="motivationCurrent" value="5" /> 5</label>
          </div>
          <div class="rrf-error">Selecciona una opción</div>
        </div>

        <div class="rrf-field">
          <label class="rrf-field-label">En comparación con tus primeros años de docencia, tu motivación actual es… <span class="req">*</span></label>
          <div class="rrf-radio-group" data-name="motivationVsStart">
            <label class="rrf-radio-item"><input type="radio" name="motivationVsStart" value="1" required /> 1</label>
            <label class="rrf-radio-item"><input type="radio" name="motivationVsStart" value="2" /> 2</label>
            <label class="rrf-radio-item"><input type="radio" name="motivationVsStart" value="3" /> 3</label>
            <label class="rrf-radio-item"><input type="radio" name="motivationVsStart" value="4" /> 4</label>
            <label class="rrf-radio-item"><input type="radio" name="motivationVsStart" value="5" /> 5</label>
          </div>
          <div class="rrf-error">Selecciona una opción</div>
        </div>
      </div>

      <div class="rrf-row rrf-row-2">
        <div class="rrf-field">
          <label class="rrf-field-label">¿Cómo describirías el ambiente de tu centro educativo? <span class="req">*</span></label>
          <div class="rrf-radio-group" data-name="centerEnvironment">
            <label class="rrf-radio-item"><input type="radio" name="centerEnvironment" value="1" required /> 1</label>
            <label class="rrf-radio-item"><input type="radio" name="centerEnvironment" value="2" /> 2</label>
            <label class="rrf-radio-item"><input type="radio" name="centerEnvironment" value="3" /> 3</label>
            <label class="rrf-radio-item"><input type="radio" name="centerEnvironment" value="4" /> 4</label>
            <label class="rrf-radio-item"><input type="radio" name="centerEnvironment" value="5" /> 5</label>
          </div>
          <div class="rrf-error">Selecciona una opción</div>
        </div>

        <div class="rrf-field">
          <label class="rrf-field-label">¿Cómo valoras tu nivel de estrés laboral? <span class="req">*</span></label>
          <div class="rrf-radio-group" data-name="stressLevel">
            <label class="rrf-radio-item"><input type="radio" name="stressLevel" value="1" required /> 1</label>
            <label class="rrf-radio-item"><input type="radio" name="stressLevel" value="2" /> 2</label>
            <label class="rrf-radio-item"><input type="radio" name="stressLevel" value="3" /> 3</label>
            <label class="rrf-radio-item"><input type="radio" name="stressLevel" value="4" /> 4</label>
            <label class="rrf-radio-item"><input type="radio" name="stressLevel" value="5" /> 5</label>
          </div>
          <div class="rrf-error">Selecciona una opción</div>
        </div>
      </div>

      <div class="rrf-row rrf-row-2">
        <div class="rrf-field">
          <label class="rrf-field-label">¿Consideras que cuentas con los recursos necesarios (tecnología, materiales, apoyo) para dar clase con calidad? <span class="req">*</span></label>
          <div class="rrf-radio-group" data-name="hasResources">
            <label class="rrf-radio-item"><input type="radio" name="hasResources" value="1" required /> 1</label>
            <label class="rrf-radio-item"><input type="radio" name="hasResources" value="2" /> 2</label>
            <label class="rrf-radio-item"><input type="radio" name="hasResources" value="3" /> 3</label>
            <label class="rrf-radio-item"><input type="radio" name="hasResources" value="4" /> 4</label>
            <label class="rrf-radio-item"><input type="radio" name="hasResources" value="5" /> 5</label>
          </div>
          <div class="rrf-error">Selecciona una opción</div>
        </div>

        <div class="rrf-field">
          <label class="rrf-field-label">En tu opinión, el reconocimiento social hacia los docentes es… <span class="req">*</span></label>
          <div class="rrf-radio-group" data-name="socialRecognition">
            <label class="rrf-radio-item"><input type="radio" name="socialRecognition" value="1" required /> 1</label>
            <label class="rrf-radio-item"><input type="radio" name="socialRecognition" value="2" /> 2</label>
            <label class="rrf-radio-item"><input type="radio" name="socialRecognition" value="3" /> 3</label>
            <label class="rrf-radio-item"><input type="radio" name="socialRecognition" value="4" /> 4</label>
            <label class="rrf-radio-item"><input type="radio" name="socialRecognition" value="5" /> 5</label>
          </div>
          <div class="rrf-error">Selecciona una opción</div>
        </div>
      </div>

      <div class="rrf-row rrf-row-2">
        <div class="rrf-field">
          <label class="rrf-field-label">¿Con qué frecuencia sientes que tu carga laboral es excesiva? <span class="req">*</span></label>
          <div class="rrf-radio-group" data-name="workloadFrequency">
            <label class="rrf-radio-item"><input type="radio" name="workloadFrequency" value="muy_poca" required /> Muy poca</label>
            <label class="rrf-radio-item"><input type="radio" name="workloadFrequency" value="poca" /> Poca</label>
            <label class="rrf-radio-item"><input type="radio" name="workloadFrequency" value="algunas_veces" /> Algunas veces</label>
            <label class="rrf-radio-item"><input type="radio" name="workloadFrequency" value="mucha" /> Mucha</label>
            <label class="rrf-radio-item"><input type="radio" name="workloadFrequency" value="muchisima" /> Muchísima</label>
          </div>
          <div class="rrf-error">Selecciona una opción</div>
        </div>

        <div class="rrf-field">
          <label class="rrf-field-label">¿Cuántas horas semanales dedicas fuera del aula a preparar clases, corregir o planificar? <span class="req">*</span></label>
          <div class="rrf-radio-group" data-name="weeklyExtraHours">
            <label class="rrf-radio-item"><input type="radio" name="weeklyExtraHours" value="menos_5" required /> Menos de 5</label>
            <label class="rrf-radio-item"><input type="radio" name="weeklyExtraHours" value="5_10" /> 5-10</label>
            <label class="rrf-radio-item"><input type="radio" name="weeklyExtraHours" value="11_15" /> 11-15</label>
            <label class="rrf-radio-item"><input type="radio" name="weeklyExtraHours" value="mas_15" /> Más de 15</label>
          </div>
          <div class="rrf-error">Selecciona una opción</div>
        </div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-difficulties">¿Cuáles son actualmente tus principales dificultades en el aula y por qué? <span class="req">*</span></label>
        <textarea id="rrf-difficulties" name="difficulties" required minlength="20" maxlength="2000" class="rrf-textarea"></textarea>
        <div class="rrf-error">Mínimo 20 caracteres</div>
      </div>

      <div class="rrf-field">
        <label class="rrf-field-label" for="rrf-goals">¿Qué te gustaría conseguir con este curso? <span class="req">*</span></label>
        <textarea id="rrf-goals" name="goals" required minlength="20" maxlength="2000" class="rrf-textarea"></textarea>
        <div class="rrf-error">Mínimo 20 caracteres</div>
      </div>

      <div class="rrf-submit-row">
        <button type="submit" class="rrf-btn" id="rrf-submit-btn">Enviar</button>
        <div class="rrf-status" id="rrf-status"></div>
      </div>
    </form>
  </div>

  <script>
  (function () {
    const CFG  = <?php echo wp_json_encode($cfg); ?>;
    const FORM = document.getElementById('rrf-form');
    const BTN  = document.getElementById('rrf-submit-btn');
    const ST   = document.getElementById('rrf-status');

    // Lista de colegios
    const SCHOOLS = [
      "AGORA","AGRUPACION ESCOLAR EUROPA","AGUSTINIANO","ALBA","ALBANTA","ALHUCEMA","ALKOR","ALTAMIRA","AMOR DE DIOS",
      "AMOR MISERICORDIOSO","AMOROS","ANTANES SCHOOL","ANTAVILLA SCHOOL","APOSTOL SANTIAGO","ARCADIA",
      "ASUNCION CUESTABLANCA","ASUNCION-VALLECAS","AZORIN","BALMES","BEATA FILIPINA-FUND.FELICIANA VIERTOLA",
      "BEATA MARIA ANA DE JESUS","BERNADETTE","BIENAVENTURADA VIRGEN MARIA","BLANCA DE CASTILLA",
      "CALASANCIO NUESTRA SEÑORA DE LAS ESCUELAS PIAS","CALASANZ","CARDENAL SPINOLA","CASA DE LA VIRGEN","CASTILLA",
      "CASVI-BOADILLA","CENTRO CULTURAL ELFO","CENTRO CULTURAL PALOMERAS","CENTRO CULTURAL SALMANTINO",
      "CENTRO EDUCATIVO LA AMISTAD","CENTRO EDUCATIVO PONCE DE LEON","CENTRO EDUCATIVO PUNTA GALEA",
      "CENTRO EDUCATIVO VILLA DE ALCORCON","CENTRO EDUCATIVO ZOLA","CENTRO IBN GABIROL COLEGIO ESTRELLA TOLEDANO",
      "CHAMBERI","CIUDAD DE LOS MUCHACHOS","CIUDAD EDUCATIVA MUNICIPAL HIPATIA-FUHEM","CIUDADESCUELA MUCHACHOS",
      "CLARET","COLEGIO ABACO","COLEGIO ADDIS","COLEGIO ALBORADA","COLEGIO ALCALA","COLEGIO ANA PELLEGRINI",
      "COLEGIO ANTAMIRA","COLEGIO AQUILA","COLEGIO ARENALES ARROYOMOLINOS","COLEGIO ARENALES CARABANCHEL",
      "COLEGIO ARTICA","COLEGIO ARULA","COLEGIO CAUDE","COLEGIO CEU SAN PABLO EN SANCHINARRO","COLEGIO CHESTERTON",
      "COLEGIO DE JESÚS","COLEGIO DIOCESANO MARIA INMACULADA - JOAQUIN TURINA",
      "COLEGIO DIOCESANO MARIA INMACULADA - MOGAMBO","COLEGIO EL CATÓN","COLEGIO ESCUELAS SANTISIMO SACRAMENTO",
      "COLEGIO ESTUDIANTES LAS TABLAS","COLEGIO GAUDEM","COLEGIO HELADE",
      "COLEGIO INSTITUCION DEL DIVINO MAESTRO","COLEGIO INTERNACIONAL J.H. NEWMAN","COLEGIO INTERNACIONAL KOLBE",
      "COLEGIO INTERNACIONAL NICOLI","COLEGIO JARA","COLEGIO JUAN PABLO II",
      "COLEGIO JUAN PABLO II Y LA INMACULADA","COLEGIO LA DEHESA DE HUMANES","COLEGIO LA MILAGROSA",
      "COLEGIO LA SALLE SAN RAFAEL","COLEGIO LITTERATOR","COLEGIO MIRAMADRID","COLEGIO MONTESCLAROS",
      "COLEGIO NOBELIS","COLEGIO NOVA HISPALIS","COLEGIO NUESTRA SEÑORA DE LORETO FESD","COLEGIO NUEVO EQUIPO",
      "COLEGIO PASTEUR ARROYOMOLINOS","COLEGIO PEÑALAR","COLEGIO PEÑALVENTO","COLEGIO QUERCUS","COLEGIO SAN JAIME",
      "COLEGIO SAN PEDRO APOSTOL","COLEGIO SANTA MONICA","COLEGIO SEI CONCEPCIÓN","COLEGIO SEI LA MERCED",
      "COLEGIO SEI RIHONDO","COLEGIO SEI SAN JOSÉ","COLEGIO SEI SOLEDAD","COLEGIO SENARA",
      "COLEGIO STELLA MARIS LA GAVIA","COLEGIO TORREVILANO","COLEGIO VALDEFUENTES","COLEGIO VALLE DEL MIRO",
      "COLEGIO VALLMONT","COLEGIO VEGASUR","COLEGIO VILLAEUROPA","COLEGIO VILLAMADRID",
      "COLEGIO VIRGEN DE MIRASIERRA","COMUNIDAD INFANTIL DE VILLAVERDE","CORAZON DE MARIA","CORAZON INMACULADO",
      "CRISTO REY","DECROLY","DIVINA PASTORA","DIVINO CORAZON","DIVINO MAESTRO","EDITH STEIN","EDUCREA EL VISO",
      "EDUCREA EL MIRADOR","EL AVE MARIA","EL CARMELO TERESIANO","EL CID","EL PILAR","EL PORVENIR","EL SALVADOR",
      "EL VALLE","EL VALLE II","EL VALLE III","ENRIQUETA AYMER","ESCUELAS PIAS","ESCUELAS PIAS DE SAN FERNANDO",
      "ESPIRITU SANTO","FEC SANTA JOAQUINA DE VEDRUNA","FRAY LUIS DE LEON","FUENLABRADA","FUENLLANA",
      "FUENTELARREYNA","FUNDACION CALDEIRO","FUNDACION COLEGIO BERRIZ","FUNDACION SANTAMARCA","GAMO DIANA",
      "GREENWICH SCHOOL","GSD ALCALA","GSD EL ESCORIAL","GSD GUADARRAMA","GSD LAS ARTES","GSD LAS ROZAS",
      "GSD LAS SUERTES","GSD MORATALAZ","GSD VALDEBEBAS","GSD VALLECAS","HELICON","HOGAR DEL BUEN CONSEJO",
      "HUMANITAS BILINGUAL SCHOOL EL CAÑAVERAL","HUMANITAS BILINGUAL SCHOOL TORREJON",
      "HUMANITAS BILINGUAL SCHOOL TRES CANTOS","INMACULADA CONCEPCION","INSTITUTO VERITAS",
      "INTERNACIONAL EUROVILLAS","J.A.B.Y.","JESUS MAESTRO","JESUS MARIA","JESUS NAZARENO","JUAN DE VALDES",
      "LA INMACULADA","LA INMACULADA CONCEPCION","LA INMACULADA-MARILLAC","LA INMACULADA-PADRES ESCOLAPIOS",
      "LA NATIVIDAD","LA PRESENTACIÓN FESD","LA PURISIMA","LA SALLE","LA SALLE-SAGRADO CORAZON","LAGOMAR",
      "LAS ROSAS","LAS TABLAS VALVERDE","LEONARDO DA VINCI","LICEO CONSUL","LICEO IBERICO","LICEO MADARIAGA",
      "LICEO SAN PABLO","LICEO SOROLLA B","LICEO VERSALLES","LOPE DE VEGA","LOPEZ VICUÑA","LOS ABETOS",
      "LOS ANGELES","LOS NARANJOS","LOS NOGALES","LOS OLMOS","LOS ROBLES","LOS TILOS","LOURDES","LOYOLA",
      "LUZ CASANOVA","LUZ CASANOVA EMBAJADORES","MADRE DE DIOS","MADRES CONCEPCIONISTAS",
      "MADRES MERCEDARIAS DE D. JUAN DE ALARCON","MADRIGAL","MALVAR","MANUEL BARTOLOME COSSIO","MARIA AUXILIADORA",
      "MARIA INMACULADA","MARIA REINA","MARIA TERESA","MARIA VIRGEN","MATAESPESA SCHOOL","MATER AMABILIS",
      "MATER IMMACULATA","MATER PURISSIMA","MENESIANO","MIRASIERRA","MIRASOL","MONCAYO","MONTE TABOR",
      "MONTPELLIER","MONTSERRAT","NATIVIDAD DE NUESTRA SEÑORA","NAZARET","NAZARET-OPORTO","NERVION","N.I.L.E.",
      "NORFOLK","NUESTRA SEÑORA DE FATIMA","NUESTRA SEÑORA DE LA CONSOLACIÓN","NUESTRA SEÑORA DE LA ESTRELLA",
      "NUESTRA SEÑORA DE LA MERCED","NUESTRA SEÑORA DE LA PROVIDENCIA","NUESTRA SEÑORA DE LA VEGA",
      "NUESTRA SEÑORA DE LAS DELICIAS","NUESTRA SEÑORA DE LAS ESCUELAS PIAS","NUESTRA SEÑORA DE LAS NIEVES",
      "NUESTRA SEÑORA DE LAS VICTORIAS","NUESTRA SEÑORA DE LOS ANGELES","NUESTRA SEÑORA DE LOS DOLORES",
      "NUESTRA SEÑORA DE LOS REMEDIOS","NUESTRA SEÑORA DE MORATALAZ","NUESTRA SEÑORA DEL BUEN CONSEJO",
      "NUESTRA SEÑORA DEL CARMEN","NUESTRA SEÑORA DEL PILAR","NUESTRA SEÑORA DEL RECUERDO",
      "NUESTRA SEÑORA DEL SAGRADO CORAZON","NUEVA CASTILLA","OBISPO PERELLO",
      "OBRA SO.N.S.MONTSERRAT-S.SIMON Y S.JUDAS","PADRE MANYANET","PARAISO SAGRADOS CORAZONES","PARQUE",
      "PATROCINIO DE MARIA","PATROCINIO DE SAN JOSE","PUREZA DE MARIA","RAFAELA YBARRA","RAIMUNDO LULIO",
      "REAL COLEGIO ALFONSO XII","REAL COLEGIO NUESTRA SEÑORA DE LORETO","REAL COLEGIO SANTA ISABEL-LA ASUNCION",
      "REINADO DEL CORAZON DE JESUS","RETIRO","SAGRADA FAMILIA","SAGRADA FAMILIA DE URGEL","SAGRADO CORAZON",
      "SAGRADO CORAZON DE JESUS","SAGRADO CORAZON REPARADORAS","SAGRADOS CORAZONES","SALESIANOS ATOCHA",
      "SALESIANOS CARABANCHEL BEATO MIGUEL RÚA","SALESIANOS ESTRECHO SAN JUAN BAUTISTA",
      "SALESIANOS PASEO DE EXTREMADURA","SAMER CALASANZ","SAN AGUSTIN","SAN ALBERTO MAGNO","SAN ALFONSO",
      "SAN BERNARDO","SAN BUENAVENTURA","SAN EULOGIO","SAN FELIPE NERI","SAN FRANCISCO DE ASIS","SAN GABRIEL",
      "SAN IGNACIO DE LOYOLA","SAN JAIME APOSTOL","SAN JAVIER","SAN JOSE","SAN JOSE DE CLUNY","SAN JOSE-LUCERO",
      "SAN JUAN BOSCO","SAN JUAN EVANGELISTA","SAN LUIS GONZAGA","SAN MARTIN","SAN PEDRO",
      "SAN RAMON Y SAN ANTONIO","SAN SATURIO","SAN VIATOR","SAN VICENTE","SANTA ANA Y SAN RAFAEL",
      "SANTA BEATRIZ DE SILVA","SANTA CATALINA DE SENA","SANTA ELENA","SANTA FRANCISCA JAVIER CABRINI",
      "SANTA GEMA GALGANI","SANTA ISABEL","SANTA MARIA","SANTA MARIA DE LA HISPANIDAD",
      "SANTA MARIA DE LA PROVIDENCIA","SANTA MARIA DE LAS ROZAS","SANTA MARIA DE LOS PINOS",
      "SANTA MARIA DEL BOSQUE","SANTA MARIA DEL CARMEN","SANTA MARIA DEL PILAR","SANTA MARIA DEL YERMO",
      "SANTA MARIA LA BLANCA","SANTA MARIA MICAELA","SANTA RAFAELA MARIA","SANTA RITA","SANTA SUSANA",
      "SANTA TERESA","SANTISIMA TRINIDAD","SANTISIMO SACRAMENTO","SANTO ANGEL DE LA GUARDA","SANTO DOMINGO",
      "SANTO DOMINGO DE SILOS","SIGLO XXI","STELLA MARIS","TAJAMAR","TIMON","TORRENTE BALLESTER","TRABENCO",
      "TRES OLIVOS","TRINITY COLLEGE SAN SEBASTIAN DE LOS REYES","VALDELUZ","VEDRUNA","VILLA DE MOSTOLES",
      "VILLA DE NAVALCARNERO","VILLALKOR","VIRGEN DE ATOCHA","VIRGEN DE LA ALMUDENA","VIRGEN DE LA VEGA",
      "VIRGEN DEL HENAR","VIRGEN DEL REMEDIO","WISDOM SCHOOL MADRID","ZAZUAR","ZOLA-ROZAS","ZURBARAN",
      "AGORA INTERNATIONAL SCHOOL MADRID","ALAMEDA DE OSUNA","ALARCON","ALDEAFUENTE",
      "ALTAIR, COLEGIO INTERNACIONAL","AMANECER","ARCANGEL RAFAEL","ARETEIA","ARTURO SORIA",
      "B.R.A.-INSTITUCION","BRA-INSTITUCION","BRISTOL","CENTRO ESCOLAR BALDER","COLEGIO ALEGRA",
      "COLEGIO DE NUESTRA SEÑORA","COLEGIO EUROPEO ARISTOS","COLEGIO HIGHLANDS EL ENCINAR",
      "COLEGIO HIGHLANDS LOS FRESNOS","COLEGIO INGENIO","COLEGIO INTERNACIONAL SANTO TOMAS DE AQUINO",
      "COLEGIO INTERNACIONAL SEK-CIUDALCAMPO","COLEGIO INTERNACIONAL SEK-EL CASTILLO",
      "COLEGIO MADRID-FUNDACIÓN SANTA MARÍA","COLEGIO MADRID-FUNDACIÓN SANTA MARÍA II",
      "COLEGIO NUESTRA SEÑORA DE SCHOENSTATT","COLEGIO PRIVADO ENGAGE","COLEGIO REGGIO","COLEGIO SAN PATRICIO",
      "COLEGIO SANTA MARIA DEL CAMINO","ESCUELA IDEO","ESCUELA LIBRE MICAEL","ESTUDIO","EVEREST",
      "FONTENEBRO INTERNATIONAL SCHOOL","GONDOMAR","GREENFIELD","HUERFANOS DE LA ARMADA",
      "INTERNACIONAL ARAVACA","JOYFE","KHALIL GIBRAN","LEGAMAR","LICEO SOROLLA INTERNATIONAL SCHOOL",
      "LICEO VILLA FONTANA","LOS PEÑASCALES","LOS SAUCES","LUYFERIVAS","MARQUES DE VALLEJO","MATER SALVATORIS",
      "MIRASUR","MONTEALTO","NUESTRA SEÑORA DE LAS MARAVILLAS","NUESTRA SEÑORA DE LA LUZ",
      "PAIDEIA INTERNATIONAL SCHOOL","PAIDEIA INTERNATIONAL SCHOOL-PAS","RECREO-2","SABERES",
      "SAGRADO CORAZON DE JESUS MARIA","SAN AGUSTIN-DEHESA VIEJA","SAN ALBERTO MAGNO-POZUELO","SAN GREGORIO",
      "SAN IGNACIO DE LOYOLA-DEHESA VIEJA","SAN IGNACIO DE LOYOLA-POZUELO","SAN LUIS DE LOS FRANCESES",
      "SAN PEDRO APÓSTOL-POZUELO","SANTA MARIA DEL PILAR DE MADRID","SANTA MARIA DEL VALLE",
      "SANTA MARIA DE LOS ANGELES","ST. GEORGE´S SCHOOL","TERRAS DE LOS ALCORNOCALES","TORRELODONES",
      "TORRELODONES-PALOMERAS","TORRELODONES-POZUELO","TORRELODONES-VILLALBA",
      "TORRELODONES-VILLANUEVA DE LA CAÑADA","URBASUR","URBASUR EL PINSAPO","VILLA AMALIA",
      "VILLA DE MOSTOLES - EL CASTILLO","VILLA LAMAGDALENA","VIRGEN DE LOS REMEDIOS"
    ];

    function slugifyCenter(name) {
      return name
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    }

    const centerNameSel = document.getElementById('rrf-centerName');
    const otroOption = centerNameSel.querySelector('option[value="__otro__"]');
    SCHOOLS.forEach(function (name) {
      const opt = document.createElement('option');
      opt.value = slugifyCenter(name);
      opt.textContent = name;
      opt.dataset.label = name;
      centerNameSel.insertBefore(opt, otroOption);
    });

    let choicesCenterType, choicesCenterName, choicesPositions, choicesCourses, choicesSubjects, choicesTopics;

    function initChoices() {
      if (!window.Choices) {
        setTimeout(initChoices, 100);
        return;
      }
      choicesCenterType = new Choices('#rrf-centerType', {
        searchEnabled: false,
        itemSelectText: '',
        shouldSort: false,
      });
      choicesCenterName = new Choices('#rrf-centerName', {
        searchEnabled: true,
        searchPlaceholderValue: 'Busca tu centro…',
        itemSelectText: '',
        shouldSort: false,
        placeholder: true,
      });
      choicesPositions = new Choices('#rrf-positions', {
        removeItemButton: true, placeholder: true,
        placeholderValue: 'Selecciona…', itemSelectText: '', shouldSort: false,
      });
      choicesCourses = new Choices('#rrf-coursesTeaching', {
        removeItemButton: true, placeholder: true,
        placeholderValue: 'Selecciona…', itemSelectText: '', shouldSort: false,
      });
      choicesSubjects = new Choices('#rrf-subjects', {
        removeItemButton: true, placeholder: true,
        placeholderValue: 'Selecciona…', itemSelectText: '', shouldSort: false,
      });
      choicesTopics = new Choices('#rrf-topics', {
        removeItemButton: true, placeholder: true,
        placeholderValue: 'Selecciona…', itemSelectText: '', shouldSort: false,
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initChoices);
    } else {
      initChoices();
    }

    centerNameSel.addEventListener('change', function () {
      const otherWrap = document.getElementById('rrf-otherName-wrap');
      const otherInput = document.getElementById('rrf-otherName');
      if (centerNameSel.value === '__otro__') {
        otherWrap.classList.add('visible');
        otherInput.required = true;
      } else {
        otherWrap.classList.remove('visible');
        otherInput.required = false;
        otherInput.value = '';
      }
    });

    function showError(field) {
      const wrap = field.closest('.rrf-field');
      if (wrap) wrap.classList.add('has-error');
    }
    function clearError(field) {
      const wrap = field.closest('.rrf-field');
      if (wrap) wrap.classList.remove('has-error');
    }
    FORM.querySelectorAll('input, select, textarea').forEach(function (el) {
      el.addEventListener('input', function () { clearError(el); });
      el.addEventListener('change', function () { clearError(el); });
    });

    function getRadio(name) {
      const el = FORM.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : '';
    }
    function getMulti(name) {
      const sel = FORM.querySelector('select[name="' + name + '"]');
      if (!sel) return [];
      return Array.from(sel.selectedOptions).map(function (o) { return o.value; });
    }
    function getVal(name) {
      const el = FORM.querySelector('[name="' + name + '"]');
      return el ? el.value.trim() : '';
    }
    function getCenterLabel() {
      const sel = FORM.querySelector('#rrf-centerName');
      const val = sel.value;
      if (!val) return '';
      if (val === '__otro__') return getVal('otherName');
      const opt = sel.querySelector('option[value="' + val + '"]');
      return opt ? (opt.dataset.label || opt.textContent.trim()) : val;
    }

    FORM.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      ST.textContent = '';
      ST.className = 'rrf-status';

      let valid = true;
      const required = FORM.querySelectorAll('[required]');
      required.forEach(function (el) {
        if (el.type === 'radio') {
          const name = el.name;
          if (!getRadio(name)) {
            const group = FORM.querySelector('[data-name="' + name + '"]');
            if (group) {
              const wrap = group.closest('.rrf-field');
              if (wrap) wrap.classList.add('has-error');
            }
            valid = false;
          }
        } else if (el.tagName === 'SELECT' && el.multiple) {
          if (getMulti(el.name).length === 0) {
            showError(el);
            valid = false;
          }
        } else {
          if (!el.value.trim()) {
            showError(el);
            valid = false;
          }
        }
      });

      const difficulties = getVal('difficulties');
      if (difficulties.length < 20) { showError(FORM.querySelector('#rrf-difficulties')); valid = false; }
      const goals = getVal('goals');
      if (goals.length < 20) { showError(FORM.querySelector('#rrf-goals')); valid = false; }

      if (!valid) {
        ST.textContent = 'Hay campos sin completar. Revisa los marcados en rojo.';
        ST.className = 'rrf-status error';
        // Scroll al primer error
        const firstErr = FORM.querySelector('.rrf-field.has-error');
        if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const payload = {
        userEmail: CFG.user.email,
        userWpId: CFG.user.wpId,
        courseWpId: CFG.courseId,
        productWpId: CFG.productId,
        center: {
          type: getVal('centerType'),
          name: getCenterLabel(),
          otherName: FORM.querySelector('#rrf-centerName').value === '__otro__' ? getVal('otherName') : null,
          address: {
            street: getVal('street'),
            apartment: getVal('apartment') || null,
            city: getVal('city'),
            state: getVal('state'),
            postalCode: getVal('postalCode'),
            country: getVal('country'),
          },
          nif: getVal('nif'),
        },
        teacher: {
          yearsOfExperience: parseInt(getVal('yearsExp'), 10),
          positions: getMulti('positions'),
          coursesTeaching: getMulti('coursesTeaching'),
          subjects: getMulti('subjects'),
          topicsOfInterest: getMulti('topics'),
        },
        diagnosis: {
          motivationCurrent: parseInt(getRadio('motivationCurrent'), 10),
          motivationVsStart: parseInt(getRadio('motivationVsStart'), 10),
          centerEnvironment: parseInt(getRadio('centerEnvironment'), 10),
          stressLevel: parseInt(getRadio('stressLevel'), 10),
          hasResources: parseInt(getRadio('hasResources'), 10),
          socialRecognition: parseInt(getRadio('socialRecognition'), 10),
          workloadFrequency: getRadio('workloadFrequency'),
          weeklyExtraHours: getRadio('weeklyExtraHours'),
          mainDifficulties: difficulties,
          courseGoals: goals,
        },
        submittedAt: new Date().toISOString(),
      };

      BTN.disabled = true;
      ST.textContent = 'Enviando…';

      try {
        const res = await fetch(CFG.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant': CFG.tenantSlug,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          ST.textContent = '¡Guardado! Te llevamos al curso…';
          ST.className = 'rrf-status success';
          setTimeout(function () { window.location.href = CFG.courseUrl; }, 1000);
        } else {
          const data = await res.json().catch(function () { return {}; });
          ST.textContent = 'Error: ' + (data.error || 'No se pudo guardar. Intenta de nuevo.');
          ST.className = 'rrf-status error';
          BTN.disabled = false;
        }
      } catch (err) {
        console.error('[retorika-form] submit error', err);
        ST.textContent = 'Error de red. Intenta de nuevo en unos segundos.';
        ST.className = 'rrf-status error';
        BTN.disabled = false;
      }
    });
  })();
  </script>

  <?php
  return ob_get_clean();
});

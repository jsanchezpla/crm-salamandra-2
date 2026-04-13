<?php
/**
 * Shortcodes de captación de leads — Quality Holding
 *
 * Incluye un shortcode por empresa, todos envían al mismo tenant "quality"
 * del CRM (admin@qualityholding.com) diferenciados por el campo empresa.
 *
 * Shortcodes disponibles:
 *   [quality_lead_form]       → Quality Energy Consulting
 *   [made_of_energy_lead_form] → Made of Energy
 *   [abarcaia_lead_form]      → AbarcaIA
 *   [iluminia_lead_form]      → Iluminia Quantum
 *
 * Instalación: añadir este archivo como plugin de WordPress o incluirlo
 * desde functions.php con: require_once get_template_directory() . '/quality-holding-leads.php';
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ─── Función generadora de formulario ────────────────────────────────────────

/**
 * Genera el HTML + CSS + JS del formulario para la empresa indicada.
 *
 * @param string $empresa     Nombre exacto de la empresa (se guarda en el CRM)
 * @param string $titulo      Título visible en el formulario
 * @param string $color       Color primario del formulario (#hex)
 * @param string $color_hover Color hover del botón (#hex)
 * @param string $form_id     ID único del formulario en la página
 */
function quality_holding_render_lead_form( $empresa, $titulo, $color, $color_hover, $form_id ) {
    ob_start(); ?>

<style>
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> {
        max-width: 550px;
        margin: 40px auto;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: #ffffff;
        padding: 30px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        box-sizing: border-box;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> h3 {
        text-align: center;
        color: <?php echo esc_attr( $color_hover ); ?>;
        margin-top: 0;
        margin-bottom: 25px;
        font-size: 22px;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-group { margin-bottom: 18px; }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-label {
        display: block;
        margin-bottom: 6px;
        font-weight: 600;
        font-size: 14px;
        color: #333;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-input,
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-select {
        width: 100%;
        padding: 12px 15px;
        border: 1px solid #ced4da;
        border-radius: 6px;
        font-size: 15px;
        box-sizing: border-box;
        transition: border-color 0.3s;
        color: #495057;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-input:focus,
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-select:focus {
        border-color: <?php echo esc_attr( $color ); ?>;
        outline: none;
        box-shadow: 0 0 0 3px <?php echo esc_attr( $color ); ?>26;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-btn {
        background: <?php echo esc_attr( $color ); ?>;
        color: #fff;
        border: none;
        padding: 14px 20px;
        border-radius: 6px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        width: 100%;
        transition: background 0.3s;
        margin-top: 10px;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-btn:hover:not(:disabled) {
        background: <?php echo esc_attr( $color_hover ); ?>;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-btn:disabled { opacity: 0.7; cursor: not-allowed; }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-msg {
        margin-top: 15px;
        padding: 12px;
        border-radius: 6px;
        text-align: center;
        font-weight: 600;
        font-size: 14px;
        display: none;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-msg.ok {
        background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; display: block;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-msg.err {
        background: #ffebee; color: #c62828; border: 1px solid #ffcdd2; display: block;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .qh-err-text {
        color: #c62828; font-size: 12px; display: none; margin-top: 4px;
    }
    .qh-form-wrapper-<?php echo esc_attr( $form_id ); ?> .err-border { border-color: #c62828 !important; }
</style>

<div class="qh-form-wrapper-<?php echo esc_attr( $form_id ); ?>">
    <h3><?php echo esc_html( $titulo ); ?></h3>
    <form id="<?php echo esc_attr( $form_id ); ?>" novalidate>

        <div class="qh-group">
            <label class="qh-label">Nombre completo *</label>
            <input type="text" id="<?php echo esc_attr( $form_id ); ?>_nombre" class="qh-input"
                   placeholder="Ej: Raquel Aguado Llorente" required />
            <div class="qh-err-text" id="<?php echo esc_attr( $form_id ); ?>_errNombre">Por favor, indica tu nombre.</div>
        </div>

        <div class="qh-group">
            <label class="qh-label">Teléfono *</label>
            <input type="tel" id="<?php echo esc_attr( $form_id ); ?>_telefono" class="qh-input"
                   placeholder="Ej: 600 000 000" required />
            <div class="qh-err-text" id="<?php echo esc_attr( $form_id ); ?>_errTelefono">Introduce un teléfono válido de 9 cifras.</div>
        </div>

        <div class="qh-group">
            <label class="qh-label">Email *</label>
            <input type="email" id="<?php echo esc_attr( $form_id ); ?>_email" class="qh-input"
                   placeholder="tu@email.com" required />
            <div class="qh-err-text" id="<?php echo esc_attr( $form_id ); ?>_errEmail">Introduce un correo electrónico válido.</div>
        </div>

        <div class="qh-group">
            <label class="qh-label">Nivel de experiencia *</label>
            <select id="<?php echo esc_attr( $form_id ); ?>_experiencia" class="qh-select" required>
                <option value="" disabled selected>Selecciona tu situación...</option>
                <option value="experienced">Con experiencia en el sector</option>
                <option value="freelancer">Soy Autónomo</option>
                <option value="other_sector">Vengo de otro sector</option>
            </select>
            <div class="qh-err-text" id="<?php echo esc_attr( $form_id ); ?>_errExperiencia">Selecciona una opción.</div>
        </div>

        <div class="qh-group">
            <label class="qh-label">Zona geográfica *</label>
            <select id="<?php echo esc_attr( $form_id ); ?>_zona" class="qh-select" required>
                <option value="" disabled selected>Selecciona tu zona...</option>
                <option value="Andalucía">Andalucía</option>
                <option value="Aragón">Aragón</option>
                <option value="Canarias">Canarias</option>
                <option value="Castilla y León">Castilla y León</option>
                <option value="Castilla-La Mancha">Castilla-La Mancha</option>
                <option value="Cataluña">Cataluña</option>
                <option value="Extremadura">Extremadura</option>
                <option value="Galicia">Galicia</option>
                <option value="Madrid">Madrid</option>
                <option value="Murcia">Murcia</option>
                <option value="País Vasco">País Vasco</option>
                <option value="Valencia">Valencia</option>
            </select>
            <div class="qh-err-text" id="<?php echo esc_attr( $form_id ); ?>_errZona">Selecciona una zona.</div>
        </div>

        <button type="submit" id="<?php echo esc_attr( $form_id ); ?>_btn" class="qh-btn">Enviar candidatura</button>
        <div class="qh-msg" id="<?php echo esc_attr( $form_id ); ?>_msg"></div>

    </form>
</div>

<script>
(function() {
    var FORM_ID   = <?php echo json_encode( $form_id ); ?>;
    var EMPRESA   = <?php echo json_encode( $empresa ); ?>;
    var CRM_URL   = 'https://crm.salamandrasolutions.com/api/public/leads';
    var TENANT    = 'quality';

    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var phoneRegex = /^[6789]\d{8}$/;

    function $(id) { return document.getElementById(id); }

    function toggleErr(errId, inputId, show) {
        $(errId).style.display = show ? 'block' : 'none';
        $(inputId).classList.toggle('err-border', show);
    }

    function validateForm() {
        var ok = true;

        var nombre = $(FORM_ID + '_nombre').value.trim();
        var nErr = nombre.length < 2;
        toggleErr(FORM_ID + '_errNombre', FORM_ID + '_nombre', nErr);
        if (nErr) ok = false;

        var tel = $(FORM_ID + '_telefono').value.replace(/[\s\-\.]/g, '');
        var tErr = !phoneRegex.test(tel);
        toggleErr(FORM_ID + '_errTelefono', FORM_ID + '_telefono', tErr);
        if (tErr) ok = false;

        var email = $(FORM_ID + '_email').value.trim();
        var eErr = !emailRegex.test(email);
        toggleErr(FORM_ID + '_errEmail', FORM_ID + '_email', eErr);
        if (eErr) ok = false;

        var exp = $(FORM_ID + '_experiencia').value;
        var exErr = exp === '';
        toggleErr(FORM_ID + '_errExperiencia', FORM_ID + '_experiencia', exErr);
        if (exErr) ok = false;

        var zona = $(FORM_ID + '_zona').value;
        var zErr = zona === '';
        toggleErr(FORM_ID + '_errZona', FORM_ID + '_zona', zErr);
        if (zErr) ok = false;

        return ok;
    }

    $(FORM_ID).addEventListener('submit', async function(e) {
        e.preventDefault();

        var btn = $(FORM_ID + '_btn');
        var msg = $(FORM_ID + '_msg');

        msg.style.display = 'none';
        msg.className = 'qh-msg';

        if (!validateForm()) return;

        btn.disabled = true;
        btn.textContent = 'Enviando...';

        var data = {
            name:   $(FORM_ID + '_nombre').value.trim(),
            phone:  $(FORM_ID + '_telefono').value.trim(),
            email:  $(FORM_ID + '_email').value.trim(),
            empresa: EMPRESA,
            customFields: {
                experience:  $(FORM_ID + '_experiencia').value,
                zone:        $(FORM_ID + '_zona').value,
                fecha_envio: new Date().toISOString()
            }
        };

        try {
            var res = await fetch(CRM_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-tenant': TENANT
                },
                body: JSON.stringify(data)
            });

            var json = await res.json();

            if (res.ok && json.ok) {
                msg.textContent = '¡Datos enviados correctamente! Nos pondremos en contacto contigo.';
                msg.className = 'qh-msg ok';
                this.reset();
            } else {
                throw new Error(json.error || 'Error del servidor');
            }
        } catch (err) {
            msg.textContent = 'Hubo un error de conexión. Por favor, inténtalo de nuevo.';
            msg.className = 'qh-msg err';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Enviar candidatura';
        }
    });
})();
</script>

<?php
    return ob_get_clean();
}

// ─── Shortcode: Quality Energy Consulting ────────────────────────────────────

add_shortcode( 'quality_lead_form', function() {
    return quality_holding_render_lead_form(
        'Quality Energy Consulting',
        'Únete a nuestro equipo — Quality Energy',
        '#4a8b36',
        '#3b6b29',
        'qhForm_quality'
    );
} );

// ─── Shortcode: Made of Energy ───────────────────────────────────────────────

add_shortcode( 'made_of_energy_lead_form', function() {
    return quality_holding_render_lead_form(
        'Made of Energy',
        'Únete a nuestro equipo — Made of Energy',
        '#E67E22',
        '#CA6F1E',
        'qhForm_moe'
    );
} );

// ─── Shortcode: AbarcaIA ─────────────────────────────────────────────────────

add_shortcode( 'abarcaia_lead_form', function() {
    return quality_holding_render_lead_form(
        'AbarcaIA',
        'Únete a nuestro equipo — AbarcaIA',
        '#2980B9',
        '#1F618D',
        'qhForm_abarcaia'
    );
} );

// ─── Shortcode: Iluminia Quantum ─────────────────────────────────────────────

add_shortcode( 'iluminia_lead_form', function() {
    return quality_holding_render_lead_form(
        'Iluminia Quantum',
        'Únete a nuestro equipo — Iluminia Quantum',
        '#7D3C98',
        '#6C3483',
        'qhForm_iluminia'
    );
} );

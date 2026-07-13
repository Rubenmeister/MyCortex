import Link from 'next/link';

/**
 * Términos de Servicio — versión beta privada / inicio de beta pública.
 *
 * Texto plano, sin entrar en territorio de abogado. Cuando saquemos
 * pagos (Lemon Squeezy) hay que revisarlo con un abogado de software EU
 * + Ecuador. Hoy cubre lo mínimo: qué es el servicio, qué hace el user,
 * qué pasa con sus datos, y disclaimers.
 */
export const metadata = {
  title: 'Términos de Servicio — MyCortex',
  description: 'Condiciones de uso del servicio MyCortex de THORN AI Technologies.',
};

export default function TermsPage() {
  return (
    <main className="legal">
      <header className="head">
        <Link href="/" className="back">← Volver</Link>
        <h1>Términos de Servicio</h1>
        <p className="updated">Última actualización: 26 de mayo de 2026</p>
      </header>

      <section>
        <h2>1. Quiénes somos</h2>
        <p>
          MyCortex es un servicio operado por <strong>THORN AI Technologies</strong>, con
          base en Quito, Ecuador. Cuando decimos &quot;nosotros&quot;, &quot;el Servicio&quot; o &quot;MyCortex&quot;
          nos referimos a esta empresa y al producto que ofrece en{' '}
          <a href="https://my-cortex-web-gxoh.vercel.app">my-cortex-web-gxoh.vercel.app</a>.
        </p>
      </section>

      <section>
        <h2>2. Qué es MyCortex</h2>
        <p>
          Es una herramienta personal y empresarial que indexa contenido que tú eliges
          conectar (correos, documentos, eventos de calendario, mensajes de Telegram o
          WhatsApp) y te permite buscarlo y razonar sobre él con asistencia de
          inteligencia artificial.
        </p>
        <p>
          MyCortex <strong>no es</strong> un servicio de almacenamiento masivo, no es una
          herramienta de respaldo legal, ni un sustituto de asesoría profesional
          (médica, legal, financiera, etc).
        </p>
      </section>

      <section>
        <h2>3. Tu cuenta</h2>
        <ul>
          <li>Tienes que dar un email real y una contraseña de tu propiedad.</li>
          <li>Eres responsable de mantener tu contraseña segura.</li>
          <li>Si sospechas acceso no autorizado, avísanos de inmediato a{' '}
            <a href="mailto:rubentorcob@gmail.com">rubentorcob@gmail.com</a>.</li>
          <li>Una cuenta es para una persona. No compartas credenciales.</li>
        </ul>
      </section>

      <section>
        <h2>4. Qué hacemos con tu contenido</h2>
        <p>
          Detalle completo en nuestra <Link href="/privacy">Política de Privacidad</Link>.
          En resumen:
        </p>
        <ul>
          <li>Tu contenido es <strong>tuyo</strong>. Tú lo subes, tú puedes borrarlo.</li>
          <li>Lo usamos exclusivamente para generar tus respuestas, briefings y
            alertas — no entrenamos modelos públicos con él.</li>
          <li>Lo procesamos pasándolo a proveedores de IA (OpenAI, Anthropic, Cohere)
            que tienen acuerdos de no-entrenamiento. Sus términos están públicos.</li>
          <li>No vendemos ni compartimos tu contenido con anunciantes o terceros
            comerciales.</li>
        </ul>
      </section>

      <section>
        <h2>5. Qué no puedes hacer</h2>
        <ul>
          <li>Subir contenido que no te pertenece o sobre el que no tienes permisos.</li>
          <li>Usar MyCortex para spam, scraping abusivo, o para evadir rate limits
            (tenemos 120 req/min por usuario por una razón).</li>
          <li>Intentar acceder a workspaces o cuentas que no son tuyos.</li>
          <li>Cargar contenido ilegal: material que viole copyright, datos
            personales de terceros sin consentimiento, o contenido prohibido por la
            ley ecuatoriana.</li>
        </ul>
      </section>

      <section>
        <h2>6. Estado actual: beta</h2>
        <p>
          MyCortex está en <strong>fase beta</strong>. Eso significa que:
        </p>
        <ul>
          <li>Puede haber bugs, lentitud, o features que cambien sin aviso.</li>
          <li>Hacemos backups diarios pero no garantizamos zero data loss durante la
            beta. Si tienes información crítica, mantenla también en otro lado.</li>
          <li>El servicio puede tener cortes para mantenimiento. Avisamos cuando
            podemos.</li>
        </ul>
      </section>

      <section>
        <h2>7. Pagos (cuando arranquen)</h2>
        <p>
          Hoy la beta es <strong>gratis</strong>. Cuando saquemos planes pagos (Pro,
          Team), te avisaremos con al menos 30 días de antelación y tu uso actual
          quedará en el plan free indefinidamente, no se te va a cobrar
          retroactivamente.
        </p>
      </section>

      <section>
        <h2>8. Cancelación de cuenta</h2>
        <p>
          Puedes cancelar tu cuenta cuando quieras desde <em>Configuración</em> o
          escribiendo a <a href="mailto:rubentorcob@gmail.com">rubentorcob@gmail.com</a>.
          Al cancelar, borramos tu contenido en 30 días (excepto backups, que se
          rotan en 90 días).
        </p>
      </section>

      <section>
        <h2>9. Limitación de responsabilidad</h2>
        <p>
          MyCortex se ofrece &quot;tal cual&quot;. No garantizamos que las respuestas
          generadas por IA sean correctas, completas, o adecuadas para una decisión
          específica. <strong>Valida la información crítica antes de actuar sobre
          ella</strong>, especialmente en temas médicos, legales, o financieros.
        </p>
        <p>
          Nuestra responsabilidad total ante cualquier reclamo se limita a lo que
          hayas pagado por el servicio en los últimos 12 meses (en la beta gratis,
          eso es cero).
        </p>
      </section>

      <section>
        <h2>10. Cambios a estos términos</h2>
        <p>
          Si cambiamos estos términos de forma sustancial, te avisamos por email con
          al menos 14 días de antelación. Cambios menores (typos, aclaraciones) los
          publicamos directo aquí actualizando la fecha de arriba.
        </p>
      </section>

      <section>
        <h2>11. Ley aplicable</h2>
        <p>
          Estos términos se rigen por la legislación de Ecuador. Cualquier disputa
          se resuelve en los tribunales de Quito, Pichincha.
        </p>
      </section>

      <section>
        <h2>12. Contacto</h2>
        <p>
          ¿Dudas, reclamos, ideas? Escribe a{' '}
          <a href="mailto:rubentorcob@gmail.com">rubentorcob@gmail.com</a>. Te
          respondemos personalmente, no hay bot de soporte (todavía).
        </p>
      </section>

      <style>{`
        .legal { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; color: #ddd; font-size: 15px; line-height: 1.7; }
        .head { margin-bottom: 36px; padding-bottom: 24px; border-bottom: 1px solid #1a1a22; }
        .back { color: #888; font-size: 13px; text-decoration: none; }
        .back:hover { color: #ddd; }
        h1 { font-size: 32px; margin: 16px 0 6px; letter-spacing: -0.5px; }
        .updated { color: #666; font-size: 13px; margin: 0; }
        h2 { font-size: 18px; margin: 32px 0 10px; color: #fff; }
        a { color: #f5b133; text-decoration: none; }
        a:hover { text-decoration: underline; }
        ul { padding-left: 22px; }
        li { margin-bottom: 8px; }
        section p, section ul { margin: 8px 0; }
        strong { color: #fff; }
      `}</style>
    </main>
  );
}

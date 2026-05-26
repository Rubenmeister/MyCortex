import Link from 'next/link';

/**
 * Política de Privacidad — versión beta. Cuando saquemos a EU oficialmente
 * hay que agregar GDPR-specific clauses (DPO, base legal por cada
 * processing activity, etc.). Hoy cubre lo esencial.
 */
export const metadata = {
  title: 'Privacidad — MyCortex',
  description: 'Cómo MyCortex (THORN AI Technologies) trata tus datos personales.',
};

export default function PrivacyPage() {
  return (
    <main className="legal">
      <header className="head">
        <Link href="/" className="back">← Volver</Link>
        <h1>Política de Privacidad</h1>
        <p className="updated">Última actualización: 26 de mayo de 2026</p>
      </header>

      <section>
        <h2>El resumen de 30 segundos</h2>
        <ul>
          <li><strong>Tu contenido es tuyo.</strong> Lo subís, lo borrás cuando querés.</li>
          <li><strong>No vendemos tus datos</strong> a nadie. Nunca.</li>
          <li><strong>No entrenamos modelos públicos</strong> con tu contenido.</li>
          <li>Lo procesamos con OpenAI, Anthropic y Cohere bajo sus acuerdos de
            no-entrenamiento.</li>
          <li>Pedís borrar todo → en 30 días no queda nada (excepto backups
            cifrados que rotan en 90 días).</li>
        </ul>
      </section>

      <section>
        <h2>Quién es el responsable</h2>
        <p>
          <strong>THORN AI Technologies</strong>, Quito, Ecuador. Contacto para
          temas de privacidad:{' '}
          <a href="mailto:rubentorcob@gmail.com">rubentorcob@gmail.com</a>.
        </p>
      </section>

      <section>
        <h2>Qué datos recogemos</h2>

        <h3>Datos que vos das directamente</h3>
        <ul>
          <li><strong>Cuenta</strong>: email, contraseña (hasheada con bcrypt por
            Supabase Auth, nunca vemos el plaintext).</li>
          <li><strong>Contenido</strong>: las notas que capturás (texto, voz que
            transcribimos, fotos), los documentos de Drive que conectás, los mails
            de Gmail que indexamos, los eventos de Calendar, los mensajes de
            Telegram o WhatsApp que mandás al bot.</li>
          <li><strong>Workspace</strong>: nombre, miembros, roles, invitaciones.</li>
        </ul>

        <h3>Datos técnicos que registramos automáticamente</h3>
        <ul>
          <li>Logs de acceso (IP, timestamp, endpoint) — para detectar abuse y
            debuggear. Se rotan en 30 días.</li>
          <li>Métricas agregadas (cuántos nodos, cuántas búsquedas, qué fuentes
            están conectadas) — sin contenido específico.</li>
        </ul>

        <h3>Datos de terceros (vía OAuth)</h3>
        <p>
          Cuando conectás Google Drive / Gmail / Calendar, Google nos pasa tokens
          de acceso de solo lectura. Esos tokens viven cifrados en Google Secret
          Manager. Podés revocar el acceso en cualquier momento desde{' '}
          <a href="https://myaccount.google.com/permissions">Google Account → Permisos</a>.
        </p>
      </section>

      <section>
        <h2>Para qué los usamos</h2>
        <p>Tres cosas, y nada más:</p>
        <ol>
          <li><strong>Operar el servicio</strong>: indexar, buscar, generar
            respuestas, briefings y alertas.</li>
          <li><strong>Mantener el servicio sano</strong>: detectar abuse, debuggear
            errores, medir performance.</li>
          <li><strong>Comunicarnos con vos</strong>: emails operacionales
            (confirmación de cuenta, password reset, alertas urgentes). No mandamos
            marketing salvo que te suscribas explícitamente.</li>
        </ol>
      </section>

      <section>
        <h2>Con quién compartimos</h2>
        <p>
          Tu contenido pasa por estos proveedores únicamente para procesarlo (no
          para que lo retengan o lo usen para sus propios fines):
        </p>
        <ul>
          <li><strong>Supabase</strong> (auth + postgres + storage) — host de la DB.</li>
          <li><strong>Google Cloud Platform</strong> — host del backend y workers.</li>
          <li><strong>Vercel</strong> — host del frontend.</li>
          <li><strong>OpenAI</strong> — embeddings + Whisper (transcripción) + GPT-4.
            <a href="https://openai.com/policies/api-data-usage-policies"> No-train
            por defecto en API.</a></li>
          <li><strong>Anthropic</strong> — Claude para reasoning. <a
            href="https://www.anthropic.com/legal/aup">No entrena con API data.</a></li>
          <li><strong>Cohere</strong> — reranker multilingüe.</li>
          <li><strong>Resend</strong> — envío de emails operacionales.</li>
          <li><strong>Telegram / WhatsApp</strong> — solo si vinculaste esas
            integraciones. Los mensajes pasan por sus servidores antes de llegarnos.</li>
        </ul>
        <p>
          <strong>Nunca</strong> compartimos con anunciantes, brokers de datos, o
          terceros comerciales. Solo entregamos datos a autoridades si nos lo exige
          una orden judicial válida en Ecuador.
        </p>
      </section>

      <section>
        <h2>Dónde viven tus datos</h2>
        <ul>
          <li>Supabase: región <strong>us-east-1</strong> (Virginia, USA).</li>
          <li>Cloud Run API: <strong>us-east1</strong> (Carolina del Sur, USA).</li>
          <li>Workers + Cloud Storage: <strong>us-east1</strong>.</li>
        </ul>
        <p>
          Si querés que tus datos vivan en otra región (por ejemplo EU para
          compliance GDPR), escribinos — estamos planeando soportar
          europe-west antes de fin de 2026.
        </p>
      </section>

      <section>
        <h2>Tus derechos</h2>
        <p>Podés en cualquier momento:</p>
        <ul>
          <li><strong>Ver</strong> qué tenemos sobre vos: descargá tus nodos desde
            <em> /app/nodes</em> o pedinos un export completo por email.</li>
          <li><strong>Corregir</strong>: editás tus nodos directamente, o nos
            avisás de algún dato mal registrado.</li>
          <li><strong>Borrar</strong>: deletear nodos uno por uno, o cancelar tu
            cuenta entera y se borra todo en 30 días.</li>
          <li><strong>Portar</strong>: pediendolo, te damos un JSON con todo tu
            contenido.</li>
          <li><strong>Revocar OAuth</strong>: desde <em>/app/settings/integrations</em>
            o desde el panel de cada proveedor (Google, Telegram, etc.).</li>
        </ul>
      </section>

      <section>
        <h2>Cookies y tracking</h2>
        <p>
          Usamos lo mínimo:
        </p>
        <ul>
          <li>Una cookie de sesión de Supabase Auth (necesaria para mantenerte
            logueado).</li>
          <li>Sin analytics de terceros (no Google Analytics, no Mixpanel).</li>
          <li>Sin píxeles de tracking de Facebook, LinkedIn, etc.</li>
        </ul>
      </section>

      <section>
        <h2>Niños</h2>
        <p>
          MyCortex no está dirigido a menores de 13 años. Si descubrimos que una
          cuenta es de un menor, la cerramos y borramos los datos.
        </p>
      </section>

      <section>
        <h2>Cambios</h2>
        <p>
          Si cambiamos cómo tratamos datos personales, te avisamos por email al
          menos 14 días antes del cambio.
        </p>
      </section>

      <section>
        <h2>Contacto</h2>
        <p>
          Para cualquier tema de privacidad:{' '}
          <a href="mailto:rubentorcob@gmail.com">rubentorcob@gmail.com</a>.
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
        h3 { font-size: 15px; margin: 18px 0 6px; color: #ccc; }
        a { color: #f5b133; text-decoration: none; }
        a:hover { text-decoration: underline; }
        ul, ol { padding-left: 22px; }
        li { margin-bottom: 8px; }
        section p, section ul, section ol { margin: 8px 0; }
        strong { color: #fff; }
      `}</style>
    </main>
  );
}

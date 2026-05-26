'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth';

/**
 * Marketing landing page. Anonymous visitors see the full pitch + CTA
 * to /login. Authenticated visitors see a slim variant with a "go to
 * app" button at the top so they don't get bounced around.
 */
export default function HomePage() {
  const { session, loading } = useAuth();
  const signedIn = !loading && Boolean(session);

  return (
    <main className="page">
      <header className="top">
        <div className="brand">MyCortex</div>
        <nav className="topnav">
          <Link href="/pricing">Precios</Link>
          {signedIn ? (
            <Link href="/app" className="btn-primary">
              Ir a la app →
            </Link>
          ) : (
            <Link href="/login" className="btn-primary">
              Empezar
            </Link>
          )}
        </nav>
      </header>

      <section className="hero">
        <div className="badge-pill">Personal + empresarial · IA · Tu data</div>
        <h1>
          Tu segundo cerebro.
          <br />
          <span className="grad">Personal y empresarial.</span>
        </h1>
        <p className="lead">
          MyCortex captura todo lo que importa — notas, mails, docs, calendario, voz — y lo
          convierte en un cerebro consultable. Preguntale cualquier cosa y te responde con tus
          propias fuentes.
        </p>
        <div className="cta-row">
          <Link href="/login" className="btn-big">
            Crear cuenta gratis
          </Link>
          <Link href="/pricing" className="btn-ghost">
            Ver precios
          </Link>
        </div>
        <div className="trust">
          Tu workspace es tuyo y de nadie más (Row-Level Security en Postgres). No
          vendemos tus datos. No entrenamos modelos públicos con ellos.
        </div>
      </section>

      <section className="features">
        <h2 className="section-title">Cómo funciona</h2>
        <div className="grid">
          <div className="feat">
            <div className="feat-icon">🧠</div>
            <h3>Capturás todo</h3>
            <p>
              Notas rápidas por web, mobile o Telegram. Voz que se transcribe sola. Drive, Gmail
              y Calendar conectados — todo se indexa con embeddings.
            </p>
          </div>
          <div className="feat">
            <div className="feat-icon">🎯</div>
            <h3>Recuperás lo justo</h3>
            <p>
              Búsqueda híbrida (vector + keyword) con reranker. Te respondemos con tus fuentes
              específicas: "según el mail de X" / "en el doc Y de tu Drive".
            </p>
          </div>
          <div className="feat">
            <div className="feat-icon">☀️</div>
            <h3>Briefings proactivos</h3>
            <p>
              Cada mañana un resumen de las últimas 24h: mails que importan, agenda del día,
              pendientes. Los lunes reflexión semanal con patrones.
            </p>
          </div>
        </div>
      </section>

      <section className="sources">
        <h2 className="section-title">Fuentes que conecta hoy</h2>
        <div className="src-grid">
          <div className="src">📁 Google Drive</div>
          <div className="src">📧 Gmail</div>
          <div className="src">📅 Google Calendar</div>
          <div className="src">🌐 Web (Tavily)</div>
          <div className="src">📲 Telegram</div>
          <div className="src">💻 Web app</div>
          <div className="src">📱 Mobile (Expo)</div>
          <div className="src">🔌 API</div>
        </div>
        <div className="src-roadmap">
          Próximamente: Notion · Slack · WhatsApp · Outlook
        </div>
      </section>

      <section className="b2b">
        <h2 className="section-title">Para vos · Para tu equipo</h2>
        <div className="b2b-grid">
          <div className="b2b-card">
            <div className="b2b-tag">PERSONAL</div>
            <h3>Tu cerebro extendido</h3>
            <p>
              Un workspace personal con todas tus fuentes conectadas. Búsqueda híbrida, briefings
              diarios, citas con origen. Lo que olvidás, MyCortex lo recuerda.
            </p>
            <ul className="b2b-list">
              <li>Captura por voz (transcripción auto)</li>
              <li>Briefing diario + reflexión semanal</li>
              <li>4 fuentes conectadas en free</li>
            </ul>
          </div>
          <div className="b2b-card">
            <div className="b2b-tag tag-team">EMPRESARIAL</div>
            <h3>Cerebro de tu equipo</h3>
            <p>
              Workspaces compartidos con RBAC. Documentación común, mails de clientes, calendarios
              de proyectos — todo consultable por cualquier miembro autorizado.
            </p>
            <ul className="b2b-list">
              <li>Workspaces multi-tenant con RLS</li>
              <li>Roles: owner / admin / member / viewer</li>
              <li>Auditoría + control granular</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="faq">
        <h2 className="section-title">Preguntas frecuentes</h2>
        <div className="faq-list">
          <details className="faq-item">
            <summary>¿Mis datos están seguros?</summary>
            <p>
              Sí. Tu workspace es tuyo y de nadie más — usamos Row-Level Security en
              Postgres para aislar workspaces. Yo (Rubén, fundador) no leo tu
              contenido, solo veo métricas agregadas. Los tokens OAuth viven
              cifrados en Google Secret Manager. No vendemos datos a nadie ni
              entrenamos modelos públicos con ellos. <Link href="/privacy">Detalle
              completo en privacidad</Link>.
            </p>
          </details>
          <details className="faq-item">
            <summary>¿Qué pasa con mi contenido si cancelo?</summary>
            <p>
              Lo borramos en 30 días (los backups cifrados rotan en 90 días después
              de eso). Antes de cancelar podés exportar todo a JSON desde
              <em> Configuración → Exportar mi cerebro</em>.
            </p>
          </details>
          <details className="faq-item">
            <summary>¿Cuándo van a cobrar?</summary>
            <p>
              Hoy todo es gratis (beta). Cuando saquemos planes pagos (Pro $12,
              Team $24/user), te avisamos con 30 días de anticipación. Tu uso actual
              queda en el plan free para siempre, no cobramos retroactivo.
            </p>
          </details>
          <details className="faq-item">
            <summary>¿Funciona en español?</summary>
            <p>
              Sí, de punta a punta. Búsqueda multilingüe (reranker Cohere), respuestas
              en el idioma de la pregunta, transcripción de voz en español ecuatoriano
              y argentino sin problema.
            </p>
          </details>
          <details className="faq-item">
            <summary>¿Hay app móvil?</summary>
            <p>
              APK Android disponible bajo pedido (en beta). iOS llega después.
              Mientras tanto, la versión web anda perfecto desde el browser del celu
              — la mayoría de testers la usan así.
            </p>
          </details>
          <details className="faq-item">
            <summary>¿Puedo conectar Notion / Slack / WhatsApp?</summary>
            <p>
              WhatsApp y Notion están en roadmap (Q3 2026). Slack lo skipeamos por ahora
              — vimos que los testers usan WhatsApp y Telegram más. Si Slack es
              crítico para tu equipo, escribime y lo subimos en prioridad.
            </p>
          </details>
        </div>
      </section>

      <section className="cta-final">
        <h2>¿Listo para extender tu memoria?</h2>
        <Link href="/login?mode=signup" className="btn-big">
          Crear cuenta gratis
        </Link>
        <div className="trust" style={{ marginTop: 16 }}>
          Sin tarjeta. Tu workspace personal queda gratis siempre.
        </div>
      </section>

      <footer className="foot">
        <div>
          <strong style={{ color: '#aaa' }}>MyCortex</strong> · un producto de THORN AI
          Technologies · Quito, Ecuador · 2026
        </div>
        <div className="foot-links">
          <Link href="/pricing">Precios</Link>
          <Link href="/terms">Términos</Link>
          <Link href="/privacy">Privacidad</Link>
          <Link href="/login">Entrar</Link>
        </div>
      </footer>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #050507;
          color: #eee;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }
        .top {
          max-width: 1100px;
          margin: 0 auto;
          padding: 22px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .brand {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .topnav {
          display: flex;
          gap: 22px;
          align-items: center;
        }
        .topnav :global(a) {
          color: #aaa;
          font-size: 14px;
          text-decoration: none;
        }
        .topnav :global(a):hover {
          color: #fff;
        }
        :global(.btn-primary) {
          background: #fff !important;
          color: #000 !important;
          padding: 8px 16px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
        }
        :global(.btn-primary):hover {
          opacity: 0.85;
        }
        .hero {
          max-width: 880px;
          margin: 60px auto 80px;
          padding: 0 24px;
          text-align: center;
        }
        .badge-pill {
          display: inline-block;
          background: linear-gradient(135deg, #1a1a3a, #2a1a3a);
          border: 1px solid #3a3a5a;
          color: #aac;
          font-size: 12px;
          padding: 6px 14px;
          border-radius: 99px;
          margin-bottom: 28px;
          letter-spacing: 0.3px;
        }
        h1 {
          font-size: clamp(36px, 6vw, 64px);
          line-height: 1.05;
          font-weight: 800;
          letter-spacing: -2px;
          margin: 0 0 24px;
        }
        .grad {
          background: linear-gradient(135deg, #8af, #d8f);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .lead {
          font-size: clamp(16px, 2vw, 19px);
          color: #aaa;
          max-width: 640px;
          margin: 0 auto 32px;
          line-height: 1.55;
        }
        .cta-row {
          display: flex;
          gap: 14px;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }
        :global(.btn-big) {
          background: #fff !important;
          color: #000 !important;
          padding: 14px 28px;
          border-radius: 10px;
          font-weight: 700;
          font-size: 15px;
          text-decoration: none;
        }
        :global(.btn-big):hover {
          opacity: 0.88;
        }
        :global(.btn-ghost) {
          background: transparent !important;
          color: #ddd !important;
          padding: 14px 28px;
          border: 1px solid #2a2a3a;
          border-radius: 10px;
          font-weight: 600;
          font-size: 15px;
          text-decoration: none;
        }
        :global(.btn-ghost):hover {
          border-color: #4a4a5a;
        }
        .trust {
          color: #666;
          font-size: 12px;
        }
        .features,
        .sources,
        .b2b,
        .faq,
        .cta-final {
          max-width: 1100px;
          margin: 0 auto;
          padding: 60px 24px;
        }
        .faq {
          max-width: 720px;
        }
        .faq-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .faq-item {
          background: #0e0e14;
          border: 1px solid #1a1a22;
          border-radius: 12px;
          padding: 0;
          overflow: hidden;
        }
        .faq-item summary {
          padding: 18px 22px;
          font-weight: 600;
          color: #fff;
          font-size: 15px;
          cursor: pointer;
          list-style: none;
          position: relative;
          padding-right: 48px;
        }
        .faq-item summary::-webkit-details-marker {
          display: none;
        }
        .faq-item summary::after {
          content: '+';
          position: absolute;
          right: 22px;
          top: 50%;
          transform: translateY(-50%);
          color: #888;
          font-size: 22px;
          line-height: 1;
          font-weight: 300;
        }
        .faq-item[open] summary::after {
          content: '−';
        }
        .faq-item[open] summary {
          border-bottom: 1px solid #1a1a22;
        }
        .faq-item p {
          margin: 0;
          padding: 16px 22px 20px;
          color: #aaa;
          font-size: 14px;
          line-height: 1.65;
        }
        .faq-item :global(a) {
          color: #f5b133;
          text-decoration: none;
        }
        .faq-item :global(a):hover {
          text-decoration: underline;
        }
        .section-title {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -1px;
          text-align: center;
          margin: 0 0 40px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
        }
        .feat {
          background: #0e0e14;
          border: 1px solid #1a1a22;
          border-radius: 14px;
          padding: 26px;
        }
        .feat-icon {
          font-size: 32px;
          margin-bottom: 10px;
        }
        .feat h3 {
          margin: 0 0 8px;
          font-size: 17px;
          color: #fff;
        }
        .feat p {
          margin: 0;
          color: #999;
          font-size: 14px;
          line-height: 1.55;
        }
        .src-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          max-width: 720px;
          margin: 0 auto;
        }
        .src {
          background: #0c0c12;
          border: 1px solid #1a1a22;
          border-radius: 10px;
          padding: 14px 18px;
          color: #ddd;
          font-size: 14px;
          font-weight: 500;
        }
        .src-roadmap {
          text-align: center;
          color: #666;
          font-size: 13px;
          margin-top: 24px;
        }
        .b2b-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 20px;
        }
        .b2b-card {
          background: #0e0e14;
          border: 1px solid #1a1a22;
          border-radius: 16px;
          padding: 32px;
        }
        .b2b-tag {
          display: inline-block;
          background: #1a2a3a;
          color: #aac;
          font-size: 10px;
          padding: 4px 10px;
          border-radius: 99px;
          letter-spacing: 1px;
          margin-bottom: 16px;
        }
        .b2b-tag.tag-team {
          background: #2a1a3a;
          color: #cac;
        }
        .b2b-card h3 {
          font-size: 22px;
          color: #fff;
          margin: 0 0 12px;
        }
        .b2b-card p {
          color: #aaa;
          line-height: 1.55;
          font-size: 14px;
          margin: 0 0 16px;
        }
        .b2b-list {
          padding-left: 18px;
          margin: 0;
          color: #888;
          font-size: 13px;
          line-height: 1.7;
        }
        .cta-final {
          text-align: center;
          padding: 80px 24px 100px;
        }
        .cta-final h2 {
          font-size: 32px;
          font-weight: 800;
          letter-spacing: -1px;
          margin: 0 0 24px;
        }
        .foot {
          max-width: 1100px;
          margin: 0 auto;
          padding: 30px 24px;
          border-top: 1px solid #1a1a22;
          display: flex;
          justify-content: space-between;
          color: #555;
          font-size: 12px;
        }
        .foot-links {
          display: flex;
          gap: 18px;
        }
        .foot-links :global(a) {
          color: #888;
          text-decoration: none;
        }
        .foot-links :global(a):hover {
          color: #ddd;
        }
      `}</style>
    </main>
  );
}

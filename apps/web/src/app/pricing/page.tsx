'use client';

import Link from 'next/link';
import { useAuth } from '../../lib/auth';

/**
 * Pricing page. Three tiers — Personal Free, Pro (single-user power),
 * Team (multi-user with admin/audit). Stripe checkout integration lives
 * separately (see /app/settings/billing when implemented).
 *
 * Prices are USD/mo — currency conversion handled at Stripe checkout
 * based on the buyer's locale.
 */
export default function PricingPage() {
  const { session, loading } = useAuth();
  const signedIn = !loading && Boolean(session);

  return (
    <main className="page">
      <header className="top">
        <Link href="/" className="brand">
          MyCortex
        </Link>
        <nav className="topnav">
          <Link href="/">Inicio</Link>
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
        <h1>Precios simples.</h1>
        <p className="lead">
          El personal es gratis para siempre. Pagas cuando necesitas más fuentes, más historial,
          o trabajar en equipo.
        </p>
      </section>

      <section className="tiers">
        <div className="tier">
          <div className="tier-name">Personal</div>
          <div className="tier-price">
            $0<span className="per">/mes</span>
          </div>
          <div className="tier-sub">Tu segundo cerebro personal, gratis siempre.</div>
          <ul className="tier-list">
            <li>1 workspace personal</li>
            <li>500 nodos indexados</li>
            <li>1 integración (Drive O Gmail O Calendar)</li>
            <li>Briefing diario + reflexión semanal</li>
            <li>Búsqueda híbrida con citas</li>
            <li>Mobile + Telegram bot</li>
          </ul>
          <Link href="/login" className="btn-tier ghost">
            Empezar gratis
          </Link>
        </div>

        <div className="tier featured">
          <div className="tier-badge">RECOMENDADO</div>
          <div className="tier-name">Pro</div>
          <div className="tier-price">
            $12<span className="per">/mes</span>
          </div>
          <div className="tier-sub">Power user solo. Sin límites prácticos.</div>
          <ul className="tier-list">
            <li>1 workspace personal</li>
            <li>50.000 nodos indexados</li>
            <li><strong>Todas</strong> las integraciones (Drive, Gmail, Calendar, +)</li>
            <li>Reranker premium (Cohere)</li>
            <li>Web search proactiva (Tavily)</li>
            <li>Push a WhatsApp / Telegram</li>
            <li>Agentes proactivos custom</li>
            <li>Histórico ilimitado de briefings</li>
          </ul>
          {/* Billing live deshabilitado hasta procesar Lemon Squeezy / Stripe-EC.
              Mientras tanto el CTA invita a crear cuenta gratis + ofrecemos
              upgrade desde la app cuando esté ready. */}
          <Link href="/login" className="btn-tier primary">
            Empezar gratis · Pro pronto
          </Link>
        </div>

        <div className="tier">
          <div className="tier-name">Team</div>
          <div className="tier-price">
            $24<span className="per">/usuario/mes</span>
          </div>
          <div className="tier-sub">Cerebro compartido para equipos chicos y medianos.</div>
          <ul className="tier-list">
            <li>Todo lo de Pro, +</li>
            <li>Workspaces compartidos (RBAC)</li>
            <li>Roles: owner / admin / member / viewer</li>
            <li>Slack + Notion + integraciones empresariales</li>
            <li>Audit log + control de accesos</li>
            <li>Single Sign-On (SAML/OIDC)</li>
            <li>Soporte prioritario</li>
          </ul>
          <a href="mailto:rubentorcob@gmail.com?subject=MyCortex%20Team%20-%20Contacto" className="btn-tier ghost">
            Hablar con ventas
          </a>
        </div>
      </section>

      <section className="faq">
        <h2>Preguntas frecuentes</h2>
        <div className="faq-grid">
          <div className="faq-item">
            <h3>¿Mis datos están seguros?</h3>
            <p>
              Sí. Tu workspace está aislado por Row-Level Security a nivel base de datos. Los
              tokens OAuth se guardan encriptados y nunca salen del backend. El plan Team agrega
              audit log + control granular.
            </p>
          </div>
          <div className="faq-item">
            <h3>¿Usas mis datos para entrenar IA?</h3>
            <p>
              No. Los modelos que usamos (OpenAI embeddings, Claude, Cohere rerank) están
              configurados para no retener data. Tus mails y docs nunca entran a un set de
              entrenamiento.
            </p>
          </div>
          <div className="faq-item">
            <h3>¿Puedo cancelar cuando quiera?</h3>
            <p>
              Sí, en cualquier momento. Si cancelas Pro, tu workspace queda en plan Personal (las
              fuentes pagas se pausan pero los datos siguen ahí).
            </p>
          </div>
          <div className="faq-item">
            <h3>¿Cómo funcionan los límites de nodos?</h3>
            <p>
              Cada chunk indexado (un párrafo de doc, un mail, un evento) cuenta como un nodo.
              Cuando llegas al límite del plan, las syncs nuevas se pausan hasta que upgrades o
              borres material viejo.
            </p>
          </div>
        </div>
      </section>

      <section className="cta-final">
        <h2>Empieza gratis. Sube cuando lo necesites.</h2>
        <Link href="/login" className="btn-big">
          Crear cuenta
        </Link>
      </section>

      <footer className="foot">
        <div>MyCortex · 2026</div>
        <div className="foot-links">
          <Link href="/">Inicio</Link>
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
          color: #fff;
          text-decoration: none;
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
        .hero {
          max-width: 720px;
          margin: 40px auto 50px;
          padding: 0 24px;
          text-align: center;
        }
        h1 {
          font-size: clamp(36px, 5vw, 52px);
          letter-spacing: -1.5px;
          margin: 0 0 14px;
          font-weight: 800;
        }
        .lead {
          color: #999;
          font-size: 17px;
          margin: 0;
          line-height: 1.55;
        }
        .tiers {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 24px 60px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
        }
        .tier {
          background: #0e0e14;
          border: 1px solid #1a1a22;
          border-radius: 16px;
          padding: 32px;
          position: relative;
          display: flex;
          flex-direction: column;
        }
        .tier.featured {
          background: linear-gradient(180deg, #0e0e1c 0%, #0a0a16 100%);
          border-color: #2a2a4a;
          box-shadow: 0 8px 40px -10px rgba(120, 90, 200, 0.25);
        }
        .tier-badge {
          position: absolute;
          top: -10px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(135deg, #8af, #b8f);
          color: #000;
          font-size: 10px;
          letter-spacing: 1.5px;
          padding: 4px 12px;
          border-radius: 99px;
          font-weight: 800;
        }
        .tier-name {
          font-size: 13px;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 700;
          margin-bottom: 12px;
        }
        .tier-price {
          font-size: 48px;
          font-weight: 800;
          letter-spacing: -2px;
          line-height: 1;
        }
        .per {
          font-size: 14px;
          color: #888;
          font-weight: 500;
          margin-left: 4px;
        }
        .tier-sub {
          color: #888;
          font-size: 13px;
          margin: 8px 0 24px;
          line-height: 1.45;
          min-height: 36px;
        }
        .tier-list {
          list-style: none;
          padding: 0;
          margin: 0 0 28px;
          flex: 1;
        }
        .tier-list li {
          color: #ccc;
          padding: 6px 0;
          font-size: 14px;
          border-top: 1px solid #15151c;
        }
        .tier-list li:first-child {
          border-top: none;
        }
        .tier-list :global(strong) {
          color: #fff;
        }
        :global(.btn-tier) {
          display: block;
          text-align: center;
          padding: 12px 20px;
          border-radius: 10px;
          font-weight: 700;
          font-size: 14px;
          text-decoration: none;
        }
        :global(.btn-tier.primary) {
          background: #fff;
          color: #000;
        }
        :global(.btn-tier.ghost) {
          background: transparent;
          color: #ccc;
          border: 1px solid #2a2a3a;
        }
        :global(.btn-tier):hover {
          opacity: 0.88;
        }
        .faq {
          max-width: 880px;
          margin: 0 auto;
          padding: 60px 24px;
        }
        .faq h2 {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -1px;
          margin: 0 0 32px;
          text-align: center;
        }
        .faq-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 20px;
        }
        .faq-item h3 {
          font-size: 16px;
          color: #fff;
          margin: 0 0 8px;
        }
        .faq-item p {
          color: #999;
          font-size: 14px;
          line-height: 1.55;
          margin: 0;
        }
        .cta-final {
          text-align: center;
          padding: 60px 24px 100px;
        }
        .cta-final h2 {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -1px;
          margin: 0 0 24px;
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

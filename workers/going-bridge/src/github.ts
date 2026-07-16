// Adaptador de GitHub: trae señales recientes del repo de Going (commits, PRs,
// estados de CI, alertas de seguridad) y las normaliza. Cada fetch es
// best-effort: si una fuente falla (p.ej. alertas sin permiso), se omite.

export type Signal = {
  externalId: string;
  type: 'commit' | 'pr' | 'ci' | 'security';
  title: string;
  body: string;
  severity?: string;
  url?: string;
  ts: string;
};

type GhCommit = {
  sha: string;
  html_url?: string;
  commit?: { message?: string; author?: { date?: string } };
};
type GhPull = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  merged_at?: string | null;
  updated_at: string;
  html_url?: string;
};
type GhRun = {
  id: number;
  name?: string;
  conclusion?: string | null;
  status?: string;
  head_branch?: string | null;
  created_at: string;
  html_url?: string;
};
type GhAlert = {
  number: number;
  html_url?: string;
  created_at?: string;
  state?: string;
  security_advisory?: { summary?: string };
  security_vulnerability?: { severity?: string };
  rule?: { description?: string; severity?: string };
};

async function gh<T>(repo: string, path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mycortex-going-bridge',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers });
  if (!res.ok) throw new Error(`gh ${path} ${res.status}`);
  return (await res.json()) as T;
}

/**
 * MyCortex es un coach personal, no un panel de ops. Un commit de mantenimiento
 * ("chore(deps): bump…", "fix(ci): regenera lockfile") no es una señal con peso
 * ejecutivo: no cambia una decisión ni mueve una meta. Solo mete ruido al corpus
 * y encarece los embeddings.
 */
const OPS_CHURN_COMMIT =
  /^(ci|build|chore|style|test|revert)(\([^)]*\))?!?:|^(fix|feat)\(ci\)|^merge (branch|pull request)|^bump |\[skip ci\]/i;

export function isOpsChurnCommit(message: string): boolean {
  return OPS_CHURN_COMMIT.test(message.trim());
}

export type FetchOptions = {
  /**
   * Corridas de workflow de GitHub Actions. Apagado por defecto: son el 71% del
   * corpus histórico y duplican el reporte de ops que ya llega por correo.
   */
  includeCi?: boolean;
};

export async function fetchGoingSignals(
  repo: string,
  token: string | undefined,
  sinceIso: string,
  opts: FetchOptions = {},
): Promise<Signal[]> {
  const signals: Signal[] = [];

  try {
    const commits = await gh<GhCommit[]>(repo, `/commits?since=${sinceIso}&per_page=30`, token);
    for (const c of commits) {
      const msg = c.commit?.message ?? '';
      if (isOpsChurnCommit(msg)) continue;
      signals.push({
        externalId: `commit:${c.sha}`,
        type: 'commit',
        title: msg.split('\n')[0]!.slice(0, 120),
        body: msg.slice(0, 1000),
        ts: c.commit?.author?.date ?? sinceIso,
        url: c.html_url,
      });
    }
  } catch {
    /* sin commits */
  }

  try {
    const pulls = await gh<GhPull[]>(repo, `/pulls?state=all&sort=updated&direction=desc&per_page=20`, token);
    for (const p of pulls) {
      signals.push({
        externalId: `pr:${p.number}`,
        type: 'pr',
        title: `PR #${p.number}: ${p.title}`,
        body: (p.body ?? '').slice(0, 1000),
        severity: p.merged_at ? 'merged' : p.state,
        ts: p.updated_at,
        url: p.html_url,
      });
    }
  } catch {
    /* sin PRs */
  }

  if (opts.includeCi) {
    try {
      const data = await gh<{ workflow_runs?: GhRun[] }>(repo, `/actions/runs?per_page=25`, token);
      for (const r of data.workflow_runs ?? []) {
        const failed = r.conclusion === 'failure' || r.conclusion === 'timed_out';
        // Una corrida verde no es noticia; solo los fallos entran, y como 'low'
        // (un CI roto se arregla en minutos — "high" se reserva a seguridad).
        if (!failed) continue;
        signals.push({
          externalId: `ci:${r.id}`,
          type: 'ci',
          title: `CI ${r.name ?? 'run'}: ${r.conclusion ?? r.status ?? '?'}`,
          body: `branch ${r.head_branch ?? '?'} — ${r.status ?? ''}/${r.conclusion ?? ''}`,
          severity: 'low',
          ts: r.created_at,
          url: r.html_url,
        });
      }
    } catch {
      /* sin CI */
    }
  }

  // Alertas de seguridad — requieren token con permisos; se omiten si dan 403.
  for (const kind of ['dependabot', 'code-scanning'] as const) {
    try {
      const alerts = await gh<GhAlert[]>(repo, `/${kind}/alerts?state=open&per_page=20`, token);
      for (const a of alerts) {
        const summary = a.security_advisory?.summary ?? a.rule?.description ?? `Alerta ${kind} #${a.number}`;
        const severity = a.security_vulnerability?.severity ?? a.rule?.severity ?? 'unknown';
        signals.push({
          externalId: `${kind}:${a.number}`,
          type: 'security',
          title: `🔴 Seguridad (${kind}): ${summary.slice(0, 100)}`,
          body: summary,
          severity,
          ts: a.created_at ?? sinceIso,
          url: a.html_url,
        });
      }
    } catch {
      /* sin permiso / sin alertas */
    }
  }

  return signals;
}

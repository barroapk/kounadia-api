import { Injectable, Logger } from '@nestjs/common';

const PAGE = 'https://scoregpt.app/ai-football-predictions/matchday';
const HOME = 'https://scoregpt.app/';
const UA = 'KOUNADIA-Bot/1.0 (+https://kounadia-api.onrender.com)';
const TTL = 3 * 3600 * 1000;
const RETRY = 10 * 60 * 1000;
const KEEP = 3 * 86400000;
const MAX_ENRICH = 10;

const LEAGUES: Record<string, string> = {
  'champions-league': 'Ligue des champions',
  'europa-league': 'Ligue Europa',
  'premier-league': 'Premier League',
  'la-liga': 'LaLiga',
  'serie-a': 'Serie A',
  'bundesliga': 'Bundesliga',
  'ligue-1': 'Ligue 1',
  'championship': 'Championship',
};

const title = (s: string) =>
  s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').trim();
const labelOf = (pickTeam: string) =>
  /^(draw|nul)/i.test(pickTeam.trim()) ? 'Match nul' : `Victoire ${decode(pickTeam)}`;

export interface SgMatch {
  date: string;
  league: string;
  leagueName: string;
  home: string;
  away: string;
  pick: 'home' | 'draw' | 'away';
  pickTeam: string;
  score: string;
  agree: number;
  models: number;
  url: string;
}

export interface SgResult {
  date: string;
  hasTime: boolean;
  leagueName: string;
  home: string;
  away: string;
  tipFr: string;
  predicted: string | null;
  score: string;
  won: boolean;
  url: string;
}

interface Known {
  label: string;
  predicted: string;
  date: string;
}

@Injectable()
export class ScoregptService {
  private readonly log = new Logger(ScoregptService.name);
  private cache: SgMatch[] = [];
  private cachedAt = 0;
  private results: SgResult[] = [];
  private resultsAt = 0;
  private known = new Map<string, Known>();

  async getToday() {
    if (Date.now() - this.cachedAt > TTL) {
      try {
        const r = await fetch(PAGE, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        this.cache = this.parse(await r.text());
        this.cachedAt = Date.now();
      } catch (e) {
        this.log.warn(`ScoreGPT indisponible : ${e}`);
        this.cachedAt = Date.now() - TTL + RETRY;
        if (!this.cache.length) throw e;
      }
    }
    return { source: 'ScoreGPT — https://scoregpt.app', matches: this.cache };
  }

  async getResults() {
    if (Date.now() - this.resultsAt > TTL) {
      try {
        try {
          await this.getToday();
        } catch {}
        const r = await fetch(HOME, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const fresh = this.parseResults(await r.text());
        await this.enrich(fresh);
        this.results = this.merge(fresh);
        this.resultsAt = Date.now();
      } catch (e) {
        this.log.warn(`ScoreGPT résultats indisponibles : ${e}`);
        this.resultsAt = Date.now() - TTL + RETRY;
        if (!this.results.length) throw e;
      }
    }
    return { source: 'ScoreGPT — https://scoregpt.app', results: this.results };
  }

  private apply(r: SgResult) {
    const k = this.known.get(r.url);
    if (!k) return;
    r.tipFr = k.label;
    r.predicted = k.predicted;
    if (k.date && !isNaN(new Date(k.date).getTime())) {
      r.date = new Date(k.date).toISOString();
      r.hasTime = true;
    }
  }

  private async enrich(list: SgResult[]) {
    let n = 0;
    for (const r of list) {
      if (this.known.has(r.url)) {
        this.apply(r);
        continue;
      }
      if (n >= MAX_ENRICH) continue;
      n++;
      try {
        const res = await fetch(r.url, { headers: { 'User-Agent': UA } });
        if (!res.ok) continue;
        const html = await res.text();
        const sc = html.match(/AI consensus predicted (\d+)–(\d+)/);
        if (!sc) continue;
        const win = html.match(/predicted ([^<"]+?) to win before kickoff/);
        const st = html.match(/"startDate":"([^"]+)"/);
        const label =
          win ? `Victoire ${decode(win[1])}` : sc[1] === sc[2] ? 'Match nul' : '';
        if (!label) continue;
        this.known.set(r.url, {
          label,
          predicted: `${sc[1]}-${sc[2]}`,
          date: st ? st[1] : '',
        });
        this.apply(r);
      } catch {}
    }
  }

  private merge(fresh: SgResult[]): SgResult[] {
    const map = new Map<string, SgResult>();
    for (const r of [...this.results, ...fresh]) map.set(r.url, r);
    const min = Date.now() - KEEP;
    return [...map.values()]
      .filter((r) => new Date(r.date).getTime() >= min)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  private parse(html: string): SgMatch[] {
    const re =
      /href="\/ai-football-predictions\/([a-z0-9-]+)\/([a-z0-9-]+)"><span class="sr-only">AI pick: ([^<]+?) — predicted (\d+)–(\d+), (\d+) of (\d+) models/g;
    const seen = new Set<string>();
    const out: SgMatch[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(html))) {
      const [, league, slug, pickRaw, hg, ag, agree, models] = m;
      const url = `https://scoregpt.app/ai-football-predictions/${league}/${slug}`;
      if (seen.has(url)) continue;
      seen.add(url);

      const t = html.lastIndexOf('dateTime="', m.index);
      const date = t >= 0 ? html.slice(t + 10, html.indexOf('"', t + 10)) : '';

      const teams = slug.replace(/-\d{4}-\d{2}-\d{2}$/, '').split('-vs-');
      let home = title(teams[0] ?? '');
      let away = title(teams[1] ?? '');
      const pickTeam = decode(pickRaw);
      const h = +hg;
      const a = +ag;
      const p = norm(pickTeam);

      let pick: SgMatch['pick'];
      if (/^(draw|nul)/i.test(pickTeam)) pick = 'draw';
      else if (p === norm(home)) pick = 'home';
      else if (p === norm(away)) pick = 'away';
      else pick = h > a ? 'home' : h < a ? 'away' : 'draw';

      if (pick === 'home') home = pickTeam;
      if (pick === 'away') away = pickTeam;

      this.known.set(url, { label: labelOf(pickTeam), predicted: `${h}-${a}`, date });

      out.push({
        date, league, leagueName: LEAGUES[league] ?? title(league),
        home, away, pick, pickTeam, score: `${h}-${a}`,
        agree: +agree, models: +models, url,
      });
    }

    return out.sort(
      (x, y) => y.agree / y.models - x.agree / x.models || x.date.localeCompare(y.date),
    );
  }

  private parseResults(html: string): SgResult[] {
    const re =
      /href="\/ai-football-predictions\/([a-z0-9-]+)\/([a-z0-9-]+)"><div[^>]*><span>FT<\/span><span[^>]*>(✓ Hit|✗ Miss)<\/span><\/div><div[^>]*><span>([^<]+)<\/span><strong>(\d+)<\/strong><\/div><div[^>]*><span>([^<]+)<\/span><strong>(\d+)<\/strong>/g;
    const seen = new Set<string>();
    const out: SgResult[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(html))) {
      const [, league, slug, hit, home, hg, away, ag] = m;
      const url = `https://scoregpt.app/ai-football-predictions/${league}/${slug}`;
      if (seen.has(url)) continue;
      seen.add(url);
      const d = slug.match(/(\d{4}-\d{2}-\d{2})$/);
      out.push({
        date: d ? `${d[1]}T12:00:00.000Z` : new Date().toISOString(),
        hasTime: false,
        leagueName: LEAGUES[league] ?? title(league),
        home: decode(home),
        away: decode(away),
        tipFr: 'Pronostic IA',
        predicted: null,
        score: `${hg}-${ag}`,
        won: hit.startsWith('✓'),
        url,
      });
    }
    return out;
  }
}

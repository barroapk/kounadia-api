import { Injectable, Logger } from '@nestjs/common';

const PAGE = 'https://scoregpt.app/ai-football-predictions/matchday';
const UA = 'KOUNADIA-Bot/1.0 (+https://kounadia-api.onrender.com)';
const TTL = 3 * 3600 * 1000;
const RETRY = 10 * 60 * 1000;

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

@Injectable()
export class ScoregptService {
  private readonly log = new Logger(ScoregptService.name);
  private cache: SgMatch[] = [];
  private cachedAt = 0;

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
    return {
      source: 'ScoreGPT — https://scoregpt.app',
      matches: this.cache,
    };
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
      const pickTeam = pickRaw.trim();
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
}

import { Injectable, Logger } from '@nestjs/common';

const PAGE = 'https://nerdytips.com/';
const UA = 'KOUNADIA-Bot/1.0 (+https://kounadia-api.onrender.com)';
const TTL = 3 * 3600 * 1000;
const RETRY = 10 * 60 * 1000;

export interface NtMatch {
  date: string;
  league: string;
  home: string;
  away: string;
  tip: string;
  tipFr: string;
  confidence: number | null;
  url: string;
}

@Injectable()
export class NerdytipsService {
  private readonly log = new Logger(NerdytipsService.name);
  private cache: NtMatch[] = [];
  private cachedAt = 0;

  async getToday() {
    if (Date.now() - this.cachedAt > TTL) {
      try {
        const r = await fetch(PAGE, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        this.cache = this.parse(await r.text());
        this.cachedAt = Date.now();
      } catch (e) {
        this.log.warn(`NerdyTips indisponible : ${e}`);
        this.cachedAt = Date.now() - TTL + RETRY;
        if (!this.cache.length) throw e;
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    return {
      source: 'NerdyTips — https://nerdytips.com',
      matches: this.cache.filter((m) => m.date.slice(0, 10) === today),
    };
  }

  private translate(tip: string, home: string, away: string): string {
    const t = tip.trim();
    const map: Record<string, string> = {
      '1': `Victoire ${home}`,
      'X': 'Match nul',
      '2': `Victoire ${away}`,
      '1X': `${home} ou nul`,
      'X2': `${away} ou nul`,
      '12': 'Pas de match nul',
      'GG': 'Les 2 équipes marquent : Oui',
      'NG': 'Les 2 équipes marquent : Non',
      'BTTS Yes': 'Les 2 équipes marquent : Oui',
      'BTTS No': 'Les 2 équipes marquent : Non',
    };
    if (map[t]) return map[t];
    const g = t.match(/^(Over|Under) ([\d.]+)/i);
    if (g) return `${/over/i.test(g[1]) ? 'Plus' : 'Moins'} de ${g[2].replace('.', ',')} buts`;
    return t;
  }

  private parse(html: string): NtMatch[] {
    // Note de confiance par match (texte caché du HTML)
    const conf = new Map<string, number>();
    const cre = /href="(\/match-details\/[a-z0-9-]+)"[^>]*>\s*<span class="sr-only">[^<]*?confidence ([\d.]+)\/10/g;
    let c: RegExpExecArray | null;
    while ((c = cre.exec(html))) conf.set(`https://nerdytips.com${c[1]}`, +c[2]);

    // Liste des pronostics gratuits (JSON-LD)
    const out: NtMatch[] = [];
    const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      let data: any;
      try { data = JSON.parse(m[1]); } catch { continue; }
      if (data['@type'] !== 'ItemList') continue;
      for (const el of data.itemListElement ?? []) {
        const it = el.item ?? {};
        const desc: string = it.description ?? '';
        const d = desc.match(/Predictions:\s*(.+?)\s+—\s+(.+)$/);
        if (!d || !it.startDate) continue;
        const home = it.homeTeam?.name ?? '';
        const away = it.awayTeam?.name ?? '';
        out.push({
          date: new Date(it.startDate).toISOString(),
          league: d[2],
          home, away,
          tip: d[1],
          tipFr: this.translate(d[1], home, away),
          confidence: conf.get(it.url) ?? null,
          url: it.url,
        });
      }
    }
    return out.sort((x, y) => (y.confidence ?? 0) - (x.confidence ?? 0) || x.date.localeCompare(y.date));
  }
}

import { Injectable, Logger } from '@nestjs/common';

const PAGE = 'https://nerdytips.com/';
const UA = 'KOUNADIA-Bot/1.0 (+https://kounadia-api.onrender.com)';
const TTL = 3 * 3600 * 1000;
const RETRY = 10 * 60 * 1000;
const KEEP = 3 * 86400000;

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').trim();

export interface NtMatch {
  date: string;
  league: string;
  home: string;
  away: string;
  tip: string;
  tipFr: string;
  confidence: number | null;
  url: string;
  homeLogo: string | null;
  awayLogo: string | null;
}

export interface NtResult {
  date: string;
  league: string;
  home: string;
  away: string;
  tipFr: string;
  score: string;
  won: boolean;
  url: string;
  homeLogo: string | null;
  awayLogo: string | null;
}

@Injectable()
export class NerdytipsService {
  private readonly log = new Logger(NerdytipsService.name);
  private cache: NtMatch[] = [];
  private results: NtResult[] = [];
  private cachedAt = 0;

  private async refresh() {
    if (Date.now() - this.cachedAt <= TTL) return;
    try {
      const r = await fetch(PAGE, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      this.cache = this.parse(html);
      this.results = this.merge(this.parseResults(html));
      this.cachedAt = Date.now();
    } catch (e) {
      this.log.warn(`NerdyTips indisponible : ${e}`);
      this.cachedAt = Date.now() - TTL + RETRY;
      if (!this.cache.length && !this.results.length) throw e;
    }
  }

  async getToday() {
    await this.refresh();
    const today = new Date().toISOString().slice(0, 10);
    return {
      source: 'NerdyTips — https://nerdytips.com',
      matches: this.cache.filter((m) => m.date.slice(0, 10) === today),
    };
  }

  async getResults() {
    await this.refresh();
    return { source: 'NerdyTips — https://nerdytips.com', results: this.results };
  }

  private merge(fresh: NtResult[]): NtResult[] {
    const map = new Map<string, NtResult>();
    for (const r of [...this.results, ...fresh]) map.set(r.url, r);
    const min = Date.now() - KEEP;
    return [...map.values()]
      .filter((r) => new Date(r.date).getTime() >= min)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  private logos(html: string): Map<string, [string, string]> {
    const map = new Map<string, [string, string]>();
    const re = /href="(\/match-details\/[a-z0-9-]+)"/g;
    const idx: { url: string; at: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) idx.push({ url: `https://nerdytips.com${m[1]}`, at: m.index });
    for (let i = 0; i < idx.length; i++) {
      if (map.has(idx[i].url)) continue;
      const end = i + 1 < idx.length ? idx[i + 1].at : idx[i].at + 4000;
      const imgs = html
        .slice(idx[i].at, end)
        .match(/https:\/\/cdn\.nerdytips\.com\/public\/img\/logos\/\d+\.webp/g);
      if (imgs && imgs.length >= 2) {
        map.set(idx[i].url, [`${imgs[0]}?width=96`, `${imgs[1]}?width=96`]);
      }
    }
    return map;
  }

  private translate(tip: string, home: string, away: string): string {
    const t = tip.trim();
    const l = t.toLowerCase();
    const yes = 'Les 2 équipes marquent : Oui';
    const no = 'Les 2 équipes marquent : Non';
    const map: Record<string, string> = {
      '1': `Victoire ${home}`,
      'x': 'Match nul',
      '2': `Victoire ${away}`,
      '1x': `${home} ou nul`,
      'x2': `${away} ou nul`,
      '12': 'Pas de match nul',
      'gg': yes,
      'ng': no,
      'btts yes': yes,
      'btts no': no,
      'both teams score': yes,
      'both teams to score': yes,
      'home team wins': `Victoire ${home}`,
      'away team wins': `Victoire ${away}`,
      'draw': 'Match nul',
      'home team wins or draw': `${home} ou nul`,
      'away team wins or draw': `${away} ou nul`,
      'home or away team wins': 'Pas de match nul',
    };
    if (map[l]) return map[l];
    let g = l.match(/^(over|under) ([\d.]+)/);
    if (g) return `${g[1] === 'over' ? 'Plus' : 'Moins'} de ${g[2].replace('.', ',')} buts`;
    g = l.match(/^at least (\d+) goals?/);
    if (g) return `Au moins ${g[1]} buts`;
    g = l.match(/^maximum (\d+)(?: total)? goals?/);
    if (g) return `Maximum ${g[1]} buts`;
    return t;
  }

  private parse(html: string): NtMatch[] {
    const conf = new Map<string, number>();
    const cre = /href="(\/match-details\/[a-z0-9-]+)"[^>]*>\s*<span class="sr-only">[^<]*?confidence ([\d.]+)\/10/g;
    let c: RegExpExecArray | null;
    while ((c = cre.exec(html))) conf.set(`https://nerdytips.com${c[1]}`, +c[2]);

    const logos = this.logos(html);
    const out: NtMatch[] = [];
    const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      let data: any;
      try {
        data = JSON.parse(m[1]);
      } catch {
        continue;
      }
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
          home,
          away,
          tip: d[1],
          tipFr: this.translate(d[1], home, away),
          confidence: conf.get(it.url) ?? null,
          url: it.url,
          homeLogo: logos.get(it.url)?.[0] ?? null,
          awayLogo: logos.get(it.url)?.[1] ?? null,
        });
      }
    }
    return out.sort(
      (x, y) => (y.confidence ?? 0) - (x.confidence ?? 0) || x.date.localeCompare(y.date),
    );
  }

  private parseResults(html: string): NtResult[] {
    const re =
      /href="\/match-details\/([^"]+)"[^>]*data-kick="([^"]*)"[^>]*>[\s\S]*?Best tip: ([^<.]+?)(?:, odds [\d.]+)?, confidence [\d.]+\/10\. Final score (\d+)[–-](\d+), tip (won|lost)\./gi;
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    const logos = this.logos(html);
    const out: NtResult[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(html))) {
      const [, slug, kick, tip, hg, ag, res] = m;
      const url = `https://nerdytips.com/match-details/${slug}`;
      if (seen.has(url)) continue;
      seen.add(url);

      const detail = html.slice(
        Math.max(0, m.index - 500),
        m.index + m[0].length,
      );
      const sr = detail.match(
        /<span class="sr-only">([^<]+?) vs ([^<]+?), ([^<]+?), kick-off/i,
      );
      const home = sr ? decode(sr[1]) : slug.split("-vs-")[0].replace(/-/g, " ");
      const away = sr
        ? decode(sr[2])
        : slug.split("-vs-")[1]?.replace(/-prediction-.*/, "").replace(/-/g, " ") ?? "Unknown";

      const date = new Date(`${today}T${kick || "12:00"}:00+01:00`);
      out.push({
        date: isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
        league: sr ? decode(sr[3]) : "",
        home,
        away,
        tipFr: this.translate(decode(tip), home, away),
        score: `${hg}-${ag}`,
        won: res.toLowerCase() === "won",
        url,
        homeLogo: logos.get(url)?.[0] ?? null,
        awayLogo: logos.get(url)?.[1] ?? null,
      });
    }
    return out;
  }
}

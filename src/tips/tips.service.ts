import { Injectable } from '@nestjs/common';

const URL = 'https://theopenmodel.com/data/fixtures-2026-27.csv';

@Injectable()
export class TipsService {
  private cache: any[] = [];
  private cachedAt = 0;

  async getTips(minProb = 0.6, days = 7) {
    if (Date.now() - this.cachedAt > 6 * 3600 * 1000) {
      const response = await fetch(URL);
      if (!response.ok) {
        throw new Error(`The Open Model HTTP ${response.status}`);
      }

      const csv = await response.text();

      this.cache = csv.trim().split('\n').slice(1).map((l) => {
        const c = l.split(',').map((v) => v.replace(/"/g, ''));
        const p = { home: +c[5], draw: +c[6], away: +c[7] };

        const pick = (Object.keys(p) as (keyof typeof p)[])
          .reduce((a, b) => (p[a] > p[b] ? a : b));

        return {
          date: c[0],
          league: c[1],
          home: c[3],
          away: c[4],
          pHome: p.home, pDraw: p.draw, pAway: p.away,
          pick,
          prob: p[pick],
        };
      });

      this.cachedAt = Date.now();
    }

    const now = new Date().toISOString();
    const max = new Date(Date.now() + days * 86400000).toISOString();

    return {
      source: 'The Open Model — https://theopenmodel.com — CC BY 4.0',
      tips: this.cache
        .filter((m) => m.date > now && m.date < max && m.prob >= minProb)
        .sort((a, b) => b.prob - a.prob),
    };
  }
}

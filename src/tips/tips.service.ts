import { Injectable } from '@nestjs/common';

const URL = 'https://theopenmodel.com/data/fixtures-2026-27.csv';
const r4 = (p: number) => Math.round(p * 10000) / 10000;

interface Market { code: string; label: string; prob: number }

@Injectable()
export class TipsService {
  private cache: any[] = [];
  private cachedAt = 0;

  private markets(home: string, away: string, pH: number, pD: number,
                  pA: number, xh: number, xa: number): Market[] {
    const L = xh + xa;
    const e = Math.exp(-L);
    const o15 = 1 - e * (1 + L);
    const o25 = 1 - e * (1 + L + (L * L) / 2);
    const btts = (1 - Math.exp(-xh)) * (1 - Math.exp(-xa));
    return [
      { code: '1', label: `Victoire ${home}`, prob: pH },
      { code: 'N', label: 'Match nul', prob: pD },
      { code: '2', label: `Victoire ${away}`, prob: pA },
      { code: '1N', label: `${home} ou nul`, prob: pH + pD },
      { code: 'N2', label: `${away} ou nul`, prob: pD + pA },
      { code: '12', label: 'Pas de match nul', prob: pH + pA },
      { code: 'O15', label: 'Plus de 1,5 buts', prob: o15 },
      { code: 'O25', label: 'Plus de 2,5 buts', prob: o25 },
      { code: 'U25', label: 'Moins de 2,5 buts', prob: 1 - o25 },
      { code: 'BTTS', label: 'Les 2 équipes marquent : Oui', prob: btts },
      { code: 'NOBTTS', label: 'Les 2 équipes marquent : Non', prob: 1 - btts },
    ];
  }

  async getTips(minProb = 0.6, days = 7, maxProb = 0.85) {
    if (Date.now() - this.cachedAt > 6 * 3600 * 1000) {
      const response = await fetch(URL);
      if (!response.ok) {
        throw new Error(`The Open Model HTTP ${response.status}`);
      }
      const csv = await response.text();
      this.cache = csv.trim().split('\n').slice(1).map((l) => {
        const c = l.split(',').map((v) => v.replace(/"/g, ''));
        const [pH, pD, pA, xh, xa] = [+c[5], +c[6], +c[7], +c[8], +c[9]];
        return {
          date: c[0], league: c[1], home: c[3], away: c[4],
          pHome: pH, pDraw: pD, pAway: pA, xgHome: xh, xgAway: xa,
          markets: this.markets(c[3], c[4], pH, pD, pA, xh, xa),
        };
      });
      this.cachedAt = Date.now();
    }

    const now = new Date().toISOString();
    const max = new Date(Date.now() + days * 86400000).toISOString();

    const tips = this.cache
      .filter((m) => m.date > now && m.date < max)
      .map(({ markets, ...m }) => {
        const best = (markets as Market[])
          .filter((x) => x.prob <= maxProb && !['1N', 'N2', '12', 'O15'].includes(x.code))
          .sort((a, b) => b.prob - a.prob)[0];
        return best
          ? { ...m, pick: best.code, label: best.label, prob: r4(best.prob) }
          : null;
      })
      .filter((m) => m !== null && m.prob >= minProb)
      .sort((a, b) => b!.prob - a!.prob);

    return {
      source: 'The Open Model — https://theopenmodel.com — CC BY 4.0',
      tips,
    };
  }
}

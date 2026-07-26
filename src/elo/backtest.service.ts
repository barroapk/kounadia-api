import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const DEFAULT_RATING = 1500;
const K_FACTOR = 20;
const PAGE_SIZE = 1000;

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(private supabase: SupabaseService) {}

  private goalDifferenceMultiplier(goalDiff: number): number {
    const absDiff = Math.abs(goalDiff);
    if (absDiff <= 1) return 1;
    if (absDiff === 2) return 1.5;
    return (11 + absDiff) / 8;
  }

  private async fetchMatches(competitionLike?: string): Promise<any[]> {
    const all: any[] = [];
    let from = 0;
    while (true) {
      let query = this.supabase.client
        .from('match_history')
        .select('*')
        .eq('status', 'FINISHED')
        .order('utc_date', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (competitionLike) query = query.ilike('competition', `%${competitionLike}%`);
      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  }

  async runBacktest(competitionLike?: string, homeAdvantage = 100, splitRatio = 0.6) {
    const matches = await this.fetchMatches(competitionLike);
    if (matches.length < 20) return { error: `Pas assez de matchs (${matches.length} trouvés)` };

    const splitIndex = Math.floor(matches.length * splitRatio);
    const trainMatches = matches.slice(0, splitIndex);
    const testMatches = matches.slice(splitIndex);

    const ratings = new Map<string, number>();
    const getRating = (t: string) => ratings.get(t) ?? DEFAULT_RATING;

    for (const m of trainMatches) {
      if (m.home_score === null || m.away_score === null) continue;
      const home = getRating(m.home_team);
      const away = getRating(m.away_team);
      const dr = home + homeAdvantage - away;
      const expectedHome = 1 / (Math.pow(10, -dr / 400) + 1);
      let actualHome: number;
      if (m.home_score > m.away_score) actualHome = 1;
      else if (m.home_score === m.away_score) actualHome = 0.5;
      else actualHome = 0;
      const g = this.goalDifferenceMultiplier(m.home_score - m.away_score);
      const change = K_FACTOR * g * (actualHome - expectedHome);
      ratings.set(m.home_team, home + change);
      ratings.set(m.away_team, away - change);
    }

    let correct = 0;
    let total = 0;
    let homeAlwaysCorrect = 0;

    for (const m of testMatches) {
      if (m.home_score === null || m.away_score === null) continue;
      const homeElo = getRating(m.home_team) + homeAdvantage;
      const awayElo = getRating(m.away_team);
      const actualResult = m.home_score > m.away_score ? 'HOME' : m.home_score < m.away_score ? 'AWAY' : 'DRAW';
      const prediction = homeElo > awayElo + 30 ? 'HOME' : awayElo > homeElo + 30 ? 'AWAY' : 'DRAW';
      if (prediction === actualResult) correct++;
      if (actualResult === 'HOME') homeAlwaysCorrect++;
      total++;
    }

    return {
      competition: competitionLike ?? 'TOUTES COMPETITIONS',
      homeAdvantage,
      trainMatches: trainMatches.length,
      testMatches: total,
      eloAccuracy: Math.round((correct / total) * 1000) / 10,
      homeAlwaysAccuracy: Math.round((homeAlwaysCorrect / total) * 1000) / 10,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const DEFAULT_RATING = 1500;
const HOME_ADVANTAGE = 100;
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

  private computeNewRatings(
    homeRating: number,
    awayRating: number,
    homeScore: number,
    awayScore: number,
  ) {
    const dr = homeRating + HOME_ADVANTAGE - awayRating;
    const expectedHome = 1 / (Math.pow(10, -dr / 400) + 1);
    let actualHome: number;
    if (homeScore > awayScore) actualHome = 1;
    else if (homeScore === awayScore) actualHome = 0.5;
    else actualHome = 0;
    const g = this.goalDifferenceMultiplier(homeScore - awayScore);
    const change = K_FACTOR * g * (actualHome - expectedHome);
    return { home: homeRating + change, away: awayRating - change };
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

      if (competitionLike) {
        query = query.ilike('competition', `%${competitionLike}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  }

  async runBacktest(competitionLike?: string, splitRatio = 0.6) {
    const matches = await this.fetchMatches(competitionLike);
    if (matches.length < 20) {
      return { error: `Pas assez de matchs (${matches.length} trouvés)` };
    }

    const splitIndex = Math.floor(matches.length * splitRatio);
    const trainMatches = matches.slice(0, splitIndex);
    const testMatches = matches.slice(splitIndex);

    const ratings = new Map<string, number>();
    const getRating = (t: string) => ratings.get(t) ?? DEFAULT_RATING;

    for (const m of trainMatches) {
      if (m.home_score === null || m.away_score === null) continue;
      const home = getRating(m.home_team);
      const away = getRating(m.away_team);
      const updated = this.computeNewRatings(home, away, m.home_score, m.away_score);
      ratings.set(m.home_team, updated.home);
      ratings.set(m.away_team, updated.away);
    }

    let eloCorrect = 0;
    let eloTotal = 0;
    let homeAlwaysCorrect = 0;

    for (const m of testMatches) {
      if (m.home_score === null || m.away_score === null) continue;
      const homeElo = getRating(m.home_team) + HOME_ADVANTAGE;
      const awayElo = getRating(m.away_team);

      const actualResult =
        m.home_score > m.away_score ? 'HOME' : m.home_score < m.away_score ? 'AWAY' : 'DRAW';

      const eloPrediction = homeElo > awayElo + 30 ? 'HOME' : awayElo > homeElo + 30 ? 'AWAY' : 'DRAW';

      if (eloPrediction === actualResult) eloCorrect++;
      if (actualResult === 'HOME') homeAlwaysCorrect++;
      eloTotal++;
    }

    return {
      competition: competitionLike ?? 'TOUTES COMPETITIONS',
      trainMatches: trainMatches.length,
      testMatches: eloTotal,
      eloAccuracy: Math.round((eloCorrect / eloTotal) * 1000) / 10,
      homeAlwaysAccuracy: Math.round((homeAlwaysCorrect / eloTotal) * 1000) / 10,
    };
  }
}

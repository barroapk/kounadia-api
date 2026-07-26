import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const DEFAULT_RATING = 1500;
const HOME_ADVANTAGE = 100;
const K_FACTOR = 20;

interface RatingUpdate {
  team: string;
  newRating: number;
}

@Injectable()
export class EloService {
  private readonly logger = new Logger(EloService.name);

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
  ): { home: number; away: number } {
    const dr = homeRating + HOME_ADVANTAGE - awayRating;
    const expectedHome = 1 / (Math.pow(10, -dr / 400) + 1);

    let actualHome: number;
    if (homeScore > awayScore) actualHome = 1;
    else if (homeScore === awayScore) actualHome = 0.5;
    else actualHome = 0;

    const goalDiff = homeScore - awayScore;
    const g = this.goalDifferenceMultiplier(goalDiff);

    const change = K_FACTOR * g * (actualHome - expectedHome);

    return {
      home: homeRating + change,
      away: awayRating - change,
    };
  }

  async initializeFromHistory(): Promise<{ teamsProcessed: number; matchesReplayed: number }> {
    const { data: matches, error } = await this.supabase.client
      .from('match_history')
      .select('*')
      .eq('status', 'FINISHED')
      .order('utc_date', { ascending: true });

    if (error) throw error;

    const ratings = new Map<string, { rating: number; matches: number }>();

    const getRating = (team: string) => {
      if (!ratings.has(team)) {
        ratings.set(team, { rating: DEFAULT_RATING, matches: 0 });
      }
      return ratings.get(team)!;
    };

    for (const m of matches) {
      if (m.home_score === null || m.away_score === null) continue;

      const home = getRating(m.home_team);
      const away = getRating(m.away_team);

      const updated = this.computeNewRatings(
        home.rating,
        away.rating,
        m.home_score,
        m.away_score,
      );

      home.rating = updated.home;
      home.matches += 1;
      away.rating = updated.away;
      away.matches += 1;
    }

    const rows = Array.from(ratings.entries()).map(([team_name, v]) => ({
      team_name,
      rating: Math.round(v.rating * 10) / 10,
      matches_played: v.matches,
    }));

    const { error: upsertError } = await this.supabase.client
      .from('team_ratings')
      .upsert(rows, { onConflict: 'team_name' });

    if (upsertError) throw upsertError;

    this.logger.log(`${rows.length} équipes notées à partir de ${matches.length} matchs`);
    return { teamsProcessed: rows.length, matchesReplayed: matches.length };
  }

  async getRating(teamName: string): Promise<number> {
    const { data } = await this.supabase.client
      .from('team_ratings')
      .select('rating')
      .eq('team_name', teamName)
      .maybeSingle();

    return data?.rating ?? DEFAULT_RATING;
  }
}

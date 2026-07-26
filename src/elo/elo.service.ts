import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const DEFAULT_RATING = 1500;
const DEFAULT_HOME_ADVANTAGE = 100;
const K_FACTOR = 20;
const K_HOME_ADVANTAGE = 4;
const PAGE_SIZE = 1000;

interface TeamState {
  rating: number;
  homeAdvantage: number;
  matches: number;
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

  private async fetchAllFinishedMatches(): Promise<any[]> {
    const all: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await this.supabase.client
        .from('match_history')
        .select('*')
        .eq('status', 'FINISHED')
        .order('utc_date', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  }

  async initializeFromHistory(): Promise<{ teamsProcessed: number; matchesReplayed: number }> {
    const matches = await this.fetchAllFinishedMatches();
    const states = new Map<string, TeamState>();

    const getState = (team: string) => {
      if (!states.has(team)) {
        states.set(team, {
          rating: DEFAULT_RATING,
          homeAdvantage: DEFAULT_HOME_ADVANTAGE,
          matches: 0,
        });
      }
      return states.get(team)!;
    };

    for (const m of matches) {
      if (m.home_score === null || m.away_score === null) continue;

      const home = getState(m.home_team);
      const away = getState(m.away_team);

      const dr = home.rating + home.homeAdvantage - away.rating;
      const expectedHome = 1 / (Math.pow(10, -dr / 400) + 1);

      let actualHome: number;
      if (m.home_score > m.away_score) actualHome = 1;
      else if (m.home_score === m.away_score) actualHome = 0.5;
      else actualHome = 0;

      const g = this.goalDifferenceMultiplier(m.home_score - m.away_score);
      const surprise = actualHome - expectedHome;

      home.rating += K_FACTOR * g * surprise;
      away.rating -= K_FACTOR * g * surprise;

      // L'avantage domicile de CETTE équipe évolue lentement,
      // ancré sur la moyenne générale tant que peu de matchs sont disponibles.
      home.homeAdvantage += K_HOME_ADVANTAGE * g * surprise;

      home.matches += 1;
      away.matches += 1;
    }

    const rows = Array.from(states.entries()).map(([team_name, s]) => ({
      team_name,
      rating: Math.round(s.rating * 10) / 10,
      home_advantage: Math.round(s.homeAdvantage * 10) / 10,
      matches_played: s.matches,
    }));

    const { error } = await this.supabase.client
      .from('team_ratings')
      .upsert(rows, { onConflict: 'team_name' });

    if (error) throw error;

    this.logger.log(`${rows.length} équipes notées à partir de ${matches.length} matchs`);
    return { teamsProcessed: rows.length, matchesReplayed: matches.length };
  }

  async getRating(teamName: string): Promise<{ rating: number; homeAdvantage: number }> {
    const { data } = await this.supabase.client
      .from('team_ratings')
      .select('rating, home_advantage')
      .eq('team_name', teamName)
      .maybeSingle();

    return {
      rating: data?.rating ?? DEFAULT_RATING,
      homeAdvantage: data?.home_advantage ?? DEFAULT_HOME_ADVANTAGE,
    };
  }
}

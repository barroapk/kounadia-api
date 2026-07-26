import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const DEFAULT_RATING = 1500;
const K_FACTOR = 20;
const PAGE_SIZE = 1000;

interface TeamState {
  homeRating: number;
  awayRating: number;
  homeMatches: number;
  awayMatches: number;
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
          homeRating: DEFAULT_RATING,
          awayRating: DEFAULT_RATING,
          homeMatches: 0,
          awayMatches: 0,
        });
      }
      return states.get(team)!;
    };

    for (const m of matches) {
      if (m.home_score === null || m.away_score === null) continue;

      const home = getState(m.home_team);
      const away = getState(m.away_team);

      const dr = home.homeRating - away.awayRating;
      const expectedHome = 1 / (Math.pow(10, -dr / 400) + 1);

      let actualHome: number;
      if (m.home_score > m.away_score) actualHome = 1;
      else if (m.home_score === m.away_score) actualHome = 0.5;
      else actualHome = 0;

      const g = this.goalDifferenceMultiplier(m.home_score - m.away_score);
      const change = K_FACTOR * g * (actualHome - expectedHome);

      home.homeRating += change;
      home.homeMatches += 1;
      away.awayRating -= change;
      away.awayMatches += 1;
    }

    const rows = Array.from(states.entries()).map(([team_name, s]) => ({
      team_name,
      home_rating: Math.round(s.homeRating * 10) / 10,
      away_rating: Math.round(s.awayRating * 10) / 10,
      home_matches: s.homeMatches,
      away_matches: s.awayMatches,
    }));

    const { error } = await this.supabase.client
      .from('team_ratings')
      .upsert(rows, { onConflict: 'team_name' });

    if (error) throw error;

    this.logger.log(`${rows.length} équipes notées à partir de ${matches.length} matchs`);
    return { teamsProcessed: rows.length, matchesReplayed: matches.length };
  }

  async getRatings(teamName: string): Promise<{ homeRating: number; awayRating: number; homeMatches: number; awayMatches: number }> {
    const { data } = await this.supabase.client
      .from('team_ratings')
      .select('home_rating, away_rating, home_matches, away_matches')
      .eq('team_name', teamName)
      .maybeSingle();

    return {
      homeRating: data?.home_rating ?? DEFAULT_RATING,
      awayRating: data?.away_rating ?? DEFAULT_RATING,
      homeMatches: data?.home_matches ?? 0,
      awayMatches: data?.away_matches ?? 0,
    };
  }
}

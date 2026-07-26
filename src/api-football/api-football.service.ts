import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';

const CACHE_DAYS = 30;

@Injectable()
export class ApiFootballService {
  private readonly baseUrl = 'https://v3.football.api-sports.io';

  constructor(
    private http: HttpService,
    private config: ConfigService,
    private supabase: SupabaseService,
  ) {}

  private get headers() {
    return {
      'x-apisports-key': this.config.get<string>('API_FOOTBALL_KEY'),
    };
  }

  async searchTeam(teamName: string): Promise<number> {
    const { data: cached } = await this.supabase.client
      .from('team_mappings')
      .select('api_football_id')
      .eq('team_name', teamName)
      .maybeSingle();

    if (cached) {
      return cached.api_football_id;
    }

    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/teams`, {
        headers: this.headers,
        params: { search: teamName },
      }),
    );

    if (!response.data.response.length) {
      throw new Error(`Équipe introuvable : ${teamName}`);
    }

    const id = response.data.response[0].team.id;

    await this.supabase.client
      .from('team_mappings')
      .insert({ team_name: teamName, api_football_id: id });

    return id;
  }

  async getHeadToHead(teamAName: string, teamBName: string) {
    const idA = await this.searchTeam(teamAName);
    const idB = await this.searchTeam(teamBName);

    const [team1Id, team2Id] = [idA, idB].sort((a, b) => a - b);

    const { data: cached } = await this.supabase.client
      .from('head_to_head_cache')
      .select('*')
      .eq('team1_id', team1Id)
      .eq('team2_id', team2Id)
      .maybeSingle();

    if (cached) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < CACHE_DAYS) {
        return cached.data;
      }
    }

    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/fixtures/headtohead`, {
        headers: this.headers,
        params: { h2h: `${team1Id}-${team2Id}`, last: 10 },
      }),
    );

    const fixtures = response.data.response;
    const summary = {
      totalMatches: fixtures.length,
      team1Wins: 0,
      team2Wins: 0,
      draws: 0,
      lastMeetingDate: fixtures[0]?.fixture?.date ?? null,
    };

    for (const f of fixtures) {
      const homeId = f.teams.home.id;
      const homeWinner = f.teams.home.winner;
      const awayWinner = f.teams.away.winner;

      if (homeWinner === true) {
        if (homeId === team1Id) summary.team1Wins++;
        else summary.team2Wins++;
      } else if (awayWinner === true) {
        if (homeId === team1Id) summary.team2Wins++;
        else summary.team1Wins++;
      } else {
        summary.draws++;
      }
    }

    await this.supabase.client.from('head_to_head_cache').upsert(
      {
        team1_id: team1Id,
        team2_id: team2Id,
        data: summary,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'team1_id,team2_id' },
    );

    return summary;
  }
}

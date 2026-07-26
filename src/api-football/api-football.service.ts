import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';

const CACHE_DAYS = 30;

export interface LiveMinuteInfo {
  homeTeam: string;
  awayTeam: string;
  label: string;
}

const COMMON_PREFIXES_SUFFIXES = [
  'fc', 'cr', 'ec', 'sc', 'se', 'ca', 'ac', 'afc', 'cf', 'fbpa', 'rb', 'fbc',
];

const TEAM_CANONICAL: Record<string, string> = {
  'camineiro': 'atleticomg',
  'atleticomg': 'atleticomg',
  'atleticomineiro': 'atleticomg',
};

@Injectable()
export class ApiFootballService {
  private readonly logger = new Logger(ApiFootballService.name);
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

    if (cached) return cached.api_football_id;

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
      const ageDays =
        (Date.now() - new Date(cached.fetched_at).getTime()) /
        (1000 * 60 * 60 * 24);
      if (ageDays < CACHE_DAYS) return cached.data;
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
      if (f.teams.home.winner === true) {
        homeId === team1Id ? summary.team1Wins++ : summary.team2Wins++;
      } else if (f.teams.away.winner === true) {
        homeId === team1Id ? summary.team2Wins++ : summary.team1Wins++;
      } else {
        summary.draws++;
      }
    }

    await this.supabase.client.from('head_to_head_cache').upsert(
      { team1_id: team1Id, team2_id: team2Id, data: summary, fetched_at: new Date().toISOString() },
      { onConflict: 'team1_id,team2_id' },
    );

    return summary;
  }

  private formatMinuteLabel(status: { short: string; elapsed: number | null; extra: number | null }): string {
    if (status.short === 'HT') return 'MT';
    if (['1H', '2H'].includes(status.short)) {
      const base = status.elapsed ?? 0;
      return status.extra ? `${base}+${status.extra}'` : `${base}'`;
    }
    return status.short;
  }

  private cleanText(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private canonicalize(name: string): string {
    const cleanedJoined = this.cleanText(name).replace(/\s+/g, '');
    if (TEAM_CANONICAL[cleanedJoined]) return TEAM_CANONICAL[cleanedJoined];

    const words = this.cleanText(name)
      .split(' ')
      .filter((w) => !COMMON_PREFIXES_SUFFIXES.includes(w));

    return words.join('');
  }

  async getLiveMinutes(): Promise<LiveMinuteInfo[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/fixtures`, {
        headers: this.headers,
        params: { live: 'all' },
      }),
    );

    return response.data.response.map((f: any) => ({
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      label: this.formatMinuteLabel(f.fixture.status),
    }));
  }

  findMinuteFor(
    liveMinutes: LiveMinuteInfo[],
    homeTeam: string,
    awayTeam: string,
  ): string | null {
    const nHome = this.canonicalize(homeTeam);
    const nAway = this.canonicalize(awayTeam);

    const match = liveMinutes.find((m) => {
      const mHome = this.canonicalize(m.homeTeam);
      const mAway = this.canonicalize(m.awayTeam);
      return (
        (mHome.includes(nHome) || nHome.includes(mHome)) &&
        (mAway.includes(nAway) || nAway.includes(mAway))
      );
    });

    if (!match) {
      this.logger.warn(
        `Aucune correspondance pour "${homeTeam}" vs "${awayTeam}" (canonique: ${nHome}/${nAway}). ` +
        `Matchs en direct disponibles: ${liveMinutes.map((m) => `${m.homeTeam} vs ${m.awayTeam}`).join(' | ')}`,
      );
    }

    return match?.label ?? null;
  }
}

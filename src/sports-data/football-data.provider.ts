import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Match, SportsDataProvider, StandingRow } from './sports-data-provider.interface';
import { HIERARCHY_BY_FOOTBALL_DATA_CODE } from '../config/competition-hierarchy';

@Injectable()
export class FootballDataProvider implements SportsDataProvider {
  private readonly baseUrl = 'https://api.football-data.org/v4';

  constructor(
    private http: HttpService,
    private configService: ConfigService,
  ) {}

  private get headers() {
    const token = this.configService.get<string>('FOOTBALL_DATA_API_KEY');
    return { 'X-Auth-Token': token };
  }

  private mapMatch(m: any): Match {
    return {
      id: m.id,
      competition: m.competition?.name ?? '',
      homeTeam: m.homeTeam?.name ?? '',
      awayTeam: m.awayTeam?.name ?? '',
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
      status: m.status,
      minute: m.minute ?? null,
      utcDate: m.utcDate,
      homeTeamCrest: m.homeTeam?.crest ?? null,
      awayTeamCrest: m.awayTeam?.crest ?? null,
      competitionEmblem: m.competition?.emblem ?? null,
      provider: 'football-data' as const,
      competitionCode: m.competition?.code ?? null,
      continent: HIERARCHY_BY_FOOTBALL_DATA_CODE[m.competition?.code]?.continent ?? 'Autre',
      country: HIERARCHY_BY_FOOTBALL_DATA_CODE[m.competition?.code]?.country ?? 'Autre',
      matchday: m.matchday ?? null,
      venue: m.venue ?? null,
      referee: m.referees?.[0]?.name ?? null,
    };
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  async getLiveMatches(): Promise<Match[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/matches?status=LIVE`, { headers: this.headers }),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }

  async getTodayMatches(): Promise<Match[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/matches`, { headers: this.headers }),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }

  async getRecentFinishedMatches(days: number): Promise<Match[]> {
    const safeDays = Math.min(days, 10);
    const dateTo = new Date();
    const dateFrom = new Date(Date.now() - safeDays * 86400000);

    const response = await firstValueFrom(
      this.http.get(
        `${this.baseUrl}/matches?dateFrom=${this.formatDate(dateFrom)}&dateTo=${this.formatDate(dateTo)}&status=FINISHED`,
        { headers: this.headers },
      ),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }

  async getMatchById(id: number): Promise<Match> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/matches/${id}`, { headers: this.headers }),
    );
    return this.mapMatch(response.data);
  }

  async getMatchesByDate(date: string): Promise<Match[]> {
    const requestedDate = new Date(date + 'T00:00:00Z');
    const dateTo = new Date(requestedDate.getTime() + 86400000);

    const response = await firstValueFrom(
      this.http.get(
        `${this.baseUrl}/matches?dateFrom=${date}&dateTo=${this.formatDate(dateTo)}`,
        { headers: this.headers },
      ),
    );

    return response.data.matches
      .map((m) => this.mapMatch(m))
      .filter((m) => m.utcDate.startsWith(date));
  }

  async getStandings(competitionCode: string, season?: string): Promise<StandingRow[]> {
    const seasonParam = season ? `?season=${season}` : '';
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/competitions/${competitionCode}/standings${seasonParam}`, {
        headers: this.headers,
      }),
    );

    const totalTable = response.data.standings.find((s: any) => s.type === 'TOTAL');
    if (!totalTable) return [];

    return totalTable.table.map((row: any) => ({
      position: row.position,
      teamName: row.team.name,
      teamCrest: row.team.crest ?? null,
      playedGames: row.playedGames,
      won: row.won,
      draw: row.draw,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      goalDifference: row.goalDifference,
      points: row.points,
    }));
  }

  async getSeasonMatches(competitionCode: string): Promise<Match[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/competitions/${competitionCode}/matches`, {
        headers: this.headers,
      }),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }
}

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Match, SportsDataProvider } from './sports-data-provider.interface';

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
    };
  }

  async getLiveMatches(): Promise<Match[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/matches?status=LIVE`, {
        headers: this.headers,
      }),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }

  async getTodayMatches(): Promise<Match[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/matches`, {
        headers: this.headers,
      }),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }
}

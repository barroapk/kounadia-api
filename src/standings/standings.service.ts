import { Injectable, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type { SportsDataProvider, StandingRow } from '../sports-data/sports-data-provider.interface';

export interface SeasonInfo {
  startYear: string;
  label: string;
}

export interface StandingsResponse {
  competitionCode: string;
  competitionName: string;
  competitionEmblem: string | null;
  season: string | null;
  availableSeasons: SeasonInfo[];
  totalTeams: number;
  lastUpdated: string;
  standings: StandingRow[];
}

interface CacheEntry {
  data: StandingsResponse;
  expiresAt: number;
}

@Injectable()
export class StandingsService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000;
  private readonly baseUrl = 'https://api.football-data.org/v4';

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
    private http: HttpService,
    private config: ConfigService,
  ) {}

  async getStandings(competitionCode: string, season?: string): Promise<StandingsResponse> {
    const cacheKey = `${competitionCode}-${season ?? 'current'}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const rows = await this.sportsDataProvider.getStandings(competitionCode, season);

    let competitionName = competitionCode;
    let competitionEmblem: string | null = null;
    let resolvedSeason: string | null = season ?? null;
    let availableSeasons: SeasonInfo[] = [];

    try {
      const headers = { 'X-Auth-Token': this.config.get<string>('FOOTBALL_DATA_API_KEY') };
      const detail = await firstValueFrom(
        this.http.get(`${this.baseUrl}/competitions/${competitionCode}`, { headers }),
      );
      competitionName = detail.data.name ?? competitionCode;
      competitionEmblem = detail.data.emblem ?? null;

      const seasons = detail.data.seasons ?? [];
      availableSeasons = seasons
        .map((s: any) => {
          const startYear = s.startDate?.slice(0, 4);
          const endYear = s.endDate?.slice(0, 4);
          if (!startYear) return null;
          const label = endYear && endYear !== startYear ? `${startYear}-${endYear}` : startYear;
          return { startYear, label };
        })
        .filter((s: SeasonInfo | null) => s !== null)
        .sort((a: SeasonInfo, b: SeasonInfo) => Number(b.startYear) - Number(a.startYear));

      if (!resolvedSeason) {
        const startYear = detail.data.currentSeason?.startDate?.slice(0, 4);
        const endYear = detail.data.currentSeason?.endDate?.slice(0, 4);
        if (startYear) {
          resolvedSeason = endYear && endYear !== startYear ? `${startYear}-${endYear}` : startYear;
        }
      }
    } catch {
      // On continue avec des valeurs par défaut plutôt que de tout faire échouer.
    }

    const response: StandingsResponse = {
      competitionCode,
      competitionName,
      competitionEmblem,
      season: resolvedSeason,
      availableSeasons,
      totalTeams: rows.length,
      lastUpdated: new Date().toISOString(),
      standings: rows,
    };

    this.cache.set(cacheKey, { data: response, expiresAt: now + this.CACHE_DURATION_MS });
    return response;
  }
}

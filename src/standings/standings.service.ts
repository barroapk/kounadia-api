import { Injectable, Inject } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type { SportsDataProvider, StandingRow } from '../sports-data/sports-data-provider.interface';

export interface StandingsResponse {
  competitionCode: string;
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
  private readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 heures

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
  ) {}

  async getStandings(competitionCode: string): Promise<StandingsResponse> {
    const cached = this.cache.get(competitionCode);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    try {
      const rows = await this.sportsDataProvider.getStandings(competitionCode);
      const response: StandingsResponse = {
        competitionCode,
        lastUpdated: new Date().toISOString(),
        standings: rows,
      };
      this.cache.set(competitionCode, { data: response, expiresAt: now + this.CACHE_DURATION_MS });
      return response;
    } catch (error) {
      if (cached) return cached.data;
      throw error;
    }
  }
}

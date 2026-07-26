import { Inject, Injectable } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type {
  SportsDataProvider,
  Match,
} from '../sports-data/sports-data-provider.interface';

interface CacheEntry {
  data: Match[];
  expiresAt: number;
}

@Injectable()
export class MatchesService {
  private liveCache: CacheEntry | null = null;
  private todayCache: CacheEntry | null = null;
  private byDateCache = new Map<string, CacheEntry>();
  private readonly CACHE_DURATION_MS = 30000;
  private readonly DATE_CACHE_DURATION_MS = 300000;

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
  ) {}

  async getLiveMatches() {
    return this.getWithCache('live', () =>
      this.sportsDataProvider.getLiveMatches(),
    );
  }

  async getTodayMatches() {
    return this.getWithCache('today', () =>
      this.sportsDataProvider.getTodayMatches(),
    );
  }

  async getMatchesByDate(date: string): Promise<Match[]> {
    const now = Date.now();
    const cache = this.byDateCache.get(date);

    if (cache && cache.expiresAt > now) {
      console.log(`[CACHE HIT] date:${date}`);
      return cache.data;
    }

    try {
      console.log(`[API FETCH] date:${date}`);
      const data = await this.sportsDataProvider.getMatchesByDate(date);
      this.byDateCache.set(date, {
        data,
        expiresAt: now + this.DATE_CACHE_DURATION_MS,
      });
      return data;
    } catch (error) {
      if (cache) return cache.data;
      throw error;
    }
  }

  private async getWithCache(
    key: 'live' | 'today',
    fetchFn: () => Promise<Match[]>,
  ): Promise<Match[]> {
    const cache = key === 'live' ? this.liveCache : this.todayCache;
    const now = Date.now();

    if (cache && cache.expiresAt > now) {
      console.log(`[CACHE HIT] ${key}`);
      return cache.data;
    }

    try {
      console.log(`[API FETCH] ${key}`);
      const data = await fetchFn();
      const entry = { data, expiresAt: now + this.CACHE_DURATION_MS };
      if (key === 'live') this.liveCache = entry;
      else this.todayCache = entry;
      return data;
    } catch (error) {
      if (cache) {
        return cache.data;
      }
      throw error;
    }
  }
}

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
  private readonly CACHE_DURATION_MS = 30000;

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

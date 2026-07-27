import { Inject, Injectable, Logger } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type {
  SportsDataProvider,
  Match,
} from '../sports-data/sports-data-provider.interface';
import { ApiFootballService } from '../api-football/api-football.service';

const LIVE_STATUSES = ['LIVE', 'IN_PLAY', 'PAUSED'];

interface CacheEntry {
  data: Match[];
  expiresAt: number;
}

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);
  private liveCache: CacheEntry | null = null;
  private todayCache: CacheEntry | null = null;
  private byDateCache = new Map<string, CacheEntry>();
  private readonly CACHE_DURATION_MS = 30000;
  private readonly DATE_CACHE_DURATION_MS = 300000;

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
    private apiFootball: ApiFootballService,
  ) {}

  private async enrichWithLiveMinutes(matches: Match[]): Promise<Match[]> {
    const hasLive = matches.some((m) => LIVE_STATUSES.includes(m.status));
    if (!hasLive) return matches;

    try {
      const liveMinutes = await this.apiFootball.getLiveMinutes();
      return matches.map((m) => {
        if (!LIVE_STATUSES.includes(m.status)) return m;
        const label = this.apiFootball.findMinuteFor(
          liveMinutes,
          m.homeTeam,
          m.awayTeam,
        );
        return { ...m, liveMinuteLabel: label };
      });
    } catch (error) {
      this.logger.warn(`Minutes en direct indisponibles: ${error.message}`);
      return matches;
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  async getLiveMatches() {
    const matches = await this.getWithCache('live', () =>
      this.sportsDataProvider.getLiveMatches(),
    );
    return this.enrichWithLiveMinutes(matches);
  }

  /**
   * "Aujourd'hui" = matchs dont la date correspond au jour calendaire actuel,
   * PLUS les matchs d'hier encore en direct (cas fréquent : compétitions
   * sud-américaines qui débutent après 21h UTC et se terminent après minuit).
   * Sans ça, un match suivi en direct disparaît brutalement de l'écran au
   * passage de minuit, alors qu'il est toujours en cours.
   */
  async getTodayMatches() {
    return this.getWithCache('today', async () => {
      const today = this.formatDate(new Date());
      const yesterday = this.formatDate(new Date(Date.now() - 86400000));

      const [todayMatches, yesterdayMatches] = await Promise.all([
        this.sportsDataProvider.getMatchesByDate(today),
        this.sportsDataProvider.getMatchesByDate(yesterday),
      ]);

      const stillLiveFromYesterday = yesterdayMatches.filter((m) =>
        LIVE_STATUSES.includes(m.status),
      );

      return [...todayMatches, ...stillLiveFromYesterday];
    }).then((matches) => this.enrichWithLiveMinutes(matches));
  }

  async getMatchesByDate(date: string): Promise<Match[]> {
    const now = Date.now();
    const cache = this.byDateCache.get(date);

    if (cache && cache.expiresAt > now) {
      return this.enrichWithLiveMinutes(cache.data);
    }

    try {
      const data = await this.sportsDataProvider.getMatchesByDate(date);
      this.byDateCache.set(date, {
        data,
        expiresAt: now + this.DATE_CACHE_DURATION_MS,
      });
      return this.enrichWithLiveMinutes(data);
    } catch (error) {
      if (cache) return this.enrichWithLiveMinutes(cache.data);
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
      return cache.data;
    }

    try {
      const data = await fetchFn();
      const entry = { data, expiresAt: now + this.CACHE_DURATION_MS };
      if (key === 'live') this.liveCache = entry;
      else this.todayCache = entry;
      return data;
    } catch (error) {
      if (cache) return cache.data;
      throw error;
    }
  }
}

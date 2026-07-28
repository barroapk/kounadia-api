import { Inject, Injectable, Logger } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type {
  SportsDataProvider,
  Match,
} from '../sports-data/sports-data-provider.interface';
import { ApiFootballService } from '../api-football/api-football.service';
import { ExtraCompetitionsService } from '../extra-competitions/extra-competitions.service';

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
    private extraCompetitions: ExtraCompetitionsService,
  ) {}

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /** Isole chaque source : une panne sur l'une n'empêche jamais l'autre de fonctionner. */
  private async safeFetch<T>(label: string, fetchFn: () => Promise<T[]>): Promise<T[]> {
    try {
      return await fetchFn();
    } catch (error) {
      this.logger.error(`Source "${label}" indisponible: ${error.message}`);
      return [];
    }
  }

  private async enrichWithLiveMinutes(matches: Match[]): Promise<Match[]> {
    const footballDataMatches = matches.filter((m) => m.provider === 'football-data');
    const hasLive = footballDataMatches.some((m) => LIVE_STATUSES.includes(m.status));
    if (!hasLive) return matches;

    try {
      const liveMinutes = await this.apiFootball.getLiveMinutes();
      return matches.map((m) => {
        if (m.provider !== 'football-data' || !LIVE_STATUSES.includes(m.status)) {
          return m;
        }
        const label = this.apiFootball.findMinuteFor(liveMinutes, m.homeTeam, m.awayTeam);
        return { ...m, liveMinuteLabel: label };
      });
    } catch (error) {
      this.logger.warn(`Minutes en direct indisponibles: ${error.message}`);
      return matches;
    }
  }

  async getLiveMatches() {
    const cache = this.liveCache;
    const now = Date.now();

    if (cache && cache.expiresAt > now) {
      return cache.data;
    }

    const [footballDataLive, extraToday] = await Promise.all([
      this.safeFetch('football-data live', () => this.sportsDataProvider.getLiveMatches()),
      this.safeFetch('api-football extra', () =>
        this.extraCompetitions.getMatchesForDate(this.formatDate(new Date())),
      ),
    ]);

    const extraLive = extraToday.filter((m) => LIVE_STATUSES.includes(m.status));
    const combined = [...footballDataLive, ...extraLive];
    this.liveCache = { data: combined, expiresAt: now + this.CACHE_DURATION_MS };
    return this.enrichWithLiveMinutes(combined);
  }

  async getTodayMatches() {
    const cache = this.todayCache;
    const now = Date.now();

    if (cache && cache.expiresAt > now) {
      return this.enrichWithLiveMinutes(cache.data);
    }

    const today = this.formatDate(new Date());
    const yesterday = this.formatDate(new Date(Date.now() - 86400000));

    const [footballDataToday, footballDataYesterday, extraToday] = await Promise.all([
      this.safeFetch('football-data today', () => this.sportsDataProvider.getMatchesByDate(today)),
      this.safeFetch('football-data yesterday', () => this.sportsDataProvider.getMatchesByDate(yesterday)),
      this.safeFetch('api-football extra', () => this.extraCompetitions.getMatchesForDate(today)),
    ]);

    const stillLiveFromYesterday = footballDataYesterday.filter((m) =>
      LIVE_STATUSES.includes(m.status),
    );

    const combined = [...footballDataToday, ...stillLiveFromYesterday, ...extraToday];
    this.todayCache = { data: combined, expiresAt: now + this.CACHE_DURATION_MS };
    return this.enrichWithLiveMinutes(combined);
  }

  async getMatchesByDate(date: string): Promise<Match[]> {
    const now = Date.now();
    const cache = this.byDateCache.get(date);

    if (cache && cache.expiresAt > now) {
      return this.enrichWithLiveMinutes(cache.data);
    }

    const [footballDataMatches, extraMatches] = await Promise.all([
      this.safeFetch('football-data by-date', () => this.sportsDataProvider.getMatchesByDate(date)),
      this.safeFetch('api-football extra', () => this.extraCompetitions.getMatchesForDate(date)),
    ]);

    const combined = [...footballDataMatches, ...extraMatches];
    this.byDateCache.set(date, {
      data: combined,
      expiresAt: now + this.DATE_CACHE_DURATION_MS,
    });
    return this.enrichWithLiveMinutes(combined);
  }
}

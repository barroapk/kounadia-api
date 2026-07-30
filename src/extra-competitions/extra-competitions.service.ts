import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Match } from '../sports-data/sports-data-provider.interface';
import { EXTRA_COMPETITIONS } from '../config/extra-competitions';
import { HIERARCHY_BY_LEAGUE_ID } from '../config/competition-hierarchy';

interface CacheEntry {
  data: Match[];
  expiresAt: number;
}

const STATUS_MAP: Record<string, string> = {
  NS: 'TIMED',
  '1H': 'IN_PLAY',
  '2H': 'IN_PLAY',
  ET: 'IN_PLAY',
  BT: 'IN_PLAY',
  P: 'IN_PLAY',
  LIVE: 'IN_PLAY',
  HT: 'PAUSED',
  FT: 'FINISHED',
  AET: 'FINISHED',
  PEN: 'FINISHED',
};

@Injectable()
export class ExtraCompetitionsService {
  private readonly logger = new Logger(ExtraCompetitionsService.name);
  private readonly baseUrl = 'https://v3.football.api-sports.io';
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_DURATION_MS = 20 * 60 * 1000; // 20 minutes

  constructor(
    private http: HttpService,
    private config: ConfigService,
  ) {}

  private get headers() {
    return { 'x-apisports-key': this.config.get<string>('API_FOOTBALL_KEY') };
  }

  private mapStatus(shortStatus: string): string {
    return STATUS_MAP[shortStatus] ?? shortStatus;
  }

  private mapFixture(f: any, competitionName: string, leagueId: number): Match {
    const status = f.fixture.status;
    let liveMinuteLabel: string | null = null;

    if (status.short === 'HT') {
      liveMinuteLabel = 'MT';
    } else if (['1H', '2H'].includes(status.short)) {
      const base = status.elapsed ?? 0;
      liveMinuteLabel = status.extra ? `${base}+${status.extra}'` : `${base}'`;
    }

    const hierarchy = HIERARCHY_BY_LEAGUE_ID[leagueId];

    return {
      id: f.fixture.id,
      competition: competitionName,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      homeScore: f.goals.home,
      awayScore: f.goals.away,
      status: this.mapStatus(status.short),
      minute: status.elapsed ?? null,
      utcDate: f.fixture.date,
      liveMinuteLabel,
      homeTeamCrest: f.teams.home.logo ?? null,
      awayTeamCrest: f.teams.away.logo ?? null,
      competitionEmblem: f.league.logo ?? null,
      provider: 'api-football' as const,
      leagueId,
      continent: hierarchy?.continent ?? 'Autre',
      country: hierarchy?.country ?? 'Autre',
    };
  }

  private async fetchLeagueForDate(
    leagueId: number,
    season: number,
    name: string,
    date: string,
  ): Promise<Match[]> {
    const cacheKey = `${leagueId}-${date}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/fixtures`, {
          headers: this.headers,
          params: { league: leagueId, season, date },
        }),
      );

      const matches = response.data.response.map((f: any) =>
        this.mapFixture(f, name, leagueId),
      );

      this.cache.set(cacheKey, { data: matches, expiresAt: now + this.CACHE_DURATION_MS });
      return matches;
    } catch (error) {
      this.logger.warn(`Échec récupération ${name} (${date}): ${error.message}`);
      return cached?.data ?? [];
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Traite les compétitions par lots de 5 en parallèle, avec une pause entre
   * chaque lot, pour rester sous la limite de requêtes par minute d'API-Football
   * (distincte du quota journalier — un envoi de 40 appels simultanés la dépasse).
   */
  async getMatchesForDate(date: string): Promise<Match[]> {
    const CONCURRENCY = 5;
    const PAUSE_BETWEEN_BATCHES_MS = 1200;
    const allMatches: Match[] = [];

    for (let i = 0; i < EXTRA_COMPETITIONS.length; i += CONCURRENCY) {
      const batch = EXTRA_COMPETITIONS.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((c) => this.fetchLeagueForDate(c.leagueId, c.currentSeason, c.name, date)),
      );
      allMatches.push(...batchResults.flat());

      if (i + CONCURRENCY < EXTRA_COMPETITIONS.length) {
        await this.sleep(PAUSE_BETWEEN_BATCHES_MS);
      }
    }

    return allMatches;
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type { SportsDataProvider, StandingRow } from '../sports-data/sports-data-provider.interface';
import { ApiFootballService } from '../api-football/api-football.service';
import { EXTRA_COMPETITIONS } from '../config/extra-competitions';

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
    private apiFootballService: ApiFootballService,
  ) {}

  /**
   * Générique, sans jamais nommer une compétition précise : si de vrais
   * groupes lettrés (Group A, Group B...) existent, on exclut les blocs
   * génériques comme "Group Stage" qui les recoupent (ex: classement des
   * meilleurs 3es) et ne peuvent pas s'afficher clairement comme un groupe
   * de plus. Sinon (une seule phase, ex: juste "Group Stage" ou pas de
   * groupe du tout), on garde tout tel quel.
   */
  /**
   * Transforme les vraies saisons retournées par API-Football en format
   * commun utilise par le frontend.
   *
   * Exemples :
   * - Coupe du monde : 2026
   * - Premier League : 2025/2026
   * - CAN : 2025/2026 si les dates couvrent deux annees.
   */
  private buildApiFootballSeasons(items: any[], fallbackSeason: number): SeasonInfo[] {
    const seasons: SeasonInfo[] = items
      .filter((item) => item?.year != null)
      .map((item) => {
        const year = String(item.year);
        const start = typeof item.start === 'string' ? item.start : '';
        const end = typeof item.end === 'string' ? item.end : '';

        const startYear = start.slice(0, 4);
        const endYear = end.slice(0, 4);

        let label = year;

        if (startYear && endYear && startYear !== endYear) {
          label = `${startYear}/${endYear}`;
        }

        return {
          startYear: year,
          label,
        };
      })
      .sort((a, b) => Number(b.startYear) - Number(a.startYear));

    if (seasons.length > 0) {
      return seasons;
    }

    return [
      {
        startYear: String(fallbackSeason),
        label: String(fallbackSeason),
      },
    ];
  }

  private normalizeApiFootballStandings(items: any[]): StandingRow[] {
    const groups = items
      .map((item) => item.group)
      .filter((group): group is string => typeof group === 'string');

    const hasLetterGroups = groups.some((group) => /^Group [A-Z]$/.test(group));

    const filtered = hasLetterGroups
      ? items.filter((item) => /^Group [A-Z]$/.test(item.group ?? ''))
      : items;

    return filtered.map((item) => ({
      position: item.rank,
      group: item.group ?? undefined,
      teamName: item.team.name,
      teamCrest: item.team.logo ?? null,
      playedGames: item.all.played,
      won: item.all.win,
      draw: item.all.draw,
      lost: item.all.lose,
      goalsFor: item.all.goals.for,
      goalsAgainst: item.all.goals.against,
      goalDifference: item.goalsDiff,
      points: item.points,
    }));
  }

  private async getApiFootballStandings(leagueId: number, season?: string): Promise<StandingsResponse> {
    const competition = EXTRA_COMPETITIONS.find((c) => c.leagueId === leagueId);
    const resolvedSeason = season ? Number(season) : competition?.currentSeason;

    if (!resolvedSeason) {
      throw new Error(`Saison inconnue pour la compétition ${leagueId}`);
    }

    const cacheKey = `af-${leagueId}-${resolvedSeason}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const result = await this.apiFootballService.getStandingsByLeagueId(leagueId, resolvedSeason);
    const standings = this.normalizeApiFootballStandings(result?.standings ?? []);

    const apiSeasons = await this.apiFootballService.getLeagueSeasons(leagueId);
    const availableSeasons = this.buildApiFootballSeasons(apiSeasons, resolvedSeason);

    const response: StandingsResponse = {
      competitionCode: String(leagueId),
      competitionName: competition?.name ?? `League ${leagueId}`,
      competitionEmblem: result?.emblem ?? null,
      season: String(resolvedSeason),
      availableSeasons,
      totalTeams: standings.length,
      lastUpdated: new Date().toISOString(),
      standings,
    };

    this.cache.set(cacheKey, { data: response, expiresAt: now + this.CACHE_DURATION_MS });
    return response;
  }

  async getStandings(competitionCode: string, season?: string): Promise<StandingsResponse> {
    if (/^\d+$/.test(competitionCode)) {
      return this.getApiFootballStandings(Number(competitionCode), season);
    }

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

import { Injectable, Inject } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type { SportsDataProvider, Match } from '../sports-data/sports-data-provider.interface';
import { ApiFootballService } from '../api-football/api-football.service';
import { EXTRA_COMPETITIONS } from '../config/extra-competitions';
import { HIERARCHY_BY_LEAGUE_ID } from '../config/competition-hierarchy';

const LIVE_STATUSES = ['LIVE', 'IN_PLAY', 'PAUSED'];

const API_FOOTBALL_STATUS_MAP: Record<string, string> = {
  NS: 'TIMED', TBD: 'TIMED',
  '1H': 'IN_PLAY', '2H': 'IN_PLAY', ET: 'IN_PLAY', BT: 'IN_PLAY', P: 'IN_PLAY', LIVE: 'IN_PLAY',
  HT: 'PAUSED',
  FT: 'FINISHED', AET: 'FINISHED', PEN: 'FINISHED', AWD: 'FINISHED', WO: 'FINISHED',
  PST: 'POSTPONED', SUSP: 'SUSPENDED', ABD: 'SUSPENDED', CANC: 'CANCELLED',
};

export interface MatchdaySummary {
  totalMatches: number;
  finished: number;
  live: number;
  scheduled: number;
}

export interface MatchdayGroup {
  matchday: number;
  roundLabel?: string; // Texte original (ex: "Round of 16"), pour les compétitions sans vraie journée numérotée.
  matches: Match[];
  allFinished: boolean;
  summary: MatchdaySummary;
}

export interface CalendarResponse {
  competitionCode: string;
  currentMatchday: number;
  currentRoundLabel?: string;
  totalMatchdays: number;
  matchdays: MatchdayGroup[];
}

interface CacheEntry {
  data: CalendarResponse;
  expiresAt: number;
}

@Injectable()
export class CalendarService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 heures

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
    private apiFootballService: ApiFootballService,
  ) {}

  /** Extrait un numéro de journée depuis un round textuel quand c'est possible ("Regular Season - 12" -> 12). */
  private extractMatchdayNumber(round: string): number | null {
    const match = round.match(/(\d+)\s*$/);
    return match ? parseInt(match[1], 10) : null;
  }

  private buildMatchdayGroups(matches: Array<Match & { roundLabel?: string }>): {
    matchdays: MatchdayGroup[];
    currentMatchday: number;
    currentRoundLabel?: string;
  } {
    const byMatchday = new Map<number, { matches: Match[]; roundLabel?: string }>();

    for (const m of matches) {
      const key = m.matchday;
      if (key == null) continue;
      if (!byMatchday.has(key)) byMatchday.set(key, { matches: [], roundLabel: m.roundLabel });
      byMatchday.get(key)!.matches.push(m);
    }

    const matchdayNumbers = Array.from(byMatchday.keys()).sort((a, b) => a - b);

    const matchdays: MatchdayGroup[] = matchdayNumbers.map((day) => {
      const entry = byMatchday.get(day)!;
      const dayMatches = entry.matches.sort(
        (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime(),
      );

      const finished = dayMatches.filter((m) => m.status === 'FINISHED').length;
      const live = dayMatches.filter((m) => LIVE_STATUSES.includes(m.status)).length;
      const scheduled = dayMatches.length - finished - live;

      const stalled = dayMatches.filter((m) =>
        ['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(m.status),
      ).length;
      const effectiveFinished = finished + stalled;

      return {
        matchday: day,
        roundLabel: entry.roundLabel,
        matches: dayMatches,
        allFinished: effectiveFinished === dayMatches.length,
        summary: { totalMatches: dayMatches.length, finished, live, scheduled },
      };
    });

    const liveGroup = matchdays.find((g) => g.summary.live > 0);
    const upcomingGroup = matchdays.find((g) => !g.allFinished && g.summary.scheduled > 0);
    const currentGroup = liveGroup ?? upcomingGroup ?? matchdays[matchdays.length - 1];

    return {
      matchdays,
      currentMatchday: currentGroup?.matchday ?? 1,
      currentRoundLabel: currentGroup?.roundLabel,
    };
  }

  private async getApiFootballCalendar(leagueId: number): Promise<CalendarResponse> {
    const competition = EXTRA_COMPETITIONS.find((c) => c.leagueId === leagueId);
    if (!competition) {
      throw new Error(`Compétition inconnue (leagueId=${leagueId})`);
    }

    const fixtures = await this.apiFootballService.getCalendarByLeagueId(
      leagueId,
      competition.currentSeason,
    );

    if (!fixtures || fixtures.length === 0) {
      return { competitionCode: String(leagueId), currentMatchday: 1, totalMatchdays: 0, matchdays: [] };
    }

    const hierarchy = HIERARCHY_BY_LEAGUE_ID[leagueId];
    let sequentialCounter = 0;
    const roundToNumber = new Map<string, number>();

    const matches = fixtures.map((f: any) => {
      const round: string = f.league?.round ?? '';
      let matchdayNum = this.extractMatchdayNumber(round);

      // Pas de numéro extractible (ex: "Round of 16") : on attribue un numéro
      // séquentiel stable par round, pour garder un ordre cohérent d'affichage.
      if (matchdayNum === null) {
        if (!roundToNumber.has(round)) {
          sequentialCounter += 1;
          roundToNumber.set(round, sequentialCounter);
        }
        matchdayNum = roundToNumber.get(round)!;
      }

      const status = f.fixture.status;
      let liveMinuteLabel: string | null = null;
      if (status.short === 'HT') liveMinuteLabel = 'MT';
      else if (['1H', '2H'].includes(status.short)) {
        const base = status.elapsed ?? 0;
        liveMinuteLabel = status.extra ? `${base}+${status.extra}'` : `${base}'`;
      }

      const match: Match & { roundLabel?: string } = {
        id: f.fixture.id,
        competition: competition.name,
        homeTeam: f.teams.home.name,
        awayTeam: f.teams.away.name,
        homeScore: f.goals.home,
        awayScore: f.goals.away,
        status: API_FOOTBALL_STATUS_MAP[status.short] ?? status.short,
        minute: status.elapsed ?? null,
        utcDate: f.fixture.date,
        liveMinuteLabel,
        homeTeamCrest: f.teams.home.logo ?? null,
        awayTeamCrest: f.teams.away.logo ?? null,
        competitionEmblem: f.league?.logo ?? null,
        provider: 'api-football' as const,
        leagueId,
        continent: hierarchy?.continent ?? 'Autre',
        country: hierarchy?.country ?? 'Autre',
        matchday: matchdayNum,
        roundLabel: round || undefined,
      };
      return match;
    });

    const { matchdays, currentMatchday, currentRoundLabel } = this.buildMatchdayGroups(matches);

    return {
      competitionCode: String(leagueId),
      currentMatchday,
      currentRoundLabel,
      totalMatchdays: matchdays.length,
      matchdays,
    };
  }

  async getCalendar(competitionCode: string): Promise<CalendarResponse> {
    const cached = this.cache.get(competitionCode);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    let response: CalendarResponse;

    if (/^\d+$/.test(competitionCode)) {
      response = await this.getApiFootballCalendar(Number(competitionCode));
    } else {
      const matches = await this.sportsDataProvider.getSeasonMatches(competitionCode);
      const { matchdays, currentMatchday } = this.buildMatchdayGroups(matches);
      response = {
        competitionCode,
        currentMatchday,
        totalMatchdays: matchdays.length,
        matchdays,
      };
    }

    this.cache.set(competitionCode, { data: response, expiresAt: now + this.CACHE_DURATION_MS });
    return response;
  }
}

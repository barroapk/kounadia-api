import { Injectable, Inject } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type { SportsDataProvider, Match } from '../sports-data/sports-data-provider.interface';

const LIVE_STATUSES = ['LIVE', 'IN_PLAY', 'PAUSED'];

export interface MatchdaySummary {
  totalMatches: number;
  finished: number;
  live: number;
  scheduled: number;
}

export interface MatchdayGroup {
  matchday: number;
  matches: Match[];
  allFinished: boolean;
  summary: MatchdaySummary;
}

export interface CalendarResponse {
  competitionCode: string;
  currentMatchday: number;
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
  ) {}

  async getCalendar(competitionCode: string): Promise<CalendarResponse> {
    const cached = this.cache.get(competitionCode);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const matches = await this.sportsDataProvider.getSeasonMatches(competitionCode);

    const byMatchday = new Map<number, Match[]>();
    for (const m of matches) {
      if (m.matchday == null) continue;
      byMatchday.set(m.matchday, [...(byMatchday.get(m.matchday) ?? []), m]);
    }

    const matchdayNumbers = Array.from(byMatchday.keys()).sort((a, b) => a - b);

    const matchdays: MatchdayGroup[] = matchdayNumbers.map((day) => {
      const dayMatches = byMatchday.get(day)!.sort(
        (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime(),
      );

      const finished = dayMatches.filter((m) => m.status === 'FINISHED').length;
      const live = dayMatches.filter((m) => LIVE_STATUSES.includes(m.status)).length;
      const scheduled = dayMatches.length - finished - live;

      return {
        matchday: day,
        matches: dayMatches,
        allFinished: finished === dayMatches.length,
        summary: { totalMatches: dayMatches.length, finished, live, scheduled },
      };
    });

    // Priorité : une journée avec un match en direct > une journée avec des matchs à venir > la dernière (fin de saison).
    const liveGroup = matchdays.find((g) => g.summary.live > 0);
    const upcomingGroup = matchdays.find((g) => g.summary.scheduled > 0);
    const currentGroup = liveGroup ?? upcomingGroup ?? matchdays[matchdays.length - 1];
    const currentMatchday = currentGroup?.matchday ?? 1;

    const response: CalendarResponse = {
      competitionCode,
      currentMatchday,
      totalMatchdays: matchdayNumbers.length,
      matchdays,
    };

    this.cache.set(competitionCode, { data: response, expiresAt: now + this.CACHE_DURATION_MS });
    return response;
  }
}

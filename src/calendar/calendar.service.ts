import { Injectable, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
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

export interface CalendarSeasonInfo {
  value: string;
  label: string;
}

export interface CalendarResponse {
  competitionCode: string;
  season?: string;
  availableSeasons?: CalendarSeasonInfo[];
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

  private readonly footballDataBaseUrl = 'https://api.football-data.org/v4';

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
    private apiFootballService: ApiFootballService,
    private http: HttpService,
    private config: ConfigService,
  ) {}

  // Hiérarchie fixe des rounds à élimination directe, du plus tôt au plus tard.
  // Chaque motif est cherché dans l'ordre : le premier qui correspond gagne.
  // "Group Stage" n'est volontairement PAS ici : ses journées ("Group Stage - 1",
  // "- 2"...) doivent passer par le chemin numérique pour garder leur propre ordre,
  // pas toutes recevoir la même clé de tri.
  // Liste volontairement large : API-Football utilise plusieurs formulations
  // différentes selon la compétition pour désigner le même tour (ex: "Round
  // of 16" / "8th Finals", "1st Round" / "First Round"...). L'ordre des
  // entrées compte : la première qui correspond gagne, donc les motifs les
  // plus spécifiques doivent être placés avant les plus génériques.
  private static readonly KNOCKOUT_ORDER: Array<{ pattern: RegExp; order: number }> = [
    { pattern: /preliminary round/i, order: 0 },
    { pattern: /qualification round 1/i, order: 1 },
    { pattern: /qualification round 2/i, order: 2 },
    { pattern: /qualification round 3/i, order: 3 },
    { pattern: /qualifying round|qualification round/i, order: 1 },
    { pattern: /\b(1st|first)\s*round\b/i, order: 2 },
    { pattern: /\b(2nd|second)\s*round\b/i, order: 3 },
    { pattern: /knockout round play-?offs|play-?offs?/i, order: 4 },
    { pattern: /round of 32|16th finals/i, order: 6 },
    { pattern: /round of 16|8th finals/i, order: 7 },
    { pattern: /quarter-?finals?/i, order: 8 },
    { pattern: /semi-?finals?/i, order: 9 },
    { pattern: /3rd place|third place/i, order: 10 },
    { pattern: /\bfinal\b/i, order: 11 },
  ];

  /**
   * Construit une clé de tri numérique unique et fiable pour un round.
   * Ne dépend JAMAIS d'une comparaison de texte (localeCompare) : uniquement
   * de nombres, pour que l'ordre soit toujours prévisible quel que soit le
   * format exact des libellés fournis par l'API.
   *
   * Étape 1 : les journées numériques d'une phase précise ("Apertura - 5",
   * "Group Stage - 2"...) sont regroupées par leur préfixe de phase, avec
   * un numéro de base par préfixe (multiples de 100) + le numéro de journée.
   * Étape 2 : les rounds à élimination directe reçoivent un rang fixe très
   * élevé (10000+), toujours après toutes les journées numériques.
   */
  private buildRoundSortKey(round: string, phaseBaseOrder: Map<string, number>, defaultPhase: string): number {
    for (const { pattern, order } of CalendarService.KNOCKOUT_ORDER) {
      if (pattern.test(round)) {
        // Rattache ce round à élimination directe à sa phase (Apertura,
        // Clausura...) si un préfixe explicite existe avant le nom du round,
        // sinon à l'unique phase de la compétition (cas CAN, Coupe du monde...).
        const prefixMatch = round.match(
          /^(.+?)\s*-\s*(preliminary|qualifying|qualification|knockout|play-?offs?|(1st|first)\s*round|(2nd|second)\s*round|round of|16th|8th|quarter|semi|3rd|third|final)/i,
        );
        const prefix = prefixMatch ? prefixMatch[1].trim() : defaultPhase;
        const base = phaseBaseOrder.get(prefix) ?? phaseBaseOrder.get(defaultPhase) ?? 1;
        return base * 1000 + 100 + order;
      }
    }

    const numberMatch = round.match(/^(.*?)[\s-]*(\d+)\s*$/);
    if (numberMatch) {
      const prefix = numberMatch[1].trim();
      const number = parseInt(numberMatch[2], 10);
      const base = phaseBaseOrder.get(prefix) ?? 0;
      return base * 1000 + number;
    }

    return 999999; // Round non reconnu : toujours en tout dernier.
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

  private async getApiFootballCalendar(leagueId: number, season?: string): Promise<CalendarResponse> {
    const competition = EXTRA_COMPETITIONS.find((c) => c.leagueId === leagueId);
    if (!competition) {
      throw new Error(`Compétition inconnue (leagueId=${leagueId})`);
    }

    const targetSeason = season ? Number(season) : competition.currentSeason;

    const fixtures = await this.apiFootballService.getCalendarByLeagueId(
      leagueId,
      targetSeason,
    );

    if (!fixtures || fixtures.length === 0) {
      return { competitionCode: String(leagueId), currentMatchday: 1, totalMatchdays: 0, matchdays: [] };
    }

    const hierarchy = HIERARCHY_BY_LEAGUE_ID[leagueId];

    // Ordre des rounds basé sur leur vraie date de premier match, pas sur une
    // devinette du texte : un même mot ("1st Round") peut désigner un tour de
    // qualification (avant la phase principale) dans une compétition, et un
    // tour à élimination directe (après) dans une autre — impossible à
    // distinguer de façon fiable par le vocabulaire seul. La date réelle,
    // elle, ne ment jamais sur l'ordre chronologique des phases.
    const uniqueRounds = Array.from(new Set(fixtures.map((f: any) => f.league?.round ?? '')));
    const roundEarliestDate = new Map<string, number>();
    for (const f of fixtures) {
      const round: string = f.league?.round ?? '';
      const ts = new Date(f.fixture.date).getTime();
      if (!roundEarliestDate.has(round) || ts < roundEarliestDate.get(round)!) {
        roundEarliestDate.set(round, ts);
      }
    }

    const orderedRounds = uniqueRounds.sort((a, b) => {
      return roundEarliestDate.get(a)! - roundEarliestDate.get(b)!;
    });
    const roundToNumber = new Map<string, number>();
    orderedRounds.forEach((round, index) => roundToNumber.set(round, index + 1));

    const matches = fixtures.map((f: any) => {
      const round: string = f.league?.round ?? '';
      const matchdayNum = roundToNumber.get(round)!;

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
        wonAfter:
          f.score?.penalty?.home != null && f.score?.penalty?.away != null
            ? 'PEN'
            : f.score?.extratime?.home != null && f.score?.extratime?.away != null
              ? 'AET'
              : null,
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
      season: String(targetSeason),
      availableSeasons: this.getApiFootballSeasons(competition.currentSeason),
      currentMatchday,
      currentRoundLabel,
      totalMatchdays: matchdays.length,
      matchdays,
    };
  }

  private async getFootballDataSeasons(competitionCode: string): Promise<CalendarSeasonInfo[]> {
    try {
      const token = this.config.get<string>('FOOTBALL_DATA_API_KEY');

      const response = await firstValueFrom(
        this.http.get(`${this.footballDataBaseUrl}/competitions/${competitionCode}`, {
          headers: { 'X-Auth-Token': token },
        }),
      );

      return (response.data.seasons ?? []).map((s: any) => ({
        value: String(s.startDate?.substring(0, 4) ?? ''),
        label: `${s.startDate?.substring(0, 4)}-${s.endDate?.substring(0, 4)}`,
      })).filter((s: CalendarSeasonInfo) => s.value);
    } catch (error) {
      return [];
    }
  }

  private getApiFootballSeasons(currentSeason: number): CalendarSeasonInfo[] {
    return [0, 1, 2].map((offset) => {
      const year = currentSeason - offset;
      return {
        value: String(year),
        label: `${year}/${year + 1}`,
      };
    });
  }

  async getCalendar(competitionCode: string, season?: string): Promise<CalendarResponse> {
    const cacheKey = `${competitionCode}:${season ?? 'current'}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    let response: CalendarResponse;

    if (/^\d+$/.test(competitionCode)) {
      response = await this.getApiFootballCalendar(Number(competitionCode), season);
    } else {
      const matches = await this.sportsDataProvider.getSeasonMatches(competitionCode, season);
      const { matchdays, currentMatchday } = this.buildMatchdayGroups(matches);
      const availableSeasons = await this.getFootballDataSeasons(competitionCode);
      response = {
        competitionCode,
        season: season ?? availableSeasons[0]?.value,
        availableSeasons,
        currentMatchday,
        totalMatchdays: matchdays.length,
        matchdays,
      };
    }

    this.cache.set(cacheKey, { data: response, expiresAt: now + this.CACHE_DURATION_MS });
    return response;
  }
}

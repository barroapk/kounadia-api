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

// Codes de phase standard de football-data.org (utilisés par toutes leurs
// compétitions à élimination directe, pas seulement une en particulier).
// Sert uniquement de libellé : le regroupement/tri reste basé sur les dates.
const STAGE_LABELS: Record<string, string> = {
  LAST_64: '1/32 de finale',
  LAST_32: '1/16 de finale',
  LAST_16: '1/8 de finale',
  QUARTER_FINALS: 'Quarts de finale',
  SEMI_FINALS: 'Demi-finales',
  THIRD_PLACE: 'Match pour la 3e place',
  FINAL: 'Finale',
};

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
  // true = round à élimination directe (afficher roundLabel tel quel, ex: "1/8 de finale").
  // false/absent = vraie journée numérotée (afficher "J{n}" côté Flutter, quel que soit
  // le texte brut de la source : "Regular Season - 5", "Apertura - 5", "Group Stage - 5"...).
  isKnockout?: boolean;
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
    const byMatchday = new Map<number, { matches: Match[]; roundLabel?: string; isKnockout?: boolean }>();

    for (const m of matches) {
      const key = m.matchday;
      if (key == null) continue;
      if (!byMatchday.has(key)) byMatchday.set(key, { matches: [], roundLabel: m.roundLabel, isKnockout: (m as any).isKnockout ?? false });
      byMatchday.get(key)!.matches.push(m);
    }

    // Matchs sans journée numérotée (phases à élimination directe : football-data.org
    // renvoie matchday: null pour ces matchs, avec l'info dans "stage" à la place).
    // Regroupement générique par stage, jamais par nom de compétition.
    const stageMatches = matches.filter((m: any) => m.matchday == null && m.stage);
    const stageGroups = new Map<string, Match[]>();
    for (const m of stageMatches) {
      const stage = (m as any).stage as string;
      if (!stageGroups.has(stage)) stageGroups.set(stage, []);
      stageGroups.get(stage)!.push(m);
    }

    // Ordre chronologique réel (première date de chaque stage), pas un ordre
    // deviné par nom : reste valable même pour un format de compétition inconnu.
    const orderedStages = Array.from(stageGroups.entries()).sort((a, b) => {
      const earliestA = Math.min(...a[1].map((m) => new Date(m.utcDate).getTime()));
      const earliestB = Math.min(...b[1].map((m) => new Date(m.utcDate).getTime()));
      return earliestA - earliestB;
    });

    const maxMatchday = Math.max(0, ...Array.from(byMatchday.keys()));
    orderedStages.forEach(([stage, stageMs], index) => {
      const syntheticKey = maxMatchday + index + 1;
      byMatchday.set(syntheticKey, { matches: stageMs, roundLabel: STAGE_LABELS[stage] ?? stage, isKnockout: true });
    });

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
        isKnockout: entry.isKnockout,
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
      return {
        competitionCode: String(leagueId),
        season: String(targetSeason),
        availableSeasons: await this.getApiFootballCalendarSeasons(leagueId, targetSeason),
        currentMatchday: 1,
        totalMatchdays: 0,
        matchdays: [],
      };
    }

    const hierarchy = HIERARCHY_BY_LEAGUE_ID[leagueId];

    // Tri par CONTENU du texte, pas par date : un match reporté (ex: "Apertura - 9"
    // joué en mai alors que "Apertura - 10" s'est joué en mars) ferait apparaître
    // les journées dans le désordre si on triait par date réelle. On sépare donc
    // toujours : d'abord le préfixe de phase (Apertura/Clausura/Group Stage/rien),
    // puis à l'intérieur : numéro de journée croissant, puis phases à élimination
    // directe dans leur ordre logique (jamais deviné par date).
    const uniqueRounds = Array.from(new Set(fixtures.map((f: any) => f.league?.round ?? '')));

    const parseRound = (round: string): { phase: string; matchdayNum: number | null; knockoutOrder: number | null } => {
      // Il faut tester les rounds à élimination directe D'ABORD : sinon "Round
      // of 16", "Round of 32" ou "Qualification Round 1" sont à tort lus comme
      // des journées numérotées (leur texte se termine aussi par un chiffre).
      for (const { pattern, order } of CalendarService.KNOCKOUT_ORDER) {
        if (pattern.test(round)) {
          // Le préfixe n'est extrait QUE si la partie après le tiret est
          // elle-même, à l'identique, un round à élimination directe connu
          // (teste chaque partie séparément) : sinon "Quarter-finals" est à
          // tort découpé en préfixe "Quarter" + mot-clé "finals".
          let phase = '';
          const dashIndex = round.lastIndexOf(' - ');
          if (dashIndex > 0) {
            const afterDash = round.slice(dashIndex + 3).trim();
            const afterDashIsKnockout = CalendarService.KNOCKOUT_ORDER.some(
              (k) => k.pattern.test(afterDash) && new RegExp(`^(${k.pattern.source})$`, 'i').test(afterDash),
            );
            if (afterDashIsKnockout) {
              phase = round.slice(0, dashIndex).trim();
            }
          }
          return { phase, matchdayNum: null, knockoutOrder: order };
        }
      }

      const numberMatch = round.match(/^(.*?)[\s-]*(\d+)\s*$/);
      if (numberMatch) {
        return { phase: numberMatch[1].trim(), matchdayNum: parseInt(numberMatch[2], 10), knockoutOrder: null };
      }

      return { phase: round, matchdayNum: null, knockoutOrder: null };
    };

    // Date du premier match de chaque round, uniquement utilisée pour
    // départager des PHASES différentes (ex: "" vs "Group Stage") quand leur
    // ordre logique n'est pas évident autrement. Jamais utilisée pour trier
    // les journées à l'intérieur d'une même phase (un report la fausserait).
    const roundEarliestDate = new Map<string, number>();
    for (const f of fixtures) {
      const round: string = f.league?.round ?? '';
      const ts = new Date(f.fixture.date).getTime();
      if (!roundEarliestDate.has(round) || ts < roundEarliestDate.get(round)!) {
        roundEarliestDate.set(round, ts);
      }
    }

    // Date du plus ancien round de chaque phase, pour ordonner les phases
    // entre elles (ex: Qualification avant Group Stage) de façon fiable.
    const phaseEarliestDate = new Map<string, number>();
    for (const round of uniqueRounds) {
      const { phase } = parseRound(round);
      const ts = roundEarliestDate.get(round)!;
      if (!phaseEarliestDate.has(phase) || ts < phaseEarliestDate.get(phase)!) {
        phaseEarliestDate.set(phase, ts);
      }
    }

    // Niveau global du tournoi, fixe et indépendant de la date ou du préfixe :
    // 0 = qualifications, 1 = phase de groupes/journées, 2+ = élimination directe
    // (dans l'ordre de KNOCKOUT_ORDER). Sert à départager des rounds qui n'ont
    // ni le même préfixe ni la même nature (ex: "Qualification Round 1" vs
    // "Group Stage - 1" vs "Round of 32", tous avec phase="" pour ces deux
    // derniers mais des étapes de tournoi complètement différentes).
    const globalTier = (r: { matchdayNum: number | null; knockoutOrder: number | null }, round: string): number => {
      if (/qualif|preliminary/i.test(round)) return 0;
      if (r.matchdayNum !== null) return 1;
      if (r.knockoutOrder !== null) return 2 + r.knockoutOrder;
      return 1;
    };

    const orderedRounds = uniqueRounds.sort((a, b) => {
      const pa = parseRound(a);
      const pb = parseRound(b);

      const tierA = globalTier(pa, a);
      const tierB = globalTier(pb, b);

      // CAS 1 : deux phases explicites différentes (ex: "Apertura" vs
      // "Clausura", "Eastern Conference" vs "Western Conference"). On garde
      // chaque phase comme un BLOC entier : jamais de comparaison individuelle
      // entre leurs journées.
      if (pa.phase !== '' && pb.phase !== '' && pa.phase !== pb.phase) {
        return phaseEarliestDate.get(pa.phase)! - phaseEarliestDate.get(pb.phase)!;
      }

      // CAS 2 : même phase explicite (ex: Apertura - 8 / Apertura - 9 /
      // Apertura - Final).
      if (pa.phase === pb.phase && pa.phase !== '') {
        if (tierA !== tierB) return tierA - tierB;
        if (pa.matchdayNum !== null && pb.matchdayNum !== null) return pa.matchdayNum - pb.matchdayNum;
        return (pa.knockoutOrder ?? 999) - (pb.knockoutOrder ?? 999);
      }

      // CAS 3 : rounds sans phase explicite (ex: Qualification Round 1 →
      // Group Stage → Round of 32 → Round of 16). Le niveau global tranche.
      if (tierA !== tierB) return tierA - tierB;
      if (pa.matchdayNum !== null && pb.matchdayNum !== null) return pa.matchdayNum - pb.matchdayNum;

      if (pa.phase !== pb.phase) {
        return phaseEarliestDate.get(pa.phase)! - phaseEarliestDate.get(pb.phase)!;
      }

      return (pa.knockoutOrder ?? 999) - (pb.knockoutOrder ?? 999);
    });
    const roundToNumber = new Map<string, number>();
    orderedRounds.forEach((round, index) => roundToNumber.set(round, index + 1));

    const matches = fixtures.map((f: any) => {
      const round: string = f.league?.round ?? '';
      const matchdayNum = roundToNumber.get(round)!;
      const parsedRound = parseRound(round);

      const status = f.fixture.status;
      let liveMinuteLabel: string | null = null;
      if (status.short === 'HT') liveMinuteLabel = 'MT';
      else if (['1H', '2H'].includes(status.short)) {
        const base = status.elapsed ?? 0;
        liveMinuteLabel = status.extra ? `${base}+${status.extra}'` : `${base}'`;
      }

      const match: Match & { roundLabel?: string; isKnockout?: boolean } = {
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
        penaltyHomeScore: f.score?.penalty?.home ?? null,
        penaltyAwayScore: f.score?.penalty?.away ?? null,
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
        isKnockout: parsedRound.knockoutOrder !== null,
      };
      return match;
    });

    const { matchdays, currentMatchday, currentRoundLabel } = this.buildMatchdayGroups(matches);

    return {
      competitionCode: String(leagueId),
      season: String(targetSeason),
      availableSeasons: await this.getApiFootballCalendarSeasons(leagueId, targetSeason),
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

  /**
   * Transforme les vraies saisons retournées par API-Football en format
   * commun. Ne devine plus artificiellement "annee/annee+1" : certaines
   * compétitions (Coupe du monde, Argentine...) ont un format différent
   * selon leurs vraies dates de saison.
   */
  private async getApiFootballCalendarSeasons(leagueId: number, fallbackSeason: number): Promise<CalendarSeasonInfo[]> {
    const items = await this.apiFootballService.getLeagueSeasons(leagueId);

    const seasonItems = items
      .filter((item: any) => item?.year != null)
      .sort((a: any, b: any) => Number(b.year) - Number(a.year));

    // Le format de la saison courante peut être trompeur lorsque API-Football
    // n'a encore enregistré que les qualifications (dates toutes dans la même
    // année civile). On se base donc sur la saison PRÉCÉDENTE (N-1), dont les
    // dates sont toujours complètes, pour déterminer si cette compétition
    // traverse deux années civiles ou non.
    const isSplitYear = (item: any): boolean => {
      const start = typeof item?.start === 'string' ? item.start : '';
      const end = typeof item?.end === 'string' ? item.end : '';
      const startYear = Number(start.slice(0, 4));
      const endYear = Number(end.slice(0, 4));
      return Number.isFinite(startYear) && Number.isFinite(endYear) && endYear > startYear;
    };

    const seasons: CalendarSeasonInfo[] = seasonItems.map((item: any) => {
      const year = Number(item.year);
      const previous = seasonItems.find((s: any) => Number(s.year) === year - 1);
      const splitFormat = previous ? isSplitYear(previous) : isSplitYear(item);
      return { value: String(year), label: splitFormat ? `${year}/${year + 1}` : String(year) };
    });

    if (seasons.length > 0) return seasons;
    return [{ value: String(fallbackSeason), label: String(fallbackSeason) }];
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
      const { matchdays, currentMatchday, currentRoundLabel } = this.buildMatchdayGroups(matches);
      const availableSeasons = await this.getFootballDataSeasons(competitionCode);
      response = {
        competitionCode,
        season: season ?? availableSeasons[0]?.value,
        availableSeasons,
        currentMatchday,
        currentRoundLabel,
        totalMatchdays: matchdays.length,
        matchdays,
      };
    }

    // Ne jamais mettre en cache une réponse vide (0 matchdays) : ça peut être
    // une erreur temporaire ou un rate-limit de la source, pas un vrai manque
    // de données. Sinon un échec ponctuel reste "collé" en cache pendant 6h.
    if (response.totalMatchdays > 0) {
      this.cache.set(cacheKey, { data: response, expiresAt: now + this.CACHE_DURATION_MS });
    }
    return response;
  }
}

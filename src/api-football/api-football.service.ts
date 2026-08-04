import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';

const CACHE_DAYS = 30;
const DETAIL_CACHE_MS = 5 * 60 * 1000; // 5 minutes, une seule règle simple pour stats/lineups/fixtureId

export interface LiveMinuteInfo {
  homeTeam: string;
  awayTeam: string;
  label: string;
}

export interface FixtureInfo {
  homeTeam: string;
  awayTeam: string;
  competition: string;
  homeScore: number | null;
  awayScore: number | null;
  utcDate: string;
  status: string;
  venue: string | null;
  referee: string | null;
}

const COMMON_PREFIXES_SUFFIXES = [
  'fc', 'cr', 'ec', 'sc', 'se', 'ca', 'ac', 'afc', 'cf', 'fbpa', 'rb', 'fbc',
];

const TEAM_CANONICAL: Record<string, string> = {
  'camineiro': 'atleticomg',
  'atleticomg': 'atleticomg',
  'atleticomineiro': 'atleticomg',
};

const STATUS_MAP: Record<string, string> = {
  NS: 'TIMED', TBD: 'TIMED',
  '1H': 'IN_PLAY', '2H': 'IN_PLAY', ET: 'IN_PLAY', BT: 'IN_PLAY', P: 'IN_PLAY', LIVE: 'IN_PLAY',
  HT: 'PAUSED',
  FT: 'FINISHED', AET: 'FINISHED', PEN: 'FINISHED', AWD: 'FINISHED', WO: 'FINISHED',
  PST: 'POSTPONED', SUSP: 'SUSPENDED', ABD: 'SUSPENDED', CANC: 'CANCELLED',
};

@Injectable()
export class ApiFootballService {
  private readonly logger = new Logger(ApiFootballService.name);
  private readonly baseUrl = 'https://v3.football.api-sports.io';

  private fixtureIdCache = new Map<string, { id: number | null; expiresAt: number }>();
  private statsCache = new Map<number, { data: any; expiresAt: number }>();
  private lineupsCache = new Map<number, { data: any; expiresAt: number }>();
  private fixtureInfoCache = new Map<number, { data: FixtureInfo | null; expiresAt: number }>();
  private eventsCache = new Map<number, { data: any[] | null; expiresAt: number }>();
  private calendarCache = new Map<string, { data: any[] | null; expiresAt: number }>();

  constructor(
    private http: HttpService,
    private config: ConfigService,
    private supabase: SupabaseService,
  ) {}

  private get headers() {
    return { 'x-apisports-key': this.config.get<string>('API_FOOTBALL_KEY') };
  }

  private async searchApiFootballByName(name: string): Promise<number | null> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/teams`, {
        headers: this.headers,
        params: { search: name },
      }),
    );
    return response.data.response[0]?.team?.id ?? null;
  }

  async searchTeam(teamName: string): Promise<number> {
    const { data: cached } = await this.supabase.client
      .from('team_mappings')
      .select('api_football_id')
      .eq('team_name', teamName)
      .maybeSingle();

    if (cached) return cached.api_football_id;

    // 1. Recherche avec le nom exact reçu.
    let id = await this.searchApiFootballByName(teamName);

    // 2. Repli : recherche avec le nom nettoyé (accents/préfixes retirés),
    // même logique déjà utilisée pour la minute en direct.
    if (id === null) {
      const normalized = this.canonicalize(teamName);
      if (normalized && normalized !== teamName) {
        id = await this.searchApiFootballByName(normalized);
      }
    }

    // Dernier recours : retirer le préfixe (SC, FC, CA...) et essayer
    // chaque mot significatif jusqu'à trouver une correspondance.
    if (id === null) {
      const words = teamName
        .replace(/^(SC|FC|CA|AC|CD|CF|EC|RB)\s+/i, '')
        .split(' ')
        .filter((word) => word.length > 3)
        .sort((a, b) => b.length - a.length); // mots les plus discriminants d'abord

      for (const word of words) {
        id = await this.searchApiFootballByName(word);
        if (id !== null) {
          this.logger.warn(`Recherche fallback équipe: "${teamName}" trouvée via le mot "${word}" (id ${id})`);
          break;
        }
      }
    }

    if (id === null) {
      throw new Error(`Équipe introuvable : ${teamName}`);
    }

    await this.supabase.client
      .from('team_mappings')
      .insert({ team_name: teamName, api_football_id: id });

    return id;
  }

  async getHeadToHead(teamAName: string, teamBName: string) {
    const idA = await this.searchTeam(teamAName);
    const idB = await this.searchTeam(teamBName);

    // Le tri ne sert QUE pour la clé de cache (ordre stable, peu importe qui
    // est domicile aujourd'hui) — jamais pour attribuer les victoires.
    const cacheKeyA = Math.min(idA, idB);
    const cacheKeyB = Math.max(idA, idB);

    const { data: cached } = await this.supabase.client
      .from('head_to_head_cache')
      .select('*')
      .eq('team1_id', cacheKeyA)
      .eq('team2_id', cacheKeyB)
      .maybeSingle();

    if (cached) {
      const ageDays =
        (Date.now() - new Date(cached.fetched_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < CACHE_DAYS) {
        // Le cache est stocké selon cacheKeyA/cacheKeyB : si l'équipe demandée
        // en premier (teamAName) n'a pas idA === cacheKeyA, il faut inverser
        // les compteurs pour rester cohérent avec l'appel actuel.
        const data = cached.data;
        if (idA === cacheKeyA) return data;
        return {
          ...data,
          teamA: teamAName,
          teamB: teamBName,
          teamAWins: data.teamBWins,
          teamBWins: data.teamAWins,
        };
      }
    }

    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/fixtures/headtohead`, {
        headers: this.headers,
        params: { h2h: `${cacheKeyA}-${cacheKeyB}`, last: 10 },
      }),
    );

    const fixtures = response.data.response;
    const summary = {
      totalMatches: fixtures.length,
      teamA: teamAName,
      teamB: teamBName,
      teamAWins: 0,
      teamBWins: 0,
      draws: 0,
      lastMeetingDate: fixtures[0]?.fixture?.date ?? null,
    };

    for (const f of fixtures) {
      const homeId = f.teams.home.id;
      if (f.teams.home.winner === true) {
        homeId === idA ? summary.teamAWins++ : summary.teamBWins++;
      } else if (f.teams.away.winner === true) {
        homeId === idA ? summary.teamBWins++ : summary.teamAWins++;
      } else {
        summary.draws++;
      }
    }

    await this.supabase.client.from('head_to_head_cache').upsert(
      { team1_id: cacheKeyA, team2_id: cacheKeyB, data: summary, fetched_at: new Date().toISOString() },
      { onConflict: 'team1_id,team2_id' },
    );

    return summary;
  }

  private formatMinuteLabel(status: { short: string; elapsed: number | null; extra: number | null }): string {
    if (status.short === 'HT') return 'MT';
    if (['1H', '2H'].includes(status.short)) {
      const base = status.elapsed ?? 0;
      return status.extra ? `${base}+${status.extra}'` : `${base}'`;
    }
    return status.short;
  }

  private cleanText(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private canonicalize(name: string): string {
    const cleanedJoined = this.cleanText(name).replace(/\s+/g, '');
    if (TEAM_CANONICAL[cleanedJoined]) return TEAM_CANONICAL[cleanedJoined];

    const words = this.cleanText(name)
      .split(' ')
      .filter((w) => !COMMON_PREFIXES_SUFFIXES.includes(w));

    return words.join('');
  }

  async getLiveMinutes(): Promise<LiveMinuteInfo[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/fixtures`, {
        headers: this.headers,
        params: { live: 'all' },
      }),
    );

    return response.data.response.map((f: any) => ({
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      label: this.formatMinuteLabel(f.fixture.status),
    }));
  }

  findMinuteFor(liveMinutes: LiveMinuteInfo[], homeTeam: string, awayTeam: string): string | null {
    const nHome = this.canonicalize(homeTeam);
    const nAway = this.canonicalize(awayTeam);

    const match = liveMinutes.find((m) => {
      const mHome = this.canonicalize(m.homeTeam);
      const mAway = this.canonicalize(m.awayTeam);
      return (
        (mHome.includes(nHome) || nHome.includes(mHome)) &&
        (mAway.includes(nAway) || nAway.includes(mAway))
      );
    });

    if (!match) {
      this.logger.warn(
        `Aucune correspondance pour "${homeTeam}" vs "${awayTeam}" (canonique: ${nHome}/${nAway}).`,
      );
    }

    return match?.label ?? null;
  }

  /**
   * Récupère les infos de base d'un match dont l'ID est déjà un fixture ID API-Football
   * (cas des 51 compétitions supplémentaires, où notre Match.id = fixture.id directement).
   */
  async getFixtureById(fixtureId: number): Promise<FixtureInfo | null> {
    const cached = this.fixtureInfoCache.get(fixtureId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.data;

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/fixtures`, {
          headers: this.headers,
          params: { id: fixtureId },
        }),
      );
      const f = response.data.response[0];
      if (!f) {
        this.fixtureInfoCache.set(fixtureId, { data: null, expiresAt: now + DETAIL_CACHE_MS });
        return null;
      }

      const data: FixtureInfo = {
        homeTeam: f.teams.home.name,
        awayTeam: f.teams.away.name,
        competition: f.league?.name ?? '',
        homeScore: f.goals?.home ?? null,
        awayScore: f.goals?.away ?? null,
        utcDate: f.fixture.date,
        status: STATUS_MAP[f.fixture.status.short] ?? f.fixture.status.short,
        venue: f.fixture.venue?.name ?? null,
        referee: f.fixture.referee ?? null,
      };

      this.fixtureInfoCache.set(fixtureId, { data, expiresAt: now + DETAIL_CACHE_MS });
      return data;
    } catch (error) {
      this.logger.warn(`getFixtureById échec (${fixtureId}): ${error.message}`);
      return cached?.data ?? null;
    }
  }

  /**
   * Pour un match dont l'ID vient de football-data.org : cherche l'ID de fixture
   * correspondant côté API-Football, par date + noms d'équipes canonicalisés.
   */
  async findFixtureId(homeTeam: string, awayTeam: string, utcDate: string): Promise<number | null> {
    const dateOnly = utcDate.slice(0, 10);
    const cacheKey = `${homeTeam}|${awayTeam}|${dateOnly}`;
    const cached = this.fixtureIdCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.id;

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/fixtures`, {
          headers: this.headers,
          params: { date: dateOnly },
        }),
      );

      const nHome = this.canonicalize(homeTeam);
      const nAway = this.canonicalize(awayTeam);
      const match = response.data.response.find((f: any) => {
        const mHome = this.canonicalize(f.teams.home.name);
        const mAway = this.canonicalize(f.teams.away.name);
        return (
          (mHome.includes(nHome) || nHome.includes(mHome)) &&
          (mAway.includes(nAway) || nAway.includes(mAway))
        );
      });

      const id = match?.fixture?.id ?? null;
      this.fixtureIdCache.set(cacheKey, { id, expiresAt: now + DETAIL_CACHE_MS });
      return id;
    } catch (error) {
      this.logger.warn(`findFixtureId échec: ${error.message}`);
      return null;
    }
  }

  /** Toutes les statistiques que l'API renvoie réellement, sans liste figée de notre part. */
  async getStandingsByLeagueId(
    leagueId: number,
    season: number,
  ): Promise<{ standings: any[]; emblem: string | null } | null> {
    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/standings`, {
          headers: this.headers,
          params: { league: leagueId, season },
        }),
      );
      const league = response.data.response?.[0]?.league;

      // API-Football renvoie un tableau par groupe (Group A, Group B...)
      // On conserve tous les groupes au lieu de prendre uniquement standings[0].
      const standings = (league?.standings ?? []).flat();

      if (!standings.length) return null;

      return { standings, emblem: league?.logo ?? null };
    } catch (error) {
      this.logger.warn(`Classement indisponible pour league ${leagueId}: ${error.message}`);
      return null;
    }
  }

  async getCalendarByLeagueId(leagueId: number, season: number): Promise<any[] | null> {
    const cacheKey = `${leagueId}-${season}`;
    const cached = this.calendarCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.data;

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/fixtures`, {
          headers: this.headers,
          params: { league: leagueId, season },
        }),
      );
      const fixtures = response.data.response ?? [];
      this.calendarCache.set(cacheKey, { data: fixtures, expiresAt: now + 6 * 60 * 60 * 1000 });
      return fixtures;
    } catch (error) {
      this.logger.warn(`Calendrier indisponible pour league ${leagueId}: ${error.message}`);
      return cached?.data ?? null;
    }
  }

  async getMatchStatistics(fixtureId: number): Promise<{ home: Record<string, any>; away: Record<string, any> } | null> {
    const cached = this.statsCache.get(fixtureId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.data;

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/fixtures/statistics`, {
          headers: this.headers,
          params: { fixture: fixtureId },
        }),
      );
      const raw = response.data.response;
      if (!raw || raw.length < 2) return null;

      const format = (entry: any) => {
        const stats: Record<string, any> = {};
        for (const s of entry.statistics) stats[s.type] = s.value;
        return stats;
      };

      const data = { home: format(raw[0]), away: format(raw[1]) };
      this.statsCache.set(fixtureId, { data, expiresAt: now + DETAIL_CACHE_MS });
      return data;
    } catch (error) {
      this.logger.warn(`getMatchStatistics échec (${fixtureId}): ${error.message}`);
      return cached?.data ?? null;
    }
  }

  /** Buts, cartons, remplacements — dans l'ordre chronologique fourni par l'API. */
  async getMatchEvents(fixtureId: number): Promise<any[] | null> {
    const cached = this.eventsCache.get(fixtureId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.data;

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/fixtures/events`, {
          headers: this.headers,
          params: { fixture: fixtureId },
        }),
      );
      const raw = response.data.response;
      if (!raw || raw.length === 0) return null;

      const data = raw.map((e: any) => ({
        minute: e.time?.elapsed ?? null,
        extraMinute: e.time?.extra ?? null,
        type: e.type ?? null,
        detail: e.detail ?? null,
        team: e.team?.name ?? null,
        player: e.player?.name ?? null,
        assist: e.assist?.name ?? null,
      }));

      this.eventsCache.set(fixtureId, { data, expiresAt: now + DETAIL_CACHE_MS });
      return data;
    } catch (error) {
      this.logger.warn(`getMatchEvents échec (${fixtureId}): ${error.message}`);
      return cached?.data ?? null;
    }
  }

  /** Compositions confirmées uniquement — jamais de composition "probable" inventée. */
  async getLineups(fixtureId: number): Promise<any[] | null> {
    const cached = this.lineupsCache.get(fixtureId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.data;

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/fixtures/lineups`, {
          headers: this.headers,
          params: { fixture: fixtureId },
        }),
      );
      const raw = response.data.response;
      if (!raw || raw.length === 0) return null;

      const data = raw.map((entry: any) => ({
        team: entry.team?.name ?? null,
        formation: entry.formation ?? null,
        coach: entry.coach?.name ?? null,
        startXI: (entry.startXI ?? []).map((p: any) => ({
          name: p.player?.name ?? null,
          number: p.player?.number ?? null,
          position: p.player?.pos ?? null,
        })),
        substitutes: (entry.substitutes ?? []).map((p: any) => ({
          name: p.player?.name ?? null,
          number: p.player?.number ?? null,
          position: p.player?.pos ?? null,
        })),
      }));

      this.lineupsCache.set(fixtureId, { data, expiresAt: now + DETAIL_CACHE_MS });
      return data;
    } catch (error) {
      this.logger.warn(`getLineups échec (${fixtureId}): ${error.message}`);
      return cached?.data ?? null;
    }
  }
}

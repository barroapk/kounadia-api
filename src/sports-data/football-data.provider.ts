import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Match, SportsDataProvider, StandingRow } from './sports-data-provider.interface';
import { HIERARCHY_BY_FOOTBALL_DATA_CODE } from '../config/competition-hierarchy';

@Injectable()
export class FootballDataProvider implements SportsDataProvider {
  private readonly baseUrl = 'https://api.football-data.org/v4';

  constructor(
    private http: HttpService,
    private configService: ConfigService,
  ) {}

  private get headers() {
    const token = this.configService.get<string>('FOOTBALL_DATA_API_KEY');
    return { 'X-Auth-Token': token };
  }

  private mapMatch(m: any): Match {
    return {
      id: m.id,
      competition: m.competition?.name ?? '',
      homeTeam: m.homeTeam?.name ?? '',
      awayTeam: m.awayTeam?.name ?? '',
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
      status: m.status,
      minute: m.minute ?? null,
      utcDate: m.utcDate,
      homeTeamCrest: m.homeTeam?.crest ?? null,
      awayTeamCrest: m.awayTeam?.crest ?? null,
      competitionEmblem: m.competition?.emblem ?? null,
      provider: 'football-data' as const,
      competitionCode: m.competition?.code ?? null,
      continent: HIERARCHY_BY_FOOTBALL_DATA_CODE[m.competition?.code]?.continent ?? 'Autre',
      country: HIERARCHY_BY_FOOTBALL_DATA_CODE[m.competition?.code]?.country ?? 'Autre',
      matchday: m.matchday ?? null,
      venue: m.venue ?? null,
      referee: m.referees?.[0]?.name ?? null,
      group: m.group ?? null,
      stage: m.stage ?? null,
    };
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  async getLiveMatches(): Promise<Match[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/matches?status=LIVE`, { headers: this.headers }),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }

  async getTodayMatches(): Promise<Match[]> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/matches`, { headers: this.headers }),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }

  async getRecentFinishedMatches(days: number): Promise<Match[]> {
    const safeDays = Math.min(days, 10);
    const dateTo = new Date();
    const dateFrom = new Date(Date.now() - safeDays * 86400000);

    const response = await firstValueFrom(
      this.http.get(
        `${this.baseUrl}/matches?dateFrom=${this.formatDate(dateFrom)}&dateTo=${this.formatDate(dateTo)}&status=FINISHED`,
        { headers: this.headers },
      ),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }

  async getMatchById(id: number): Promise<Match> {
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/matches/${id}`, { headers: this.headers }),
    );
    return this.mapMatch(response.data);
  }

  async getMatchesByDate(date: string): Promise<Match[]> {
    const requestedDate = new Date(date + 'T00:00:00Z');
    const dateTo = new Date(requestedDate.getTime() + 86400000);

    const response = await firstValueFrom(
      this.http.get(
        `${this.baseUrl}/matches?dateFrom=${date}&dateTo=${this.formatDate(dateTo)}`,
        { headers: this.headers },
      ),
    );

    return response.data.matches
      .map((m) => this.mapMatch(m))
      .filter((m) => m.utcDate.startsWith(date));
  }

  async getStandings(competitionCode: string, season?: string): Promise<StandingRow[]> {
    const seasonParam = season ? `?season=${season}` : '';
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/competitions/${competitionCode}/standings${seasonParam}`, {
        headers: this.headers,
      }),
    );

    const totalTable = response.data.standings.find((s: any) => s.type === 'TOTAL');
    if (!totalTable) return [];

    // Certaines compétitions (ex: Coupe du monde) n'exposent pas le groupe
    // sur l'endpoint /standings, seulement TOTAL/HOME/AWAY sans distinction.
    // Le groupe existe en revanche sur chaque match (m.group). On construit
    // donc la correspondance équipe -> groupe à partir des matchs, de façon
    // générique (fonctionne pour toute compétition à groupes, pas seulement WC).
    const teamToGroup = await this.getTeamGroupMap(competitionCode, season);

    // Le classement TOTAL de football-data.org est trié par position générale
    // (points décroissants toutes équipes confondues), pas par groupe. Il faut
    // regrouper les équipes du même groupe ensemble avant de les renvoyer,
    // sinon chaque groupe n'affiche qu'une seule équipe côté application.
    const rowsWithGroup = totalTable.table.map((row: any) => ({
      row,
      group: teamToGroup.get(row.team.name) ?? undefined,
    }));

    const hasGroups = rowsWithGroup.some((r: any) => r.group);
    if (hasGroups) {
      rowsWithGroup.sort((a: any, b: any) => {
        const groupCompare = (a.group ?? '').localeCompare(b.group ?? '');
        if (groupCompare !== 0) return groupCompare;
        return a.row.position - b.row.position;
      });
    }

    // Recalcule un rang local (1..4) au sein de chaque groupe, dérivé de
    // l'ordre déjà fourni par football-data.org (donc fiable), plutôt que
    // d'afficher la position globale du classement TOTAL (ex: "28e") qui
    // n'a pas de sens une fois les équipes séparées par groupe.
    const groupCounters = new Map<string, number>();
    return rowsWithGroup.map(({ row, group }: any) => {
      let localPosition = row.position;
      if (group) {
        const next = (groupCounters.get(group) ?? 0) + 1;
        groupCounters.set(group, next);
        localPosition = next;
      }
      return {
        position: localPosition,
        group,
        teamName: row.team.name,
      teamCrest: row.team.crest ?? null,
      playedGames: row.playedGames,
      won: row.won,
      draw: row.draw,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalDifference,
        points: row.points,
      };
    });
  }

  /**
   * Construit équipe -> groupe à partir des matchs, uniquement si de vrais
   * groupes existent (sinon retourne une map vide, sans coût inutile).
   * Générique : ne connaît aucune compétition par son code.
   */
  private async getTeamGroupMap(competitionCode: string, season?: string): Promise<Map<string, string>> {
    try {
      const matches = await this.getSeasonMatches(competitionCode, season);
      const map = new Map<string, string>();

      for (const m of matches) {
        if (!m.group) continue;
        if (!map.has(m.homeTeam)) map.set(m.homeTeam, m.group);
        if (!map.has(m.awayTeam)) map.set(m.awayTeam, m.group);
      }

      return map;
    } catch {
      return new Map();
    }
  }

  async getSeasonMatches(competitionCode: string, season?: string): Promise<Match[]> {
    const seasonParam = season ? `?season=${season}` : '';
    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/competitions/${competitionCode}/matches${seasonParam}`, {
        headers: this.headers,
      }),
    );
    return response.data.matches.map((m) => this.mapMatch(m));
  }
}

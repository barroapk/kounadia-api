import { Inject, Injectable, Logger } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type { SportsDataProvider } from '../sports-data/sports-data-provider.interface';
import { ApiFootballService, FixtureInfo } from '../api-football/api-football.service';
import { TeamFormService } from '../team-form/team-form.service';

interface BaseMatchInfo {
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

@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
    private teamFormService: TeamFormService,
    private apiFootball: ApiFootballService,
  ) {}

  async analyzeMatch(matchId: number, provider: 'football-data' | 'api-football' = 'football-data') {
    const matchInfo: BaseMatchInfo | null =
      provider === 'api-football'
        ? await this.apiFootball.getFixtureById(matchId)
        : await this.getFootballDataMatch(matchId);

    if (!matchInfo) {
      throw new Error(`Match introuvable (id=${matchId}, provider=${provider})`);
    }

    const home = await this.teamFormService.getTeamForm(matchInfo.homeTeam);
    const away = await this.teamFormService.getTeamForm(matchInfo.awayTeam);
    const headToHead = await this.getHeadToHeadSafe(matchInfo.homeTeam, matchInfo.awayTeam);
    const { statistics, lineups, events } = await this.getMatchDetailsSafe(matchId, provider, matchInfo);

    return {
      matchId,
      homeTeam: matchInfo.homeTeam,
      awayTeam: matchInfo.awayTeam,
      competition: matchInfo.competition,
      homeScore: matchInfo.homeScore,
      awayScore: matchInfo.awayScore,
      utcDate: matchInfo.utcDate,
      status: matchInfo.status,
      venue: matchInfo.venue,
      referee: matchInfo.referee,
      home,
      away,
      headToHead,
      statistics,
      lineups,
      events,
    };
  }

  private async getFootballDataMatch(matchId: number): Promise<BaseMatchInfo | null> {
    try {
      const match = await this.sportsDataProvider.getMatchById(matchId);
      return {
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        competition: match.competition,
        homeScore: match.homeScore ?? null,
        awayScore: match.awayScore ?? null,
        utcDate: match.utcDate,
        status: match.status,
        venue: match.venue ?? null,
        referee: match.referee ?? null,
      };
    } catch (error) {
      this.logger.error(`getFootballDataMatch échec (${matchId}): ${error.message}`);
      return null;
    }
  }

  private async getHeadToHeadSafe(homeTeam: string, awayTeam: string) {
    try {
      return await this.apiFootball.getHeadToHead(homeTeam, awayTeam);
    } catch (error) {
      this.logger.warn(`Head-to-head indisponible pour ${homeTeam} vs ${awayTeam}: ${error.message}`);
      return { available: false };
    }
  }

  private async getMatchDetailsSafe(
    matchId: number,
    provider: 'football-data' | 'api-football',
    matchInfo: BaseMatchInfo,
  ): Promise<{ statistics: any; lineups: any; events: any }> {
    try {
      const fixtureId =
        provider === 'api-football'
          ? matchId
          : await this.apiFootball.findFixtureId(matchInfo.homeTeam, matchInfo.awayTeam, matchInfo.utcDate);

      if (!fixtureId) return { statistics: null, lineups: null, events: null };

      const [statistics, lineups, events] = await Promise.all([
        this.apiFootball.getMatchStatistics(fixtureId),
        this.apiFootball.getLineups(fixtureId),
        this.apiFootball.getMatchEvents(fixtureId),
      ]);

      return { statistics, lineups, events };
    } catch (error) {
      this.logger.warn(
        `Détails indisponibles pour ${matchInfo.homeTeam} vs ${matchInfo.awayTeam}: ${error.message}`,
      );
      return { statistics: null, lineups: null, events: null };
    }
  }
}

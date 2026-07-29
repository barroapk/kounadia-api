import { Inject, Injectable, Logger } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type { SportsDataProvider } from '../sports-data/sports-data-provider.interface';
import { ApiFootballService } from '../api-football/api-football.service';
import { TeamFormService } from '../team-form/team-form.service';

@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
    private teamFormService: TeamFormService,
    private apiFootball: ApiFootballService,
  ) {}

  async analyzeMatch(matchId: number) {
    const match = await this.sportsDataProvider.getMatchById(matchId);
    const home = await this.teamFormService.getTeamForm(match.homeTeam);
    const away = await this.teamFormService.getTeamForm(match.awayTeam);
    const headToHead = await this.getHeadToHeadSafe(
      match.homeTeam,
      match.awayTeam,
    );

    return {
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      utcDate: match.utcDate,
      status: match.status,
      venue: match.venue ?? null,
      referee: match.referee ?? null,
      home,
      away,
      headToHead,
    };
  }

  private async getHeadToHeadSafe(homeTeam: string, awayTeam: string) {
    try {
      return await this.apiFootball.getHeadToHead(homeTeam, awayTeam);
    } catch (error) {
      this.logger.warn(
        `Head-to-head indisponible pour ${homeTeam} vs ${awayTeam}: ${error.message}`,
      );
      return { available: false };
    }
  }
}

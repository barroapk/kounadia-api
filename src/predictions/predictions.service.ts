import { Injectable } from '@nestjs/common';
import { MatchesService } from '../matches/matches.service';
import { TeamFormService, TeamForm } from '../team-form/team-form.service';

const MIN_MATCHES_FOR_ELIGIBILITY = 3;

export interface EligibleMatch {
  matchId: number;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeForm: TeamForm;
  awayForm: TeamForm;
  favoredSide: 'home' | 'away' | 'balanced';
  note: string;
}

@Injectable()
export class PredictionsService {
  constructor(
    private matchesService: MatchesService,
    private teamFormService: TeamFormService,
  ) {}

  async getTodaysEligibleMatches(): Promise<EligibleMatch[]> {
    const matches = await this.matchesService.getTodayMatches();
    const eligible: EligibleMatch[] = [];

    for (const match of matches) {
      const homeForm = await this.teamFormService.getTeamForm(match.homeTeam);
      const awayForm = await this.teamFormService.getTeamForm(match.awayTeam);

      const hasEnoughData =
        homeForm.matchesAnalyzed >= MIN_MATCHES_FOR_ELIGIBILITY &&
        awayForm.matchesAnalyzed >= MIN_MATCHES_FOR_ELIGIBILITY;

      if (!hasEnoughData) continue;

      const formGap = homeForm.formPercent - awayForm.formPercent;
      let favoredSide: 'home' | 'away' | 'balanced';
      let note: string;

      if (formGap > 20) {
        favoredSide = 'home';
        note = `${match.homeTeam} affiche une forme nettement supérieure sur ses derniers matchs (${homeForm.formPercent}% contre ${awayForm.formPercent}%).`;
      } else if (formGap < -20) {
        favoredSide = 'away';
        note = `${match.awayTeam} affiche une forme nettement supérieure sur ses derniers matchs (${awayForm.formPercent}% contre ${homeForm.formPercent}%).`;
      } else {
        favoredSide = 'balanced';
        note = `Les deux équipes montrent une forme comparable (${homeForm.formPercent}% contre ${awayForm.formPercent}%).`;
      }

      eligible.push({
        matchId: match.id,
        competition: match.competition,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeForm,
        awayForm,
        favoredSide,
        note,
      });
    }

    return eligible;
  }
}

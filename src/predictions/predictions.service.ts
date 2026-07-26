import { Injectable } from '@nestjs/common';
import { MatchesService } from '../matches/matches.service';
import { TeamFormService, TeamForm } from '../team-form/team-form.service';
import { EloService } from '../elo/elo.service';

const MIN_MATCHES_FOR_ELIGIBILITY = 3;
const MIN_CONTEXT_MATCHES = 5;
const ELO_THRESHOLD = 50;

export interface EligibleMatch {
  matchId: number;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeForm: TeamForm;
  awayForm: TeamForm;
  homeElo: number;
  awayElo: number;
  favoredSide: 'home' | 'away' | 'balanced';
  note: string;
}

@Injectable()
export class PredictionsService {
  constructor(
    private matchesService: MatchesService,
    private teamFormService: TeamFormService,
    private eloService: EloService,
  ) {}

  async getTodaysEligibleMatches(): Promise<EligibleMatch[]> {
    const matches = await this.matchesService.getTodayMatches();
    const eligible: EligibleMatch[] = [];

    for (const match of matches) {
      const homeForm = await this.teamFormService.getTeamForm(match.homeTeam);
      const awayForm = await this.teamFormService.getTeamForm(match.awayTeam);
      const homeRatings = await this.eloService.getRatings(match.homeTeam);
      const awayRatings = await this.eloService.getRatings(match.awayTeam);

      const hasEnoughData =
        homeForm.matchesAnalyzed >= MIN_MATCHES_FOR_ELIGIBILITY &&
        awayForm.matchesAnalyzed >= MIN_MATCHES_FOR_ELIGIBILITY &&
        homeRatings.homeMatches >= MIN_CONTEXT_MATCHES &&
        awayRatings.awayMatches >= MIN_CONTEXT_MATCHES;

      if (!hasEnoughData) continue;

      const homeElo = Math.round(homeRatings.homeRating);
      const awayElo = Math.round(awayRatings.awayRating);
      const eloDiff = homeElo - awayElo;

      let favoredSide: 'home' | 'away' | 'balanced';
      let note: string;

      if (eloDiff > ELO_THRESHOLD) {
        favoredSide = 'home';
        note = `${match.homeTeam} est plus fort à domicile (${homeElo}) que ${match.awayTeam} à l'extérieur (${awayElo}), sur la base de leurs historiques respectifs dans ce contexte.`;
      } else if (eloDiff < -ELO_THRESHOLD) {
        favoredSide = 'away';
        note = `${match.awayTeam} est plus fort à l'extérieur (${awayElo}) que ${match.homeTeam} ne l'est à domicile (${homeElo}).`;
      } else {
        favoredSide = 'balanced';
        note = `Forces comparables dans leur contexte respectif (domicile ${homeElo} contre extérieur ${awayElo}) : match difficile à départager.`;
      }

      eligible.push({
        matchId: match.id,
        competition: match.competition,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeForm,
        awayForm,
        homeElo,
        awayElo,
        favoredSide,
        note,
      });
    }

    return eligible;
  }
}

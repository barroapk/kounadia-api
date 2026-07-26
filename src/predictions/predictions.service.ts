import { Injectable } from '@nestjs/common';
import { MatchesService } from '../matches/matches.service';
import { TeamFormService, TeamForm } from '../team-form/team-form.service';
import { EloService } from '../elo/elo.service';
import { SupabaseService } from '../supabase/supabase.service';

const MIN_MATCHES_FOR_ELIGIBILITY = 3;
const MIN_ELO_MATCHES = 5;
const HOME_ADVANTAGE = 100;
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
    private supabase: SupabaseService,
  ) {}

  private async getEloMatchesPlayed(teamName: string): Promise<number> {
    const { data } = await this.supabase.client
      .from('team_ratings')
      .select('matches_played')
      .eq('team_name', teamName)
      .maybeSingle();
    return data?.matches_played ?? 0;
  }

  async getTodaysEligibleMatches(): Promise<EligibleMatch[]> {
    const matches = await this.matchesService.getTodayMatches();
    const eligible: EligibleMatch[] = [];

    for (const match of matches) {
      const homeForm = await this.teamFormService.getTeamForm(match.homeTeam);
      const awayForm = await this.teamFormService.getTeamForm(match.awayTeam);

      const homeEloMatches = await this.getEloMatchesPlayed(match.homeTeam);
      const awayEloMatches = await this.getEloMatchesPlayed(match.awayTeam);

      const hasEnoughData =
        homeForm.matchesAnalyzed >= MIN_MATCHES_FOR_ELIGIBILITY &&
        awayForm.matchesAnalyzed >= MIN_MATCHES_FOR_ELIGIBILITY &&
        homeEloMatches >= MIN_ELO_MATCHES &&
        awayEloMatches >= MIN_ELO_MATCHES;

      if (!hasEnoughData) continue;

      const homeElo = await this.eloService.getRating(match.homeTeam);
      const awayElo = await this.eloService.getRating(match.awayTeam);
      const adjustedHomeElo = Math.round(homeElo + HOME_ADVANTAGE);
      const roundedAwayElo = Math.round(awayElo);
      const eloDiff = adjustedHomeElo - roundedAwayElo;

      let favoredSide: 'home' | 'away' | 'balanced';
      let note: string;

      if (eloDiff > ELO_THRESHOLD) {
        favoredSide = 'home';
        note = `${match.homeTeam} présente une force effective supérieure à domicile (${adjustedHomeElo}, avantage du terrain inclus, contre ${roundedAwayElo} pour ${match.awayTeam}).`;
      } else if (eloDiff < -ELO_THRESHOLD) {
        favoredSide = 'away';
        note = `${match.awayTeam} présente une force supérieure (${roundedAwayElo}), suffisante pour compenser l'avantage du terrain de ${match.homeTeam} (${adjustedHomeElo}).`;
      } else {
        favoredSide = 'balanced';
        note = `Forces effectives proches une fois l'avantage du terrain pris en compte (${adjustedHomeElo} contre ${roundedAwayElo}) : match difficile à départager.`;
      }

      eligible.push({
        matchId: match.id,
        competition: match.competition,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeForm,
        awayForm,
        homeElo: Math.round(homeElo),
        awayElo: roundedAwayElo,
        favoredSide,
        note,
      });
    }

    return eligible;
  }
}

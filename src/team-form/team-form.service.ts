import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface TeamForm {
  matchesAnalyzed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  maxPoints: number;
  formPercent: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  cleanSheets: number;
  failedToScore: number;
}

@Injectable()
export class TeamFormService {
  constructor(private supabase: SupabaseService) {}

  async getTeamForm(teamName: string): Promise<TeamForm> {
    const { data, error } = await this.supabase.client
      .from('match_history')
      .select('*')
      .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
      .order('utc_date', { ascending: false })
      .limit(5);

    if (error) throw error;

    const form: TeamForm = {
      matchesAnalyzed: data.length,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      maxPoints: data.length * 3,
      formPercent: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      avgGoalsFor: 0,
      avgGoalsAgainst: 0,
      cleanSheets: 0,
      failedToScore: 0,
    };

    for (const m of data) {
      const isHome = m.home_team === teamName;
      const teamGoals = isHome ? m.home_score : m.away_score;
      const opponentGoals = isHome ? m.away_score : m.home_score;

      form.goalsFor += teamGoals ?? 0;
      form.goalsAgainst += opponentGoals ?? 0;

      if (teamGoals > opponentGoals) {
        form.wins++;
        form.points += 3;
      } else if (teamGoals === opponentGoals) {
        form.draws++;
        form.points += 1;
      } else {
        form.losses++;
      }

      if (opponentGoals === 0) form.cleanSheets++;
      if (teamGoals === 0) form.failedToScore++;
    }

    form.goalDifference = form.goalsFor - form.goalsAgainst;
    form.formPercent =
      form.maxPoints > 0
        ? Math.round((form.points / form.maxPoints) * 1000) / 10
        : 0;
    form.avgGoalsFor =
      form.matchesAnalyzed > 0
        ? Math.round((form.goalsFor / form.matchesAnalyzed) * 10) / 10
        : 0;
    form.avgGoalsAgainst =
      form.matchesAnalyzed > 0
        ? Math.round((form.goalsAgainst / form.matchesAnalyzed) * 10) / 10
        : 0;

    return form;
  }
}

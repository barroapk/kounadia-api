export interface Match {
  id: number;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: number | null;
  utcDate: string;
  liveMinuteLabel?: string | null;
  homeTeamCrest?: string | null;
  awayTeamCrest?: string | null;
  competitionEmblem?: string | null;
  provider: 'football-data' | 'api-football';
  competitionCode?: string | null;
  leagueId?: number | null;
  continent?: string;
  country?: string;
  matchday?: number | null;
  venue?: string | null;
  referee?: string | null;
  // Précise comment un match FINISHED a été décidé, quand ce n'est pas le
  // temps réglementaire seul. Absent = décidé en 90 minutes normales.
  wonAfter?: 'AET' | 'PEN' | null;
}

export interface StandingRow {
  position: number;
  group?: string;
  teamName: string;
  teamCrest: string | null;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface SportsDataProvider {
  getLiveMatches(): Promise<Match[]>;
  getTodayMatches(): Promise<Match[]>;
  getRecentFinishedMatches(days: number): Promise<Match[]>;
  getMatchById(id: number): Promise<Match>;
  getMatchesByDate(date: string): Promise<Match[]>;
  getStandings(competitionCode: string, season?: string): Promise<StandingRow[]>;
  getSeasonMatches(competitionCode: string, season?: string): Promise<Match[]>;
}

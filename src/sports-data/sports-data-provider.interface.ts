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
}

export interface SportsDataProvider {
  getLiveMatches(): Promise<Match[]>;
  getTodayMatches(): Promise<Match[]>;
  getRecentFinishedMatches(days: number): Promise<Match[]>;
  getMatchById(id: number): Promise<Match>;
}

export interface EloMatch {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  utcDate: string;
  competition: string;
}

export interface TeamEloState {
  team: string;
  rating: number;
  matchesUsed: number;
  firstMatchDate: string | null;
  lastMatchDate: string | null;
}

export interface EloPredictionExplained {
  modelVersion: string;
  homeTeam: string;
  awayTeam: string;
  homeRating: number;
  awayRating: number;
  homeAdvantage: number;
  kFactor: number;
  homeMatchesUsed: number;
  awayMatchesUsed: number;
  probabilities: {
    home: number;
    draw: number;
    away: number;
  };
}

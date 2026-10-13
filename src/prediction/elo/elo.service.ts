import { Injectable, Logger } from '@nestjs/common';
import { EloMatch, TeamEloState, EloPredictionExplained } from './elo.types';

@Injectable()
export class EloService {
  private readonly logger = new Logger(EloService.name);

  /**
   * elo_v1 - FIGE. Valide par backtest sur 3326 matchs (Premier League,
   * Primera Division, Bundesliga), teste sur un holdout temporel de 954
   * matchs jamais utilise pour choisir ces parametres :
   *   Brier=0.5965  LogLoss=1.0004  RPS=0.2032
   * Bat les baselines uniforme (Brier=0.6667) et frequence historique
   * (Brier=0.6497). Un candidat elo_v2 (K=25) a ete teste sur le meme
   * holdout et n'a pas fait mieux - conserver ces valeurs telles quelles,
   * ne pas re-optimiser sans repeter tout le protocole (dev/test gele).
   *
   * IMPORTANT : toute modification de ces constantes doit s'appeler
   * elo_v2 (nouvelle version), jamais une modification silencieuse de v1.
   */
  static readonly MODEL_VERSION = 'elo_v1';
  private readonly INITIAL_RATING = 1500;
  private readonly HOME_ADVANTAGE = 60;
  private readonly K_FACTOR = 20;

  // Seuil experimental : sous ce nombre de matchs, la prediction est
  // encore consideree comme peu fiable (pas encore valide par un test
  // dedie, cf. le rapport "par anciennete" qui n'a pas montre de seuil
  // net - a garder a l'esprit avant de s'appuyer sur ce chiffre).
  static readonly MIN_RELIABLE_MATCHES = 3;

  private expectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }

  private goalDifferenceMultiplier(goalDiff: number): number {
    const absDiff = Math.abs(goalDiff);
    if (absDiff <= 1) return 1;
    if (absDiff === 2) return 1.5;
    return (11 + absDiff) / 8;
  }

  /**
   * Calcule les ratings Elo de toutes les equipes d'UNE competition, a
   * partir de son historique, en ordre chronologique strict. Les
   * competitions ne sont jamais melangees (chaque championnat a ses
   * propres ratings) - c'est le protocole valide par le backtest.
   */
  computeRatings(matches: EloMatch[]): Map<string, TeamEloState> {
    const ratings = new Map<string, TeamEloState>();

    const sorted = [...matches].sort(
      (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime(),
    );

    const getOrCreate = (team: string): TeamEloState => {
      if (!ratings.has(team)) {
        ratings.set(team, {
          team,
          rating: this.INITIAL_RATING,
          matchesUsed: 0,
          firstMatchDate: null,
          lastMatchDate: null,
        });
      }
      return ratings.get(team)!;
    };

    for (const match of sorted) {
      const home = getOrCreate(match.homeTeam);
      const away = getOrCreate(match.awayTeam);

      const homeRatingAdjusted = home.rating + this.HOME_ADVANTAGE;
      const expectedHome = this.expectedScore(homeRatingAdjusted, away.rating);
      const expectedAway = 1 - expectedHome;

      let actualHome: number;
      let actualAway: number;
      if (match.homeScore > match.awayScore) {
        actualHome = 1;
        actualAway = 0;
      } else if (match.homeScore < match.awayScore) {
        actualHome = 0;
        actualAway = 1;
      } else {
        actualHome = 0.5;
        actualAway = 0.5;
      }

      const goalDiff = match.homeScore - match.awayScore;
      const multiplier = this.goalDifferenceMultiplier(goalDiff);

      home.rating += this.K_FACTOR * multiplier * (actualHome - expectedHome);
      away.rating += this.K_FACTOR * multiplier * (actualAway - expectedAway);

      home.matchesUsed += 1;
      away.matchesUsed += 1;
      if (!home.firstMatchDate) home.firstMatchDate = match.utcDate;
      if (!away.firstMatchDate) away.firstMatchDate = match.utcDate;
      home.lastMatchDate = match.utcDate;
      away.lastMatchDate = match.utcDate;
    }

    return ratings;
  }

  /**
   * Produit une prediction 1X2 traçable : jamais juste des probabilites
   * brutes, toujours accompagnees des ratings et du contexte qui les ont
   * produites, pour qu'une prediction KOUNADIA soit toujours explicable.
   *
   * La formule du nul est une approximation empirique NON VALIDEE par
   * calibration independante (voir calibration multiclasses : le nul
   * s'est avere raisonnablement bien calibre sur le test final, mais ce
   * n'est pas une preuve definitive). A revoir si une future calibration
   * dediee au nul montre un biais clair.
   */
  predictMatch(
    homeTeam: string,
    awayTeam: string,
    homeState: TeamEloState,
    awayState: TeamEloState,
  ): EloPredictionExplained {
    const homeRatingAdjusted = homeState.rating + this.HOME_ADVANTAGE;
    const expectedHome = this.expectedScore(homeRatingAdjusted, awayState.rating);

    const distanceFromEven = Math.abs(expectedHome - 0.5) * 2;
    const drawProbability = 0.28 * (1 - distanceFromEven) + 0.20 * distanceFromEven;

    const remaining = 1 - drawProbability;
    const homeWinProbability = expectedHome * remaining;
    const awayWinProbability = (1 - expectedHome) * remaining;

    return {
      modelVersion: EloService.MODEL_VERSION,
      homeTeam,
      awayTeam,
      homeRating: Math.round(homeState.rating * 10) / 10,
      awayRating: Math.round(awayState.rating * 10) / 10,
      homeAdvantage: this.HOME_ADVANTAGE,
      kFactor: this.K_FACTOR,
      homeMatchesUsed: homeState.matchesUsed,
      awayMatchesUsed: awayState.matchesUsed,
      probabilities: {
        home: Math.round(homeWinProbability * 1000) / 1000,
        draw: Math.round(drawProbability * 1000) / 1000,
        away: Math.round(awayWinProbability * 1000) / 1000,
      },
    };
  }
}

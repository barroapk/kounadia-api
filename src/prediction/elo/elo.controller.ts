import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { EloRatingService } from './elo-rating.service';

@Controller('prediction/elo')
export class EloController {
  constructor(private readonly eloRatingService: EloRatingService) {}

  /**
   * GET /prediction/elo/predict?competition=Premier League&home=Arsenal FC&away=Chelsea FC
   * Reserve pour l'instant aux 3 competitions validees par backtest :
   * Premier League, Primera Division, Bundesliga.
   */
  @Get('predict')
  async predict(
    @Query('competition') competition: string,
    @Query('home') home: string,
    @Query('away') away: string,
  ) {
    if (!competition || !home || !away) {
      throw new NotFoundException('Parametres requis : competition, home, away');
    }

    const prediction = await this.eloRatingService.predictMatch(competition, home, away);

    if (!prediction) {
      throw new NotFoundException({
        message: "Prediction indisponible : une des deux equipes n'a pas d'historique dans cette competition",
        competition,
        home,
        away,
      });
    }

    return prediction;
  }
}

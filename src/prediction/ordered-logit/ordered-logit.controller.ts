import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { OrderedLogitRatingService } from './ordered-logit-rating.service';

@Controller('prediction/ordered-logit')
export class OrderedLogitController {
  constructor(private readonly orderedLogitRatingService: OrderedLogitRatingService) {}

  /**
   * GET /prediction/ordered-logit/predict?competition=Premier League&home=Arsenal FC&away=Chelsea FC
   * Reserve aux 3 competitions validees : Premier League, Primera Division, Bundesliga.
   * Modele candidat (ordered_logit_v1), pas encore adopte comme reference
   * de production - voir Elo v1 pour la reference actuelle.
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

    const prediction = await this.orderedLogitRatingService.predictMatch(competition, home, away);

    if (!prediction) {
      throw new NotFoundException({
        message: "Prediction indisponible : historique insuffisant ou equipe(s) inconnue(s)",
        competition,
        home,
        away,
      });
    }

    return prediction;
  }
}

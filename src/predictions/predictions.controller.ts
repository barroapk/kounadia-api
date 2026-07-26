import { Controller, Get } from '@nestjs/common';
import { PredictionsService } from './predictions.service';

@Controller('predictions')
export class PredictionsController {
  constructor(private predictionsService: PredictionsService) {}

  @Get('today')
  getToday() {
    return this.predictionsService.getTodaysEligibleMatches();
  }
}

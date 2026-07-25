import { Controller, Get } from '@nestjs/common';
import { MatchesService } from './matches.service';

@Controller('matches')
export class MatchesController {
  constructor(private matchesService: MatchesService) {}

  @Get('live')
  getLive() {
    return this.matchesService.getLiveMatches();
  }

  @Get('today')
  getToday() {
    return this.matchesService.getTodayMatches();
  }
}

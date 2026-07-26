import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
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

  @Get('by-date')
  getByDate(@Query('date') date: string) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException(
        'Paramètre "date" requis, format attendu : AAAA-MM-JJ',
      );
    }
    return this.matchesService.getMatchesByDate(date);
  }
}

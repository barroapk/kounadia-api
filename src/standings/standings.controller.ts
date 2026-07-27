import { Controller, Get, Param } from '@nestjs/common';
import { StandingsService } from './standings.service';

@Controller('standings')
export class StandingsController {
  constructor(private standingsService: StandingsService) {}

  @Get(':competitionCode')
  getStandings(@Param('competitionCode') competitionCode: string) {
    return this.standingsService.getStandings(competitionCode);
  }
}

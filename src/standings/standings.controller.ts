import { Controller, Get, Param, Query } from '@nestjs/common';
import { StandingsService } from './standings.service';

@Controller('standings')
export class StandingsController {
  constructor(private standingsService: StandingsService) {}

  @Get(':competitionCode')
  getStandings(
    @Param('competitionCode') competitionCode: string,
    @Query('season') season?: string,
  ) {
    return this.standingsService.getStandings(competitionCode, season);
  }
}

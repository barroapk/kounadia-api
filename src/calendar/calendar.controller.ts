import { Controller, Get, Param, Query } from '@nestjs/common';
import { CalendarService } from './calendar.service';

@Controller('calendar')
export class CalendarController {
  constructor(private calendarService: CalendarService) {}

  @Get(':competitionCode')
  getCalendar(
    @Param('competitionCode') competitionCode: string,
    @Query('season') season?: string,
  ) {
    return this.calendarService.getCalendar(competitionCode, season);
  }
}

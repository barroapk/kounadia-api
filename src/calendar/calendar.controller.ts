import { Controller, Get, Param } from '@nestjs/common';
import { CalendarService } from './calendar.service';

@Controller('calendar')
export class CalendarController {
  constructor(private calendarService: CalendarService) {}

  @Get(':competitionCode')
  getCalendar(@Param('competitionCode') competitionCode: string) {
    return this.calendarService.getCalendar(competitionCode);
  }
}

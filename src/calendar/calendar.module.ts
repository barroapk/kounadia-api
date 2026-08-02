import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { SportsDataModule } from '../sports-data/sports-data.module';
import { ApiFootballModule } from '../api-football/api-football.module';

@Module({
  imports: [SportsDataModule, ApiFootballModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}

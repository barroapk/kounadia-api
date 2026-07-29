import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { SportsDataModule } from '../sports-data/sports-data.module';

@Module({
  imports: [SportsDataModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}

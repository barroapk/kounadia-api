import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExtraCompetitionsService } from './extra-competitions.service';

@Module({
  imports: [HttpModule],
  providers: [ExtraCompetitionsService],
  exports: [ExtraCompetitionsService],
})
export class ExtraCompetitionsModule {}

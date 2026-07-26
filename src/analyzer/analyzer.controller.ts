import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AnalyzerService } from './analyzer.service';

@Controller('analyzer')
export class AnalyzerController {
  constructor(private analyzerService: AnalyzerService) {}

  @Get(':matchId')
  analyze(@Param('matchId', ParseIntPipe) matchId: number) {
    return this.analyzerService.analyzeMatch(matchId);
  }
}

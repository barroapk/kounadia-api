import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { AnalyzerService } from './analyzer.service';

@Controller('analyzer')
export class AnalyzerController {
  constructor(private analyzerService: AnalyzerService) {}

  @Get(':matchId')
  analyze(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Query('provider') provider?: string,
  ) {
    return this.analyzerService.analyzeMatch(matchId, provider === 'api-football' ? 'api-football' : 'football-data');
  }
}

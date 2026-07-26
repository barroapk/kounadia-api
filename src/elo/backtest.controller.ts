import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BacktestService } from './backtest.service';

@Controller('admin')
export class BacktestController {
  constructor(
    private backtestService: BacktestService,
    private configService: ConfigService,
  ) {}

  @Get('backtest')
  async run(
    @Query('secret') secret: string,
    @Query('competition') competition?: string,
    @Query('kHomeAdvantage') kHomeAdvantage?: string,
  ) {
    const expected = this.configService.get<string>('SYNC_SECRET');
    if (!expected || secret !== expected) throw new ForbiddenException('Clé secrète invalide');
    return this.backtestService.runBacktest(competition, kHomeAdvantage ? parseInt(kHomeAdvantage, 10) : 4);
  }
}

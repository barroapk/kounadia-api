import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';

import {
  BacktestOptions,
  BrvmBacktestService,
} from './brvm-backtest.service';

@Controller('stocks/brvm/backtest')
export class BrvmBacktestController {
  constructor(
    private readonly backtestService: BrvmBacktestService,
  ) {}

  @Get('all')
  async backtestAll(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('initialCapital') initialCapital?: string,
    @Query('feeRate') feeRate?: string,
    @Query('slippageRate') slippageRate?: string,
    @Query('positionSizeRate') positionSizeRate?: string,
    @Query('maxHoldingSessions') maxHoldingSessions?: string,
  ) {
    const options: BacktestOptions = {
      from,
      to,

      initialCapital:
        initialCapital !== undefined
          ? Number(initialCapital)
          : undefined,

      feeRate:
        feeRate !== undefined
          ? Number(feeRate)
          : undefined,

      slippageRate:
        slippageRate !== undefined
          ? Number(slippageRate)
          : undefined,

      positionSizeRate:
        positionSizeRate !== undefined
          ? Number(positionSizeRate)
          : undefined,

      maxHoldingSessions:
        maxHoldingSessions !== undefined
          ? Number(maxHoldingSessions)
          : undefined,
    };

    return this.backtestService.backtestAll(options);
  }

  @Get(':ticker')
  async backtestTicker(
    @Param('ticker') ticker: string,

    @Query('from') from?: string,
    @Query('to') to?: string,

    @Query('initialCapital')
    initialCapital?: string,

    @Query('feeRate')
    feeRate?: string,

    @Query('slippageRate')
    slippageRate?: string,

    @Query('positionSizeRate')
    positionSizeRate?: string,

    @Query('maxHoldingSessions')
    maxHoldingSessions?: string,
  ) {
    const options: BacktestOptions = {
      from,
      to,

      initialCapital:
        initialCapital !== undefined
          ? Number(initialCapital)
          : undefined,

      feeRate:
        feeRate !== undefined
          ? Number(feeRate)
          : undefined,

      slippageRate:
        slippageRate !== undefined
          ? Number(slippageRate)
          : undefined,

      positionSizeRate:
        positionSizeRate !== undefined
          ? Number(positionSizeRate)
          : undefined,

      maxHoldingSessions:
        maxHoldingSessions !== undefined
          ? Number(maxHoldingSessions)
          : undefined,
    };

    return this.backtestService.backtestTicker(
      ticker,
      options,
    );
  }
}

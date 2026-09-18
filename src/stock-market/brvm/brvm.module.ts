import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BrvmService } from './brvm.service';
import { GitHubBrvmProvider } from './github-brvm.provider';
import { BRVM_DATA_PROVIDER } from './brvm-data.constants';
import { BrvmController } from './brvm.controller';
import { BrvmIndicatorsService } from './brvm-indicators.service';
import { BrvmTradingService } from './brvm-trading.service';
import { BrvmLiveScheduler } from './brvm-live.scheduler';
import { BrvmLiveService } from './brvm-live.service';
import { BrvmSevenService } from './brvm-seven.service';
import { BrvmEntryService } from './brvm-entry.service';
import { BrvmBacktestService } from './brvm-backtest.service';
import { BrvmBacktestController } from './brvm-backtest.controller';

@Module({
  controllers: [BrvmController, BrvmBacktestController],
  imports: [HttpModule],
  providers: [
    BrvmService,
    BrvmIndicatorsService,
    BrvmTradingService,
    BrvmLiveScheduler,
    BrvmLiveService,
    BrvmSevenService,
    BrvmEntryService,
    BrvmBacktestService,
    {
      provide: BRVM_DATA_PROVIDER,
      useClass: GitHubBrvmProvider,
    },
  ],
  exports: [BrvmService, BrvmIndicatorsService, BrvmTradingService,
    BrvmLiveScheduler, BrvmLiveService, BrvmSevenService,
    BrvmEntryService,
    BrvmBacktestService,
  ],
})
export class BrvmModule {}

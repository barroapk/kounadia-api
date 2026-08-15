import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BrvmService } from './brvm.service';
import { GitHubBrvmProvider } from './github-brvm.provider';
import { BRVM_DATA_PROVIDER } from './brvm-data.constants';
import { BrvmController } from './brvm.controller';
import { BrvmIndicatorsService } from './brvm-indicators.service';

@Module({
  controllers: [BrvmController],
  imports: [HttpModule],
  providers: [
    BrvmService,
    BrvmIndicatorsService,
    {
      provide: BRVM_DATA_PROVIDER,
      useClass: GitHubBrvmProvider,
    },
  ],
  exports: [BrvmService, BrvmIndicatorsService],
})
export class BrvmModule {}

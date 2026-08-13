import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BrvmService } from './brvm.service';
import { GitHubBrvmProvider } from './github-brvm.provider';
import { BRVM_DATA_PROVIDER } from './brvm-data.constants';
import { BrvmController } from './brvm.controller';

@Module({
  controllers: [BrvmController],
  imports: [HttpModule],
  providers: [
    BrvmService,
    {
      provide: BRVM_DATA_PROVIDER,
      useClass: GitHubBrvmProvider,
    },
  ],
  exports: [BrvmService],
})
export class BrvmModule {}

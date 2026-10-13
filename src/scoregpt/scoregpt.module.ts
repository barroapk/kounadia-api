import { Module } from '@nestjs/common';
import { ScoregptController } from './scoregpt.controller';
import { ScoregptService } from './scoregpt.service';

@Module({
  controllers: [ScoregptController],
  providers: [ScoregptService],
})
export class ScoregptModule {}

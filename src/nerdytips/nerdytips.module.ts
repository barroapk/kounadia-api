import { Module } from '@nestjs/common';
import { NerdytipsController } from './nerdytips.controller';
import { NerdytipsService } from './nerdytips.service';

@Module({
  controllers: [NerdytipsController],
  providers: [NerdytipsService],
})
export class NerdytipsModule {}

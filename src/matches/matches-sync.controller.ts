import {
  Controller,
  ForbiddenException,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MatchesSyncService } from './matches-sync.service';

@Controller('matches')
export class MatchesSyncController {
  constructor(
    private matchesSyncService: MatchesSyncService,
    private configService: ConfigService,
  ) {}

  @Post('sync')
  async sync(
    @Query('secret') secret: string,
    @Query('days') days?: string,
  ) {
    const expected = this.configService.get<string>('SYNC_SECRET');
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Clé secrète invalide');
    }
    const parsedDays = days ? parseInt(days, 10) : 3;
    return this.matchesSyncService.syncFinishedMatches(parsedDays);
  }
}

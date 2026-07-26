import { Controller, ForbiddenException, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EloService } from './elo.service';

@Controller('admin')
export class EloController {
  constructor(
    private eloService: EloService,
    private configService: ConfigService,
  ) {}

  @Post('rebuild-ratings')
  async rebuild(@Query('secret') secret: string) {
    const expected = this.configService.get<string>('SYNC_SECRET');
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Clé secrète invalide');
    }
    return this.eloService.initializeFromHistory();
  }
}

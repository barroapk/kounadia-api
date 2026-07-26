import {
  Controller,
  ForbiddenException,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SeasonImportService } from './season-import.service';

@Controller('admin')
export class SeasonImportController {
  constructor(
    private seasonImportService: SeasonImportService,
    private configService: ConfigService,
  ) {}

  @Post('import-season')
  async importSeason(
    @Query('secret') secret: string,
    @Query('season') season: string,
  ) {
    const expected = this.configService.get<string>('SYNC_SECRET');
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Clé secrète invalide');
    }
    return this.seasonImportService.importSeason(parseInt(season, 10));
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiFootballService } from './api-football.service';

@Controller('api-football')
export class ApiFootballController {
  constructor(private apiFootballService: ApiFootballService) {}

  @Get('test-search')
  async testSearch(@Query('team') team: string) {
    const id = await this.apiFootballService.searchTeam(team);
    return { team, apiFootballId: id };
  }
}

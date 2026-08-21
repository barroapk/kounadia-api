import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { BrvmService } from './brvm.service';
import { BrvmIndicatorsService } from './brvm-indicators.service';
import { BrvmTradingService } from './brvm-trading.service';
import { BrvmLiveService } from './brvm-live.service';

@Controller('stocks/brvm')
export class BrvmController {
  constructor(
    private readonly brvmService: BrvmService,
    private readonly indicatorsService: BrvmIndicatorsService,
    private readonly tradingService: BrvmTradingService,
    private readonly liveService: BrvmLiveService,
  ) {}

  @Get()
  async getCatalog() {
    return this.brvmService.getCatalog();
  }

  @Get('quotes')
  async getAllQuotes() {
    return { quotes: await this.brvmService.getAllQuotes() };
  }

  @Get('indices')
  async getIndices() {
    return { indices: await this.brvmService.getIndexQuotes() };
  }

  @Get('live')
  async getLiveQuotes() {
    const quotes = await this.liveService.getLiveQuotes();
    return {
      count: quotes.length,
      source: 'brvm_official',
      fetchedAt: new Date().toISOString(),
      quotes,
    };
  }

  @Get('trading/top')
  async getTopTrading(@Query('limit') limit?: string) {
    const max = limit ? Math.max(1, Math.min(48, Number(limit) || 10)) : 10;
    const { results, lowLiquidity } = await this.tradingService.computeTop(max);
    return {
      count: results.length,
      results,
      lowLiquidityCount: lowLiquidity.length,
      lowLiquidity,
    };
  }

  @Get(':ticker')
  async getQuote(@Param('ticker') ticker: string) {
    const quote = await this.brvmService.getQuote(ticker);
    if (!quote) {
      throw new NotFoundException({ message: 'Action BRVM introuvable', ticker: ticker.toUpperCase() });
    }
    return quote;
  }

  @Get(':ticker/history')
  async getHistory(@Param('ticker') ticker: string) {
    const history = await this.brvmService.getHistory(ticker);
    if (history.length === 0) {
      throw new NotFoundException({ message: 'Action BRVM introuvable', ticker: ticker.toUpperCase() });
    }
    return { ticker: ticker.toUpperCase(), candles: history };
  }

  @Get(':ticker/indicators')
  async getIndicators(@Param('ticker') ticker: string) {
    const history = await this.brvmService.getHistory(ticker);
    if (history.length === 0) {
      throw new NotFoundException({ message: 'Action BRVM introuvable', ticker: ticker.toUpperCase() });
    }

    const sma20 = this.indicatorsService.computeSma(history, 20);
    const sma50 = this.indicatorsService.computeSma(history, 50);
    const rsi14 = this.indicatorsService.computeRsi(history, 14);
    const volatility20 = this.indicatorsService.computeVolatility(history, 20);
    const maxDrawdown = this.indicatorsService.computeMaxDrawdown(history);

    return {
      ticker: ticker.toUpperCase(),
      lastDataDate: history[history.length - 1].date,
      sma20,
      sma50,
      rsi14,
      volatility20,
      maxDrawdown,
      kounadiaScore: this.indicatorsService.computeKounadiaScore(history, sma20, sma50, rsi14, volatility20),
    };
  }

  @Get(':ticker/trading')
  async getTradingScore(@Param('ticker') ticker: string) {
    const history = await this.brvmService.getHistory(ticker);
    if (history.length === 0) {
      throw new NotFoundException({ message: 'Action BRVM introuvable', ticker: ticker.toUpperCase() });
    }

    const result = await this.tradingService.computeForTicker(ticker, history);
    if (!result) {
      throw new NotFoundException({
        message: 'Historique insuffisant pour calculer le score Trading (minimum 51 seances)',
        ticker: ticker.toUpperCase(),
      });
    }

    return result;
  }
}

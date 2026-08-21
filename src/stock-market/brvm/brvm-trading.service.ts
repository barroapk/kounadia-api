import { Injectable } from '@nestjs/common';
import { BrvmCandle } from './brvm.types';
import { BrvmIndicatorsService } from './brvm-indicators.service';
import { BrvmService } from './brvm.service';

export type TradingReading = 'faible' | 'neutre' | 'a_surveiller' | 'interessante' | 'forte' | 'exceptionnelle';
export type TradingRiskLevel = 'faible' | 'modere' | 'eleve' | 'tres_eleve';
export type TradingTradability = 'non_eligible' | 'faible' | 'moyenne' | 'bonne' | 'excellente';

export interface TradingScoreComponents {
  trend: number;
  momentum: number;
  volume: number;
  liquidity: number;
  volatility: number;
}

export interface TradingConfidenceComponents {
  dataQuality: number;
  history: number;
  stability: number;
  liquidity: number;
  robustness: number;
}

export interface TradingRawValues {
  avgDailyValueTraded: number;
  avgDailyVolume: number;
  volumeRatio: number;
  activeSessionsRatio: number;
  volatility20: number;
  variation5: number;
  variation20: number;
  liquidityPercentile: number;
  volatilityPercentile: number;
}

export interface TradingScoreResult {
  ticker: string;
  score: number;
  reading: TradingReading;
  riskLevel: TradingRiskLevel;
  tradability: TradingTradability;
  components: TradingScoreComponents;
  confidence: number;
  confidenceComponents: TradingConfidenceComponents;
  riskGate: { passed: boolean; reasons: string[] };
  strengths: string[];
  warnings: string[];
  raw: TradingRawValues;
}

interface RawTradingMetrics {
  ticker: string;
  nbSeances: number;
  trend: number;
  momentum: number;
  volumeScore: number;
  avgDailyValueTraded: number;
  avgDailyVolume: number;
  volatility20: number;
  volumeRatio: number;
  activeSessionsRatio: number;
  variation5: number;
  variation20: number;
}

interface MarketSnapshot {
  raws: RawTradingMetrics[];
  liquidityDistribution: number[];
  volatilityDistribution: number[];
}

@Injectable()
export class BrvmTradingService {
  private readonly SNAPSHOT_CACHE_MS = 15 * 60 * 1000;
  private snapshotCache: { data: MarketSnapshot; expiresAt: number } | null = null;

  constructor(
    private readonly indicators: BrvmIndicatorsService,
    private readonly brvmService: BrvmService,
  ) {}

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private scoreTrend(lastClose: number, sma20: number, sma50: number): number {
    if (sma50 === 0 || sma20 === 0) return 50;
    const ecartSma = this.clamp(((sma20 - sma50) / sma50) * 100, -10, 10);
    const smaScore = ((ecartSma + 10) / 20) * 100;
    const closeVsSma20 = this.clamp(((lastClose - sma20) / sma20) * 100, -5, 5);
    const closeScore = ((closeVsSma20 + 5) / 10) * 100;
    return smaScore * 0.6 + closeScore * 0.4;
  }

  private scoreMomentum(rsi: number, variation5: number, variation20: number): number {
    const rsiScore = this.clamp(rsi, 0, 100);
    const var5Score = ((this.clamp(variation5, -10, 10) + 10) / 20) * 100;
    const var20Score = ((this.clamp(variation20, -20, 20) + 20) / 40) * 100;
    return rsiScore * 0.4 + var5Score * 0.3 + var20Score * 0.3;
  }

  private scoreVolumeRatio(volumeRatio: number): number {
    return this.clamp((volumeRatio / 3) * 100, 0, 100);
  }

  private variationSur(candles: BrvmCandle[], seances: number): number | null {
    if (candles.length < seances + 1) return null;
    const past = candles[candles.length - 1 - seances].close;
    const current = candles[candles.length - 1].close;
    if (past === 0) return null;
    return ((current - past) / past) * 100;
  }

  private computeRaw(ticker: string, candles: BrvmCandle[]): RawTradingMetrics | null {
    if (candles.length < 51) return null;

    const sma20 = this.indicators.computeSma(candles, 20);
    const sma50 = this.indicators.computeSma(candles, 50);
    const rsi14 = this.indicators.computeRsi(candles, 14);
    const volatility20 = this.indicators.computeVolatility(candles, 20);

    if (sma20.length === 0 || sma50.length === 0 || rsi14.length === 0 || volatility20 === null) return null;

    const lastClose = candles[candles.length - 1].close;
    const lastSma20 = sma20[sma20.length - 1].value;
    const lastSma50 = sma50[sma50.length - 1].value;
    const lastRsi = rsi14[rsi14.length - 1].value;

    const variation5 = this.variationSur(candles, 5) ?? 0;
    const variation20 = this.variationSur(candles, 20) ?? 0;

    const recent20 = candles.slice(-20);
    const avgDailyVolume = recent20.reduce((s, c) => s + c.volume, 0) / recent20.length;
    const todayVolume = candles[candles.length - 1].volume;
    const volumeRatio = avgDailyVolume === 0 ? 1 : todayVolume / avgDailyVolume;

    const avgDailyValueTraded = recent20.reduce((s, c) => s + c.volume * c.close, 0) / recent20.length;
    const activeSessionsRatio = (recent20.filter((c) => c.volume > 0).length / recent20.length) * 100;

    return {
      ticker: ticker.toUpperCase(),
      nbSeances: candles.length,
      trend: this.scoreTrend(lastClose, lastSma20, lastSma50),
      momentum: this.scoreMomentum(lastRsi, variation5, variation20),
      volumeScore: this.scoreVolumeRatio(volumeRatio),
      avgDailyValueTraded,
      avgDailyVolume,
      volatility20,
      volumeRatio,
      activeSessionsRatio,
      variation5,
      variation20,
    };
  }

  private percentileRank(value: number, distribution: number[]): number {
    if (distribution.length <= 1) return 50;
    const sorted = [...distribution].sort((a, b) => a - b);
    let lower = 0;
    for (const v of sorted) {
      if (v < value) lower++;
    }
    return (lower / (sorted.length - 1)) * 100;
  }

  /**
   * Score de VOLATILITE pour le calcul du score global : repond a "est-ce
   * une bonne configuration pour trader", zone optimale ~P40-P80.
   * DIFFERENT de computeRiskLevel() ci-dessous, qui repond a une question
   * differente ("quel danger represente ce mouvement"). Les deux peuvent
   * diverger sur un meme titre, c'est voulu : score eleve + risque eleve
   * n'est pas contradictoire, c'est de l'information complementaire.
   */
  private scoreVolatilityFromPercentile(p: number): number {
    if (p < 20) return 45 + (p / 20) * 15;
    if (p < 40) return 60 + ((p - 20) / 20) * 25;
    if (p <= 80) return 85 + ((p - 40) / 40) * 15;
    return this.clamp(100 - ((p - 80) / 20) * 35, 65, 100);
  }

  /**
   * Niveau de RISQUE (categoriel, affiche separement du score). Bornes
   * simplifiees a 4 niveaux : P95 n'est pas une frontiere fiable avec
   * seulement 48 titres (represente 2-3 titres), donc regroupe dans
   * tres_eleve des P85.
   */
  private computeRiskLevel(volatilityPercentile: number): TradingRiskLevel {
    if (volatilityPercentile < 20) return 'faible';
    if (volatilityPercentile < 60) return 'modere';
    if (volatilityPercentile < 85) return 'eleve';
    return 'tres_eleve';
  }

  /**
   * Tradabilite (categorielle) : peut-on raisonnablement entrer/sortir de
   * cette position ? Base sur le percentile de liquidite reel du marche.
   */
  private computeTradability(liquidityPercentile: number): TradingTradability {
    if (liquidityPercentile < 20) return 'non_eligible';
    if (liquidityPercentile < 40) return 'faible';
    if (liquidityPercentile < 60) return 'moyenne';
    if (liquidityPercentile < 80) return 'bonne';
    return 'excellente';
  }

  private scoreToReading(score: number): TradingReading {
    if (score < 40) return 'faible';
    if (score < 55) return 'neutre';
    if (score < 70) return 'a_surveiller';
    if (score < 80) return 'interessante';
    if (score < 90) return 'forte';
    return 'exceptionnelle';
  }

  private computeConfidence(
    nbSeances: number,
    activeSessionsRatio: number,
    liquidityScore: number,
  ): { confidence: number; components: TradingConfidenceComponents } {
    const dataQuality = this.clamp((nbSeances / 250) * 100, 0, 100);
    const history = this.clamp((nbSeances / 500) * 100, 0, 100);
    const stability = this.clamp(activeSessionsRatio, 0, 100);
    const robustness = 70;

    const confidence = dataQuality * 0.3 + history * 0.25 + stability * 0.2 + liquidityScore * 0.15 + robustness * 0.1;

    return {
      confidence: Math.round(confidence * 10) / 10,
      components: {
        dataQuality: Math.round(dataQuality * 10) / 10,
        history: Math.round(history * 10) / 10,
        stability: Math.round(stability * 10) / 10,
        liquidity: Math.round(liquidityScore * 10) / 10,
        robustness,
      },
    };
  }

  private applyRiskGate(nbSeances: number, liquidityPercentile: number): { passed: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (nbSeances < 30) reasons.push('Historique insuffisant (< 30 seances)');
    if (liquidityPercentile < 20) reasons.push('Liquidite dans les 20% les plus faibles du marche BRVM');
    return { passed: reasons.length === 0, reasons };
  }

  /**
   * strengths/warnings utilisent maintenant riskLevel/tradability (categories
   * deja tranchees) plutot que de re-interpreter les pourcentages bruts :
   * un seul endroit decide "eleve" ou "faible", le texte se contente de le dire.
   */
  private buildStrengths(raw: RawTradingMetrics, tradability: TradingTradability): string[] {
    const strengths: string[] = [];
    if (raw.trend > 65) strengths.push('Tendance haussiere structuree');
    if (raw.momentum > 65) strengths.push('Momentum positif');
    if (raw.volumeScore > 65) strengths.push('Volume nettement superieur a sa moyenne');
    if (tradability === 'bonne' || tradability === 'excellente') {
      strengths.push('Liquidite superieure a la majorite du marche BRVM');
    }
    return strengths;
  }

  private buildWarnings(raw: RawTradingMetrics, tradability: TradingTradability, riskLevel: TradingRiskLevel): string[] {
    const warnings: string[] = [];
    if (raw.trend < 40) warnings.push('Tendance defavorable');
    if (raw.momentum < 35) warnings.push('Momentum negatif');
    if (tradability === 'faible') warnings.push('Liquidite limitee : sortie potentiellement difficile');
    if (riskLevel === 'eleve') warnings.push('Volatilite elevee : risque de retournement accru');
    if (riskLevel === 'tres_eleve') warnings.push('Volatilite tres elevee : risque de retournement important');
    return warnings;
  }

  private finalize(
    raw: RawTradingMetrics,
    liquidityDistribution: number[],
    volatilityDistribution: number[],
  ): TradingScoreResult {
    const liquidityPercentile = this.percentileRank(raw.avgDailyValueTraded, liquidityDistribution);
    const volatilityPercentile = this.percentileRank(raw.volatility20, volatilityDistribution);

    const liquidityScore = this.clamp(liquidityPercentile, 0, 100);
    const volatilityScore = this.scoreVolatilityFromPercentile(volatilityPercentile);

    const riskLevel = this.computeRiskLevel(volatilityPercentile);
    const tradability = this.computeTradability(liquidityPercentile);

    const score =
      raw.trend * 0.3 + raw.momentum * 0.25 + raw.volumeScore * 0.2 + liquidityScore * 0.15 + volatilityScore * 0.1;

    const { confidence, components: confidenceComponents } = this.computeConfidence(
      raw.nbSeances,
      raw.activeSessionsRatio,
      liquidityScore,
    );

    const riskGate = this.applyRiskGate(raw.nbSeances, liquidityPercentile);

    return {
      ticker: raw.ticker,
      score: Math.round(score * 10) / 10,
      reading: this.scoreToReading(score),
      riskLevel,
      tradability,
      components: {
        trend: Math.round(raw.trend * 10) / 10,
        momentum: Math.round(raw.momentum * 10) / 10,
        volume: Math.round(raw.volumeScore * 10) / 10,
        liquidity: Math.round(liquidityScore * 10) / 10,
        volatility: Math.round(volatilityScore * 10) / 10,
      },
      confidence,
      confidenceComponents,
      riskGate,
      strengths: this.buildStrengths(raw, tradability),
      warnings: this.buildWarnings(raw, tradability, riskLevel),
      raw: {
        avgDailyValueTraded: Math.round(raw.avgDailyValueTraded),
        avgDailyVolume: Math.round(raw.avgDailyVolume),
        volumeRatio: Math.round(raw.volumeRatio * 100) / 100,
        activeSessionsRatio: Math.round(raw.activeSessionsRatio * 10) / 10,
        volatility20: Math.round(raw.volatility20 * 10) / 10,
        variation5: Math.round(raw.variation5 * 100) / 100,
        variation20: Math.round(raw.variation20 * 100) / 100,
        liquidityPercentile: Math.round(liquidityPercentile * 10) / 10,
        volatilityPercentile: Math.round(volatilityPercentile * 10) / 10,
      },
    };
  }

  private async buildMarketSnapshot(): Promise<MarketSnapshot> {
    const catalog = await this.brvmService.getCatalog();

    const results = await Promise.allSettled(
      catalog.companies.map(async (c) => {
        const history = await this.brvmService.getHistory(c.ticker);
        return this.computeRaw(c.ticker, history);
      }),
    );

    const raws = results
      .filter((r): r is PromiseFulfilledResult<RawTradingMetrics | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is RawTradingMetrics => v !== null);

    return {
      raws,
      liquidityDistribution: raws.map((r) => r.avgDailyValueTraded),
      volatilityDistribution: raws.map((r) => r.volatility20),
    };
  }

  private async getMarketSnapshot(): Promise<MarketSnapshot> {
    const now = Date.now();
    if (this.snapshotCache && this.snapshotCache.expiresAt > now) {
      return this.snapshotCache.data;
    }
    const data = await this.buildMarketSnapshot();
    this.snapshotCache = { data, expiresAt: now + this.SNAPSHOT_CACHE_MS };
    return data;
  }

  async computeForTicker(ticker: string, candles: BrvmCandle[]): Promise<TradingScoreResult | null> {
    const snapshot = await this.getMarketSnapshot();
    const normalizedTicker = ticker.toUpperCase();

    const cachedRaw = snapshot.raws.find((r) => r.ticker === normalizedTicker);
    const raw = cachedRaw ?? this.computeRaw(normalizedTicker, candles);
    if (!raw) return null;

    return this.finalize(raw, snapshot.liquidityDistribution, snapshot.volatilityDistribution);
  }

  async computeTop(limit: number): Promise<{ results: TradingScoreResult[]; lowLiquidity: TradingScoreResult[] }> {
    const snapshot = await this.getMarketSnapshot();
    const all = snapshot.raws.map((raw) =>
      this.finalize(raw, snapshot.liquidityDistribution, snapshot.volatilityDistribution),
    );

    const results = all
      .filter((r) => r.riskGate.passed)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const lowLiquidity = all
      .filter((r) => !r.riskGate.passed && r.raw.liquidityPercentile < 20)
      .sort((a, b) => b.score - a.score);

    return { results, lowLiquidity };
  }
}

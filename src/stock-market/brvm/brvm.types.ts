export interface BrvmCompany {
  ticker: string;
  name: string | null;
  country: string | null;
}

export interface BrvmCatalog {
  companies: BrvmCompany[];
  indexes: string[];
  lastUpdated: string | null;
}

export interface BrvmCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BrvmQuote extends BrvmCandle {
  ticker: string;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
}

export interface BrvmDataProvider {
  getCatalog(): Promise<BrvmCatalog>;
  getHistory(ticker: string): Promise<BrvmCandle[]>;
  getQuote(ticker: string): Promise<BrvmQuote | null>;
}


export interface BrvmLiveQuote {
  ticker: string;
  price: number;
  changePercent: number | null;
  source: 'brvm_official';
  fetchedAt: string;
}

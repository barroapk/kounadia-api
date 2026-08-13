export interface BrvmCompany {
  ticker: string;
}

export interface BrvmCatalog {
  companies: BrvmCompany[];
  indexes: string[];
  lastUpdated: string | null;
}

export interface BrvmDataProvider {
  getCatalog(): Promise<BrvmCatalog>;
}

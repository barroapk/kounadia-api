export interface CompetitionConfig {
  code: string;
  name: string;
  enabled: boolean;
}

export const COMPETITIONS: CompetitionConfig[] = [
  { code: 'PL', name: 'Premier League', enabled: true },
  { code: 'PD', name: 'La Liga', enabled: true },
  { code: 'BL1', name: 'Bundesliga', enabled: true },
  { code: 'SA', name: 'Serie A', enabled: true },
  { code: 'FL1', name: 'Ligue 1', enabled: true },
  { code: 'CL', name: 'Champions League', enabled: true },
  { code: 'DED', name: 'Eredivisie', enabled: true },
  { code: 'PPL', name: 'Primeira Liga', enabled: true },
  { code: 'ELC', name: 'Championship', enabled: true },
  { code: 'BSA', name: 'Brasileirão', enabled: true },
  { code: 'WC', name: 'Coupe du Monde', enabled: true },
  { code: 'EC', name: 'Euro', enabled: true },
];

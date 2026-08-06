export interface ExtraCompetition {
  leagueId: number;
  name: string;
  currentSeason: number; // À vérifier/mettre à jour une fois par an
}

export const EXTRA_COMPETITIONS: ExtraCompetition[] = [
  // Europe
  { leagueId: 3, name: 'Europa League', currentSeason: 2025 },
  { leagueId: 848, name: 'Conference League', currentSeason: 2025 },
  { leagueId: 45, name: 'FA Cup', currentSeason: 2025 },
  { leagueId: 143, name: 'Copa del Rey', currentSeason: 2025 },
  { leagueId: 137, name: 'Coppa Italia', currentSeason: 2025 },
  { leagueId: 81, name: 'DFB Pokal', currentSeason: 2025 },
  { leagueId: 66, name: 'Coupe de France', currentSeason: 2025 },
  { leagueId: 144, name: 'Jupiler Pro League', currentSeason: 2025 },
  { leagueId: 558, name: 'Supercoupe d\'Espagne', currentSeason: 2025 },
  { leagueId: 531, name: 'UEFA Super Cup', currentSeason: 2025 },
  { leagueId: 79, name: '2. Bundesliga', currentSeason: 2025 },
  { leagueId: 136, name: 'Serie B (Italie)', currentSeason: 2025 },
  { leagueId: 141, name: 'Segunda División (Espagne)', currentSeason: 2025 },
  { leagueId: 203, name: 'Süper Lig (Turquie)', currentSeason: 2025 },

  // Afrique
  { leagueId: 12, name: 'CAF Champions League', currentSeason: 2025 },
  { leagueId: 20, name: 'CAF Confederation Cup', currentSeason: 2025 },
  { leagueId: 6, name: 'CAN', currentSeason: 2025 },
  { leagueId: 423, name: 'Ligue 1 Burkina Faso', currentSeason: 2025 },
  { leagueId: 386, name: 'Ligue 1 Côte d\'Ivoire', currentSeason: 2025 },
  { leagueId: 403, name: 'Ligue 1 Sénégal', currentSeason: 2025 },
  { leagueId: 598, name: 'Première Division Mali', currentSeason: 2025 },
  { leagueId: 570, name: 'Ghana Premier League', currentSeason: 2025 },
  { leagueId: 399, name: 'NPFL Nigeria', currentSeason: 2025 },
  { leagueId: 200, name: 'Botola Pro', currentSeason: 2025 },
  { leagueId: 186, name: 'Ligue 1 Algérie', currentSeason: 2025 },
  { leagueId: 202, name: 'Ligue 1 Tunisie', currentSeason: 2025 },
  { leagueId: 233, name: 'Egyptian Premier League', currentSeason: 2025 },
  { leagueId: 288, name: 'Premier Soccer League (Afrique du Sud)', currentSeason: 2025 },

  // Amériques
  { leagueId: 73, name: 'Copa do Brasil', currentSeason: 2026 },
  { leagueId: 128, name: 'Liga Profesional Argentina', currentSeason: 2026 },
  { leagueId: 13, name: 'CONMEBOL Libertadores', currentSeason: 2026 },
  { leagueId: 11, name: 'CONMEBOL Sudamericana', currentSeason: 2026 },
  { leagueId: 262, name: 'Liga MX', currentSeason: 2026 },
  { leagueId: 253, name: 'MLS', currentSeason: 2026 },

  // Asie / Moyen-Orient
  { leagueId: 307, name: 'Saudi Pro League', currentSeason: 2025 },
  { leagueId: 98, name: 'J1 League', currentSeason: 2026 },
  { leagueId: 17, name: 'AFC Champions League Elite', currentSeason: 2025 },
  { leagueId: 504, name: 'King\'s Cup (Arabie Saoudite)', currentSeason: 2025 },

  // Sélections et coupes
  { leagueId: 9, name: 'Copa America', currentSeason: 2024 },
  { leagueId: 15, name: 'Coupe du Monde des Clubs', currentSeason: 2025 },
  { leagueId: 1, name: 'Coupe du Monde', currentSeason: 2026 },
];

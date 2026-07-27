export interface HierarchyInfo {
  continent: string;
  country: string;
}

export const HIERARCHY_BY_FOOTBALL_DATA_CODE: Record<string, HierarchyInfo> = {
  PL: { continent: 'Europe', country: 'Angleterre' },
  ELC: { continent: 'Europe', country: 'Angleterre' },
  PD: { continent: 'Europe', country: 'Espagne' },
  BL1: { continent: 'Europe', country: 'Allemagne' },
  SA: { continent: 'Europe', country: 'Italie' },
  FL1: { continent: 'Europe', country: 'France' },
  DED: { continent: 'Europe', country: 'Pays-Bas' },
  PPL: { continent: 'Europe', country: 'Portugal' },
  CL: { continent: 'Europe', country: 'International' },
  EC: { continent: 'Europe', country: 'International' },
  BSA: { continent: 'Amériques', country: 'Brésil' },
  WC: { continent: 'Monde', country: 'International' },
};

export const HIERARCHY_BY_LEAGUE_ID: Record<number, HierarchyInfo> = {
  // Europe
  3: { continent: 'Europe', country: 'International' },
  848: { continent: 'Europe', country: 'International' },
  45: { continent: 'Europe', country: 'Angleterre' },
  143: { continent: 'Europe', country: 'Espagne' },
  137: { continent: 'Europe', country: 'Italie' },
  81: { continent: 'Europe', country: 'Allemagne' },
  66: { continent: 'Europe', country: 'France' },
  144: { continent: 'Europe', country: 'Belgique' },
  558: { continent: 'Europe', country: 'Espagne' },
  531: { continent: 'Europe', country: 'International' },
  79: { continent: 'Europe', country: 'Allemagne' },
  136: { continent: 'Europe', country: 'Italie' },
  141: { continent: 'Europe', country: 'Espagne' },
  203: { continent: 'Europe', country: 'Turquie' },

  // Afrique
  12: { continent: 'Afrique', country: 'International' },
  20: { continent: 'Afrique', country: 'International' },
  6: { continent: 'Afrique', country: 'International' },
  423: { continent: 'Afrique', country: 'Burkina Faso' },
  386: { continent: 'Afrique', country: 'Côte d\'Ivoire' },
  403: { continent: 'Afrique', country: 'Sénégal' },
  598: { continent: 'Afrique', country: 'Mali' },
  570: { continent: 'Afrique', country: 'Ghana' },
  399: { continent: 'Afrique', country: 'Nigeria' },
  200: { continent: 'Afrique', country: 'Maroc' },
  186: { continent: 'Afrique', country: 'Algérie' },
  202: { continent: 'Afrique', country: 'Tunisie' },
  233: { continent: 'Afrique', country: 'Égypte' },
  288: { continent: 'Afrique', country: 'Afrique du Sud' },

  // Amériques
  73: { continent: 'Amériques', country: 'Brésil' },
  128: { continent: 'Amériques', country: 'Argentine' },
  13: { continent: 'Amériques', country: 'International' },
  11: { continent: 'Amériques', country: 'International' },
  262: { continent: 'Amériques', country: 'Mexique' },
  253: { continent: 'Amériques', country: 'États-Unis' },

  // Asie
  307: { continent: 'Asie', country: 'Arabie Saoudite' },
  98: { continent: 'Asie', country: 'Japon' },
  17: { continent: 'Asie', country: 'International' },
  504: { continent: 'Asie', country: 'Arabie Saoudite' },

  // Monde
  9: { continent: 'Amériques', country: 'International' },
  15: { continent: 'Monde', country: 'International' },
};

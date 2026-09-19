// Modelos do backend Claude Code (BACKEND = 'claude' em settings.js).

// Modelo por modo: alias ('sonnet', 'opus', 'haiku') ou nome completo.
// null = padrão do Claude Code. 'sonnet' no web deixa mais rápido e gasta menos cota.
export const MODEL = {
  web: "sonnet",
  full: "sonnet",
  vision: null, // descrição de imagens (IMAGES em settings.js); null = mesmo do web
};

// Esforço por modo: 'low' | 'medium' | 'high' | 'xhigh' | 'max'. null = padrão do CLI.
export const EFFORT = {
  web: 'low',
  full: 'medium',
  vision: null, // null = mesmo do web
};

// Máximo de idas à web (WebSearch/WebFetch) por resposta no modo web.
export const WEB_MAX_TURNS = 4;


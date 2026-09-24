// Modelos do backend Claude Code (BACKEND = 'claude' em settings.js).

// Modelo por modo: alias ('sonnet', 'opus', 'haiku') ou nome completo.
// null = padrão do Claude Code. 'sonnet' no web deixa mais rápido e gasta menos cota.
export const MODEL = {
  web: "sonnet",
  full: "sonnet",
  vision: null, // descrição de imagens (IMAGES em settings.js); null = mesmo do web
};

// Modelos que os usuários podem escolher com /model (docs/model-selector.md).
// Entradas `{ model, effort?, nome? }` (string = só o modelo). Só o que está
// listado aqui pode ser escolhido; lista vazia desliga /model e /model-list.
// Máximo de 24 (o Discord aceita 25 choices e um é o "padrão").
export const MODEL_CHOICES = [
  "sonnet",
  "opus",
  "haiku",
];

// Esforço por modo: 'low' | 'medium' | 'high' | 'xhigh' | 'max'. null = padrão do CLI.
export const EFFORT = {
  web: 'low',
  full: 'medium',
  vision: null, // null = mesmo do web
};

// Máximo de idas à web (WebSearch/WebFetch) por resposta no modo web.
export const WEB_MAX_TURNS = 4;


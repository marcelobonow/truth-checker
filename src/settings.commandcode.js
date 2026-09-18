// Modelos do backend Command Code (BACKEND = 'commandcode' em settings.js).
// Ids completos, como em `command-code --list-models` (ex.: deepseek/deepseek-v4.1-flash,
// moonshotai/kimi-k3, zai-org/glm-5.3). null = padrão do CLI.

export const MODEL = {
  web: 'deepseek/deepseek-v4.1-flash',
  full: 'deepseek/deepseek-v4.1-flash',
};

// Esforço por modo: depende do modelo (deepseek-v4.1-flash aceita low | high | max;
// o CLI recusa outros valores). null = padrão do CLI.
export const EFFORT = {
  web: 'high',
  full: 'high',
};

// Máximo de turnos por resposta no modo web. Cada busca gasta ~2 turnos
// (o modelo carrega a ferramenta via search_tools e só depois chama web_search).
export const WEB_MAX_TURNS = 8;

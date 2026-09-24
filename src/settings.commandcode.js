// Modelos do backend Command Code (BACKEND = 'commandcode' em settings.js).
// Ids completos, como em `command-code --list-models` (ex.: deepseek/deepseek-v4.1-flash,
// moonshotai/kimi-k3, zai-org/glm-5.3). null = padrão do CLI.

export const MODEL = {
  web: "deepseek/deepseek-v4.1-flash",
  full: "deepseek/deepseek-v4.1-flash",
  vision: null, // descrição de imagens (IMAGES em settings.js); null = mesmo do web
};

// Modelos que os usuários podem escolher com /model (docs/model-selector.md).
// Entradas `{ model, effort?, nome? }` (string = só o modelo): `effort` fixa o
// --effort daquela escolha (null = sem --effort, "sem thinking"), `nome` é o
// rótulo no dropdown, no /model-list e no log. Só o que está listado aqui pode
// ser escolhido; lista vazia desliga /model e /model-list. Máximo de 24 (o
// Discord aceita 25 choices e um é o "padrão").
export const MODEL_CHOICES = [
  { model: "meta/muse-spark-1.3-contributor", effort: "medium", nome: "Muse Spark 1.3 Contributor (medium)" },
  { model: "meta/muse-spark-1.3-contributor", effort: "high", nome: "Muse Spark 1.3 Contributor (high)" },
  { model: "gpt-6-luna", effort: "low", nome: "GPT-6 Luna (low)" },
  { model: "gpt-6-luna", effort: "high", nome: "GPT-6 Luna (high)" },
  { model: "xiaomi/mimo-v2.6-flash", effort: null, nome: "MiMo V2.6 Flash" },
  { model: "deepseek/deepseek-v4.1-flash", effort: "high", nome: "DeepSeek V4.1 Flash (high)" },
  { model: "deepseek/deepseek-v4-flash-fast", effort: null, nome: "DeepSeek V4 Flash Fast" },
  { model: "z-ai/glm-5.3-flash", nome: "GLM-5.3 Flash" },
  { model: "inclusionai/ling-3.0-flash-sante:free", effort: null, nome: "Ling 3.0 Flash Sante" },
  { model: "poolside/laguna-s-2.1-free", nome: "Laguna S 2.1" },
];

// Esforço por modo: depende do modelo (deepseek-v4.1-flash aceita low | high | max;
// o CLI recusa outros valores). null = padrão do CLI.
export const EFFORT = {
  web: "high",
  full: "high",
  vision: null, // null = mesmo do web
};

// Máximo de turnos por resposta no modo web. Cada busca gasta ~2 turnos
// (o modelo carrega a ferramenta via search_tools e só depois chama web_search).
export const WEB_MAX_TURNS = 8;

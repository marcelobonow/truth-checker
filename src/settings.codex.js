// Modelos do backend Codex CLI. A seleção de backend fica em src/settings.js.

export const MODEL = {
  web: 'gpt-6-luna',
  full: 'gpt-6-luna',
  vision: 'gpt-6-luna',
  analysis: null, // null = mesmo do web
};

// Luna é o único modelo disponível no seletor /model para este backend.
export const MODEL_CHOICES = [
  { model: 'gpt-6-luna', effort: 'low', nome: 'GPT-6 Luna' },
];

export const EFFORT = {
  web: 'low',
  full: 'low',
  vision: 'low',
  analysis: null, // null = mesmo do web
};

// O Codex CLI não expõe atualmente um limite equivalente a --max-turns.
export const WEB_MAX_TURNS = null;

// Escolha do CLI que gera as respostas (BACKEND em settings.js). Cada backend
// é um módulo com a mesma interface (name, buildRequest, run, describeEvent,
// isSessionMissing, webDir, resolveBin, supportsUsage) e um settings de modelos.
const BACKENDS = {
  claude: { module: './claude.js', settings: './settings.claude.js' },
  commandcode: { module: './commandcode.js', settings: './settings.commandcode.js' },
};

export async function selectBackend(name) {
  const entry = BACKENDS[name];
  if (!entry) throw new Error(`BACKEND desconhecido em settings.js: ${JSON.stringify(name)} (válidos: ${Object.keys(BACKENDS).join(', ')})`);
  const [backend, settings] = await Promise.all([import(entry.module), import(entry.settings)]);
  return { backend, settings };
}

// Mod do Command Code carregado pelo bot (`--mod commandcode/mod.ts`).
// O CLI não tem flag de system prompt nem de allowlist de ferramentas; este
// mod faz as duas coisas a partir de `--mod-option`:
//   systemPrompt=<texto>  anexado ao system prompt em toda chamada
//   tools=<lista>         '*' = todas; vazio = nenhuma; senão nomes separados por vírgula
// Compilado pelo jiti na hora (sem build). Docs: https://commandcode.ai/docs/mods
export default function (cmd: any) {
  cmd.addFlag('systemPrompt', { type: 'string', default: '' });
  cmd.addFlag('tools', { type: 'string', default: '*' });

  // null = sem restrição
  const allowed = (): Set<string> | null => {
    const value: string = cmd.getFlag('tools');
    if (value === '*') return null;
    return new Set(value ? value.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
  };

  cmd.hooks({
    appendSystemPrompt: () => cmd.getFlag('systemPrompt') || undefined,
    // Tira do schema o que não está na lista (o modelo nem vê); ferramentas
    // carregadas depois via search_tools ou MCP caem no beforeToolCall.
    onSessionStart: () => {
      const list = allowed();
      if (list) cmd.setActiveTools([...list]);
    },
    beforeToolCall: ({ toolName }: { toolName: string }) => {
      const list = allowed();
      if (list && !list.has(toolName)) {
        return { block: true, additionalContext: `A ferramenta ${toolName} não está disponível neste contexto.` };
      }
      return undefined;
    },
  });
}

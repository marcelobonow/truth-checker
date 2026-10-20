import { formatCommandCodeUsage } from './usage.js';

// Metadados por chamada; não confundem o teto de reinício do bot com a janela do modelo.
export function prependRuntimeInfo(prompt, { backend, mode, model, effort, maxTurns, runtime = {} }) {
  const tools = backend === 'commandcode'
    ? { web: 'web_search, web_fetch, search_tools', vision: 'read_file, search_tools', analysis: 'read_file, web_search, web_fetch, search_tools', full: 'todas as ferramentas disponibilizadas pelo CLI (tools=*)' }
    : backend === 'claude'
      ? { web: 'WebSearch, WebFetch', vision: 'Read', analysis: 'Read, WebSearch, WebFetch', full: 'ferramentas padrão do Claude Code, incluindo leitura, escrita, execução e busca web; inventário exato definido pelo CLI' }
      : { web: 'busca web; shell desativado', vision: 'imagem anexada diretamente; busca web e shell desativados', analysis: 'busca web e shell em sandbox somente leitura', full: 'ferramentas disponibilizadas pelo Codex CLI, incluindo shell e busca web' };
  const turns = backend === 'codex' ? null : mode === 'vision' ? (backend === 'claude' ? 3 : 4) : mode === 'analysis' ? (maxTurns ?? 80) : mode === 'web' ? maxTurns : null;
  const limit = (value) => value > 0 ? value : 'sem teto configurado pelo bot';
  const context = runtime.contextTokens == null ? 'desconhecido (sem medição disponível)' : `${runtime.contextTokens} tokens na última chamada medida; não inclui este pedido nem resultados futuros`;
  const planUsage = backend === 'commandcode' ? formatCommandCodeUsage(runtime.commandCodeUsage) : null;
  const webSearchLimit = mode === 'web' && backend === 'commandcode'
    ? `Não existe uma cota separada de pesquisas por conversa. O teto de ${limit(turns)} é por resposta/execução do CLI; no uso observado, cada busca simples consome cerca de 2 turnos (aproximadamente ${turns > 0 ? Math.floor(turns / 2) : 'várias'} buscas simples). Como orçamento para pesquisas complexas que envolvam busca e consulta de fontes, considere até aproximadamente ${turns > 0 ? Math.floor(turns / 3) : 'várias'} por resposta. Isso é uma estimativa, não um contador separado: buscas com várias fontes, web_fetch e outras ferramentas podem consumir mais turnos e reduzir o total. Informe os limites e as estimativas deste bloco quando perguntarem; não diga que desconhece um valor presente aqui. Marque como desconhecido somente o que estiver explicitamente indisponível.`
    : '';
  return `[ambiente de execução — metadados do bot para esta chamada]
Backend: ${backend}; modo: ${mode}.
Modelo solicitado: ${model || 'padrão do CLI (identidade efetiva não informada)'}.
Reasoning solicitado: ${effort || 'padrão do CLI (nível efetivo não informado)'}.
Ferramentas disponíveis: ${tools[mode] || 'inventário não informado'}.
Máximo de turnos nesta execução: ${limit(turns)}.
${webSearchLimit ? `Pesquisas na web: ${webSearchLimit}\n` : ''}Contexto atual: ${context}.
Limite de contexto para reinício da sessão pelo bot: ${runtime.sessionLimits ? limit(runtime.sessionLimits.maxContextTokens) : 'não se aplica (chamada isolada)'}.
Janela máxima de contexto do modelo: desconhecida (não informada pelo CLI; não confundir com o limite do bot).
Mensagens Discord já enviadas nesta sessão: ${runtime.messages ?? 0}; mensagens incluídas neste pedido: ${runtime.messageCount ?? 'contagem não disponível'}.
Máximo de mensagens Discord antes do reinício da sessão: ${runtime.sessionLimits ? limit(runtime.sessionLimits.maxMessages) : 'não se aplica (chamada isolada)'}.
As contagens de mensagens são do bot, não de turnos internos do modelo. Contexto atual é a última medição concluída, não uma leitura exata após incluir este pedido. Ao responder perguntas sobre contexto, mensagens, ferramentas, modelo, reasoning ou limites, use os valores acima e explique o que cada um mede. Não diga que desconhece um valor informado; só marque como desconhecido o que estiver explicitamente indisponível.
${planUsage ? `${planUsage}\n` : ''}[/ambiente de execução]

${prompt}`;
}

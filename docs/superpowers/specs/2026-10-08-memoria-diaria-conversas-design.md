# Memória diária das conversas do Discord

Data: 2026-10-08. Status: implementado; testes automatizados executados em 2026-10-08. Validação em servidor Discord real pendente.

## Objetivo

Guardar as mensagens dos canais acompanhados, incluindo conversas que não acionam o bot, e analisar diariamente as interações com ele. A análise deve mostrar o que funcionou, o que falhou e quais mudanças de prompt ou código merecem revisão, com evidências da conversa.

O resultado será uma memória Markdown para análise manual do responsável. O programa não altera o prompt, não aplica sugestões e não carrega automaticamente essas memórias nas respostas do bot.

Requisito de isolamento: cada combinação de **servidor + canal + dia** possui seu próprio arquivo de conversa e sua própria memória. Nenhuma chamada de análise combina canais ou servidores.

## Decisões e padrões propostos

Requisitos definidos pelo usuário:

- Capturar todas as mensagens dos canais acompanhados, mesmo sem menção ao bot e mesmo de pessoas que ele não atende.
- Preservar as respostas do bot e a conversa ao redor das interações.
- Usar um pequeno contexto do dia anterior e do posterior para entender conversas que atravessam meia-noite.
- Preservar o resultado da descrição de imagens, ligado ao autor, à mensagem de origem e à resposta que o utilizou. O mesmo contrato deve acomodar transcrição de áudio futura.
- Usar Command Code ou o backend escolhido para produzir o resumo de madrugada.
- Salvar memória orientada a propostas de mudança, com revisão humana posterior.
- Separar os arquivos por servidor, canal e dia.

Padrões sugeridos neste design, ajustáveis antes da implementação:

- Formato da conversa: JSONL UTF-8, uma linha JSON por evento.
- Fuso: `America/Sao_Paulo`, configurado explicitamente.
- Janela da análise: das 03:00 às 06:00 nesse fuso, referente ao dia anterior e a pendências anteriores. Fora dela, a coleta continua e novas chamadas de análise aguardam a próxima madrugada.
- Canais: seguir `WATCH_CHANNEL_IDS`; lista vazia acompanha os canais de servidores cujos eventos o cliente recebe. Um canal pai incluído abrange suas threads acessíveis, cada uma arquivada separadamente; também é possível incluir somente uma thread pelo ID. DMs ficam fora.
- Backend da análise: seguir `BACKEND`, com opção de escolher outro backend e modelo para essa tarefa.
- Contexto da virada do dia: até 20 mensagens de cada lado, configurável.
- Sem exclusão automática dos arquivos na primeira versão.

## Situação atual

- `src/logger.js` escreve eventos operacionais e mensagens em `logs/bot.log`, sujeito a `LOG_LEVEL`.
- `src/index.js` registra mensagens com espaços normalizados. As mensagens do próprio bot passam pelo log em nível `debug`, ausente no padrão `info`.
- O envio registra sucesso e tamanho da resposta, sem preservar seu texto completo no log em nível `info`.
- `CONTEXT` em `src/settings.js` busca 50 mensagens e combina até 10 do canal, 5 do autor e 5 do bot, sem duplicatas. Em sessões retomadas, o marcador do canal limita o contexto novo enviado.
- `fetchContext` corta o texto de cada mensagem de contexto em 200 caracteres.
- `src/backend.js` seleciona `claude`, `commandcode` ou `codex`; seus adapters usam `src/runner.js`.
- `src/queue.js` já oferece uma fila serial para chamadas ao backend.

Esses pontos justificam uma captura própria: extrair o log não recupera textos e relações que nunca foram registrados. A nova captura preserva o conteúdo completo, sem alterar a seleção de contexto das respostas.

## Alternativas consideradas

| Alternativa | Vantagem | Limitação |
| --- | --- | --- |
| Extrair `bot.log` | Aproveita o arquivo existente | Dados incompletos e dependência de mensagens operacionais e nível de log |
| Arquivo diário `.txt` | Leitura direta | Exige definir delimitadores e escapes para textos multilinha e relações entre mensagens |
| Arquivo diário `.jsonl` | Append simples, preserva estrutura e pode ser lido em streaming | Menos confortável para leitura manual |

Recomendação: JSONL para a fonte de dados e Markdown para a memória que será lida pelo responsável. Não criar uma segunda cópia `.txt` na primeira versão.

## Organização dos arquivos

```text
conversas/
  <guildId>/
    <channelId>/
      conversa-2026-10-08.jsonl
      conversa-2026-10-09.jsonl
memorias-conversas/
  <guildId>/
    <channelId>/
      memoria-2026-10-08.md
      memoria-2026-10-09.md
estado-analise-conversas.json
```

IDs são strings e são usados nos caminhos; nomes ficam nos registros e no cabeçalho da memória. Renomear um canal ou servidor não muda sua pasta. Threads usam seu próprio `channelId`, com `parentChannelId` como metadado, e são analisadas separadamente.

A data do arquivo de uma mensagem vem de `createdTimestamp`, convertido ao fuso configurado. Os timestamps armazenados também incluem a representação UTC. A análise de 09/10 às 03:00 processa o intervalo de 08/10 às 00:00 até 09/10 às 00:00, no fuso configurado.

O fuso adotado fica persistido junto à raiz do arquivo. Uma alteração incompatível exige nova raiz ou migração explícita, evitando que eventos da mesma conversa sejam reparticionados silenciosamente após reinício.

O arquivo de estado contém apenas controle de trabalhos e referências a checkpoints. Resultados parciais e snapshots de leitura ficam em uma pasta de trabalho por servidor/canal/dia, são substituíveis e são removidos após publicação bem-sucedida. Pastas de conversas e memórias, estado e temporários entram no `.gitignore`.

### Contexto da virada do dia

Para analisar o dia `D`, acrescentar **as últimas 20 mensagens de `D-1` e as primeiras 20 de `D+1`**, exclusivamente do mesmo servidor e canal. Selecionar registros `message`, não os últimos/primeiros 20 eventos operacionais do JSONL. Preservar ordem cronológica, IDs, autor e datas; mensagens de pessoas e do bot contam igualmente.

Esses trechos são contexto auxiliar, identificado como `previous_day` ou `next_day`. Os arquivos originais continuam separados: não copiar mensagens vizinhas para o arquivo de conversa de `D`. Contagens, temas principais e novas interações da memória pertencem a `D`; mensagens auxiliares podem esclarecer uma interação de `D` e fornecer evidências de seu desfecho, sem virarem novas interações desse dia.

Às 03:00, `D+1` ainda está em curso. Usar até 20 mensagens disponíveis no primeiro snapshot do job dentro da janela; se houver menos ou nenhum arquivo vizinho, registrar essa limitação e prosseguir, sem esperar indefinidamente. Não buscar dias mais distantes para completar a quantidade. O contexto selecionado fica congelado com o job e seus checkpoints, mesmo que a análise continue em outra madrugada. Novas mensagens no dia posterior não provocam, sozinhas, reanálise automática; reprocessamento explícito pode selecionar contexto atualizado.

O manifesto guarda dias de origem, IDs, conteúdo e hashes dos trechos auxiliares selecionados, incluindo resultados de mídia associados quando disponíveis. Esses dados participam da identidade da entrada e da validação de evidências. Na divisão em blocos, o trecho anterior acompanha a borda inicial e o posterior acompanha a final; ambos também podem apoiar uma etapa específica de interação da virada, sem serem repetidos em todos os blocos nem descartados por limite de entrada.

## Captura das mensagens

### Escopo e ponto de integração

A captura acontece no início de `Events.MessageCreate`, antes de `skipReason`, whitelist, modo de menções/replies, juiz, lotes ou análise de anexos. Seu filtro próprio verifica apenas servidor e canal acompanhado.

Entram mensagens de usuários atendidos ou não, do próprio bot, de outros bots e de webhooks, identificando a origem. A decisão de arquivar não dá permissão para responder: as regras atuais de atendimento continuam independentes. A inclusão de threads na coleta não amplia o filtro de atendimento.

“Todas as mensagens” significa todos os eventos recebidos dentro desse escopo. Conteúdo indisponível por intents/permissões deve ser identificado, e não confundido com mensagem deliberadamente vazia. Registrar início/fim da coleta e desconexões conhecidas permite declarar cobertura parcial; não é possível enumerar mensagens perdidas enquanto o processo estava desligado. Arquivos já coletados continuam elegíveis para análise mesmo se o canal deixar de ser acompanhado depois.

### Registro de mensagem

Todo registro possui `schemaVersion`, `type`, `eventId`, `observedAt`, `guildId`, `channelId`, `localDate` e `timeZone`. Tipos iniciais: `message`, `decision`, `media_analysis_start`, `media_analysis_end`, `generation_start`, `generation_end`, `prompt_snapshot` e `capture_status`. A versão define os campos obrigatórios por tipo; uma versão desconhecida impede a análise em vez de descartar registros silenciosamente.

Cada evento `message` contém ainda:

- `schemaVersion`, `messageId`, `guildId`, `guildName`, `channelId`, `channelName`, `parentChannelId`.
- `createdAt`, `observedAt`, `localDate`, `timeZone`.
- `authorId`, `authorName`, `authorIsBot`, `isOwnBot`, `webhookId` quando existir.
- `content` bruto e `cleanContent`, completos, preservando quebras de linha e Unicode.
- IDs das menções e referência de reply: `messageId`, `channelId` e `guildId` disponíveis no evento.
- Anexos: ID, nome, URL, tipo e tamanho disponíveis; metadados e texto dos embeds recebidos.
- Metadados disponíveis que ajudem a reconstruir o evento e diagnosticar o comportamento: tipo e flags da mensagem, stickers e demais referências/IDs do Discord expostos pelo evento. O contrato deve ser ampliado com versão de schema quando necessário, sem serializar objetos completos do cliente.

Não baixar anexos apenas para arquivamento. Uma URL pode expirar; registrar os metadados não significa preservar o conteúdo do arquivo. Descrições de imagens ficam em eventos próprios e são referenciadas pelas gerações que as usarem; textos extraídos dos demais arquivos também são preservados na entrada da geração.

Não salvar tokens, variáveis de ambiente, credenciais do backend ou objetos completos do cliente Discord. Somente campos explícitos do contrato são serializados.

### Arquivo bruto e representação compacta para análise

O JSONL diário é a fonte de verdade: preserva conteúdo completo, timestamp original (`createdAt` UTC e representação local), autor, IDs, metadados disponíveis e eventos relacionados de decisão, mídia e geração. A análise nunca altera nem substitui esses registros. A serialização salva o máximo de dados relevantes disponível no evento, excluindo credenciais, segredos e objetos completos do cliente.

O modelo recebe uma linha do tempo compacta, gerada a partir do snapshot, para reduzir tokens sem fundir mensagens nem apagar quem disse o quê. A data aparece uma vez no cabeçalho do dia; cada mensagem continua em uma linha própria, com autor e referência curta de evidência mapeada no manifesto para o `eventId`/`messageId` original. O corpo mantém o texto integral daquela mensagem, inclusive quebras de linha devidamente delimitadas. Segundos e repetições de horário podem ser omitidos nessa apresentação; timestamps exatos permanecem no JSONL e podem ser consultados.

Representação de horário em `America/Sao_Paulo`:

- A primeira mensagem do dia, e a primeira após mudança de hora, mostra `HHhMM`, por exemplo `14h16`.
- Mensagens seguintes no mesmo minuto não repetem horário, mesmo se forem de autores diferentes. Cada linha ainda preserva autor, referência e fronteira de mensagem; por exemplo:

  ```text
  2026-10-08
  14h16 Tuctuc [m1]: teste
  Tuctuc [m2]: teste dnv.
  ```

- Ao mudar o minuto sem mudar a hora, mostra apenas `MMm`; `18m` significa minuto 18 da última hora explicitada, não “18 minutos depois”. Exemplo:

  ```text
  14h16 Tuctuc [m1]: teste
  18m Fulano [m2]: teste2
  ```

  Ambas as linhas são das 14h; na primeira mudança de hora seguinte, o formato completo `HHhMM` reaparece.

Esse formato é apenas uma projeção compacta para o prompt, nunca uma substituição dos dados brutos. As referências curtas (`m1`, `m2`) são locais ao job/bloco e resolvidas pelo manifesto; respostas finais devem referenciar evidências que o programa consiga mapear e conferir.

### Descrições de imagem e transcrição futura de áudio

Registrar cada processamento de mídia executado pelo pipeline, incluindo resultados que depois não sejam usados por uma geração. A captura não dispara análise de toda imagem enviada: uma imagem fora das regras atuais permanece na transcrição com metadados e motivo de não processamento quando conhecido. Ausência de descrição não significa que o modelo viu a imagem.

O evento de início e o de fim compartilham um `mediaAnalysisId` independente do `generationId`. Cada tentativa de processamento identifica:

- `kind`: `image_description` ou, futuramente, `audio_transcription`.
- Origem: `sourceMessageId`, `sourceGuildId`, `sourceChannelId`, `sourceAuthorId`, `sourceAuthorName`, data da mensagem, anexo/URL e posição da mídia na mensagem. Imagens de link, embed ou reply também possuem origem explícita.
- Acionamento: `triggerMessageId` e autor de quem pediu a análise, separados do autor original da mídia. Quando a imagem vem de uma mensagem citada, não atribuir seu conteúdo a quem apenas fez o reply.
- Execução: backend/modelo efetivamente usados no processamento, início/fim, estado `success`, `failed` ou `cancelled`, erro resumido quando existir e output completo produzido. Em áudio, metadados como idioma, duração e timestamps entram quando o transcritor os fornecer, sem inventá-los.

Eventos da mídia ficam na partição da mensagem de origem, mesmo que o processamento termine em outro dia; um resultado tardio pode modificar essa fonte. O fim é registrado assim que o processamento termina, antes de depender da geração da resposta. Se a origem for externa aos canais acompanhados, registrar apenas a referência e a limitação no acionamento, sem importar seu conteúdo para a análise diária.

Cada entrada de geração registra os `mediaAnalysisIds` consumidos, junto ao texto efetivamente utilizado, inclusive cortes ou formatação diferentes do output completo. Seu resultado registra resposta gerada, situação de entrega e IDs das mensagens enviadas. Assim é possível reconstruir **autor/mensagem da mídia → descrição ou transcrição → geração que a utilizou → resposta entregue**, sem presumir que todo resultado obtido foi usado ou respondido. Um resultado reaproveitado pode ser referenciado por várias gerações; cancelamento ou `NO_REPLY` mantém o resultado e indica ausência de resposta.

Na memória, interações com mídia apresentam essa sequência com as evidências correspondentes. O design prepara o contrato para áudio; implementar o transcritor e suas regras de acionamento será uma feature posterior.

### Respostas do próprio bot

O evento de gateway registra normalmente a mensagem enviada. Além disso, `send()` entrega ao arquivador cada objeto retornado por `reply()` e `channel.send()` imediatamente após seu envio, antes de tentar o próximo trecho. Isso preserva entregas parciais, inclusive em fallback. Continua existindo uma janela de perda se o processo cair entre o envio ao Discord e a gravação local.

O arquivador deduplica por `messageId` tanto o evento quanto o retorno do envio. Verificação de duplicata e append acontecem na mesma fila por arquivo; o ID só é confirmado após a escrita. Antes do primeiro append em um arquivo após reinício, recupera seus IDs em streaming. Índices de arquivos inativos podem ser descartados da memória e reconstruídos sob demanda. Texto gerado que não foi entregue não é registrado como mensagem enviada.

Respostas públicas de slash commands também entram quando recebidas pelo gateway; respostas efêmeras ficam fora da transcrição do canal. Não se afirma capturar interações que só são visíveis ao usuário do comando.

### Escrita e falhas

- Append assíncrono, serializado por arquivo, com `JSON.stringify` e uma quebra de linha entre registros.
- Um erro de captura é registrado como erro operacional e não interrompe a resposta do bot. A fila tem limite configurável em bytes; após esgotar retentativas ou capacidade, contabiliza registros perdidos e declara a lacuna quando a escrita voltar. A captura é best effort, sem garantia de sobrevivência a queda antes da persistência.
- O processo drena as escritas pendentes no shutdown, com prazo limitado.
- Se a última linha tiver JSON válido sem quebra final, acrescentar somente a quebra. Se estiver truncada, preservar o fragmento em diagnóstico e remover apenas essa cauda inválida antes de continuar. JSON inválido no meio do arquivo exige falha explícita da análise, sem publicação de memória completa. Retentativa após escrita parcial faz essa recuperação antes de reenviar o registro.
- A implantação inicial considera uma única instância do bot gravando nessas pastas. Escrita compartilhada por múltiplos processos fica fora do escopo.

## Registrar o que o bot recebeu e fez

A transcrição mostra o que estava no canal, mas não prova o que chegou ao modelo. Por isso, o mesmo JSONL guarda eventos operacionais associados às mensagens daquele canal, sem copiar o log inteiro.

Para cada geração, registrar um `generationId` próprio, correlacionável ao monitor quando disponível:

- Início: IDs do lote, referências, backend, modelo, esforço, modo, horário, sessão nova ou retomada e configuração efetiva de contexto.
- Entrada: texto efetivamente enviado ao backend, IDs e textos efetivos das mensagens de contexto, textos de anexos, `mediaAnalysisIds` e descrições de imagens ou futuras transcrições efetivamente usados.
- Política: snapshot das instruções montadas pelo aplicativo, incluindo prompt do modo/servidor e preferência personalizada aplicada, identificado por hash para evitar repetição no arquivo. Não chamar isso de system prompt completo do provedor: o CLI pode acrescentar instruções internas não observáveis.
- Fim: sucesso, erro, `NO_REPLY`, cancelamento ou falha/parcialidade de entrega; texto gerado e IDs dos trechos efetivamente enviados.

Registrar também a decisão de ignorar/rejeitar uma mensagem, motivo e configuração de atendimento relevante, quando observáveis, sem copiar dados sensíveis de erros do CLI. Ela fica no dia da mensagem correspondente.

Eventos de geração e seus resultados pertencem ao dia da última mensagem do lote, definido quando ele é fechado. Se o lote atravessar meia-noite, as mensagens originais continuam em seus próprios dias; a entrada registrada explica quais foram reunidas. A resposta entregue pertence ao dia de sua criação no Discord, mesmo que a geração esteja no arquivo anterior. O resultado guarda texto e IDs de entrega para permitir avaliar o desfecho sem importar outra transcrição. Uma mensagem já associada a uma geração concluída no dia anterior não deve virar uma nova interação sem pedido no dia seguinte.

Referências ou contexto de outro dia, presentes na entrada da geração ou selecionados pela regra de contexto da virada, são identificados como contexto auxiliar, sem serem contados como mensagens novas daquele dia. Conteúdo de outro canal não entra na análise: manter os IDs e marcar essa parte do snapshot como omitida pelo isolamento. Por isso, o snapshot analisável nem sempre é uma reprodução integral do input. Não buscar arquivos de outros canais para completá-lo.

Snapshots de contexto preservam exatamente os cortes usados na geração; o registro original da mensagem mantém o conteúdo completo. A análise pode comparar ambos. Sessões retomadas são identificadas, mas não se presume reconstruir todo o histórico interno do CLI: ausência no contexto novo não prova ausência na sessão.

## Análise de madrugada

### Agendamento e retomada

O scheduler verifica periodicamente, e ao iniciar o processo, quais arquivos de dias encerrados estão pendentes. O horário é calculado no fuso explícito, independente do fuso do Windows.

- Durante a janela configurada, enfileirar trabalhos pendentes de dias encerrados, do mais antigo para o mais recente. Ao terminar a janela, concluir apenas a chamada em curso e persistir seu checkpoint; os próximos blocos aguardam a janela seguinte. Não criar arquivos para combinações sem eventos.
- Um trabalho é identificado por `(guildId, channelId, localDate)`.
- Persistir estado `pending`, `running`, `failed` ou `completed`, tentativas, `nextAttemptAt`, hash da fonte, identificação da configuração do analisador e referências aos checkpoints das etapas.
- Um trabalho encontrado como `running` após reinício volta a ficar pendente.
- Sucesso exige resposta válida e publicação atômica da memória. A existência de um `.md` temporário ou uma saída parcial do modelo não conclui o trabalho.
- Falhas transitórias têm até três tentativas por trabalho e janela, com espera de 5 e 15 minutos entre elas. Esgotadas, o trabalho fica `failed` até a próxima janela. Fonte corrompida ou saída estruturalmente inválida após a correção permitida exige intervenção ou mudança da fonte/configuração antes de novas tentativas pagas. Uma falha não bloqueia outros canais.

O job espera a drenagem das escritas daquela fonte e não começa enquanto houver geração ou processamento de mídia ativo pertencente àquela partição. Após reinício, execução com início sem fim é marcada como interrompida/desfecho desconhecido; ela não pode bloquear a análise para sempre nem ser presumida como falha de entrega.

Sob a fila de escrita de cada arquivo lido, fixar um limite de bytes correspondente a registros completos. A análise usa uma cópia imutável do dia-alvo e os trechos auxiliares congelados. Antes de publicar, confirmar que a fonte do dia-alvo não mudou; se mudou, descartar a candidatura à publicação e reagendar a nova revisão. Acrescentar mensagens ao arquivo de `D+1` não invalida o contexto congelado. Isso evita memória marcada como atual enquanto um resultado tardio era anexado ao dia-alvo, sem reagendar continuamente por atividade no dia seguinte.

Checkpoints só são reutilizáveis para a mesma entrada e configuração: hash da fonte do dia-alvo e dos trechos auxiliares, hash do prompt de análise, versão do schema/algoritmo de divisão, backend, modelo e esforço. Trocar esses valores invalida parciais pendentes. Memórias concluídas não são reprocessadas automaticamente só por mudar o modelo ou prompt do analisador; isso exige habilitar explicitamente `CONVERSATION_REPROCESS_COMPLETED=true`. Alteração da fonte do dia-alvo torna a memória anterior desatualizada e permite substituí-la somente após uma nova execução bem-sucedida.

O arquivo de estado e a memória são publicados por escrita temporária e rename no mesmo volume, preservando a versão anterior em caso de erro. Após falha entre publicar memória e atualizar estado, metadados estruturados no cabeçalho permitem reconciliar hash da fonte e configuração sem chamar novamente o modelo. As memórias são saídas geradas; observações manuais devem ficar em arquivo separado para não serem sobrescritas em uma regeneração.

### Concorrência

Respostas do Discord e análises usam o mesmo coordenador serial de execução. Chamadas auxiliares de imagem/anexos que usem backend também precisam participar desse coordenador antes de afirmar que só existe um CLI ativo. A fila coordena chamadas, sem uma tarefa aguardar outra enfileirada atrás dela. Trabalhos de análise ficam em baixa prioridade: chamadas de atendimento pendentes entram primeiro, e cada bloco de análise volta à fila separadamente.

Uma chamada de análise já iniciada pode atrasar uma resposta até terminar ou atingir o timeout configurado. Limitar o tamanho dos blocos e o timeout reduz essa espera; não prometer preempção na primeira versão.

### Backend e sessão

Adicionar um modo próprio `analysis` aos adapters, com prompt de avaliação independente da persona de conversa. Não usar `full` para obter um resumo e não reaproveitar `askClaude` com a sessão do servidor.

- Não enviar o arquivo diário inteiro em uma única chamada. O programa percorre a fonte em blocos compactos e sequenciais, apresentando a cada etapa os metadados de cobertura, o bloco atual e o checkpoint resumido anterior. O modelo pode pedir leituras adicionais durante a etapa para conferir uma hipótese, localizar uma reply distante ou recuperar timestamp e contexto originais.
- A IA não recebe uma ferramenta de sistema nem acesso direto a arquivos. Para consultar o snapshot, devolve JSON `readRequests`; o programa valida e executa pedidos estruturados por alias (`e...`, `p...`, `n...`), cursor/página, ID de evento/mensagem, relação de reply/geração/mídia ou trecho de campo. O pedido não aceita caminho arbitrário. As fontes são o dia-alvo e somente os trechos auxiliares congelados de `D-1`/`D+1`, identificados como contexto auxiliar.
- Cada resposta pode pedir até três leituras e cada bloco tem limite de rodadas, quantidade de resultados, bytes e orçamento de chamadas da janela. O padrão limita cada resultado a 20 eventos/32 KB, até 100 consultas por job e três rodadas de leitura por bloco. Truncamento é sinalizado e pode ser consultado em faixa menor. Consultas, aliases, resultados e hashes ficam no checkpoint/manifesto; a validação final aceita somente IDs e trechos conferíveis nos registros efetivamente lidos.
- Os adapters de análise desligam ferramentas, shell, escrita, rede/web, MCP/plugin, sessão retomada e acesso ao repositório/disco. A leitura é feita pelo programa, nunca por ferramenta do modelo; assim todos os backends compartilham a mesma restrição.
- Cada chamada de bloco e consolidação começa sem sessão retomada. Um follow-up recebe somente a linha do tempo compacta do bloco, leituras permitidas daquela etapa e um checkpoint resumido do bloco anterior; ao seguir para o próximo bloco, o checkpoint estruturado substitui o histórico da etapa anterior, sem acumular o transcript no contexto.
- O programa valida a saída e grava o `.md`; o modelo não grava arquivos.
- A análise avalia somente a conversa e os snapshots fornecidos. Não apresenta inferência sobre código como se tivesse inspecionado ou executado o repositório.

A seleção de modelo para essa tarefa vem da configuração de análise ou de `MODEL.analysis`/`EFFORT.analysis` do backend escolhido, com fallback para os respectivos valores de `web`. Resolver executável e settings do backend de análise separadamente quando ele diferir do backend de atendimento. Nunca usar a preferência de um participante via `/model`.

Configuração de captura e de análise possuem habilitação independente. Desligar a análise continua acumulando conversas para processamento posterior. O orçamento de entrada, reserva de saída, timeout, limite de fila de escrita e máximo de chamadas por janela devem ser explícitos e validados na implementação. Ao atingir o limite de chamadas, preservar checkpoints e continuar na próxima janela, sem publicar um resumo parcial como final.

### Dias grandes

Não cortar silenciosamente a transcrição nem assumir que um dia cabe em uma chamada. O leitor percorre o snapshot em streaming. Para dias que excedam o orçamento de memória, a ordenação por horário de criação e ID usa runs temporários de tamanho limitado e merge em disco com número limitado de arquivos abertos; ler em streaming e depois acumular o dia inteiro em um array não satisfaz esse limite. IDs Discord são comparados sem conversão para `Number`.

1. Criar um índice leve com contagens, faixas de horário, IDs/aliases e posição/cursor dos registros; fornecer um bloco inicial para orientar e dividir a linha do tempo em blocos limitados por orçamento de entrada, incluindo instruções e metadados na conta. Nunca enviar todo o JSONL em uma única chamada. Priorizar limites entre mensagens; dividir uma mensagem individual grande em trechos identificados quando necessário.
2. Incluir uma sobreposição limitada nas bordas. Relações explícitas de reply e `generationId` preservam pedido, resposta e feedback mesmo quando distantes: fornecer excertos referenciados da mesma fonte como contexto auxiliar, respeitando o orçamento. Se não couberem, produzir uma etapa específica para a interação ou usar a consulta controlada do backend; não presumir que sobreposição resolve replies distantes.
3. Durante cada bloco, permitir que o modelo leia páginas ou mensagens adicionais da fonte congelada por meio da ferramenta limitada. Respostas da ferramenta entram no contexto daquela etapa e consomem o orçamento restante; o programa sinaliza truncamento e fornece cursor para continuar. Essas leituras aprofundam o bloco atual sem substituir a leitura sequencial que garante cobertura.
4. Ao fim de cada bloco, exigir saída estruturada com temas, interações, evidências, avaliações, intervalo coberto e cursor seguinte. Persistir atomicamente o checkpoint e o manifesto de eventos realmente cobertos, consultas feitas e resultados devolvidos. Se o processo parar, retomar do último checkpoint válido sem repetir ou pular mensagens; a declaração do modelo, sozinha, não prova cobertura.
5. Iniciar cada bloco seguinte em sessão limpa, enviando apenas o checkpoint anterior, uma sobreposição limitada e o novo bloco. Relações explícitas de reply e `generationId` podem buscar excertos referenciados da mesma fonte; se não couberem, registrar a pendência e tratá-la numa etapa específica, sem presumir que a sobreposição resolve relações distantes.
6. Após a cobertura sequencial completa, consolidar somente resultados do mesmo servidor/canal/dia, deduplicando evidências e mantendo referências. Se os parciais excederem o orçamento, consolidar em níveis até caber. A consolidação usa checkpoints e evidências já verificadas; novas leituras da transcrição acontecem nos blocos, para manter o limite de contexto e consultas previsível.
7. Publicar a memória final apenas quando todas as etapas obrigatórias terminarem. Falhas, impossibilidade de consulta requerida, checkpoint incompatível e cobertura incompleta nunca são apresentados como análise completa.

Conteúdo de participantes, saídas do bot e snapshots dos prompts avaliados são material de análise, não instruções do job. Pedidos na transcrição para alterar arquivos, manipular a memória ou ignorar o avaliador não mudam o contrato. O avaliador compara comportamento e resultado às instruções registradas sem assumir para si a persona analisada.

## Conteúdo da memória Markdown

Cada memória deve conter:

1. **Identificação e cobertura:** data, fuso, servidor/canal e IDs, fonte e hash, backend/modelo, versão do analisador, horário, quantidade de mensagens e gerações, trechos auxiliares de cada dia vizinho e momento de seu congelamento, lacunas conhecidas.
2. **Resumo geral do canal:** assuntos e continuidade das conversas. Mensagens sem acionamento servem de contexto, sem serem tratadas como respostas do bot.
3. **Interações com o bot:** pedido, resposta ou ausência, desfecho observável e referências às mensagens. Em mídia, identificar autor e mensagem de origem, output da descrição/transcrição e resposta que o utilizou, distinguindo resultado completo de texto efetivamente enviado ao modelo.
4. **O que funcionou:** comportamentos úteis e elogios explícitos, com evidências. Continuação da conversa ou silêncio não são prova de aprovação.
5. **O que não funcionou:** críticas, correções, pedidos repetidos, respostas fora do assunto e erros técnicos. Distinguir falha de entrega, contexto, atendimento e conteúdo.
6. **Mudanças propostas no prompt:** regra/comportamento observado, problema, texto sugerido, benefício esperado, risco de efeito colateral, confiança e evidências.
7. **Mudanças propostas no código/configuração:** hipótese técnica, evidências, componente provável e forma de verificar. Exemplos: seleção curta de contexto ou corte em 200 caracteres. Não converter um problema técnico em recomendação genérica de prompt.
8. **Limitações e dúvidas:** sarcasmo/elogio ambíguo, referência ausente, conteúdo de anexo não preservado, sessão anterior não reconstruída e falta de dados.

Uma proposta precisa apontar IDs e trechos curtos da conversa, além do contexto necessário para interpretá-los. Preferir links de mensagem `https://discord.com/channels/<guildId>/<channelId>/<messageId>` quando os três IDs estiverem disponíveis.

Separar **observação**, **hipótese** e **mudança sugerida**. Exemplos isolados têm confiança limitada; elogio ou crítica não provam correção factual. Feedback conflitante de diferentes participantes deve permanecer visível.

A saída estruturada do avaliador deve ser validada antes da renderização: campos obrigatórios, IDs presentes no manifesto da entrada (dia-alvo e contexto auxiliar), trechos citados conferíveis e cobertura calculada pelo programa. O programa monta links e metadados a partir dos registros, em vez de confiar em URLs inventadas pelo modelo. Validação estrutural não prova a qualidade das conclusões. Saída inválida pode ter uma tentativa limitada de correção; se continuar inválida, o trabalho falha sem publicar memória final. Processar integralmente uma fonte com lacunas conhecidas permite publicação, mas a memória deve distinguir “análise concluída da fonte disponível” de “captura completa do dia”.

Não forçar sugestões quando faltarem evidências. Um dia sem interação nem pedido observável ao bot ainda recebe resumo dos temas do canal, mas a avaliação do bot informa ausência de dados. Uma ausência de resposta só sustenta hipótese de falha quando confrontada com as regras de atendimento e a decisão registrada: whitelist, filtros ou `NO_REPLY` podem explicar um comportamento correto. Discordância com a persona configurada deve ser distinguida de descumprimento do prompt.

## Componentes e alterações previstas

| Componente | Responsabilidade |
| --- | --- |
| `src/conversation-archive.js` (novo) | Partição por IDs/data, contrato JSONL, deduplicação, append e flush |
| `src/conversation-analysis.js` (novo) | Blocos, chamadas ao backend, validação, consolidação e renderização Markdown |
| `src/conversation-order.js` (novo) | Ordenação externa do snapshot com runs limitados e merge em disco |
| `src/conversation-lookup.js` (novo) | Consultas estruturadas, limitadas e somente leitura ao snapshot congelado; manifesto de consultas |
| `src/conversation-backend.js` (novo) | Chamada do backend de análise, métricas próprias e prioridade baixa na fila |
| `src/conversation-scheduler.js` (novo) | Horário, descoberta de fontes, estado persistido e retomada |
| `src/settings.js` e `src/settings.<backend>.js` | Habilitação, fuso, horário, modelo/esforço, orçamento de entrada, limites de consultas e timeout de análise |
| `src/index.js` | Captura anterior aos filtros, registros de geração/envio, startup e shutdown |
| `src/prompts.js` e adapters de backend | Modo `analysis` independente, sem sessão retomada e com apenas a consulta restrita quando suportada |
| `src/queue.js` | Prioridade de respostas sobre blocos de análise, mantendo execução serial |
| `.gitignore` | Dados de conversas, memórias, estado e temporários |

O log operacional continua sendo usado para diagnóstico da execução. Métricas de análise devem identificar a finalidade `analysis`, sem aumentar artificialmente contadores de respostas ao Discord.

## Limites da primeira versão

- Captura a partir da implantação, enquanto o bot está conectado e recebe eventos. Não recupera automaticamente histórico anterior ou mensagens perdidas durante períodos offline.
- Não usa o log antigo como fonte de transcrição completa.
- Registra as mensagens recebidas em `MessageCreate`; histórico de edições, exclusões e reações fica para uma extensão futura. Feedback por emoji não será avaliado como se tivesse sido coletado.
- Referências a outro canal são omitidas da análise. Para dias vizinhos do mesmo canal, importar somente os trechos previstos no contexto da virada e seus resultados de mídia associados; outros dias usam apenas o contexto auxiliar já registrado na geração.
- O contrato inclui transcrição de áudio futura, mas esta feature não implementa transcritor nem passa a analisar automaticamente mídias que o pipeline atual ignora.
- Não altera limites de contexto, prompts ou código a partir das recomendações.
- Não manda a memória para o Discord e não cria memória consolidada entre canais/servidores.

## Critérios de aceitação e validação

- Duas mensagens no mesmo dia, mas em canais ou servidores diferentes, são gravadas em caminhos distintos, mesmo com nomes iguais.
- Uma mensagem após meia-noite pertence ao novo dia em `America/Sao_Paulo`, inclusive quando o host usa outro fuso.
- Mensagens sem menção, fora da whitelist, de outros bots e do próprio bot são preservadas nos canais acompanhados; DMs e canais excluídos ficam fora.
- A análise inclui até 20 mensagens anteriores e 20 posteriores do mesmo canal/servidor; contabiliza separadamente o contexto auxiliar e declara quando há menos mensagens disponíveis.
- Mensagens recebidas depois do congelamento do contexto posterior não invalidam nem reagendam sozinhas o job; arquivos diários continuam separados.
- Uma imagem de reply mantém o autor original separado do solicitante; output completo, input efetivo e resposta entregue são correlacionáveis pelos IDs.
- Descrição concluída permanece arquivada mesmo com geração cancelada, `NO_REPLY` ou falha de entrega; processamento tardio e múltiplas mídias mantêm suas associações.
- O mesmo contrato comporta output de transcrição de áudio sem implementar essa capacidade nesta feature.
- Textos multilinha e mensagens com mais de 200 caracteres são preservados integralmente no arquivo de conversa.
- O JSONL conserva timestamps exatos e dados relevantes disponíveis; o prompt usa cabeçalho de data único, `HHhMM` ao iniciar o dia/hora, `MMm` dentro da mesma hora e omite horários repetidos no mesmo minuto sem unir as mensagens nem perder autor/referência.
- A linha do tempo compacta não repete a data por mensagem nem os segundos; `18m` após `14h16` é interpretado como minuto 18 das 14h. Os exemplos de serialização acima são testados, inclusive mudança de autor no mesmo minuto e mudança de hora.
- Uma resposta capturada pelo gateway e pelo retorno do envio produz um único registro; reinício não perde essa deduplicação.
- Fallback, divisão de resposta e falha após enviar apenas alguns trechos preservam o que chegou ao Discord e a entrega parcial.
- O contexto registrado corresponde à entrada real da geração, inclusive cortes, referências e marcador de sessão.
- Falha de gravação não derruba atendimento; shutdown drena a captura; linha final interrompida é recuperada.
- Às 03:00 o scheduler usa o dia anterior; reinício recupera pendências; execução repetida não duplica a memória concluída da mesma fonte.
- Queda após publicação é reconciliada; fonte alterada por geração tardia pode ser reanalisada.
- Lote e resposta atravessando meia-noite seguem as regras de partição; geração interrompida por reinício não bloqueia o job indefinidamente.
- Mudança da fonte durante a análise impede publicação desatualizada; checkpoints incompatíveis não são reutilizados.
- Thread incluída pelo pai mantém arquivo próprio; conteúdo de outro canal presente em snapshot não entra na análise.
- Fim da janela e limite de chamadas preservam checkpoints, sem iniciar novas chamadas até a próxima janela.
- Dia grande é processado em blocos sem misturar partições e sem descartar silenciosamente o restante.
- Nenhum dia inteiro é incluído numa só chamada; a cobertura do dia-alvo é comprovada pelos blocos/checkpoints do programa, e consultas sob demanda recuperam eventos completos para verificar evidências.
- Cada bloco começa em sessão limpa com o checkpoint anterior e uma sobreposição limitada; a IA pode pedir páginas adicionais dentro dos limites, e respostas dessas consultas consomem o orçamento de contexto/chamadas da etapa.
- Após cada bloco, checkpoint e cursor são persistidos; reinício retoma do último checkpoint compatível sem duplicar nem pular eventos. A síntese final usa os checkpoints e evidências, não a transcrição inteira acumulada numa sessão.
- Consulta do modelo é somente leitura, ligada ao snapshot deste job, limitada por resultados/bytes/chamadas e auditada no manifesto; não permite paths arbitrários, escrita, execução, rede ou acesso a outro canal/servidor/dia além do contexto auxiliar congelado.
- Um backend que não possa restringir a ferramenta de consulta falha explicitamente e não amplia as permissões da análise.
- Feedback por reply distante mantém ligação com a interação; cobertura é verificada pelo manifesto do programa.
- Cada backend monta chamadas sem retomar sessões do Discord e sem ferramentas gerais; quando suportada, somente a consulta restrita ao snapshot fica disponível.
- Evidência inexistente, saída inválida ou etapa incompleta impede publicação de uma memória final bem-sucedida.
- Recomendações distinguem prompt e código, citam evidências e não tratam falta de feedback como aprovação.
- Nenhum prompt de resposta é modificado ou alimentado automaticamente pelas memórias.

Os testes automatizados usam diretórios temporários, relógio injetado e backend simulado; a suíte existente também foi executada. Em 2026-10-08, `npm test` concluiu com 237 testes passando e 7 falhas preexistentes listadas em `falhas.md`. A validação em um servidor Discord real — incluindo recebimento de mensagens do próprio bot e captura anterior aos filtros — continua pendente.

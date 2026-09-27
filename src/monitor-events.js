const WEB_TOOLS = new Set(['WebSearch', 'web_search', 'WebFetch', 'web_fetch']);
const toolNameOf = (name) => WEB_TOOLS.has(name) ? name : null;

export function createBackendMetricHandler({ monitor, generationId, backendName, fallbackModel = null }) {
  const attemptSequences = new Map();
  const sourceByCallId = new Map();
  const queuedSources = new Map();
  const tokenEventsByAttempt = new Map();

  const next = (attempt) => {
    const value = (attemptSequences.get(attempt) ?? 0) + 1;
    attemptSequences.set(attempt, value);
    return value;
  };
  const startTool = (name, callId, attempt, model) => {
    const toolName = toolNameOf(name);
    if (!toolName) return;
    const ordinal = next(attempt);
    const identity = callId == null ? `event-${ordinal}` : String(callId);
    const sourceKey = `${backendName}:${attempt}:tool:${identity}`;
    if (!monitor.startTool({ generationId, sourceKey, model: model ?? fallbackModel, toolName, startedAt: Date.now() })) return;
    if (callId != null) sourceByCallId.set(`${attempt}:${callId}`, { sourceKey, toolName });
    const queueKey = `${attempt}:${toolName}`;
    const queue = queuedSources.get(queueKey) ?? [];
    queue.push(sourceKey);
    queuedSources.set(queueKey, queue);
  };
  const finishTool = (name, callId, attempt, outcome) => {
    const call = callId == null ? null : sourceByCallId.get(`${attempt}:${callId}`);
    const toolName = toolNameOf(name) ?? call?.toolName;
    if (!toolName) return;
    let sourceKey = call?.sourceKey;
    if (!sourceKey) {
      const queue = queuedSources.get(`${attempt}:${toolName}`) ?? [];
      sourceKey = queue.shift() ?? null;
    }
    if (!sourceKey) return;
    if (callId != null) sourceByCallId.delete(`${attempt}:${callId}`);
    const queue = queuedSources.get(`${attempt}:${toolName}`) ?? [];
    const index = queue.indexOf(sourceKey);
    if (index >= 0) queue.splice(index, 1);
    monitor.finishTool({ generationId, sourceKey, finishedAt: Date.now(), outcome });
  };
  const recordUsage = (usage, model, attempt) => {
    if (!usage || typeof usage !== 'object') return;
    const inputTokens = usage.inputTokens ?? usage.input_tokens;
    const outputTokens = usage.outputTokens ?? usage.output_tokens;
    const cacheReadInputTokens = usage.cacheReadTokens ?? usage.cache_read_input_tokens;
    const cacheCreationInputTokens = usage.cacheWriteTokens ?? usage.cache_creation_input_tokens;
    if ([inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens].every((value) => value == null)) return;
    const ordinal = next(attempt);
    tokenEventsByAttempt.set(attempt, (tokenEventsByAttempt.get(attempt) ?? 0) + 1);
    monitor.recordTokenUsage({
      generationId,
      sourceKey: `${backendName}:${attempt}:request:${ordinal}`,
      measuredAt: Date.now(),
      model: model ?? usage.model ?? fallbackModel,
      inputTokens: inputTokens == null
        ? (cacheReadInputTokens == null && cacheCreationInputTokens == null ? null : Number(cacheReadInputTokens ?? 0) + Number(cacheCreationInputTokens ?? 0))
        : Number(inputTokens),
      outputTokens: outputTokens == null ? null : Number(outputTokens),
      cacheReadInputTokens: cacheReadInputTokens == null ? null : Number(cacheReadInputTokens),
      cacheCreationInputTokens: cacheCreationInputTokens == null ? null : Number(cacheCreationInputTokens),
    });
  };

  const handler = (event, { attempt = 1 } = {}) => {
    if (!generationId || !event) return;
    if (backendName === 'commandcode') {
      const item = event.event;
      if (event.type !== 'event' || !item) return;
      if (item.type === 'model_request_end') recordUsage(item.usage, item.model, attempt);
      const callId = item.toolCallId ?? item.toolUseId ?? item.callId ?? item.toolId ?? item.id;
      if (item.type === 'tool_queued') startTool(item.toolName, callId, attempt, item.model);
      if (item.type === 'tool_completed') finishTool(item.toolName, callId, attempt, item.isError || item.error ? 'failure' : 'success');
      if (item.type === 'tool_denied') finishTool(item.toolName, callId, attempt, 'failure');
      return;
    }

    if (event.type === 'assistant') {
      const message = event.message ?? {};
      for (const block of message.content ?? []) {
        if (block.type === 'tool_use') startTool(block.name, block.id, attempt, message.model);
      }
    } else if (event.type === 'user') {
      const message = event.message ?? {};
      for (const block of message.content ?? []) {
        if (block.type === 'tool_result') finishTool(block.name ?? block.tool_name, block.tool_use_id, attempt, block.is_error ? 'failure' : 'success');
      }
    }
  };
  handler.hasTokenEvents = (attempt = undefined) => attempt == null
    ? [...tokenEventsByAttempt.values()].some((count) => count > 0)
    : (tokenEventsByAttempt.get(attempt) ?? 0) > 0;
  return handler;
}

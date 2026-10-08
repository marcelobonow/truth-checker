import { createBackendMetricHandler } from './monitor-events.js';

export function createConversationBackendCaller({ backend, config, queue, monitor = null, now = Date.now }) {
  if (!backend?.buildRequest || !backend?.run || !queue?.add) throw new TypeError('backend e queue são obrigatórios');
  return (prompt, { signal } = {}) => queue.add(async () => {
    const startedAt = now();
    const model = config.model?.analysis ?? null;
    const generationId = monitor?.startGeneration({
      startedAt, backend: backend.name, mode: 'analysis', model,
      effort: config.effort?.analysis ?? null, analyzedMessageCount: 0,
    });
    const metrics = monitor && generationId != null
      ? createBackendMetricHandler({ monitor, generationId, backendName: backend.name, fallbackModel: model })
      : null;
    try {
      const request = backend.buildRequest({
        mode: 'analysis', workDir: config.workDir, extraPrompt: config.extraPrompt?.analysis,
        model, effort: config.effort?.analysis, prompt,
      });
      const result = await backend.run({
        ...request, cwd: config.workDir, bin: config.bin, timeoutMs: config.timeoutMs, signal,
        onEvent: metrics ? (event, metadata) => metrics(event, metadata) : undefined,
      });
      if (metrics && !metrics.hasTokenEvents()) {
        for (const [index, usage] of (result.tokenUsage ?? []).entries()) monitor.recordTokenUsage({
          generationId, sourceKey: `${backend.name}:analysis-result:${index}`, granularity: 'generation',
          measuredAt: now(), ...usage, model: usage.model ?? model,
        });
      }
      if (result.isError) throw new Error(`${backend.name} analysis retornou erro (${result.subtype ?? 'desconhecido'}): ${(result.text ?? '').slice(0, 200)}`);
      monitor?.finishGeneration({ id: generationId, finishedAt: now(), modelSucceeded: true, outcome: 'analysis_complete' });
      return result.text ?? '';
    } catch (error) {
      monitor?.finishGeneration({ id: generationId, finishedAt: now(), modelSucceeded: false, outcome: error.name === 'AbortError' ? 'cancelled' : 'analysis_failed' });
      throw error;
    }
  }, { priority: 'low' });
}

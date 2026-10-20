import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mesmo endpoint que o /usage do Claude Code consulta (API interna, sem
// garantia de estabilidade). O token é o do login do CLI; o próprio CLI o
// renova no arquivo, por isso é lido a cada chamada.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CREDENTIALS = path.join(os.homedir(), '.claude', '.credentials.json');

export function readAccessToken(file = CREDENTIALS) {
  const token = JSON.parse(fs.readFileSync(file, 'utf8')).claudeAiOauth?.accessToken;
  if (!token) throw new Error(`sem accessToken em ${file}`);
  return token;
}

// { fiveHour, sevenDay }: % já usado de cada janela.
export async function fetchUsage({ token = readAccessToken(), fetchFn = fetch } = {}) {
  const res = await fetchFn(USAGE_URL, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
  });
  if (!res.ok) throw new Error(`usage respondeu ${res.status}`);
  return parseUsage(await res.json());
}

export function parseUsage(data) {
  return { fiveHour: data.five_hour?.utilization ?? null, sevenDay: data.seven_day?.utilization ?? null };
}

// "49/32%" = quanto já foi usado nas janelas de 5 h e de 7 dias.
export function formatUsage({ fiveHour, sevenDay }) {
  const pct = (used) => (used == null ? '?' : String(Math.round(used)));
  return `${pct(fiveHour)}/${pct(sevenDay)}%`;
}

// O Command Code ainda não documenta uma API pública para os medidores do
// plano. O CLI obtém estes dados de /alpha/whoami e /alpha/billing/credits.
// Esta rota interna é usada pelo /usage do próprio CLI e pode mudar sem aviso.
const COMMANDCODE_API = 'https://api.commandcode.ai';
const COMMANDCODE_AUTH = path.join(os.homedir(), '.commandcode', 'auth.json');
const COMMANDCODE_CACHE_MS = 30_000;
const PLAN_MONTHLY_CREDITS = {
  'individual-go': 10,
  'individual-goat': 70,
  'individual-pro': 30,
  'individual-pro-v1': 80,
  'individual-provider': 15,
  'individual-max': 150,
  'individual-ultra': 300,
  'teams-pro': 40,
};
let commandCodeCache = null;

function readCommandCodeApiKey(file = COMMANDCODE_AUTH) {
  const apiKey = JSON.parse(fs.readFileSync(file, 'utf8')).apiKey;
  if (!apiKey) throw new Error(`sem apiKey em ${file}`);
  return apiKey;
}

function planMonthlyCredits(planId) {
  if (!planId) return null;
  const normalized = String(planId).toLowerCase();
  const key = Object.keys(PLAN_MONTHLY_CREDITS).sort((a, b) => b.length - a.length)
    .find((candidate) => normalized.startsWith(candidate));
  return key ? PLAN_MONTHLY_CREDITS[key] : null;
}

async function commandCodeGet(endpoint, apiKey, fetchFn) {
  const response = await fetchFn(`${COMMANDCODE_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Command Code ${endpoint} respondeu ${response.status}`);
  return response.json();
}

// Retorna créditos já consumidos, teto e horário de reset das janelas de 5 h,
// 7 dias e do ciclo mensal. Os limites de janela valem para créditos inclusos.
export async function fetchCommandCodeUsage({ apiKey = readCommandCodeApiKey(), fetchFn = fetch, now = Date.now() } = {}) {
  if (commandCodeCache && now - commandCodeCache.fetchedAt < COMMANDCODE_CACHE_MS) return commandCodeCache;

  const whoami = await commandCodeGet('/alpha/whoami?limits=1', apiKey, fetchFn);
  const orgId = whoami.org?.id ?? null;
  const billingQuery = new URLSearchParams();
  if (orgId) billingQuery.set('orgId', orgId);
  const query = billingQuery.size ? `?${billingQuery}` : '';
  const [billing, subscription] = await Promise.all([
    commandCodeGet(`/alpha/billing/credits${query}`, apiKey, fetchFn),
    commandCodeGet(`/alpha/billing/subscriptions${query}`, apiKey, fetchFn),
  ]);
  const summaryQuery = new URLSearchParams(billingQuery);
  if (subscription.data?.currentPeriodStart) summaryQuery.set('since', subscription.data.currentPeriodStart);
  const summary = await commandCodeGet(`/alpha/usage/summary?${summaryQuery}`, apiKey, fetchFn);
  const credits = billing.credits ?? {};
  const planId = subscription.data?.planId ?? credits.planId ?? null;
  const monthlyCap = planMonthlyCredits(planId);
  const monthlyRemaining = Number.isFinite(Number(credits.monthlyCredits)) ? Number(credits.monthlyCredits) : null;
  const monthlyUsed = monthlyCap == null || monthlyRemaining == null
    ? null
    : Math.max(0, monthlyCap - monthlyRemaining);
  commandCodeCache = {
    fetchedAt: now,
    planId,
    fiveHour: billing.windowLimits?.fiveHour ?? null,
    weekly: billing.windowLimits?.weekly ?? null,
    monthly: {
      used: monthlyUsed,
      cap: monthlyCap,
      remaining: monthlyRemaining,
      resetAt: subscription.data?.currentPeriodEnd ? Date.parse(subscription.data.currentPeriodEnd) : null,
    },
    monthlyTokens: Number.isFinite(Number(summary.totalTokens)) ? Number(summary.totalTokens) : null,
    monthlyRequests: Number.isFinite(Number(summary.totalCount)) ? Number(summary.totalCount) : null,
  };
  return commandCodeCache;
}

export function formatCommandCodeUsage(usage) {
  if (!usage) return 'Uso Command Code: indisponível.';
  const percent = (data) => data && data.cap > 0 && Number.isFinite(Number(data.used))
    ? `${Math.round((data.used / data.cap) * 100)}%`
    : '?';
  const monthly = usage.monthly;
  const monthlyPercent = monthly?.used != null && monthly.cap > 0
    ? `${Math.round((monthly.used / monthly.cap) * 100)}%`
    : '?';
  const compactTokens = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return '?';
    const n = Number(value);
    const scale = Math.abs(n) >= 1_000_000 ? 1_000_000 : Math.abs(n) >= 1_000 ? 1_000 : 1;
    const suffix = scale === 1_000_000 ? 'M' : scale === 1_000 ? 'k' : '';
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n / scale)}${suffix}`;
  };
  const requests = usage.monthlyRequests == null
    ? '?'
    : new Intl.NumberFormat('pt-BR').format(usage.monthlyRequests);
  return `Uso: 5h ${percent(usage.fiveHour)}; semana ${percent(usage.weekly)}; mês ${monthlyPercent}; tokens no mês ${compactTokens(usage.monthlyTokens)}; requests no mês ${requests}.`;
}

export function clearCommandCodeUsageCache() {
  commandCodeCache = null;
}

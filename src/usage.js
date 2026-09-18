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

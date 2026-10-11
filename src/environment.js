import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Carrega antes dos módulos de configuração, inclusive ao iniciar sem npm.
// O caminho independe do cwd usado pelo terminal ou pelo PM2.
try {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

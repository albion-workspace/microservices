/**
 * Script Runner Utility
 * 
 * Provides a consistent pattern for running gateway scripts with:
 * - Proper exit handling (avoids hanging processes)
 * - Error handling with appropriate exit codes
 * - Support for long-running processes (dev servers)
 * 
 * Usage:
 *   import { runScript, runLongRunningScript } from './script-runner.js';
 *   
 *   // For scripts that complete and exit
 *   runScript(main);
 *   
 *   // For long-running scripts (dev servers)
 *   runLongRunningScript(main);
 */

export interface ScriptOptions {
  /** Script name for logging */
  name: string;
  /** Whether script is long-running (dev server) */
  longRunning?: boolean;
  /** Exit timeout in ms (default: 100) */
  exitTimeout?: number;
}

/**
 * Run a script with proper exit handling
 * - Sets exit code appropriately
 * - Forces exit after timeout to avoid hanging
 * - Uses setTimeout to allow async handles to close gracefully (Windows compatibility)
 */
export function runScript(
  main: () => Promise<void>,
  options: ScriptOptions = { name: 'Script' }
): void {
  const { name, exitTimeout = 100 } = options;

  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(`${name} failed:`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => {
      // Use setTimeout instead of setImmediate for Windows compatibility
      // This gives async handles time to close gracefully before exit
      setTimeout(() => {
        process.exit(process.exitCode ?? 0);
      }, exitTimeout);
    });
}

/**
 * Run a long-running script (dev server, watcher)
 * - Does not force exit on success (process keeps running)
 * - Only exits on error
 */
export function runLongRunningScript(
  main: () => Promise<void>,
  options: ScriptOptions = { name: 'Script' }
): void {
  const { name, exitTimeout = 100 } = options;

  main()
    .catch((err) => {
      console.error(`${name} failed:`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
      // Only force exit on error for long-running scripts
      setTimeout(() => {
        process.exit(1);
      }, exitTimeout);
    });
}

/**
 * Create a health check function that returns structured results
 */
export interface HealthResult {
  ok: boolean;
  status?: string;
  error?: string;
  url?: string;
}

export async function checkHttpHealth(
  url: string,
  timeoutMs: number = 5000
): Promise<HealthResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      try {
        const data = await response.json();
        return { ok: true, status: data.status || 'healthy', url };
      } catch {
        return { ok: true, status: 'healthy', url };
      }
    }
    return { ok: false, error: `HTTP ${response.status}`, url };
  } catch (err) {
    clearTimeout(timeout); // Always clear timeout on error
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout', url };
    }
    return { ok: false, error: 'Not responding', url };
  }
}

/**
 * Print a summary header
 */
export function printHeader(title: string): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(` ${title}`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
}

/**
 * Print a summary footer
 */
export function printFooter(message: string): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(` ${message}`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
}

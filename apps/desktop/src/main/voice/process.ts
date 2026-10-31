import { spawn } from 'node:child_process';

export interface ProcessOptions { signal?: AbortSignal; input?: string; timeoutMs?: number; maxOutputBytes?: number; cwd?: string }
/** Shell disabled. Program and flags are trusted app code; narration only enters stdin. */
export function runLocalProcess(executable: string, args: string[], options: ProcessOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(Error('Voice job canceled')); return; }
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], cwd: options.cwd });
    let stdout = ''; let stderr = ''; let size = 0; let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (error) { child.kill(); reject(error); } else resolve({ stdout, stderr });
    };
    const cancel = () => finish(Error('Voice job canceled'));
    const timer = setTimeout(() => finish(Error('Local voice process timed out')), options.timeoutMs ?? 90000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      size += chunk.length;
      if (size > (options.maxOutputBytes ?? 128 * 1024)) { finish(Error('Local voice output limit exceeded')); return; }
      if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (c: Buffer) => collect(c, 'stdout')); child.stderr.on('data', (c: Buffer) => collect(c, 'stderr'));
    child.on('error', error => finish(error));
    child.on('close', code => finish(code === 0 ? undefined : Error(`Local voice process failed (${code}): ${stderr.slice(-1200)}`)));
    child.stdin.on('error', () => {}); child.stdin.end(options.input ?? '');
  });
}

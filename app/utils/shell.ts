import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from './promises';
import { atom } from 'nanostores';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';

export async function newShellProcess(webcontainer: WebContainer, terminal: ITerminal) {
  const args: string[] = [];

  // we spawn a JSH process with a fallback cols and rows in case the process is not attached yet to a visible terminal
  const process = await webcontainer.spawn('/bin/jsh', ['--osc', ...args], {
    terminal: {
      cols: terminal.cols ?? 80,
      rows: terminal.rows ?? 15,
    },
  });

  const input = process.input.getWriter();
  const output = process.output;

  const jshReady = withResolvers<void>();

  let isInteractive = false;
  output.pipeTo(
    new WritableStream({
      write(data) {
        if (!isInteractive) {
          const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

          if (osc === 'interactive') {
            // wait until we see the interactive OSC
            isInteractive = true;

            jshReady.resolve();
          }
        }

        terminal.write(data);

        // Capture terminal output for debugging
        try {
          import('~/utils/debugLogger')
            .then(({ captureTerminalLog }) => {
              // Clean the data by removing ANSI escape sequences for logging
              const cleanData = data.replace(/\x1b\[[0-9;]*[mG]/g, '').trim();

              if (cleanData) {
                captureTerminalLog(cleanData, 'output');
              }
            })
            .catch(() => {
              // Ignore if debug logger is not available
            });
        } catch {
          // Ignore errors in debug logging
        }
      },
    }),
  );

  terminal.onData((data) => {
    // console.log('terminal onData', { data, isInteractive });

    if (isInteractive) {
      input.write(data);

      // Capture terminal input for debugging
      try {
        import('~/utils/debugLogger')
          .then(({ captureTerminalLog }) => {
            // Clean the data and check if it's a command (not just cursor movement)
            const cleanData = data.replace(/\x1b\[[0-9;]*[A-Z]/g, '').trim();

            if (cleanData && cleanData !== '\r' && cleanData !== '\n') {
              captureTerminalLog(cleanData, 'input');
            }
          })
          .catch(() => {
            // Ignore if debug logger is not available
          });
      } catch {
        // Ignore errors in debug logging
      }
    }
  });

  await jshReady.promise;

  return process;
}

export type ExecutionResult = { output: string; exitCode: number } | undefined;

export class BoltShell {
  #initialized: (() => void) | undefined;
  #readyPromise: Promise<void>;
  #webcontainer: WebContainer | undefined;
  #terminal: ITerminal | undefined;
  #process: WebContainerProcess | undefined;
  executionState = atom<
    { sessionId: string; active: boolean; executionPrms?: Promise<any>; abort?: () => void } | undefined
  >();
  #outputStream: ReadableStream<string> | undefined;
  #shellInputStream: WritableStreamDefaultWriter<string> | undefined;
  #waiters: Array<{
    waitCode: string;
    resolve: (data: { output: string; exitCode: number }) => void;
    startOffset: number;
  }> = [];
  #fullOutput = '';
  #lastExitCode = 0;
  #buffer = '';

  constructor() {
    this.#readyPromise = new Promise((resolve) => {
      this.#initialized = resolve;
    });
  }

  ready() {
    return this.#readyPromise;
  }

  async init(webcontainer: WebContainer, terminal: ITerminal) {
    this.#webcontainer = webcontainer;
    this.#terminal = terminal;

    const { process, commandStream } = await this.newBoltShellProcess(webcontainer, terminal);
    this.#process = process;
    this.#outputStream = commandStream;

    // Start the centralized command output reader
    this.#startReaderLoop();

    await this.waitTillOscCode('interactive');
    this.#initialized?.();
  }

  async newBoltShellProcess(webcontainer: WebContainer, terminal: ITerminal) {
    const args: string[] = [];
    const process = await webcontainer.spawn('/bin/jsh', ['--osc', ...args], {
      terminal: {
        cols: terminal.cols ?? 80,
        rows: terminal.rows ?? 15,
      },
    });

    const input = process.input.getWriter();
    this.#shellInputStream = input;

    const [streamA, streamB] = process.output.tee();

    const jshReady = withResolvers<void>();
    let isInteractive = false;
    streamA.pipeTo(
      new WritableStream({
        write(data) {
          if (!isInteractive) {
            const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

            if (osc === 'interactive') {
              isInteractive = true;
              jshReady.resolve();
            }
          }

          terminal.write(data);
        },
      }),
    );

    terminal.onData((data) => {
      if (isInteractive) {
        input.write(data);
      }
    });

    await jshReady.promise;

    return { process, terminalStream: streamA, commandStream: streamB };
  }

  async #startReaderLoop() {
    if (!this.#outputStream) {
      return;
    }

    const reader = this.#outputStream.getReader();
    const expoUrlRegex = /(exp:\/\/[^\s]+)/;

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      const text = value || '';
      this.#fullOutput += text;
      this.#buffer += text;

      // URL detection
      const expoUrlMatch = this.#buffer.match(expoUrlRegex);

      if (expoUrlMatch) {
        const cleanUrl = expoUrlMatch[1]
          .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
          .replace(/[^\x20-\x7E]+$/g, '');
        expoUrlAtom.set(cleanUrl);

        /*
         * Remove just the matched URL from the buffer to prevent duplicate processing
         * while preserving any surrounding OSC codes.
         */
        this.#buffer = this.#buffer.replace(expoUrlMatch[1], '');
      }

      // Signal detection
      let oscMatch;

      while ((oscMatch = this.#buffer.match(/\x1b\]654;([^\x07=;]+)(?:[=;]([^\x07]*))?\x07/)) !== null) {
        const [, osc, value] = oscMatch;

        if (osc === 'exit' && value) {
          this.#lastExitCode = parseInt(value.split(':')[0], 10);
        }

        // Clear buffer up to the end of the current signal
        this.#buffer = this.#buffer.slice(oscMatch.index! + oscMatch[0].length);

        // Notify matching waiters
        for (let i = 0; i < this.#waiters.length; i++) {
          const waiter = this.#waiters[i];

          if (osc === waiter.waitCode || osc.startsWith(waiter.waitCode + ';')) {
            const output = this.#fullOutput.slice(waiter.startOffset);
            waiter.resolve({ output, exitCode: this.#lastExitCode });
            this.#waiters.splice(i, 1);
            i--;
          }
        }
      }

      // Prevent regex performance degradation on huge buffers during commands like `npm install`
      if (this.#buffer.length > 8192) {
        this.#buffer = this.#buffer.slice(-8192);
      }

      // Prevent fullOutput bloat for long sessions
      if (this.#fullOutput.length > 1024 * 1024) {
        // If we reach 1MB, we might want to trim old output, but only if no waiters are using it as offset
        const minOffset = this.#waiters.length > 0 ? Math.min(...this.#waiters.map((w) => w.startOffset)) : Infinity;

        // If minOffset is large, we can safely prune some start
        if (minOffset > 512 * 1024) {
          const pruneSize = 256 * 1024;
          this.#fullOutput = this.#fullOutput.slice(pruneSize);

          for (const waiter of this.#waiters) {
            waiter.startOffset -= pruneSize;
          }
        }
      }
    }
  }

  get terminal() {
    return this.#terminal;
  }

  get process() {
    return this.#process;
  }

  async executeCommand(
    sessionId: string,
    command: string,
    abort?: () => void,
    timeoutMs?: number,
  ): Promise<ExecutionResult> {
    if (!this.process || !this.terminal) {
      return undefined;
    }

    const state = this.executionState.get();

    if (state?.active && state.abort) {
      state.abort();
    }

    this.terminal.input('\x03');
    await this.waitTillOscCode('prompt');

    if (state && state.executionPrms) {
      await state.executionPrms;
    }

    //start a new execution
    this.terminal.input(command.trim() + '\n');

    //wait for the execution to finish
    const executionPromise = this.getCurrentExecutionResult(timeoutMs);
    this.executionState.set({ sessionId, active: true, executionPrms: executionPromise, abort });

    const resp = await executionPromise;
    this.executionState.set({ sessionId, active: false });

    if (resp) {
      try {
        resp.output = cleanTerminalOutput(resp.output);
      } catch (error) {
        console.log('failed to format terminal output', error);
      }
    }

    return resp;
  }

  async getCurrentExecutionResult(timeoutMs?: number): Promise<ExecutionResult> {
    const { output, exitCode } = await this.waitTillOscCode('exit', timeoutMs);
    return { output, exitCode };
  }

  onQRCodeDetected?: (qrCode: string) => void;

  async waitTillOscCode(waitCode: string, timeoutMs = 60000) {
    const startOffset = this.#fullOutput.length;

    return new Promise<{ output: string; exitCode: number }>((resolve, _reject) => {
      const timeout = setTimeout(() => {
        const index = this.#waiters.findIndex((w) => w.resolve === resolve);

        if (index !== -1) {
          this.#waiters.splice(index, 1);
        }

        console.warn(`[BoltShell] Timeout waiting for OSC code: ${waitCode}`);
        resolve({ output: this.#fullOutput.slice(startOffset), exitCode: -1 });
      }, timeoutMs);

      this.#waiters.push({
        waitCode,
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        startOffset,
      });
    });
  }
}

/**
 * Cleans and formats terminal output while preserving structure and paths
 * Handles ANSI, OSC, and various terminal control sequences
 */
export function cleanTerminalOutput(input: string): string {
  // Step 1: Remove OSC sequences (including those with parameters)
  const removeOsc = input
    .replace(/\x1b\](\d+;[^\x07\x1b]*|\d+[^\x07\x1b]*)\x07/g, '')
    .replace(/\](\d+;[^\n]*|\d+[^\n]*)/g, '');

  // Step 2: Remove ANSI escape sequences and color codes more thoroughly
  const removeAnsi = removeOsc
    // Remove all escape sequences with parameters
    .replace(/\u001b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    // Remove color codes
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    // Clean up any remaining escape characters
    .replace(/\u001b/g, '')
    .replace(/\x1b/g, '');

  // Step 3: Clean up carriage returns and newlines
  const cleanNewlines = removeAnsi
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  // Step 4: Add newlines at key breakpoints while preserving paths
  const formatOutput = cleanNewlines
    // Preserve prompt line
    .replace(/^([~\/][^\n❯]+)❯/m, '$1\n❯')
    // Add newline before command output indicators
    .replace(/(?<!^|\n)>/g, '\n>')
    // Add newline before error keywords without breaking paths
    .replace(/(?<!^|\n|\w)(error|failed|warning|Error|Failed|Warning):/g, '\n$1:')
    // Add newline before 'at' in stack traces without breaking paths
    .replace(/(?<!^|\n|\/)(at\s+(?!async|sync))/g, '\nat ')
    // Ensure 'at async' stays on same line
    .replace(/\bat\s+async/g, 'at async')
    // Add newline before npm error indicators
    .replace(/(?<!^|\n)(npm ERR!)/g, '\n$1');

  // Step 5: Clean up whitespace while preserving intentional spacing
  const cleanSpaces = formatOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  // Step 6: Final cleanup
  return cleanSpaces
    .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newlines
    .replace(/:\s+/g, ': ') // Normalize spacing after colons
    .replace(/\s{2,}/g, ' ') // Remove multiple spaces
    .replace(/^\s+|\s+$/g, '') // Trim start and end
    .replace(/\u0000/g, ''); // Remove null characters
}

export function newBoltShellProcess() {
  return new BoltShell();
}

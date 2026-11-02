import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  bold: "\u001b[1m"
};

// Messages go to stderr, colored only for a terminal and never when NO_COLOR is set (https://no-color.org).
function colored(color: string, message: string): string {
  return process.stderr.isTTY && !process.env.NO_COLOR ? `${color}${message}${ANSI.reset}` : message;
}

export function info(message: string): void {
  console.error(colored(ANSI.cyan, message));
}

export function success(message: string): void {
  console.error(colored(ANSI.green, message));
}

export function warn(message: string): void {
  console.error(colored(ANSI.yellow, message));
}

export function error(message: string): void {
  console.error(colored(ANSI.red, message));
}

export async function promptText(label: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const suffix = defaultValue ? ` ${ANSI.dim}[${defaultValue}]${ANSI.reset}` : "";
    const answer = await rl.question(`${ANSI.bold}${label}:${ANSI.reset}${suffix} `);
    return answer.trim() || defaultValue || "";
  } finally {
    rl.close();
  }
}

export async function promptSecret(label: string, defaultValue?: string): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return promptText(label, defaultValue);
  }

  output.write(`${ANSI.bold}${label}:${ANSI.reset} `);
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = (): void => {
      input.off("data", onData);
      input.setRawMode(false);
      output.write("\n");
    };

    const onData = (chunk: string | Buffer): void => {
      const chars = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      for (const char of chars) {
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value || defaultValue || "");
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }
        if (char < " ") {
          continue;
        }
        value += char;
        output.write("*");
      }
    };

    input.on("data", onData);
  });
}

export async function confirm(message: string): Promise<boolean> {
  const answer = await promptText(`${message} [y/N]`);
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

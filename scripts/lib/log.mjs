const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const current = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;

const COLOR = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function paint(color, text) {
  return useColor ? `${color}${text}${COLOR.reset}` : text;
}

function ts() {
  return new Date().toISOString().slice(11, 19);
}

function emit(level, scope, args) {
  if (LEVELS[level] < current) return;
  const tag = paint(COLOR[level] ?? '', level.toUpperCase().padEnd(5));
  const head = `${paint(COLOR.dim, ts())} ${tag} ${paint(COLOR.bold, scope)}`;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${head} ${args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ')}\n`);
}

function inspect(value) {
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createLogger(scope) {
  return {
    debug: (...args) => emit('debug', scope, args),
    info: (...args) => emit('info', scope, args),
    warn: (...args) => emit('warn', scope, args),
    error: (...args) => emit('error', scope, args),
  };
}

export const log = createLogger('openllmdocs');

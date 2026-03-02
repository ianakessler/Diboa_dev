const isDev = process.env.NODE_ENV !== 'production';

function formatMessage(level, message, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

const logger = {
  info: (msg, meta = {}) => console.info(formatMessage('info', msg, meta)),
  warn: (msg, meta = {}) => console.warn(formatMessage('warn', msg, meta)),
  error: (msg, meta = {}) => console.error(formatMessage('error', msg, meta)),
  debug: (msg, meta = {}) => {
    if (isDev) console.debug(formatMessage('debug', msg, meta));
  },
};

export default logger;

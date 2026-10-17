export const log = {
  info: (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a),
  warn: (...a: unknown[]) => console.warn(new Date().toISOString().slice(11, 19), "WARN", ...a),
  error: (...a: unknown[]) => console.error(new Date().toISOString().slice(11, 19), "ERROR", ...a),
};

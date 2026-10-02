const tag = "corral";
export const logger = {
  success: (...a: unknown[]): void => console.log(`[${tag}]`, ...a),
  info: (...a: unknown[]): void => console.log(`[${tag}]`, ...a),
  warn: (...a: unknown[]): void => console.warn(`[${tag}]`, ...a),
  error: (...a: unknown[]): void => console.error(`[${tag}]`, ...a),
};

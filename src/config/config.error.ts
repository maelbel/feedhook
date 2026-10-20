/**
 * Thrown at startup when the configuration is invalid. Each issue names the
 * field and what is expected, but never contains a secret value.
 */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  // Private field: not printed again when Nest logs the error object.
  readonly #issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.#issues = Object.freeze([...issues]);
    // The problem is in the config, not in the code: a stack trace pointing
    // into Nest's injector would only hide the list of things to fix.
    this.stack = `${this.name}: ${this.message}`;
  }

  get issues(): readonly string[] {
    return this.#issues;
  }
}

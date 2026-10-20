const REDACTED = '[REDACTED]';

/**
 * Wraps a sensitive string (a Discord webhook URL, a push URL) so it cannot
 * leak by accident: logging it, putting it in a template string, or
 * serialising it to JSON all print `[REDACTED]`.
 *
 * The real value is kept in a private class field (`#value`), which
 * `console.log`, `util.inspect` and `JSON.stringify` cannot see. Code that
 * really needs it must call `reveal()` explicitly, which is easy to spot in
 * a review.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Secret(${REDACTED})`;
  }
}

/** The document is not a readable RSS or Atom feed. */
export class ParseError extends Error {
  override readonly name = 'ParseError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

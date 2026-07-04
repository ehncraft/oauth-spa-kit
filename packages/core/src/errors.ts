export class OAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "OAuthError";
  }
}

export class TokenExchangeError extends OAuthError {
  constructor(
    message: string,
    public readonly error?: string,
    public readonly errorDescription?: string,
  ) {
    super(message);
    this.name = "TokenExchangeError";
  }
}

export class DiscoveryError extends OAuthError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "DiscoveryError";
  }
}

export type PrivyErrorType = 
  | 'CRYPTO_ERROR'
  | 'API_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'INVALID_INPUT'
  | 'NETWORK_ERROR';

export class PrivyError extends Error {
  public readonly type: PrivyErrorType;
  public readonly originalError?: unknown;

  constructor(message: string, type: PrivyErrorType, originalError?: unknown) {
    super(message);
    this.name = 'PrivyError';
    this.type = type;
    this.originalError = originalError;
  }
}

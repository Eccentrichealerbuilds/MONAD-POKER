import { PrivyError } from '../types/errors';
import { ExportKeyResponse } from '../utils/crypto';

const PRIVY_API_BASE = 'https://api.privy.io/v1';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

interface PrivyConfig {
  appId: string;
  authSignature?: string;
}

export class PrivyClient {
  private readonly config: PrivyConfig;
  private rateLimitRemaining: number = 100;
  private rateLimitReset: number = 0;

  constructor(config: PrivyConfig) {
    this.config = config;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    // Update rate limit info
    this.rateLimitRemaining = Number(response.headers.get('x-ratelimit-remaining') || 100);
    this.rateLimitReset = Number(response.headers.get('x-ratelimit-reset') || 0);

    if (!response.ok) {
      let errorMessage: string;
      try {
        const error = await response.json();
        errorMessage = error.message || response.statusText;
      } catch {
        errorMessage = response.statusText;
      }

      switch (response.status) {
        case 401:
          throw new PrivyError('Unauthorized request', 'AUTHORIZATION_ERROR');
        case 429:
          throw new PrivyError('Rate limit exceeded', 'RATE_LIMIT_ERROR');
        default:
          throw new PrivyError(errorMessage, 'API_ERROR');
      }
    }

    return response.json();
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'privy-app-id': this.config.appId,
    };

    if (this.config.authSignature) {
      headers['privy-authorization-signature'] = this.config.authSignature;
    }

    return headers;
  }

  private async fetchWithRetry<T>(
    url: string,
    options: RequestInit,
    retryCount: number = 0
  ): Promise<T> {
    try {
      // Check rate limit
      if (this.rateLimitRemaining <= 0) {
        const waitTime = (this.rateLimitReset * 1000) - Date.now();
        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      const response = await fetch(url, {
        ...options,
        headers: this.getHeaders(),
      });

      return await this.handleResponse<T>(response);
    } catch (error) {
      if (retryCount < MAX_RETRIES && this.shouldRetry(error)) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, options, retryCount + 1);
      }
      throw error;
    }
  }

  private shouldRetry(error: unknown): boolean {
    if (error instanceof PrivyError) {
      return error.type === 'NETWORK_ERROR' || error.type === 'RATE_LIMIT_ERROR';
    }
    return false;
  }

  async exportWallet(walletId: string, recipientPublicKey: string): Promise<ExportKeyResponse> {
    const url = `${PRIVY_API_BASE}/wallets/${walletId}/export`;
    
    return this.fetchWithRetry<ExportKeyResponse>(url, {
      method: 'POST',
      body: JSON.stringify({
        encryption_type: 'HPKE',
        recipient_public_key: recipientPublicKey,
      }),
    });
  }
}

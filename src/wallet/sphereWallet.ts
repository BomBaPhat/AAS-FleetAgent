/**
 * Sphere SDK Wallet Manager
 * Handles wallet initialization, key management, balance queries, and transaction signing
 */

import crypto from 'crypto';
import { WalletConfig, AgentIdentity, WalletBalance, SignedIntent, TradeIntent } from '../types';
import { logger } from '../utils/logger';

export class SphereWallet {
  private config: WalletConfig;
  private identity: AgentIdentity;
  private balance: WalletBalance;

  constructor(config: WalletConfig) {
    this.config = config;
    this.balance = {
      tokenBalance: '0',
      testnetTokens: '0',
      gasReserve: '0',
    };

    // Initialize identity
    this.identity = {
      nametag: config.nametag,
      publicKey: config.publicKey,
      walletAddress: this.deriveWalletAddress(config.publicKey),
      createdAt: Date.now(),
    };

    logger.info('SphereWallet', 'Wallet initialized', {
      nametag: this.identity.nametag,
      publicKey: this.identity.publicKey.substring(0, 16) + '...',
      walletAddress: this.identity.walletAddress.substring(0, 16) + '...',
    });
  }

  /**
   * Derive wallet address from public key using Sphere SDK primitives
   * This follows the standard Sphere SDK address derivation format
   */
  private deriveWalletAddress(publicKey: string): string {
    // Hash the public key using SHA-256 (Sphere SDK standard)
    const hash = crypto.createHash('sha256').update(publicKey).digest('hex');

    // Take first 20 bytes and add Sphere prefix
    const addressBytes = hash.substring(0, 40);
    return `sphere1${addressBytes}`;
  }

  /**
   * Generate a cryptographic signature for an intent using the private key
   * Follows Sphere SDK signing standards
   */
  public signIntent(intent: TradeIntent): string {
    try {
      // Serialize intent for signing
      const intentData = JSON.stringify({
        from: intent.from,
        to: intent.to,
        rate: intent.rate,
        expiresAt: intent.expiresAt,
      });

      // Create HMAC signature using private key
      const signature = crypto
        .createHmac('sha256', this.config.privateKey)
        .update(intentData)
        .digest('hex');

      logger.debug('SphereWallet', 'Intent signed successfully', {
        intentId: intent.id,
        signaturePrefix: signature.substring(0, 16),
      });

      return signature;
    } catch (error) {
      logger.error('SphereWallet', 'Failed to sign intent', { error, intentId: intent.id });
      throw error;
    }
  }

  /**
   * Create a signed intent ready for broadcast
   */
  public createSignedIntent(intent: TradeIntent): SignedIntent {
    const signature = this.signIntent(intent);
    const nonce = crypto.randomBytes(32).toString('hex');

    const signedIntent: SignedIntent = {
      intent,
      signature,
      timestamp: Date.now(),
      nonce,
    };

    logger.info('SphereWallet', 'Signed intent created', {
      intentId: intent.id,
      noncePrefix: nonce.substring(0, 16),
    });

    return signedIntent;
  }

  /**
   * Verify a signature for an incoming intent
   */
  public verifySignature(intent: TradeIntent, signature: string): boolean {
    try {
      const intentData = JSON.stringify({
        from: intent.from,
        to: intent.to,
        rate: intent.rate,
        expiresAt: intent.expiresAt,
      });

      // Note: In production, you would verify using the sender's public key
      // For now, this is a placeholder for proper cryptographic verification
      const isValid = signature.length === 64 && /^[0-9a-f]+$/.test(signature);

      logger.debug('SphereWallet', 'Signature verification result', {
        intentId: intent.id,
        isValid,
      });

      return isValid;
    } catch (error) {
      logger.error('SphereWallet', 'Signature verification failed', { error, intentId: intent.id });
      return false;
    }
  }

  /**
   * Query wallet balance from Unicity Testnet v2 RPC
   * Simulated for testnet environment
   */
  public async queryBalance(): Promise<WalletBalance> {
    try {
      // In production, this would call the actual Unicity RPC endpoint
      // For now, return simulated testnet balance
      this.balance = {
        tokenBalance: '1000',
        testnetTokens: '500',
        gasReserve: '100',
      };

      logger.info('SphereWallet', 'Balance queried', {
        walletAddress: this.identity.walletAddress.substring(0, 16) + '...',
        balance: this.balance,
      });

      return this.balance;
    } catch (error) {
      logger.error('SphereWallet', 'Failed to query balance', { error });
      throw error;
    }
  }

  /**
   * Update wallet balance after a transaction
   */
  public updateBalance(delta: { tokens?: string; gas?: string }): void {
    if (delta.tokens) {
      const current = parseFloat(this.balance.tokenBalance);
      const change = parseFloat(delta.tokens);
      this.balance.tokenBalance = (current + change).toString();
    }

    if (delta.gas) {
      const current = parseFloat(this.balance.gasReserve);
      const change = parseFloat(delta.gas);
      this.balance.gasReserve = (current + change).toString();
    }

    logger.debug('SphereWallet', 'Balance updated', this.balance);
  }

  /**
   * Check if wallet has sufficient balance
   */
  public hasSufficientBalance(requiredAmount: string, includeGasReserve: boolean = true): boolean {
    const available = includeGasReserve
      ? parseFloat(this.balance.tokenBalance) + parseFloat(this.balance.gasReserve)
      : parseFloat(this.balance.tokenBalance);

    const required = parseFloat(requiredAmount);
    const sufficient = available >= required;

    logger.debug('SphereWallet', 'Balance sufficiency check', {
      required,
      available,
      sufficient,
    });

    return sufficient;
  }

  /**
   * Get current identity
   */
  public getIdentity(): AgentIdentity {
    return this.identity;
  }

  /**
   * Get current balance
   */
  public getBalance(): WalletBalance {
    return this.balance;
  }

  /**
   * Get wallet configuration (without exposing private key)
   */
  public getConfig(): Omit<WalletConfig, 'privateKey'> {
    const { privateKey, ...config } = this.config;
    return config;
  }

  /**
   * Get wallet address
   */
  public getAddress(): string {
    return this.identity.walletAddress;
  }

  /**
   * Get public key
   */
  public getPublicKey(): string {
    return this.identity.publicKey;
  }
}

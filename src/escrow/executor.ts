/**
 * Escrow Executor - Atomic Swap Execution via Sphere SDK Primitives
 * Manages escrow locking, settlement verification, timeout handling, and risk-free atomic swaps
 */

import crypto from 'crypto';
import { AtomicSwap, EscrowConfig, SignedIntent, TradeIntent, TimeoutEvent, GracefulShutdown } from '../types';
import { SphereWallet } from '../wallet/sphereWallet';
import { logger } from '../utils/logger';

export class EscrowExecutor {
  private wallet: SphereWallet;
  private escrowConfig: EscrowConfig;
  private activeSwaps: Map<string, AtomicSwap> = new Map();
  private timeoutIntervals: Map<string, NodeJS.Timeout> = new Map();
  private swapHistory: AtomicSwap[] = [];
  private maxHistorySize: number = 1000;

  constructor(wallet: SphereWallet, escrowConfig: EscrowConfig) {
    this.wallet = wallet;
    this.escrowConfig = escrowConfig;

    logger.info('EscrowExecutor', 'Initialized', {
      escrowAddress: escrowConfig.escrowAddress.substring(0, 16) + '...',
      lockDuration: escrowConfig.lockDuration,
      timeout: escrowConfig.timeout,
    });
  }

  /**
   * Initiate an atomic swap using Sphere SDK escrow mechanism
   * Creates escrow lock for risk-free settlement
   */
  public async initiateSwap(
    signedIntentA: SignedIntent,
    signedIntentB: SignedIntent,
    counterpartyAddress: string
  ): Promise<AtomicSwap> {
    const swapId = `swap-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

    try {
      // Validate both intents
      if (!this.wallet.verifySignature(signedIntentA.intent, signedIntentA.signature)) {
        throw new Error('Invalid signature for intent A');
      }

      if (!this.wallet.verifySignature(signedIntentB.intent, signedIntentB.signature)) {
        throw new Error('Invalid signature for intent B');
      }

      // Create atomic swap structure
      const atomicSwap: AtomicSwap = {
        id: swapId,
        initiator: this.wallet.getAddress(),
        counterparty: counterpartyAddress,
        tokenA: {
          symbol: signedIntentA.intent.from.tokenSymbol,
          amount: signedIntentA.intent.from.amount,
        },
        tokenB: {
          symbol: signedIntentB.intent.to.tokenSymbol,
          amount: signedIntentB.intent.to.amount,
        },
        escrowAddress: this.escrowConfig.escrowAddress,
        status: 'pending',
        createdAt: Date.now(),
        signature: signedIntentA.signature,
      };

      // Lock tokens in escrow
      await this.lockEscrow(atomicSwap);

      // Update status to locked
      atomicSwap.status = 'locked';

      // Store swap
      this.activeSwaps.set(swapId, atomicSwap);
      this.addToHistory(atomicSwap);

      // Set timeout handler
      this.setSwapTimeout(swapId);

      logger.info('EscrowExecutor', 'Atomic swap initiated', {
        swapId,
        tokenA: atomicSwap.tokenA.symbol,
        tokenB: atomicSwap.tokenB.symbol,
        amountA: atomicSwap.tokenA.amount,
        amountB: atomicSwap.tokenB.amount,
      });

      return atomicSwap;
    } catch (error) {
      logger.error('EscrowExecutor', 'Failed to initiate swap', {
        error,
        swapId,
      });
      throw error;
    }
  }

  /**
   * Lock tokens in escrow via Sphere SDK
   * Ensures cryptographic guarantee of settlement
   */
  private async lockEscrow(atomicSwap: AtomicSwap): Promise<void> {
    try {
      // Generate escrow lock proof
      const lockProof = this.generateLockProof(atomicSwap);

      logger.debug('EscrowExecutor', 'Escrow locking initiated', {
        swapId: atomicSwap.id,
        amount: atomicSwap.tokenA.amount,
        lockProof: lockProof.substring(0, 16) + '...',
      });

      // In production, this would call the actual Sphere SDK escrow contract
      // For testnet simulation, we verify the lock structure is valid
      if (!this.validateEscrowStructure(atomicSwap)) {
        throw new Error('Invalid escrow structure');
      }

      logger.info('EscrowExecutor', 'Escrow locked successfully', {
        swapId: atomicSwap.id,
        lockProof,
      });
    } catch (error) {
      logger.error('EscrowExecutor', 'Escrow lock failed', {
        error,
        swapId: atomicSwap.id,
      });
      throw error;
    }
  }

  /**
   * Generate cryptographic proof for escrow lock
   */
  private generateLockProof(atomicSwap: AtomicSwap): string {
    const data = JSON.stringify({
      id: atomicSwap.id,
      initiator: atomicSwap.initiator,
      counterparty: atomicSwap.counterparty,
      tokenA: atomicSwap.tokenA,
      tokenB: atomicSwap.tokenB,
      createdAt: atomicSwap.createdAt,
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Validate escrow structure
   */
  private validateEscrowStructure(atomicSwap: AtomicSwap): boolean {
    // Check required fields
    if (!atomicSwap.id || !atomicSwap.initiator || !atomicSwap.counterparty) {
      return false;
    }

    // Check amounts are valid numbers
    const amountA = parseFloat(atomicSwap.tokenA.amount);
    const amountB = parseFloat(atomicSwap.tokenB.amount);

    if (isNaN(amountA) || isNaN(amountB) || amountA <= 0 || amountB <= 0) {
      return false;
    }

    return true;
  }

  /**
   * Settle an atomic swap - both parties release their tokens
   */
  public async settleSwap(swapId: string): Promise<boolean> {
    try {
      const atomicSwap = this.activeSwaps.get(swapId);

      if (!atomicSwap) {
        logger.warn('EscrowExecutor', 'Swap not found for settlement', { swapId });
        return false;
      }

      if (atomicSwap.status !== 'locked') {
        logger.warn('EscrowExecutor', 'Swap not in locked state', {
          swapId,
          status: atomicSwap.status,
        });
        return false;
      }

      // Release escrow
      await this.releaseEscrow(atomicSwap);

      // Update status
      atomicSwap.status = 'settled';
      atomicSwap.settledAt = Date.now();

      // Clear timeout
      this.clearSwapTimeout(swapId);

      // Update wallet balance
      this.wallet.updateBalance({
        tokens: atomicSwap.tokenB.amount,
        gas: '-0.05', // Settlement fee
      });

      logger.info('EscrowExecutor', 'Swap settled successfully', {
        swapId,
        tokenA: atomicSwap.tokenA.symbol,
        tokenB: atomicSwap.tokenB.symbol,
      });

      return true;
    } catch (error) {
      logger.error('EscrowExecutor', 'Swap settlement failed', {
        error,
        swapId,
      });
      return false;
    }
  }

  /**
   * Release tokens from escrow
   */
  private async releaseEscrow(atomicSwap: AtomicSwap): Promise<void> {
    try {
      logger.debug('EscrowExecutor', 'Releasing escrow tokens', {
        swapId: atomicSwap.id,
        amount: atomicSwap.tokenB.amount,
      });

      // In production, this would call the Sphere SDK escrow release function
      // For testnet, we validate the release conditions are met

      if (atomicSwap.status !== 'locked') {
        throw new Error('Cannot release non-locked escrow');
      }

      logger.info('EscrowExecutor', 'Escrow released', {
        swapId: atomicSwap.id,
      });
    } catch (error) {
      logger.error('EscrowExecutor', 'Escrow release failed', {
        error,
        swapId: atomicSwap.id,
      });
      throw error;
    }
  }

  /**
   * Set timeout handler for swap
   * Triggers graceful recovery if settlement doesn't occur within timeout period
   */
  private setSwapTimeout(swapId: string): void {
    const timeoutMs = this.escrowConfig.timeout * 1000;

    const timeoutId = setTimeout(() => {
      this.handleSwapTimeout(swapId);
    }, timeoutMs);

    this.timeoutIntervals.set(swapId, timeoutId);

    logger.debug('EscrowExecutor', 'Swap timeout handler set', {
      swapId,
      timeoutSeconds: this.escrowConfig.timeout,
    });
  }

  /**
   * Clear timeout handler
   */
  private clearSwapTimeout(swapId: string): void {
    const timeoutId = this.timeoutIntervals.get(swapId);

    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeoutIntervals.delete(swapId);
      logger.debug('EscrowExecutor', 'Swap timeout cleared', { swapId });
    }
  }

  /**
   * Handle swap timeout - gracefully recover locked assets
   */
  private async handleSwapTimeout(swapId: string): Promise<void> {
    try {
      const atomicSwap = this.activeSwaps.get(swapId);

      if (!atomicSwap) {
        logger.warn('EscrowExecutor', 'Swap not found for timeout handling', { swapId });
        return;
      }

      if (atomicSwap.status === 'settled') {
        logger.info('EscrowExecutor', 'Swap already settled, timeout cancelled', { swapId });
        return;
      }

      logger.warn('EscrowExecutor', 'Swap timeout triggered, recovering assets', {
        swapId,
        status: atomicSwap.status,
      });

      // Recover locked assets
      await this.recoverAssets(atomicSwap);

      // Update status
      atomicSwap.status = 'timeout';

      // Log timeout event
      const timeoutEvent: TimeoutEvent = {
        swapId,
        reason: 'Settlement timeout exceeded',
        timestamp: Date.now(),
        recoveredAssets: atomicSwap.tokenA.amount,
      };

      logger.error('EscrowExecutor', 'Swap timeout event', timeoutEvent);

      this.activeSwaps.delete(swapId);
      this.timeoutIntervals.delete(swapId);
    } catch (error) {
      logger.error('EscrowExecutor', 'Error handling swap timeout', {
        error,
        swapId,
      });
    }
  }

  /**
   * Recover locked assets in case of timeout or failure
   */
  private async recoverAssets(atomicSwap: AtomicSwap): Promise<void> {
    try {
      logger.info('EscrowExecutor', 'Recovering assets from escrow', {
        swapId: atomicSwap.id,
        amount: atomicSwap.tokenA.amount,
      });

      // Update wallet with recovered amount (minus a small recovery fee)
      const recoveryFee = parseFloat(atomicSwap.tokenA.amount) * 0.01; // 1% fee
      const recoveredAmount = (parseFloat(atomicSwap.tokenA.amount) - recoveryFee).toString();

      this.wallet.updateBalance({
        tokens: recoveredAmount,
      });

      logger.info('EscrowExecutor', 'Assets recovered', {
        swapId: atomicSwap.id,
        recoveredAmount,
        fee: recoveryFee,
      });
    } catch (error) {
      logger.error('EscrowExecutor', 'Asset recovery failed', {
        error,
        swapId: atomicSwap.id,
      });
      throw error;
    }
  }

  /**
   * Get active swap status
   */
  public getSwapStatus(swapId: string): AtomicSwap | null {
    const swap = this.activeSwaps.get(swapId);
    return swap || null;
  }

  /**
   * Get all active swaps
   */
  public getActiveSwaps(): AtomicSwap[] {
    return Array.from(this.activeSwaps.values());
  }

  /**
   * Get swap history
   */
  public getSwapHistory(limit?: number): AtomicSwap[] {
    if (limit) {
      return this.swapHistory.slice(-limit);
    }
    return this.swapHistory;
  }

  /**
   * Add swap to history
   */
  private addToHistory(atomicSwap: AtomicSwap): void {
    this.swapHistory.push(atomicSwap);

    if (this.swapHistory.length > this.maxHistorySize) {
      this.swapHistory = this.swapHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get executor metrics
   */
  public getMetrics(): {
    activeSwaps: number;
    settledSwaps: number;
    failedSwaps: number;
    totalSettledValue: string;
  } {
    const settled = this.swapHistory.filter((s) => s.status === 'settled');
    const failed = this.swapHistory.filter((s) => s.status === 'failed' || s.status === 'timeout');

    const totalValue = settled.reduce((acc, swap) => acc + parseFloat(swap.tokenB.amount), 0);

    return {
      activeSwaps: this.activeSwaps.size,
      settledSwaps: settled.length,
      failedSwaps: failed.length,
      totalSettledValue: totalValue.toString(),
    };
  }

  /**
   * Graceful shutdown - attempt to settle all pending swaps or recover assets
   */
  public async gracefulShutdown(): Promise<GracefulShutdown> {
    const timestamp = Date.now();
    const recoveryActions: string[] = [];
    const failedSwaps: string[] = [];

    try {
      logger.info('EscrowExecutor', 'Graceful shutdown initiated', {
        activeSwaps: this.activeSwaps.size,
      });

      // Attempt to settle locked swaps
      for (const [swapId, atomicSwap] of this.activeSwaps) {
        try {
          if (atomicSwap.status === 'locked') {
            await this.settleSwap(swapId);
            recoveryActions.push(`Settled swap ${swapId}`);
          } else if (atomicSwap.status === 'pending') {
            await this.recoverAssets(atomicSwap);
            recoveryActions.push(`Recovered assets from swap ${swapId}`);
          }
        } catch (error) {
          logger.error('EscrowExecutor', 'Shutdown swap recovery failed', {
            error,
            swapId,
          });
          failedSwaps.push(swapId);
        }
      }

      // Clear all timeouts
      this.timeoutIntervals.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      this.timeoutIntervals.clear();

      const finalBalance = this.wallet.getBalance();

      const shutdown: GracefulShutdown = {
        timestamp,
        reason: 'Agent shutdown',
        finalBalance: finalBalance.tokenBalance,
        failedSwaps,
        recoveryActions,
        status: failedSwaps.length === 0 ? 'completed' : 'partial',
      };

      logger.info('EscrowExecutor', 'Graceful shutdown complete', shutdown);

      return shutdown;
    } catch (error) {
      logger.error('EscrowExecutor', 'Graceful shutdown failed', { error });

      return {
        timestamp,
        reason: 'Agent shutdown (with errors)',
        finalBalance: this.wallet.getBalance().tokenBalance,
        failedSwaps: Array.from(this.activeSwaps.keys()),
        recoveryActions,
        status: 'failed',
      };
    }
  }
}

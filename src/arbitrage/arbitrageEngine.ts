/**
 * Arbitrage Engine
 * Core logic for detecting profitable atomic swap opportunities
 * Calculates profit margins, validates opportunities, and manages risk metrics
 */

import { ArbitrageOpportunity, TradeIntent, OpportunityScan, RiskMetrics } from '../types';
import { logger } from '../utils/logger';

export class ArbitrageEngine {
  private minProfitMarginPercent: number;
  private stopLossThreshold: string;
  private maxConcurrentSwaps: number;
  private activeSwaps: number = 0;
  private opportunityHistory: ArbitrageOpportunity[] = [];
  private maxHistorySize: number = 1000;

  constructor(
    minProfitMarginPercent: number = 1.5,
    stopLossThreshold: string = '10',
    maxConcurrentSwaps: number = 5
  ) {
    this.minProfitMarginPercent = minProfitMarginPercent;
    this.stopLossThreshold = stopLossThreshold;
    this.maxConcurrentSwaps = maxConcurrentSwaps;

    logger.info('ArbitrageEngine', 'Initialized', {
      minProfitMarginPercent,
      stopLossThreshold,
      maxConcurrentSwaps,
    });
  }

  /**
   * Scan for arbitrage opportunities given two trade intents
   * Detects when Agent A's offer price differs from Agent B's offer price
   */
  public scanForOpportunities(tradeIntentsA: TradeIntent[], tradeIntentsB: TradeIntent[]): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    try {
      // Cross-reference all intents to find mispricings
      for (const intentA of tradeIntentsA) {
        for (const intentB of tradeIntentsB) {
          // Check if these are complementary trades (A wants X, B offers X)
          if (
            intentA.to.tokenSymbol === intentB.from.tokenSymbol &&
            intentA.from.tokenSymbol === intentB.to.tokenSymbol
          ) {
            const opportunity = this.evaluateOpportunity(intentA, intentB);

            if (opportunity.viable) {
              opportunities.push(opportunity);
              logger.debug('ArbitrageEngine', 'Viable opportunity identified', {
                opportunityId: opportunity.id,
                profitMargin: opportunity.profitMarginPercent,
              });
            }
          }
        }
      }

      logger.info('ArbitrageEngine', 'Opportunity scan complete', {
        scannedPairs: tradeIntentsA.length * tradeIntentsB.length,
        viableOpportunities: opportunities.length,
      });

      // Add to history
      this.addToHistory(opportunities);

      return opportunities;
    } catch (error) {
      logger.error('ArbitrageEngine', 'Error scanning for opportunities', { error });
      return [];
    }
  }

  /**
   * Evaluate a single pair of intents for profitability
   * Returns detailed opportunity analysis
   */
  private evaluateOpportunity(intentA: TradeIntent, intentB: TradeIntent): ArbitrageOpportunity {
    const opportunityId = `opp-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      // Calculate the rates and profit potential
      const rateA = intentA.rate; // What Agent A is offering
      const rateB = intentB.rate; // What Agent B is offering

      // Calculate profit margin: (better rate - worse rate) / worse rate * 100
      let profitMarginPercent: number;
      let profitMargin: number;
      let viable: boolean;

      // If rateB > rateA, we can profit by:
      // 1. Accept intentA (get rateA for tokens)
      // 2. Use those tokens to fulfill intentB (get rateB for tokens)
      if (rateB > rateA) {
        profitMarginPercent = ((rateB - rateA) / rateA) * 100;
        profitMargin = rateB - rateA;
        viable = profitMarginPercent >= this.minProfitMarginPercent;
      } else {
        profitMarginPercent = 0;
        profitMargin = 0;
        viable = false;
      }

      // Estimate gas fees (simulated for testnet)
      const estimatedGasFee = this.estimateGasFee(intentA, intentB);

      // Calculate net profit after gas
      const netProfit = profitMargin - parseFloat(estimatedGasFee);

      // Calculate risk score (0-100)
      const riskScore = this.calculateRiskScore(intentA, intentB, profitMarginPercent);

      const opportunity: ArbitrageOpportunity = {
        id: opportunityId,
        agentA: intentA,
        agentB: intentB,
        profitMargin,
        profitMarginPercent,
        estimatedGasFee,
        netProfit: netProfit.toString(),
        riskScore,
        timestamp: Date.now(),
        viable,
      };

      return opportunity;
    } catch (error) {
      logger.error('ArbitrageEngine', 'Error evaluating opportunity', {
        error,
        opportunityId,
      });

      return {
        id: opportunityId,
        agentA: intentA,
        agentB: intentB,
        profitMargin: 0,
        profitMarginPercent: 0,
        estimatedGasFee: '0',
        netProfit: '0',
        riskScore: 100,
        timestamp: Date.now(),
        viable: false,
      };
    }
  }

  /**
   * Estimate gas fees for atomic swap execution
   * Simulated for testnet (typically 0.01 - 0.1 tokens)
   */
  private estimateGasFee(intentA: TradeIntent, intentB: TradeIntent): string {
    try {
      // Base gas fee for atomic swap
      const baseGasFee = 0.05;

      // Additional gas for escrow locking
      const escrowGasFee = 0.02;

      // Total estimated fee
      const totalFee = (baseGasFee + escrowGasFee).toFixed(4);

      logger.debug('ArbitrageEngine', 'Gas fee estimated', {
        base: baseGasFee,
        escrow: escrowGasFee,
        total: totalFee,
      });

      return totalFee;
    } catch (error) {
      logger.error('ArbitrageEngine', 'Error estimating gas fee', { error });
      return '0.1';
    }
  }

  /**
   * Calculate risk score based on various factors
   * Lower score = lower risk
   * Score ranges from 0 (very safe) to 100 (very risky)
   */
  private calculateRiskScore(intentA: TradeIntent, intentB: TradeIntent, profitMarginPercent: number): number {
    let riskScore = 50; // Base risk

    // Check expiration times
    const timeToExpiryA = intentA.expiresAt - Date.now();
    const timeToExpiryB = intentB.expiresAt - Date.now();

    // Penalize short expiration windows
    if (timeToExpiryA < 60000) riskScore += 20; // Less than 1 minute
    if (timeToExpiryB < 60000) riskScore += 20;

    // Reward higher profit margins (more buffer for slippage)
    if (profitMarginPercent > 5) riskScore -= 20;
    if (profitMarginPercent > 10) riskScore -= 10;

    // Check for suspicious patterns (too good to be true)
    if (profitMarginPercent > 50) riskScore += 25; // Potentially honeypot

    // Normalize score to 0-100 range
    riskScore = Math.max(0, Math.min(100, riskScore));

    return riskScore;
  }

  /**
   * Filter opportunities by criteria
   */
  public filterOpportunities(
    opportunities: ArbitrageOpportunity[],
    filters: {
      minProfit?: number;
      maxRiskScore?: number;
      minExpiration?: number;
    }
  ): ArbitrageOpportunity[] {
    return opportunities.filter((opp) => {
      if (filters.minProfit && parseFloat(opp.netProfit) < filters.minProfit) {
        return false;
      }

      if (filters.maxRiskScore && opp.riskScore > filters.maxRiskScore) {
        return false;
      }

      if (filters.minExpiration) {
        const minExpiryTime = Math.min(opp.agentA.expiresAt, opp.agentB.expiresAt);
        if (minExpiryTime - Date.now() < filters.minExpiration) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get optimal opportunity (highest risk-adjusted profit)
   */
  public getOptimalOpportunity(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity | null {
    if (opportunities.length === 0) {
      return null;
    }

    // Sort by risk-adjusted profit (profit / risk)
    const sorted = opportunities.sort((a, b) => {
      const scoreA = parseFloat(a.netProfit) / (a.riskScore + 1);
      const scoreB = parseFloat(b.netProfit) / (b.riskScore + 1);
      return scoreB - scoreA;
    });

    logger.debug('ArbitrageEngine', 'Optimal opportunity selected', {
      opportunityId: sorted[0].id,
      netProfit: sorted[0].netProfit,
      riskScore: sorted[0].riskScore,
    });

    return sorted[0];
  }

  /**
   * Perform opportunity scan and return structured results
   */
  public performScan(
    tradeIntentsA: TradeIntent[],
    tradeIntentsB: TradeIntent[],
    currentBalance: string
  ): OpportunityScan {
    const opportunities = this.scanForOpportunities(tradeIntentsA, tradeIntentsB);
    const profitable = opportunities.filter((opp) => opp.viable && opp.netProfit > '0');

    logger.info('ArbitrageEngine', 'Full scan performed', {
      opportunitiesFound: opportunities.length,
      profitableOpportunities: profitable.length,
      totalValue: profitable.reduce((acc, opp) => acc + parseFloat(opp.netProfit), 0),
    });

    return {
      timestamp: Date.now(),
      opportunitiesFound: opportunities.length,
      profitableOpportunities: profitable.length,
      totalOpportunities: opportunities,
      executedSwaps: [],
    };
  }

  /**
   * Validate if an opportunity can be executed given current constraints
   */
  public canExecute(opportunity: ArbitrageOpportunity, riskMetrics: RiskMetrics): boolean {
    // Check if we can take on another swap
    if (this.activeSwaps >= this.maxConcurrentSwaps) {
      logger.warn('ArbitrageEngine', 'Max concurrent swaps reached', {
        active: this.activeSwaps,
        max: this.maxConcurrentSwaps,
      });
      return false;
    }

    // Check stop-loss threshold
    const currentBalance = parseFloat(riskMetrics.currentBalance);
    const threshold = parseFloat(this.stopLossThreshold);

    if (currentBalance <= threshold) {
      logger.warn('ArbitrageEngine', 'Stop-loss threshold triggered', {
        currentBalance,
        threshold,
      });
      return false;
    }

    // Check if opportunity is still viable
    if (!opportunity.viable) {
      logger.warn('ArbitrageEngine', 'Opportunity no longer viable', {
        opportunityId: opportunity.id,
      });
      return false;
    }

    return true;
  }

  /**
   * Register an active swap
   */
  public registerActiveSwap(): void {
    this.activeSwaps++;
    logger.debug('ArbitrageEngine', 'Active swap registered', { count: this.activeSwaps });
  }

  /**
   * Unregister an active swap
   */
  public unregisterActiveSwap(): void {
    if (this.activeSwaps > 0) {
      this.activeSwaps--;
      logger.debug('ArbitrageEngine', 'Active swap unregistered', { count: this.activeSwaps });
    }
  }

  /**
   * Get current metrics
   */
  public getMetrics(): {
    activeSwaps: number;
    maxConcurrentSwaps: number;
    minProfitMarginPercent: number;
    opportunitiesInHistory: number;
  } {
    return {
      activeSwaps: this.activeSwaps,
      maxConcurrentSwaps: this.maxConcurrentSwaps,
      minProfitMarginPercent: this.minProfitMarginPercent,
      opportunitiesInHistory: this.opportunityHistory.length,
    };
  }

  /**
   * Add opportunities to history
   */
  private addToHistory(opportunities: ArbitrageOpportunity[]): void {
    this.opportunityHistory.push(...opportunities);

    if (this.opportunityHistory.length > this.maxHistorySize) {
      this.opportunityHistory = this.opportunityHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get opportunity history
   */
  public getHistory(limit?: number): ArbitrageOpportunity[] {
    if (limit) {
      return this.opportunityHistory.slice(-limit);
    }
    return this.opportunityHistory;
  }
}

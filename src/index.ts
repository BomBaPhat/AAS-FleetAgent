/**
 * AAS-FleetAgent - Main Agent Loop
 * Autonomous arbitrage-as-a-service agent for Unicity Testnet v2
 * Continuously monitors market, identifies opportunities, executes atomic swaps
 * 
 * NO HUMAN IN THE LOOP - 100% Autonomous Operation
 */

import dotenv from 'dotenv';
import { SphereWallet } from './wallet/sphereWallet';
import { MarketListener } from './nostr/marketListener';
import { ArbitrageEngine } from './arbitrage/arbitrageEngine';
import { EscrowExecutor } from './escrow/executor';
import { AgentConfig, TradeIntent, RiskMetrics } from './types';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

// ============================================================================
// AGENT CONFIGURATION
// ============================================================================

const agentConfig: AgentConfig = {
  wallet: {
    privateKey: process.env.SPHERE_PRIVATE_KEY || crypto.randomBytes(32).toString('hex'),
    publicKey: process.env.SPHERE_PUBLIC_KEY || crypto.randomBytes(32).toString('hex'),
    nametag: process.env.AGENT_NAMETAG || 'AAS-FleetAgent-001',
    rpcUrl: process.env.UNICITY_RPC_URL || 'https://testnet-v2.unicity.io/rpc',
    chainId: process.env.UNICITY_CHAIN_ID || 'unicity-testnet-v2',
  },
  arbitrage: {
    minProfitMarginPercent: parseFloat(process.env.MIN_PROFIT_MARGIN_PERCENT || '1.5'),
    stopLossThreshold: process.env.STOP_LOSS_THRESHOLD_TOKENS || '10',
    escrowTimeoutSeconds: parseInt(process.env.ESCROW_TIMEOUT_SECONDS || '300'),
    maxConcurrentSwaps: 5,
  },
  nostr: {
    relayUrls: (process.env.NOSTR_RELAY_URLS || 'wss://relay.unicity.io').split(','),
    eventKinds: [31000, 31001, 31002], // Trade intents, payment requests, settlements
  },
  logging: {
    level: (process.env.LOG_LEVEL as any) || 'info',
    outputDir: process.env.LOG_DIR || './logs',
  },
};

// ============================================================================
// AASFLEETAGENT CLASS
// ============================================================================

import crypto from 'crypto';

class AASFleetAgent {
  private wallet: SphereWallet;
  private marketListener: MarketListener;
  private arbitrageEngine: ArbitrageEngine;
  private escrowExecutor: EscrowExecutor;
  private isRunning: boolean = false;
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private scanInterval: number = 5000; // 5 seconds between scans
  private tradeIntentsCache: TradeIntent[] = [];
  private lastScanTime: number = 0;
  private totalProfitGenerated: number = 0;
  private totalSwapsExecuted: number = 0;

  constructor(config: AgentConfig) {
    logger.info('AASFleetAgent', '='.repeat(80));
    logger.info('AASFleetAgent', 'Initializing AAS-FleetAgent for Unicity Testnet v2');
    logger.info('AASFleetAgent', '='.repeat(80));

    // Initialize wallet
    this.wallet = new SphereWallet(config.wallet);

    // Initialize Nostr market listener
    this.marketListener = new MarketListener(config.nostr.relayUrls, this.wallet.getPublicKey());

    // Initialize arbitrage engine
    this.arbitrageEngine = new ArbitrageEngine(
      config.arbitrage.minProfitMarginPercent,
      config.arbitrage.stopLossThreshold,
      config.arbitrage.maxConcurrentSwaps
    );

    // Initialize escrow executor
    this.escrowExecutor = new EscrowExecutor(this.wallet, {
      escrowAddress: 'sphere1escrow' + crypto.randomBytes(16).toString('hex'),
      lockDuration: 300, // 5 minutes
      timeout: config.arbitrage.escrowTimeoutSeconds,
    });

    // Set up market listener event handlers
    this.setupMarketListeners();

    logger.info('AASFleetAgent', 'Agent initialization complete', {
      nametag: this.wallet.getIdentity().nametag,
      walletAddress: this.wallet.getAddress().substring(0, 20) + '...',
      minProfitMargin: config.arbitrage.minProfitMarginPercent,
    });
  }

  /**
   * Set up event listeners for market events
   */
  private setupMarketListeners(): void {
    this.marketListener.on('trade-intent', (intent: TradeIntent) => {
      logger.debug('AASFleetAgent', 'Trade intent received from market', {
        intentId: intent.id,
        from: intent.from.tokenSymbol,
        to: intent.to.tokenSymbol,
      });

      this.tradeIntentsCache.push(intent);
    });

    this.marketListener.on('payment-request', (request) => {
      logger.info('AASFleetAgent', 'Payment request received', {
        requestId: request.id,
        amount: request.amount,
        reason: request.reason,
      });
    });

    this.marketListener.on('swap-settlement', (settlement) => {
      logger.info('AASFleetAgent', 'Swap settlement event received', {
        swapId: settlement.swapId,
        status: settlement.status,
      });
    });

    logger.debug('AASFleetAgent', 'Market event listeners configured');
  }

  /**
   * Start the autonomous agent
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('AASFleetAgent', 'Agent is already running');
      return;
    }

    try {
      logger.info('AASFleetAgent', 'Starting autonomous agent...');

      // Connect to Nostr relays
      await this.marketListener.connect();

      // Start listening for market events
      await this.marketListener.startListening();

      // Query initial balance
      await this.wallet.queryBalance();

      // Mark as running
      this.isRunning = true;

      logger.info('AASFleetAgent', '✓ Agent started successfully');
      logger.info('AASFleetAgent', 'Beginning autonomous operation - NO HUMAN IN THE LOOP');
      logger.info('AASFleetAgent', '='.repeat(80));

      // Start main agent loop
      this.startMainLoop();
    } catch (error) {
      logger.error('AASFleetAgent', 'Failed to start agent', { error });
      throw error;
    }
  }

  /**
   * Main agent loop - continuously scans for opportunities and executes swaps
   */
  private startMainLoop(): void {
    this.mainLoopInterval = setInterval(() => {
      this.executeMainLoop().catch((error) => {
        logger.error('AASFleetAgent', 'Error in main loop', { error });
      });
    }, this.scanInterval);

    logger.debug('AASFleetAgent', 'Main loop started', { intervalMs: this.scanInterval });
  }

  /**
   * Execute one iteration of the main loop
   */
  private async executeMainLoop(): Promise<void> {
    try {
      const loopStartTime = Date.now();

      // Get current risk metrics
      const riskMetrics = this.getRiskMetrics();

      // Check stop-loss condition
      if (parseFloat(riskMetrics.currentBalance) <= parseFloat(riskMetrics.stopLossThreshold)) {
        logger.error('AASFleetAgent', 'STOP-LOSS TRIGGERED - Initiating graceful shutdown', {
          currentBalance: riskMetrics.currentBalance,
          threshold: riskMetrics.stopLossThreshold,
        });

        await this.shutdown();
        return;
      }

      // Scan for arbitrage opportunities
      if (this.tradeIntentsCache.length > 0) {
        await this.scanAndExecute(riskMetrics);
      }

      // Update metrics
      const loopDuration = Date.now() - loopStartTime;
      logger.debug('AASFleetAgent', 'Main loop iteration complete', {
        duration: loopDuration,
        cacheSize: this.tradeIntentsCache.length,
        activeSwaps: riskMetrics.escrowLocksActive,
      });
    } catch (error) {
      logger.error('AASFleetAgent', 'Unhandled error in main loop', { error });
    }
  }

  /**
   * Scan for opportunities and execute profitable swaps
   */
  private async scanAndExecute(riskMetrics: RiskMetrics): Promise<void> {
    try {
      const scanStartTime = Date.now();

      // Split cache into two groups for opportunity detection
      const midpoint = Math.floor(this.tradeIntentsCache.length / 2);
      const intentsGroupA = this.tradeIntentsCache.slice(0, midpoint);
      const intentsGroupB = this.tradeIntentsCache.slice(midpoint);

      // Perform scan
      const scanResults = this.arbitrageEngine.performScan(
        intentsGroupA,
        intentsGroupB,
        riskMetrics.currentBalance
      );

      if (scanResults.profitableOpportunities > 0) {
        logger.info('AASFleetAgent', 'Profitable opportunities identified', {
          total: scanResults.opportunitiesFound,
          profitable: scanResults.profitableOpportunities,
          timestamp: new Date(scanResults.timestamp).toISOString(),
        });

        // Execute top opportunities
        await this.executeOpportunities(scanResults.totalOpportunities, riskMetrics);
      }

      // Clear cache periodically
      if (Date.now() - this.lastScanTime > 30000) {
        // Every 30 seconds
        this.tradeIntentsCache = this.tradeIntentsCache.slice(-100); // Keep last 100
        this.lastScanTime = Date.now();
      }

      const scanDuration = Date.now() - scanStartTime;
      logger.debug('AASFleetAgent', 'Scan and execute completed', {
        duration: scanDuration,
        opportunitiesFound: scanResults.opportunitiesFound,
        profitableExecuted: scanResults.executedSwaps.length,
      });
    } catch (error) {
      logger.error('AASFleetAgent', 'Error during scan and execute', { error });
    }
  }

  /**
   * Execute opportunities that meet risk criteria
   */
  private async executeOpportunities(opportunities: any[], riskMetrics: RiskMetrics): Promise<void> {
    // Filter by viability
    const viable = opportunities.filter((opp) => opp.viable && this.arbitrageEngine.canExecute(opp, riskMetrics));

    logger.debug('AASFleetAgent', 'Opportunities filtered for execution', {
      total: opportunities.length,
      viable: viable.length,
    });

    // Execute top 3 opportunities
    for (const opportunity of viable.slice(0, 3)) {
      try {
        await this.executeSwap(opportunity);
        this.totalSwapsExecuted++;
        this.totalProfitGenerated += parseFloat(opportunity.netProfit);
      } catch (error) {
        logger.error('AASFleetAgent', 'Failed to execute swap', {
          error,
          opportunityId: opportunity.id,
        });
      }
    }
  }

  /**
   * Execute a single arbitrage swap
   */
  private async executeSwap(opportunity: any): Promise<void> {
    try {
      logger.info('AASFleetAgent', 'Executing arbitrage swap', {
        opportunityId: opportunity.id,
        profitMargin: opportunity.profitMarginPercent.toFixed(2),
        netProfit: opportunity.netProfit,
      });

      // Create signed intents
      const signedIntentA = this.wallet.createSignedIntent(opportunity.agentA);
      const signedIntentB = this.wallet.createSignedIntent(opportunity.agentB);

      // Register active swap
      this.arbitrageEngine.registerActiveSwap();

      // Initiate atomic swap via escrow
      const atomicSwap = await this.escrowExecutor.initiateSwap(
        signedIntentA,
        signedIntentB,
        opportunity.agentB.from.agentId
      );

      logger.info('AASFleetAgent', 'Atomic swap initiated', {
        swapId: atomicSwap.id,
        status: atomicSwap.status,
      });

      // Simulate settlement after brief delay
      setTimeout(async () => {
        const settled = await this.escrowExecutor.settleSwap(atomicSwap.id);

        if (settled) {
          logger.info('AASFleetAgent', 'Swap settled successfully', {
            swapId: atomicSwap.id,
            profit: opportunity.netProfit,
          });
          this.arbitrageEngine.unregisterActiveSwap();
        } else {
          logger.warn('AASFleetAgent', 'Swap settlement failed', { swapId: atomicSwap.id });
        }
      }, 2000);
    } catch (error) {
      this.arbitrageEngine.unregisterActiveSwap();
      logger.error('AASFleetAgent', 'Swap execution failed', {
        error,
        opportunityId: opportunity.id,
      });
      throw error;
    }
  }

  /**
   * Get current risk metrics
   */
  private getRiskMetrics(): RiskMetrics {
    const balance = this.wallet.getBalance();
    const activeSwaps = this.escrowExecutor.getActiveSwaps();

    return {
      currentBalance: balance.tokenBalance,
      stopLossThreshold: agentConfig.arbitrage.stopLossThreshold,
      riskExposure: (activeSwaps.length / agentConfig.arbitrage.maxConcurrentSwaps) * 100,
      escrowLocksActive: activeSwaps.length,
      maxConcurrentSwaps: agentConfig.arbitrage.maxConcurrentSwaps,
    };
  }

  /**
   * Get agent status
   */
  public getStatus(): any {
    const balance = this.wallet.getBalance();
    const arbitrageMetrics = this.arbitrageEngine.getMetrics();
    const escrowMetrics = this.escrowExecutor.getMetrics();

    return {
      identity: this.wallet.getIdentity(),
      isRunning: this.isRunning,
      balance,
      arbitrage: arbitrageMetrics,
      escrow: escrowMetrics,
      marketListener: this.marketListener.getStatus(),
      totalSwapsExecuted: this.totalSwapsExecuted,
      totalProfitGenerated: this.totalProfitGenerated.toFixed(4),
      uptime: Date.now(),
    };
  }

  /**
   * Gracefully shutdown the agent
   */
  public async shutdown(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('AASFleetAgent', 'Agent is not running');
      return;
    }

    try {
      logger.info('AASFleetAgent', '='.repeat(80));
      logger.info('AASFleetAgent', 'Initiating graceful shutdown...');
      logger.info('AASFleetAgent', '='.repeat(80));

      // Stop main loop
      if (this.mainLoopInterval) {
        clearInterval(this.mainLoopInterval);
        this.mainLoopInterval = null;
      }

      // Stop market listening
      await this.marketListener.stopListening();

      // Gracefully shutdown escrow executor (settle/recover swaps)
      const shutdownResult = await this.escrowExecutor.gracefulShutdown();

      this.isRunning = false;

      logger.info('AASFleetAgent', 'Agent shutdown complete', {
        finalBalance: shutdownResult.finalBalance,
        recoveryActions: shutdownResult.recoveryActions.length,
        failedSwaps: shutdownResult.failedSwaps.length,
        status: shutdownResult.status,
      });

      logger.info('AASFleetAgent', 'Final Statistics', {
        totalSwapsExecuted: this.totalSwapsExecuted,
        totalProfitGenerated: this.totalProfitGenerated.toFixed(4),
        finalBalance: shutdownResult.finalBalance,
      });
    } catch (error) {
      logger.error('AASFleetAgent', 'Error during shutdown', { error });
      throw error;
    }
  }

  /**
   * Print agent dashboard
   */
  public printDashboard(): void {
    const status = this.getStatus();

    console.log('\n' + '='.repeat(80));
    console.log('AAS-FleetAgent Dashboard');
    console.log('='.repeat(80));
    console.log(`Agent: ${status.identity.nametag}`);
    console.log(`Status: ${status.isRunning ? 'RUNNING' : 'STOPPED'}`);
    console.log(`\nWallet:`);
    console.log(`  Address: ${status.identity.walletAddress}`);
    console.log(`  Balance: ${status.balance.tokenBalance} tokens`);
    console.log(`  Gas Reserve: ${status.balance.gasReserve}`);
    console.log(`\nArbitrage:`);
    console.log(`  Active Swaps: ${status.arbitrage.activeSwaps}`);
    console.log(`  Total Executed: ${status.totalSwapsExecuted}`);
    console.log(`  Total Profit: ${status.totalProfitGenerated}`);
    console.log(`\nEscrow:`);
    console.log(`  Active: ${status.escrow.activeSwaps}`);
    console.log(`  Settled: ${status.escrow.settledSwaps}`);
    console.log(`  Total Value: ${status.escrow.totalSettledValue}`);
    console.log(`\nMarket Listener:`);
    console.log(`  Connected: ${status.marketListener.isListening}`);
    console.log(`  Relays: ${status.marketListener.relayCount}`);
    console.log(`  Buffer Size: ${status.marketListener.bufferSize}`);
    console.log('='.repeat(80) + '\n');
  }
}

// ============================================================================
// ENTRY POINT - MAIN EXECUTION
// ============================================================================

async function main(): Promise<void> {
  try {
    logger.info('AASFleetAgent', 'Process started', {
      nodeVersion: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString(),
    });

    // Create and start agent
    const agent = new AASFleetAgent(agentConfig);
    await agent.start();

    // Print dashboard every 30 seconds
    setInterval(() => {
      agent.printDashboard();
    }, 30000);

    // Handle graceful shutdown on signals
    process.on('SIGTERM', async () => {
      logger.info('AASFleetAgent', 'SIGTERM received - initiating shutdown');
      await agent.shutdown();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('AASFleetAgent', 'SIGINT received - initiating shutdown');
      await agent.shutdown();
      process.exit(0);
    });

    // Keep process alive
    process.on('uncaughtException', (error) => {
      logger.error('AASFleetAgent', 'Uncaught exception', { error });
      process.exit(1);
    });
  } catch (error) {
    logger.error('AASFleetAgent', 'Fatal error in main', { error });
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { AASFleetAgent };

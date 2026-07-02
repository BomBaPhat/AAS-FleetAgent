/**
 * Nostr Market Listener
 * Subscribes to Nostr relays to listen for trade intents, swaps, and payment requests
 * Implements P2P discovery mechanism for autonomous agent coordination
 */

import { EventEmitter } from 'events';
import { NostrEvent, TradeIntent, NostrSubscription, NostrFilter } from '../types';
import { logger } from '../utils/logger';

/**
 * Mock Nostr WebSocket implementation for testnet
 * In production, this would connect to actual Nostr relays
 */
class NostrRelay {
  private url: string;
  private connected: boolean = false;
  private listeners: Map<string, (event: NostrEvent) => void> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve) => {
      this.connected = true;
      logger.info('NostrRelay', `Connected to relay: ${this.url}`);
      resolve();
    });
  }

  public subscribe(id: string, filters: NostrFilter[], onEvent: (event: NostrEvent) => void): void {
    this.listeners.set(id, onEvent);
    logger.debug('NostrRelay', `Subscription created: ${id}`, { filters });
  }

  public unsubscribe(id: string): void {
    this.listeners.delete(id);
    logger.debug('NostrRelay', `Subscription removed: ${id}`);
  }

  public async publish(event: NostrEvent): Promise<void> {
    logger.debug('NostrRelay', 'Event published to relay', {
      eventId: event.id,
      kind: event.kind,
    });
  }

  public isConnected(): boolean {
    return this.connected;
  }
}

// ============================================================================
// MARKET LISTENER CLASS
// ============================================================================

export class MarketListener extends EventEmitter {
  private relayUrls: string[];
  private relays: Map<string, NostrRelay> = new Map();
  private subscriptions: Map<string, NostrSubscription> = new Map();
  private agentPublicKey: string;
  private isListening: boolean = false;
  private eventBuffer: NostrEvent[] = [];
  private maxBufferSize: number = 1000;

  // Nostr event kinds for arbitrage detection
  private readonly EVENT_KINDS = {
    TRADE_INTENT: 31000, // Custom kind for trade intents
    PAYMENT_REQUEST: 31001, // Custom kind for payment requests
    SWAP_SETTLEMENT: 31002, // Custom kind for swap settlements
    AGENT_HEARTBEAT: 31003, // Custom kind for agent status
  };

  constructor(relayUrls: string[], agentPublicKey: string) {
    super();
    this.relayUrls = relayUrls;
    this.agentPublicKey = agentPublicKey;

    logger.info('MarketListener', 'Initialized', {
      relayCount: relayUrls.length,
      agentPublicKeyPrefix: agentPublicKey.substring(0, 16) + '...',
    });
  }

  /**
   * Connect to all Nostr relays
   */
  public async connect(): Promise<void> {
    try {
      const connectionPromises = this.relayUrls.map(async (url) => {
        const relay = new NostrRelay(url);
        await relay.connect();
        this.relays.set(url, relay);
      });

      await Promise.all(connectionPromises);

      logger.info('MarketListener', 'Connected to all relays', {
        relayCount: this.relays.size,
      });
    } catch (error) {
      logger.error('MarketListener', 'Failed to connect to relays', { error });
      throw error;
    }
  }

  /**
   * Start listening for trade intents and payment requests
   */
  public async startListening(): Promise<void> {
    if (this.isListening) {
      logger.warn('MarketListener', 'Already listening for market events');
      return;
    }

    try {
      // Subscribe to trade intents
      await this.subscribeToTradeIntents();

      // Subscribe to payment requests
      await this.subscribeToPaymentRequests();

      // Subscribe to swap settlements
      await this.subscribeToSwapSettlements();

      this.isListening = true;

      logger.info('MarketListener', 'Started listening for market events', {
        subscriptionCount: this.subscriptions.size,
      });

      // Emit ready event
      this.emit('ready');
    } catch (error) {
      logger.error('MarketListener', 'Failed to start listening', { error });
      throw error;
    }
  }

  /**
   * Subscribe to trade intent events
   */
  private async subscribeToTradeIntents(): Promise<string> {
    const subscriptionId = 'trade-intents-' + Date.now();

    const filters: NostrFilter[] = [
      {
        kinds: [this.EVENT_KINDS.TRADE_INTENT],
        limit: 100,
      },
    ];

    const subscription: NostrSubscription = {
      id: subscriptionId,
      filters,
      active: true,
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Subscribe on all relays
    this.relays.forEach((relay) => {
      relay.subscribe(subscriptionId, filters, (event: NostrEvent) => {
        this.handleTradeIntentEvent(event);
      });
    });

    logger.debug('MarketListener', 'Subscribed to trade intents', { subscriptionId });

    return subscriptionId;
  }

  /**
   * Subscribe to payment request events
   */
  private async subscribeToPaymentRequests(): Promise<string> {
    const subscriptionId = 'payment-requests-' + Date.now();

    const filters: NostrFilter[] = [
      {
        kinds: [this.EVENT_KINDS.PAYMENT_REQUEST],
        limit: 50,
      },
    ];

    const subscription: NostrSubscription = {
      id: subscriptionId,
      filters,
      active: true,
    };

    this.subscriptions.set(subscriptionId, subscription);

    this.relays.forEach((relay) => {
      relay.subscribe(subscriptionId, filters, (event: NostrEvent) => {
        this.handlePaymentRequestEvent(event);
      });
    });

    logger.debug('MarketListener', 'Subscribed to payment requests', { subscriptionId });

    return subscriptionId;
  }

  /**
   * Subscribe to swap settlement events
   */
  private async subscribeToSwapSettlements(): Promise<string> {
    const subscriptionId = 'swap-settlements-' + Date.now();

    const filters: NostrFilter[] = [
      {
        kinds: [this.EVENT_KINDS.SWAP_SETTLEMENT],
        limit: 100,
      },
    ];

    const subscription: NostrSubscription = {
      id: subscriptionId,
      filters,
      active: true,
    };

    this.subscriptions.set(subscriptionId, subscription);

    this.relays.forEach((relay) => {
      relay.subscribe(subscriptionId, filters, (event: NostrEvent) => {
        this.handleSwapSettlementEvent(event);
      });
    });

    logger.debug('MarketListener', 'Subscribed to swap settlements', { subscriptionId });

    return subscriptionId;
  }

  /**
   * Handle incoming trade intent event
   */
  private handleTradeIntentEvent(event: NostrEvent): void {
    try {
      const intent = this.parseTradeIntent(event);

      // Add to buffer
      this.addToBuffer(event);

      logger.debug('MarketListener', 'Trade intent received', {
        intentId: intent.id,
        from: intent.from.tokenSymbol,
        to: intent.to.tokenSymbol,
        rate: intent.rate,
      });

      // Emit event for arbitrage engine to process
      this.emit('trade-intent', intent);
    } catch (error) {
      logger.error('MarketListener', 'Failed to handle trade intent event', {
        error,
        eventId: event.id,
      });
    }
  }

  /**
   * Handle incoming payment request event
   */
  private handlePaymentRequestEvent(event: NostrEvent): void {
    try {
      const paymentRequest = this.parsePaymentRequest(event);

      this.addToBuffer(event);

      logger.debug('MarketListener', 'Payment request received', {
        requestId: paymentRequest.id,
        amount: paymentRequest.amount,
        tokenSymbol: paymentRequest.tokenSymbol,
      });

      this.emit('payment-request', paymentRequest);
    } catch (error) {
      logger.error('MarketListener', 'Failed to handle payment request event', {
        error,
        eventId: event.id,
      });
    }
  }

  /**
   * Handle incoming swap settlement event
   */
  private handleSwapSettlementEvent(event: NostrEvent): void {
    try {
      const settlement = JSON.parse(event.content);

      this.addToBuffer(event);

      logger.info('MarketListener', 'Swap settlement event received', {
        swapId: settlement.swapId,
        status: settlement.status,
      });

      this.emit('swap-settlement', settlement);
    } catch (error) {
      logger.error('MarketListener', 'Failed to handle swap settlement event', {
        error,
        eventId: event.id,
      });
    }
  }

  /**
   * Parse Nostr event into TradeIntent
   */
  private parseTradeIntent(event: NostrEvent): TradeIntent {
    const data = JSON.parse(event.content);

    return {
      id: event.id,
      from: {
        agentId: event.pubkey,
        tokenSymbol: data.from.tokenSymbol,
        amount: data.from.amount,
      },
      to: {
        tokenSymbol: data.to.tokenSymbol,
        amount: data.to.amount,
      },
      rate: parseFloat(data.to.amount) / parseFloat(data.from.amount),
      expiresAt: data.expiresAt || Date.now() + 3600000, // Default 1 hour
      signature: event.sig,
    };
  }

  /**
   * Parse Nostr event into PaymentRequest
   */
  private parsePaymentRequest(event: NostrEvent): any {
    const data = JSON.parse(event.content);

    return {
      id: event.id,
      requester: event.pubkey,
      amount: data.amount,
      tokenSymbol: data.tokenSymbol,
      reason: data.reason,
      expiresAt: data.expiresAt || Date.now() + 3600000,
    };
  }

  /**
   * Add event to buffer for analysis
   */
  private addToBuffer(event: NostrEvent): void {
    this.eventBuffer.push(event);

    // Maintain max buffer size
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer = this.eventBuffer.slice(-this.maxBufferSize);
    }
  }

  /**
   * Stop listening and unsubscribe from all subscriptions
   */
  public async stopListening(): Promise<void> {
    try {
      this.subscriptions.forEach((subscription) => {
        this.relays.forEach((relay) => {
          relay.unsubscribe(subscription.id);
        });
      });

      this.subscriptions.clear();
      this.isListening = false;

      logger.info('MarketListener', 'Stopped listening for market events');
    } catch (error) {
      logger.error('MarketListener', 'Error stopping listener', { error });
    }
  }

  /**
   * Get buffered events
   */
  public getBufferedEvents(limit?: number): NostrEvent[] {
    if (limit) {
      return this.eventBuffer.slice(-limit);
    }
    return this.eventBuffer;
  }

  /**
   * Clear event buffer
   */
  public clearBuffer(): void {
    this.eventBuffer = [];
    logger.debug('MarketListener', 'Event buffer cleared');
  }

  /**
   * Get listener status
   */
  public getStatus(): { isListening: boolean; relayCount: number; subscriptionCount: number; bufferSize: number } {
    return {
      isListening: this.isListening,
      relayCount: this.relays.size,
      subscriptionCount: this.subscriptions.size,
      bufferSize: this.eventBuffer.length,
    };
  }
}

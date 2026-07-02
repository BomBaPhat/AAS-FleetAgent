/**
 * Core Type Definitions for AAS-FleetAgent
 * Sphere SDK primitives and Nostr message structures
 */

// ============================================================================
// SPHERE SDK WALLET & IDENTITY TYPES
// ============================================================================

export interface WalletConfig {
  privateKey: string;
  publicKey: string;
  nametag: string;
  rpcUrl: string;
  chainId: string;
}

export interface AgentIdentity {
  nametag: string;
  publicKey: string;
  walletAddress: string;
  createdAt: number;
}

export interface WalletBalance {
  tokenBalance: string;
  testnetTokens: string;
  gasReserve: string;
}

// ============================================================================
// NOSTR MESSAGE & INTENT TYPES
// ============================================================================

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface TradeIntent {
  id: string;
  from: {
    agentId: string;
    tokenSymbol: string;
    amount: string;
  };
  to: {
    tokenSymbol: string;
    amount: string;
  };
  rate: number;
  expiresAt: number;
  signature: string;
}

export interface PaymentRequest {
  id: string;
  requester: string;
  amount: string;
  tokenSymbol: string;
  reason: string;
  expiresAt: number;
}

export interface NostrSubscription {
  id: string;
  filters: NostrFilter[];
  active: boolean;
}

export interface NostrFilter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [key: string]: any;
}

// ============================================================================
// ARBITRAGE OPPORTUNITY TYPES
// ============================================================================

export interface ArbitrageOpportunity {
  id: string;
  agentA: TradeIntent;
  agentB: TradeIntent;
  profitMargin: number;
  profitMarginPercent: number;
  estimatedGasFee: string;
  netProfit: string;
  riskScore: number;
  timestamp: number;
  viable: boolean;
}

export interface OpportunityScan {
  timestamp: number;
  opportunitiesFound: number;
  profitableOpportunities: number;
  totalOpportunities: ArbitrageOpportunity[];
  executedSwaps: string[];
}

// ============================================================================
// ESCROW & ATOMIC SWAP TYPES
// ============================================================================

export interface EscrowConfig {
  escrowAddress: string;
  lockDuration: number;
  timeout: number;
}

export interface AtomicSwap {
  id: string;
  initiator: string;
  counterparty: string;
  tokenA: {
    symbol: string;
    amount: string;
  };
  tokenB: {
    symbol: string;
    amount: string;
  };
  escrowAddress: string;
  status: 'pending' | 'locked' | 'settled' | 'failed' | 'timeout';
  createdAt: number;
  settledAt?: number;
  signature: string;
}

export interface SignedIntent {
  intent: TradeIntent;
  signature: string;
  timestamp: number;
  nonce: string;
}

// ============================================================================
// RISK MANAGEMENT TYPES
// ============================================================================

export interface RiskMetrics {
  currentBalance: string;
  stopLossThreshold: string;
  riskExposure: number;
  escrowLocksActive: number;
  maxConcurrentSwaps: number;
}

export interface TimeoutEvent {
  swapId: string;
  reason: string;
  timestamp: number;
  recoveredAssets: string;
}

export interface GracefulShutdown {
  timestamp: number;
  reason: string;
  finalBalance: string;
  failedSwaps: string[];
  recoveryActions: string[];
  status: 'completed' | 'partial' | 'failed';
}

// ============================================================================
// LOGGING & MONITORING TYPES
// ============================================================================

export interface AgentLog {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  data?: any;
}

export interface AgentMetrics {
  uptime: number;
  totalSwapsExecuted: number;
  totalProfitGenerated: string;
  averageProfit: string;
  failureRate: number;
  lastHeartbeat: number;
}

// ============================================================================
// ASTRIDOS SANDBOX TYPES
// ============================================================================

export interface AstridOSSandboxConfig {
  enabled: boolean;
  processIsolation: boolean;
  memoryLimitMB: number;
  cpuLimitPercent: number;
  networkWhitelist: string[];
  fileSystemPermissions: {
    readPaths: string[];
    writePaths: string[];
  };
}

export interface SandboxContext {
  processId: string;
  isolationLevel: 'strict' | 'moderate' | 'permissive';
  resourceLimits: {
    memory: number;
    cpu: number;
    diskIO: number;
  };
  dataStreams: {
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  };
}

// ============================================================================
// AGENT STATE TYPES
// ============================================================================

export interface AgentState {
  identity: AgentIdentity;
  wallet: WalletBalance;
  activeSwaps: Map<string, AtomicSwap>;
  nostrSubscriptions: Map<string, NostrSubscription>;
  metrics: AgentMetrics;
  lastUpdate: number;
}

export interface AgentConfig {
  wallet: WalletConfig;
  arbitrage: {
    minProfitMarginPercent: number;
    stopLossThreshold: string;
    escrowTimeoutSeconds: number;
    maxConcurrentSwaps: number;
  };
  nostr: {
    relayUrls: string[];
    eventKinds: number[];
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    outputDir: string;
  };
  astridOS?: AstridOSSandboxConfig;
}

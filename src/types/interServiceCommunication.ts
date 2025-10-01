/**
 * Inter-Service Communication Types and Interfaces
 */

export interface ServiceRequest {
  id: string;
  correlationId: string;
  timestamp: Date;
  source: string;
  target: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  headers: Record<string, string>;
  body?: any;
  timeout?: number;
  retries?: number;
  metadata?: Record<string, any>;
}

export interface ServiceResponse {
  id: string;
  correlationId: string;
  timestamp: Date;
  statusCode: number;
  headers: Record<string, string>;
  body?: any;
  error?: ServiceError;
  processingTime: number;
  metadata?: Record<string, any>;
}

export interface ServiceError {
  code: string;
  message: string;
  details?: any;
  stack?: string;
  retryable: boolean;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
  halfOpenMaxCalls: number;
}

export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  halfOpenCalls: number;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableStatusCodes: number[];
  retryableErrors: string[];
}

export interface RequestTracing {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  baggage?: Record<string, string>;
}

export interface ServiceContract {
  serviceName: string;
  version: string;
  endpoints: ContractEndpoint[];
  schemas: Record<string, any>;
}

export interface ContractEndpoint {
  path: string;
  method: string;
  description: string;
  requestSchema?: string;
  responseSchema?: string;
  errorCodes: string[];
  timeout: number;
  retryable: boolean;
}

export interface LoadBalancingConfig {
  strategy: 'round-robin' | 'least-connections' | 'random' | 'weighted';
  healthCheckRequired: boolean;
  weights?: Record<string, number>;
}

export interface ServiceInstance {
  id: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  weight: number;
  healthy: boolean;
  lastHealthCheck?: Date;
  connections: number;
}

export interface InterServiceClient {
  request<T = any>(request: Omit<ServiceRequest, 'id' | 'timestamp'>): Promise<ServiceResponse<T>>;
  get<T = any>(path: string, options?: RequestOptions): Promise<T>;
  post<T = any>(path: string, body?: any, options?: RequestOptions): Promise<T>;
  put<T = any>(path: string, body?: any, options?: RequestOptions): Promise<T>;
  delete<T = any>(path: string, options?: RequestOptions): Promise<T>;
  patch<T = any>(path: string, body?: any, options?: RequestOptions): Promise<T>;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  correlationId?: string;
  metadata?: Record<string, any>;
}

export interface ServiceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  circuitBreakerTrips: number;
  retryAttempts: number;
  timeoutErrors: number;
  connectionErrors: number;
}
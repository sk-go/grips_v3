/**
 * Inter-Service Communication Client
 * Provides standardized HTTP client with circuit breaker, retry logic, and load balancing
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { CircuitBreaker } from './circuitBreaker';
import { LoadBalancer } from './loadBalancer';
import { ServiceDiscoveryClient } from '../serviceDiscovery/serviceDiscoveryClient';
import {
  ServiceRequest,
  ServiceResponse,
  ServiceError,
  RetryConfig,
  RequestOptions,
  InterServiceClient as IInterServiceClient,
  ServiceMetrics,
  ServiceInstance
} from '../../types/interServiceCommunication';

export class InterServiceClient implements IInterServiceClient {
  private axiosInstance: AxiosInstance;
  private circuitBreaker: CircuitBreaker;
  private loadBalancer: LoadBalancer;
  private serviceDiscovery: ServiceDiscoveryClient;
  private metrics: ServiceMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    p95ResponseTime: 0,
    p99ResponseTime: 0,
    circuitBreakerTrips: 0,
    retryAttempts: 0,
    timeoutErrors: 0,
    connectionErrors: 0
  };
  private responseTimes: number[] = [];

  private readonly defaultRetryConfig: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED']
  };

  constructor(
    private readonly targetService: string,
    private readonly retryConfig: Partial<RetryConfig> = {},
    private readonly baseURL?: string
  ) {
    this.circuitBreaker = new CircuitBreaker(targetService);
    this.loadBalancer = new LoadBalancer(targetService);
    this.serviceDiscovery = new ServiceDiscoveryClient();

    const finalRetryConfig = { ...this.defaultRetryConfig, ...retryConfig };

    this.axiosInstance = axios.create({
      timeout: 30000, // 30 seconds default timeout
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `InterServiceClient/${targetService}`
      }
    });

    this.setupInterceptors();
    this.initializeServiceInstances();
  }

  /**
   * Make a generic service request
   */
  async request<T = any>(
    request: Omit<ServiceRequest, 'id' | 'timestamp'>
  ): Promise<ServiceResponse<T>> {
    const fullRequest: ServiceRequest = {
      id: uuidv4(),
      timestamp: new Date(),
      ...request
    };

    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      const response = await this.executeWithRetry(fullRequest);
      const processingTime = Date.now() - startTime;
      
      this.updateMetrics(processingTime, true);
      
      return {
        id: response.data?.id || uuidv4(),
        correlationId: fullRequest.correlationId,
        timestamp: new Date(),
        statusCode: response.status,
        headers: response.headers,
        body: response.data,
        processingTime,
        metadata: {
          requestId: fullRequest.id,
          target: fullRequest.target
        }
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
      
      throw this.createServiceError(error as Error, fullRequest);
    }
  }

  /**
   * GET request
   */
  async get<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request<T>({
      correlationId: options.correlationId || uuidv4(),
      source: 'inter-service-client',
      target: this.targetService,
      method: 'GET',
      path,
      headers: options.headers || {},
      timeout: options.timeout,
      retries: options.retries,
      metadata: options.metadata
    });

    return response.body;
  }

  /**
   * POST request
   */
  async post<T = any>(path: string, body?: any, options: RequestOptions = {}): Promise<T> {
    const response = await this.request<T>({
      correlationId: options.correlationId || uuidv4(),
      source: 'inter-service-client',
      target: this.targetService,
      method: 'POST',
      path,
      headers: options.headers || {},
      body,
      timeout: options.timeout,
      retries: options.retries,
      metadata: options.metadata
    });

    return response.body;
  }

  /**
   * PUT request
   */
  async put<T = any>(path: string, body?: any, options: RequestOptions = {}): Promise<T> {
    const response = await this.request<T>({
      correlationId: options.correlationId || uuidv4(),
      source: 'inter-service-client',
      target: this.targetService,
      method: 'PUT',
      path,
      headers: options.headers || {},
      body,
      timeout: options.timeout,
      retries: options.retries,
      metadata: options.metadata
    });

    return response.body;
  }

  /**
   * DELETE request
   */
  async delete<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request<T>({
      correlationId: options.correlationId || uuidv4(),
      source: 'inter-service-client',
      target: this.targetService,
      method: 'DELETE',
      path,
      headers: options.headers || {},
      timeout: options.timeout,
      retries: options.retries,
      metadata: options.metadata
    });

    return response.body;
  }

  /**
   * PATCH request
   */
  async patch<T = any>(path: string, body?: any, options: RequestOptions = {}): Promise<T> {
    const response = await this.request<T>({
      correlationId: options.correlationId || uuidv4(),
      source: 'inter-service-client',
      target: this.targetService,
      method: 'PATCH',
      path,
      headers: options.headers || {},
      body,
      timeout: options.timeout,
      retries: options.retries,
      metadata: options.metadata
    });

    return response.body;
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry(request: ServiceRequest): Promise<AxiosResponse> {
    const retryConfig = { ...this.defaultRetryConfig, ...this.retryConfig };
    let lastError: Error;
    
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await this.circuitBreaker.execute(async () => {
          const instance = await this.getServiceInstance();
          const url = this.buildUrl(instance, request.path);
          
          const config: AxiosRequestConfig = {
            method: request.method,
            url,
            headers: {
              ...request.headers,
              'x-correlation-id': request.correlationId,
              'x-request-id': request.id
            },
            data: request.body,
            timeout: request.timeout || 30000
          };

          if (instance) {
            this.loadBalancer.incrementConnections(instance.id);
          }

          try {
            const response = await this.axiosInstance.request(config);
            
            if (instance) {
              this.loadBalancer.decrementConnections(instance.id);
            }

            return response;
          } catch (error) {
            if (instance) {
              this.loadBalancer.decrementConnections(instance.id);
            }
            throw error;
          }
        });
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < retryConfig.maxRetries && this.isRetryableError(error as Error, retryConfig)) {
          this.metrics.retryAttempts++;
          const delay = this.calculateRetryDelay(attempt, retryConfig);
          
          logger.warn('Request failed, retrying', {
            service: this.targetService,
            attempt: attempt + 1,
            maxRetries: retryConfig.maxRetries,
            delay,
            error: (error as Error).message,
            correlationId: request.correlationId
          });

          await this.sleep(delay);
          continue;
        }

        break;
      }
    }

    throw lastError!;
  }

  /**
   * Get service instance from load balancer or service discovery
   */
  private async getServiceInstance(): Promise<ServiceInstance | null> {
    let instance = this.loadBalancer.getNextInstance();
    
    if (!instance) {
      // Try to discover services
      await this.refreshServiceInstances();
      instance = this.loadBalancer.getNextInstance();
    }

    return instance;
  }

  /**
   * Build URL from instance and path
   */
  private buildUrl(instance: ServiceInstance | null, path: string): string {
    if (this.baseURL) {
      return `${this.baseURL}${path}`;
    }

    if (!instance) {
      throw new Error(`No available instances for service: ${this.targetService}`);
    }

    const protocol = instance.protocol || 'http';
    return `${protocol}://${instance.host}:${instance.port}${path}`;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: Error, retryConfig: RetryConfig): boolean {
    // Check for retryable error codes/messages
    const isRetryableErrorType = retryConfig.retryableErrors.some(retryableError =>
      error.message.includes(retryableError) || error.name.includes(retryableError)
    );

    // Check for retryable HTTP status codes
    const isRetryableStatus = axios.isAxiosError(error) && 
      error.response && 
      retryConfig.retryableStatusCodes.includes(error.response.status);

    return isRetryableErrorType || isRetryableStatus;
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number, retryConfig: RetryConfig): number {
    const baseDelay = retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt);
    const delay = Math.min(baseDelay, retryConfig.maxDelay);
    
    if (retryConfig.jitter) {
      // Add random jitter (±25%)
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      return Math.max(0, delay + jitter);
    }

    return delay;
  }

  /**
   * Create service error from caught error
   */
  private createServiceError(error: Error, request: ServiceRequest): ServiceError {
    let serviceError: ServiceError;

    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        this.metrics.timeoutErrors++;
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.metrics.connectionErrors++;
      }

      serviceError = {
        code: error.code || 'HTTP_ERROR',
        message: error.message,
        details: {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          config: {
            method: error.config?.method,
            url: error.config?.url,
            timeout: error.config?.timeout
          }
        },
        retryable: this.isRetryableError(error, this.defaultRetryConfig)
      };
    } else if (error.name === 'CircuitBreakerError') {
      this.metrics.circuitBreakerTrips++;
      serviceError = {
        code: 'CIRCUIT_BREAKER_OPEN',
        message: error.message,
        retryable: false
      };
    } else {
      serviceError = {
        code: 'UNKNOWN_ERROR',
        message: error.message,
        stack: error.stack,
        retryable: false
      };
    }

    logger.error('Service request failed', {
      service: this.targetService,
      correlationId: request.correlationId,
      requestId: request.id,
      error: serviceError
    });

    return serviceError;
  }

  /**
   * Initialize service instances from service discovery
   */
  private async initializeServiceInstances(): Promise<void> {
    try {
      await this.refreshServiceInstances();
    } catch (error) {
      logger.warn('Failed to initialize service instances', {
        service: this.targetService,
        error: error.message
      });
    }
  }

  /**
   * Refresh service instances from service discovery
   */
  private async refreshServiceInstances(): Promise<void> {
    try {
      const services = await this.serviceDiscovery.getHealthyServicesByName(this.targetService);
      
      // Clear existing instances
      this.loadBalancer.clear();
      
      // Add discovered instances
      for (const service of services) {
        const instance: ServiceInstance = {
          id: service.id,
          host: service.host,
          port: service.port,
          protocol: service.protocol,
          weight: 1,
          healthy: true,
          connections: 0
        };
        
        this.loadBalancer.addInstance(instance);
      }

      logger.debug('Refreshed service instances', {
        service: this.targetService,
        instanceCount: services.length
      });
    } catch (error) {
      logger.error('Failed to refresh service instances', {
        service: this.targetService,
        error: error.message
      });
    }
  }

  /**
   * Setup axios interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => {
        logger.debug('Outgoing request', {
          service: this.targetService,
          method: config.method?.toUpperCase(),
          url: config.url,
          correlationId: config.headers?.['x-correlation-id']
        });
        return config;
      },
      (error) => {
        logger.error('Request interceptor error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        logger.debug('Incoming response', {
          service: this.targetService,
          status: response.status,
          correlationId: response.headers?.['x-correlation-id']
        });
        return response;
      },
      (error) => {
        logger.error('Response interceptor error', {
          service: this.targetService,
          error: error.message,
          status: error.response?.status
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Update metrics
   */
  private updateMetrics(responseTime: number, success: boolean): void {
    this.responseTimes.push(responseTime);
    
    // Keep only last 1000 response times for percentile calculation
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Update average response time
    const totalRequests = this.metrics.successfulRequests + this.metrics.failedRequests;
    this.metrics.averageResponseTime = 
      ((this.metrics.averageResponseTime * (totalRequests - 1)) + responseTime) / totalRequests;

    // Update percentiles
    if (this.responseTimes.length > 0) {
      const sorted = [...this.responseTimes].sort((a, b) => a - b);
      this.metrics.p95ResponseTime = sorted[Math.floor(sorted.length * 0.95)];
      this.metrics.p99ResponseTime = sorted[Math.floor(sorted.length * 0.99)];
    }
  }

  /**
   * Get client metrics
   */
  getMetrics(): ServiceMetrics {
    return { ...this.metrics };
  }

  /**
   * Get circuit breaker metrics
   */
  getCircuitBreakerMetrics() {
    return this.circuitBreaker.getMetrics();
  }

  /**
   * Get load balancer statistics
   */
  getLoadBalancerStats() {
    return this.loadBalancer.getStatistics();
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown the client
   */
  async shutdown(): Promise<void> {
    await this.serviceDiscovery.shutdown();
    logger.info('Inter-service client shutdown completed', {
      service: this.targetService
    });
  }
}
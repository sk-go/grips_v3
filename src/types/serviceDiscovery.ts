/**
 * Service Discovery Types and Interfaces
 */

export interface ServiceRegistration {
  id: string;
  name: string;
  version: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  endpoints: ServiceEndpoint[];
  metadata: Record<string, any>;
  registeredAt: Date;
  lastHeartbeat: Date;
  status: ServiceStatus;
  tags: string[];
}

export interface ServiceEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description: string;
  healthCheck?: boolean;
}

export enum ServiceStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  STARTING = 'starting',
  STOPPING = 'stopping',
  UNKNOWN = 'unknown'
}

export interface HealthCheckResult {
  status: ServiceStatus;
  timestamp: Date;
  responseTime: number;
  details: Record<string, any>;
  errors?: string[];
}

export interface ServiceHealthCheck {
  endpoint: string;
  interval: number;
  timeout: number;
  retries: number;
  expectedStatus?: number;
  expectedResponse?: any;
}

export interface ServiceDiscoveryConfig {
  registrationTtl: number;
  heartbeatInterval: number;
  healthCheckInterval: number;
  cleanupInterval: number;
  maxRetries: number;
  retryDelay: number;
}

export interface ServiceQuery {
  name?: string;
  tags?: string[];
  status?: ServiceStatus;
  version?: string;
  metadata?: Record<string, any>;
}

export interface ServiceRegistry {
  register(service: Omit<ServiceRegistration, 'id' | 'registeredAt' | 'lastHeartbeat'>): Promise<string>;
  deregister(serviceId: string): Promise<void>;
  discover(query: ServiceQuery): Promise<ServiceRegistration[]>;
  getService(serviceId: string): Promise<ServiceRegistration | null>;
  updateHeartbeat(serviceId: string): Promise<void>;
  updateStatus(serviceId: string, status: ServiceStatus, details?: Record<string, any>): Promise<void>;
  getAllServices(): Promise<ServiceRegistration[]>;
  cleanup(): Promise<void>;
}

export interface HealthMonitor {
  startMonitoring(serviceId: string, healthCheck: ServiceHealthCheck): Promise<void>;
  stopMonitoring(serviceId: string): Promise<void>;
  getHealthStatus(serviceId: string): Promise<HealthCheckResult | null>;
  getAllHealthStatuses(): Promise<Map<string, HealthCheckResult>>;
}
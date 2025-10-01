import { AIServiceMonitor, AIServiceStatus } from './aiServiceMonitor';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';

export interface DegradationConfig {
  enableFallbacks: boolean;
  showManualOverrides: boolean;
  notifyOperationsTeam: boolean;
  operationsEmail?: string;
  fallbackResponses: {
    [key: string]: string;
  };
}

export interface ManualOverride {
  id: string;
  agentId: string;
  originalRequest: any;
  manualResponse?: string;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: Date;
  completedAt?: Date;
}

export class AIServiceDegradationHandler extends EventEmitter {
  private monitor: AIServiceMonitor;
  private config: DegradationConfig;
  private manualOverrides: Map<string, ManualOverride> = new Map();
  private isInDegradedMode = false;

  constructor(monitor: AIServiceMonitor, config: DegradationConfig) {
    super();
    this.monitor = monitor;
    this.config = config;

    // Listen to service status changes
    this.monitor.on('statusUpdate', this.handleStatusUpdate.bind(this));
    this.monitor.on('serviceUnavailable', this.handleServiceUnavailable.bind(this));
    this.monitor.on('serviceDegraded', this.handleServiceDegraded.bind(this));
    this.monitor.on('serviceHealthy', this.handleServiceHealthy.bind(this));
    this.monitor.on('alert', this.handleAlert.bind(this));
  }

  /**
   * Check if AI features should be disabled
   */
  shouldDisableAIFeatures(): boolean {
    const status = this.monitor.getStatus();
    return status.status === 'unavailable';
  }

  /**
   * Check if AI features should show degradation warnings
   */
  shouldShowDegradationWarning(): boolean {
    const status = this.monitor.getStatus();
    return status.status === 'degraded';
  }

  /**
   * Get current degradation state
   */
  getDegradationState(): {
    isServiceAvailable: boolean;
    isServiceHealthy: boolean;
    shouldDisableFeatures: boolean;
    shouldShowWarning: boolean;
    status: AIServiceStatus;
    manualOverrideCount: number;
  } {
    const status = this.monitor.getStatus();
    
    return {
      isServiceAvailable: this.monitor.isServiceAvailable(),
      isServiceHealthy: this.monitor.isServiceHealthy(),
      shouldDisableFeatures: this.shouldDisableAIFeatures(),
      shouldShowWarning: this.shouldShowDegradationWarning(),
      status,
      manualOverrideCount: this.manualOverrides.size
    };
  }

  /**
   * Handle AI request with degradation fallbacks
   */
  async handleAIRequest(request: any): Promise<{
    success: boolean;
    response?: any;
    fallbackUsed: boolean;
    manualOverrideRequired: boolean;
    overrideId?: string;
  }> {
    const status = this.monitor.getStatus();

    // If service is unavailable, provide fallback or manual override
    if (status.status === 'unavailable') {
      if (this.config.enableFallbacks && this.hasFallbackResponse(request.type)) {
        return {
          success: true,
          response: this.getFallbackResponse(request.type),
          fallbackUsed: true,
          manualOverrideRequired: false
        };
      }

      // Create manual override if enabled
      if (this.config.showManualOverrides) {
        const overrideId = this.createManualOverride(request);
        return {
          success: false,
          fallbackUsed: false,
          manualOverrideRequired: true,
          overrideId
        };
      }

      return {
        success: false,
        fallbackUsed: false,
        manualOverrideRequired: false
      };
    }

    // Service is available, but may be degraded
    return {
      success: true,
      fallbackUsed: false,
      manualOverrideRequired: false
    };
  }

  /**
   * Create a manual override request
   */
  createManualOverride(request: any): string {
    const override: ManualOverride = {
      id: `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentId: request.agentId || 'unknown',
      originalRequest: request,
      status: 'pending',
      createdAt: new Date()
    };

    this.manualOverrides.set(override.id, override);

    logger.info('Created manual override for AI request', {
      overrideId: override.id,
      agentId: override.agentId,
      requestType: request.type
    });

    // Emit event for UI updates
    this.emit('manualOverrideCreated', override);

    return override.id;
  }

  /**
   * Complete a manual override
   */
  completeManualOverride(overrideId: string, response: string): boolean {
    const override = this.manualOverrides.get(overrideId);
    if (!override || override.status !== 'pending') {
      return false;
    }

    override.manualResponse = response;
    override.status = 'completed';
    override.completedAt = new Date();

    logger.info('Completed manual override', {
      overrideId,
      agentId: override.agentId
    });

    // Emit event for UI updates
    this.emit('manualOverrideCompleted', override);

    return true;
  }

  /**
   * Cancel a manual override
   */
  cancelManualOverride(overrideId: string): boolean {
    const override = this.manualOverrides.get(overrideId);
    if (!override || override.status !== 'pending') {
      return false;
    }

    override.status = 'cancelled';
    override.completedAt = new Date();

    logger.info('Cancelled manual override', {
      overrideId,
      agentId: override.agentId
    });

    // Emit event for UI updates
    this.emit('manualOverrideCancelled', override);

    return true;
  }

  /**
   * Get all manual overrides
   */
  getManualOverrides(status?: 'pending' | 'completed' | 'cancelled'): ManualOverride[] {
    const overrides = Array.from(this.manualOverrides.values());
    
    if (status) {
      return overrides.filter(override => override.status === status);
    }
    
    return overrides;
  }

  /**
   * Get a specific manual override
   */
  getManualOverride(overrideId: string): ManualOverride | undefined {
    return this.manualOverrides.get(overrideId);
  }

  /**
   * Check if a fallback response exists for a request type
   */
  private hasFallbackResponse(requestType: string): boolean {
    return requestType in this.config.fallbackResponses;
  }

  /**
   * Get fallback response for a request type
   */
  private getFallbackResponse(requestType: string): string {
    return this.config.fallbackResponses[requestType] || 
           'AI service is temporarily unavailable. Please try again later or contact support.';
  }

  /**
   * Handle service status updates
   */
  private handleStatusUpdate(status: AIServiceStatus): void {
    const wasDegraded = this.isInDegradedMode;
    this.isInDegradedMode = status.status !== 'healthy';

    // Emit degradation state changes
    if (!wasDegraded && this.isInDegradedMode) {
      this.emit('degradationStarted', status);
    } else if (wasDegraded && !this.isInDegradedMode) {
      this.emit('degradationEnded', status);
    }

    // Always emit status update for UI
    this.emit('statusUpdate', this.getDegradationState());
  }

  /**
   * Handle service unavailable
   */
  private handleServiceUnavailable(status: AIServiceStatus): void {
    logger.error('AI service is unavailable', { status });
    
    if (this.config.notifyOperationsTeam) {
      this.notifyOperationsTeam('critical', 'AI service is unavailable', status);
    }

    this.emit('serviceUnavailable', status);
  }

  /**
   * Handle service degraded
   */
  private handleServiceDegraded(status: AIServiceStatus): void {
    logger.warn('AI service is degraded', { status });
    
    if (this.config.notifyOperationsTeam) {
      this.notifyOperationsTeam('warning', 'AI service is experiencing performance issues', status);
    }

    this.emit('serviceDegraded', status);
  }

  /**
   * Handle service healthy
   */
  private handleServiceHealthy(status: AIServiceStatus): void {
    logger.info('AI service is healthy', { status });
    this.emit('serviceHealthy', status);
  }

  /**
   * Handle alerts
   */
  private handleAlert(alert: any): void {
    if (this.config.notifyOperationsTeam) {
      this.notifyOperationsTeam(alert.level, alert.message, alert);
    }
  }

  /**
   * Notify operations team (placeholder - would integrate with actual notification system)
   */
  private notifyOperationsTeam(level: 'warning' | 'critical', message: string, details: any): void {
    logger.info('Notifying operations team', { level, message, details });
    
    // In a real implementation, this would send emails, Slack messages, etc.
    // For now, we just emit an event that can be handled by external systems
    this.emit('operationsNotification', {
      level,
      message,
      details,
      timestamp: new Date(),
      email: this.config.operationsEmail
    });
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DegradationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Updated degradation handler configuration', { config: this.config });
  }

  /**
   * Clean up old manual overrides
   */
  cleanupOldOverrides(maxAgeHours: number = 24): number {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - maxAgeHours);

    let cleanedCount = 0;
    
    for (const [id, override] of this.manualOverrides.entries()) {
      if (override.createdAt < cutoffTime && override.status !== 'pending') {
        this.manualOverrides.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old manual overrides', { count: cleanedCount });
    }

    return cleanedCount;
  }
}
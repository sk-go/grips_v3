import { VoiceError } from '../../types/voice';
import { logger } from '../../utils/logger';

export class VoiceErrorHandler {
  private errorCounts: Map<string, number> = new Map();
  private readonly maxRetries = 3;
  private readonly errorCooldown = 60000; // 1 minute

  handleError(error: any, context: { sessionId?: string, type?: string }): VoiceError {
    const voiceError: VoiceError = {
      type: this.categorizeError(error),
      message: this.sanitizeErrorMessage(error.message || 'Unknown voice processing error'),
      code: error.code,
      sessionId: context.sessionId,
      timestamp: new Date()
    };

    // Log the error
    logger.error('Voice processing error', {
      error: voiceError,
      context,
      stack: error.stack
    });

    // Track error frequency
    this.trackError(voiceError);

    return voiceError;
  }

  private categorizeError(error: any): VoiceError['type'] {
    const message = error.message?.toLowerCase() || '';
    const code = error.code;

    // Network-related errors
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      return 'network';
    }

    if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
      return 'network';
    }

    // Configuration errors
    if (message.includes('api key') || message.includes('unauthorized') || message.includes('forbidden')) {
      return 'config';
    }

    // Recognition-specific errors
    if (message.includes('speech') || message.includes('recognition') || message.includes('transcription')) {
      return 'recognition';
    }

    // Synthesis-specific errors
    if (message.includes('synthesis') || message.includes('tts') || message.includes('voice generation')) {
      return 'synthesis';
    }

    // Quality-related errors
    if (message.includes('quality') || message.includes('noise') || message.includes('clarity')) {
      return 'quality';
    }

    // Default to network for unknown errors
    return 'network';
  }

  private sanitizeErrorMessage(message: string): string {
    // Remove sensitive information from error messages
    return message
      .replace(/api[_-]?key[s]?[:\s]*[a-zA-Z0-9_-]+/gi, 'api_key: [REDACTED]')
      .replace(/token[s]?[:\s]*[a-zA-Z0-9_-]+/gi, 'token: [REDACTED]')
      .replace(/password[s]?[:\s]*[^\s]+/gi, 'password: [REDACTED]');
  }

  private trackError(error: VoiceError): void {
    const key = `${error.type}_${error.sessionId || 'global'}`;
    const count = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, count + 1);

    // Clean up old error counts periodically
    setTimeout(() => {
      this.errorCounts.delete(key);
    }, this.errorCooldown);
  }

  shouldRetry(error: VoiceError, sessionId?: string): boolean {
    const key = `${error.type}_${sessionId || 'global'}`;
    const errorCount = this.errorCounts.get(key) || 0;

    // Don't retry configuration errors
    if (error.type === 'config') {
      return false;
    }

    // Don't retry if we've exceeded max attempts
    if (errorCount >= this.maxRetries) {
      return false;
    }

    // Retry network and quality errors
    return error.type === 'network' || error.type === 'quality';
  }

  getRetryDelay(attemptNumber: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s...
    return Math.min(1000 * Math.pow(2, attemptNumber), 10000);
  }

  generateUserFriendlyMessage(error: VoiceError): string {
    switch (error.type) {
      case 'network':
        return 'Connection issue detected. Please check your internet connection and try again.';
      
      case 'config':
        return 'Voice service configuration error. Please contact support.';
      
      case 'recognition':
        return 'Speech recognition failed. Please try speaking more clearly or use text input.';
      
      case 'synthesis':
        return 'Voice synthesis failed. You may not hear audio responses temporarily.';
      
      case 'quality':
        return 'Poor audio quality detected. Please check your microphone and reduce background noise.';
      
      default:
        return 'Voice processing error occurred. Please try again or use text input.';
    }
  }

  generateRecoveryActions(error: VoiceError): string[] {
    const actions: string[] = [];

    switch (error.type) {
      case 'network':
        actions.push('Check internet connection');
        actions.push('Try again in a few moments');
        actions.push('Switch to text input if problem persists');
        break;
      
      case 'config':
        actions.push('Contact system administrator');
        actions.push('Use text input as alternative');
        break;
      
      case 'recognition':
        actions.push('Speak more clearly and slowly');
        actions.push('Reduce background noise');
        actions.push('Move closer to microphone');
        actions.push('Switch to text input');
        break;
      
      case 'synthesis':
        actions.push('Check audio output settings');
        actions.push('Try refreshing the page');
        actions.push('Continue with text responses');
        break;
      
      case 'quality':
        actions.push('Improve microphone positioning');
        actions.push('Reduce background noise');
        actions.push('Check microphone settings');
        actions.push('Use a headset if available');
        break;
      
      default:
        actions.push('Try again');
        actions.push('Use text input as fallback');
    }

    return actions;
  }

  getErrorStats(): { [key: string]: number } {
    const stats: { [key: string]: number } = {};
    
    for (const [key, count] of this.errorCounts.entries()) {
      const [type] = key.split('_');
      stats[type] = (stats[type] || 0) + count;
    }
    
    return stats;
  }

  clearErrorHistory(): void {
    this.errorCounts.clear();
  }
}
import { VoiceErrorHandler } from '../../services/voice/voiceErrorHandler';

describe('VoiceErrorHandler', () => {
  let errorHandler: VoiceErrorHandler;

  beforeEach(() => {
    errorHandler = new VoiceErrorHandler();
  });

  describe('handleError', () => {
    it('should categorize network errors correctly', () => {
      const networkError = new Error('Connection refused') as any;
      networkError.code = 'ECONNREFUSED';

      const voiceError = errorHandler.handleError(networkError, { sessionId: 'test-session' });

      expect(voiceError.type).toBe('network');
      expect(voiceError.message).toContain('Connection refused');
      expect(voiceError.sessionId).toBe('test-session');
      expect(voiceError.code).toBe('ECONNREFUSED');
    });

    it('should categorize configuration errors correctly', () => {
      const configError = new Error('Invalid API key provided');

      const voiceError = errorHandler.handleError(configError, { type: 'config' });

      expect(voiceError.type).toBe('config');
      expect(voiceError.message).toContain('Invalid API key provided');
    });

    it('should categorize recognition errors correctly', () => {
      const recognitionError = new Error('Speech recognition failed');

      const voiceError = errorHandler.handleError(recognitionError, {});

      expect(voiceError.type).toBe('recognition');
    });

    it('should categorize synthesis errors correctly', () => {
      const synthesisError = new Error('TTS service unavailable');

      const voiceError = errorHandler.handleError(synthesisError, {});

      expect(voiceError.type).toBe('synthesis');
    });

    it('should sanitize sensitive information from error messages', () => {
      const sensitiveError = new Error('Authentication failed with api_key: sk-1234567890abcdef');

      const voiceError = errorHandler.handleError(sensitiveError, {});

      expect(voiceError.message).not.toContain('sk-1234567890abcdef');
      expect(voiceError.message).toContain('[REDACTED]');
    });
  });

  describe('shouldRetry', () => {
    it('should allow retry for network errors', () => {
      const networkError = {
        type: 'network' as const,
        message: 'Connection timeout',
        timestamp: new Date()
      };

      const shouldRetry = errorHandler.shouldRetry(networkError, 'test-session');
      expect(shouldRetry).toBe(true);
    });

    it('should not allow retry for configuration errors', () => {
      const configError = {
        type: 'config' as const,
        message: 'Invalid API key',
        timestamp: new Date()
      };

      const shouldRetry = errorHandler.shouldRetry(configError, 'test-session');
      expect(shouldRetry).toBe(false);
    });

    it('should not allow retry after max attempts', () => {
      const networkError = {
        type: 'network' as const,
        message: 'Connection timeout',
        timestamp: new Date()
      };

      // Simulate multiple errors to exceed max retries
      for (let i = 0; i < 4; i++) {
        errorHandler.handleError(new Error('Network error'), { sessionId: 'test-session' });
      }

      const shouldRetry = errorHandler.shouldRetry(networkError, 'test-session');
      expect(shouldRetry).toBe(false);
    });
  });

  describe('getRetryDelay', () => {
    it('should return exponential backoff delays', () => {
      expect(errorHandler.getRetryDelay(0)).toBe(1000);  // 1s
      expect(errorHandler.getRetryDelay(1)).toBe(2000);  // 2s
      expect(errorHandler.getRetryDelay(2)).toBe(4000);  // 4s
      expect(errorHandler.getRetryDelay(3)).toBe(8000);  // 8s
    });

    it('should cap delay at maximum value', () => {
      expect(errorHandler.getRetryDelay(10)).toBe(10000); // Max 10s
    });
  });

  describe('generateUserFriendlyMessage', () => {
    it('should generate user-friendly message for network errors', () => {
      const networkError = {
        type: 'network' as const,
        message: 'ECONNREFUSED',
        timestamp: new Date()
      };

      const message = errorHandler.generateUserFriendlyMessage(networkError);
      expect(message).toContain('Connection issue detected');
      expect(message).toContain('internet connection');
    });

    it('should generate user-friendly message for recognition errors', () => {
      const recognitionError = {
        type: 'recognition' as const,
        message: 'Speech recognition failed',
        timestamp: new Date()
      };

      const message = errorHandler.generateUserFriendlyMessage(recognitionError);
      expect(message).toContain('Speech recognition failed');
      expect(message).toContain('speaking more clearly');
    });

    it('should generate user-friendly message for quality errors', () => {
      const qualityError = {
        type: 'quality' as const,
        message: 'Poor audio quality',
        timestamp: new Date()
      };

      const message = errorHandler.generateUserFriendlyMessage(qualityError);
      expect(message).toContain('Poor audio quality detected');
      expect(message).toContain('microphone');
    });
  });

  describe('generateRecoveryActions', () => {
    it('should generate recovery actions for network errors', () => {
      const networkError = {
        type: 'network' as const,
        message: 'Connection timeout',
        timestamp: new Date()
      };

      const actions = errorHandler.generateRecoveryActions(networkError);
      expect(actions).toContain('Check internet connection');
      expect(actions).toContain('Try again in a few moments');
      expect(actions).toContain('Switch to text input if problem persists');
    });

    it('should generate recovery actions for recognition errors', () => {
      const recognitionError = {
        type: 'recognition' as const,
        message: 'Speech recognition failed',
        timestamp: new Date()
      };

      const actions = errorHandler.generateRecoveryActions(recognitionError);
      expect(actions).toContain('Speak more clearly and slowly');
      expect(actions).toContain('Reduce background noise');
      expect(actions).toContain('Move closer to microphone');
      expect(actions).toContain('Switch to text input');
    });

    it('should generate recovery actions for quality errors', () => {
      const qualityError = {
        type: 'quality' as const,
        message: 'Poor audio quality',
        timestamp: new Date()
      };

      const actions = errorHandler.generateRecoveryActions(qualityError);
      expect(actions).toContain('Improve microphone positioning');
      expect(actions).toContain('Reduce background noise');
      expect(actions).toContain('Check microphone settings');
      expect(actions).toContain('Use a headset if available');
    });
  });

  describe('error statistics', () => {
    it('should track error statistics', () => {
      const error1 = new Error('Network error 1');
      const error2 = new Error('Network error 2');
      const error3 = new Error('Speech recognition failed');

      errorHandler.handleError(error1, { sessionId: 'session1' });
      errorHandler.handleError(error2, { sessionId: 'session2' });
      errorHandler.handleError(error3, { sessionId: 'session1' });

      const stats = errorHandler.getErrorStats();
      expect(stats.network).toBe(2);
      expect(stats.recognition).toBe(1);
    });

    it('should clear error history', () => {
      const error = new Error('Test error');
      errorHandler.handleError(error, { sessionId: 'test' });

      let stats = errorHandler.getErrorStats();
      expect(Object.keys(stats).length).toBeGreaterThan(0);

      errorHandler.clearErrorHistory();
      stats = errorHandler.getErrorStats();
      expect(Object.keys(stats).length).toBe(0);
    });
  });
});
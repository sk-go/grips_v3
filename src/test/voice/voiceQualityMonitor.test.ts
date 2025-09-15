import { VoiceQualityMonitor } from '../../services/voice/voiceQualityMonitor';

describe('VoiceQualityMonitor', () => {
  let monitor: VoiceQualityMonitor;

  beforeEach(() => {
    monitor = new VoiceQualityMonitor();
  });

  describe('analyzeAudio', () => {
    it('should analyze audio quality and return metrics', async () => {
      // Create a mock audio buffer with some variation
      const audioBuffer = Buffer.alloc(1024);
      for (let i = 0; i < audioBuffer.length; i += 2) {
        // Create 16-bit PCM samples with some variation
        const sample = Math.sin(i / 100) * 16000; // Sine wave
        audioBuffer.writeInt16LE(sample, i);
      }

      const quality = await monitor.analyzeAudio(audioBuffer);

      expect(quality).toHaveProperty('signalStrength');
      expect(quality).toHaveProperty('noiseLevel');
      expect(quality).toHaveProperty('clarity');
      expect(quality).toHaveProperty('overallScore');

      expect(quality.signalStrength).toBeGreaterThanOrEqual(0);
      expect(quality.signalStrength).toBeLessThanOrEqual(100);
      expect(quality.noiseLevel).toBeGreaterThanOrEqual(0);
      expect(quality.noiseLevel).toBeLessThanOrEqual(100);
      expect(quality.clarity).toBeGreaterThanOrEqual(0);
      expect(quality.clarity).toBeLessThanOrEqual(100);
      expect(quality.overallScore).toBeGreaterThanOrEqual(0);
      expect(quality.overallScore).toBeLessThanOrEqual(100);
    });

    it('should handle empty audio buffer', async () => {
      const audioBuffer = Buffer.alloc(0);

      const quality = await monitor.analyzeAudio(audioBuffer);

      expect(quality.signalStrength).toBe(50); // Default value
      expect(quality.noiseLevel).toBe(30);     // Default low noise
      expect(quality.clarity).toBe(60);        // Default moderate clarity
    });

    it('should handle corrupted audio buffer gracefully', async () => {
      const audioBuffer = Buffer.from('not audio data');

      const quality = await monitor.analyzeAudio(audioBuffer);

      // Should return default values without throwing
      expect(quality).toBeDefined();
      expect(typeof quality.overallScore).toBe('number');
    });
  });

  describe('getQualityRating', () => {
    it('should return correct rating for excellent quality', () => {
      const quality = {
        signalStrength: 90,
        noiseLevel: 10,
        clarity: 95,
        overallScore: 85
      };

      const rating = monitor.getQualityRating(quality);
      expect(rating).toBe('excellent');
    });

    it('should return correct rating for good quality', () => {
      const quality = {
        signalStrength: 70,
        noiseLevel: 25,
        clarity: 75,
        overallScore: 65
      };

      const rating = monitor.getQualityRating(quality);
      expect(rating).toBe('good');
    });

    it('should return correct rating for fair quality', () => {
      const quality = {
        signalStrength: 50,
        noiseLevel: 50,
        clarity: 55,
        overallScore: 45
      };

      const rating = monitor.getQualityRating(quality);
      expect(rating).toBe('fair');
    });

    it('should return correct rating for poor quality', () => {
      const quality = {
        signalStrength: 20,
        noiseLevel: 80,
        clarity: 25,
        overallScore: 25
      };

      const rating = monitor.getQualityRating(quality);
      expect(rating).toBe('poor');
    });
  });

  describe('generateQualityReport', () => {
    it('should generate report for good quality audio', () => {
      const quality = {
        signalStrength: 80,
        noiseLevel: 20,
        clarity: 85,
        overallScore: 75
      };

      const report = monitor.generateQualityReport(quality);

      expect(report).toContain('good');
      expect(report).toContain('75/100');
      expect(report).not.toContain('Issues detected');
    });

    it('should generate report with issues for poor quality audio', () => {
      const quality = {
        signalStrength: 30, // Below fair threshold (40)
        noiseLevel: 60,     // Above fair threshold (50)
        clarity: 35,        // Below fair threshold (50)
        overallScore: 35
      };

      const report = monitor.generateQualityReport(quality);

      expect(report).toContain('poor');
      expect(report).toContain('35/100');
      expect(report).toContain('Issues detected');
      expect(report).toContain('weak signal');
      expect(report).toContain('high noise');
      expect(report).toContain('poor clarity');
    });
  });

  describe('getSuggestions', () => {
    it('should provide suggestions for weak signal', () => {
      const quality = {
        signalStrength: 30,
        noiseLevel: 20,
        clarity: 70,
        overallScore: 50
      };

      const suggestions = monitor.getSuggestions(quality);

      expect(suggestions).toContain('Move closer to the microphone or increase input volume');
    });

    it('should provide suggestions for high noise', () => {
      const quality = {
        signalStrength: 80,
        noiseLevel: 70,
        clarity: 60,
        overallScore: 60
      };

      const suggestions = monitor.getSuggestions(quality);

      expect(suggestions).toContain('Reduce background noise or use noise cancellation');
    });

    it('should provide suggestions for poor clarity', () => {
      const quality = {
        signalStrength: 80,
        noiseLevel: 20,
        clarity: 40,
        overallScore: 60
      };

      const suggestions = monitor.getSuggestions(quality);

      expect(suggestions).toContain('Speak more clearly and at a steady pace');
    });

    it('should provide hardware suggestions for very poor quality', () => {
      const quality = {
        signalStrength: 20,
        noiseLevel: 80,
        clarity: 25,
        overallScore: 30
      };

      const suggestions = monitor.getSuggestions(quality);

      expect(suggestions).toContain('Consider using a better microphone or headset');
    });

    it('should return empty suggestions for excellent quality', () => {
      const quality = {
        signalStrength: 90,
        noiseLevel: 10,
        clarity: 95,
        overallScore: 90
      };

      const suggestions = monitor.getSuggestions(quality);

      expect(suggestions).toHaveLength(0);
    });
  });
});
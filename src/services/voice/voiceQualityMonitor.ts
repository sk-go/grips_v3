import { VoiceQuality, VoiceError } from '../../types/voice';
import { logger } from '../../utils/logger';

export class VoiceQualityMonitor {
  private qualityThresholds = {
    signalStrength: {
      excellent: 80,
      good: 60,
      fair: 40,
      poor: 20
    },
    noiseLevel: {
      excellent: 10,
      good: 25,
      fair: 50,
      poor: 75
    },
    clarity: {
      excellent: 85,
      good: 70,
      fair: 50,
      poor: 30
    }
  };

  async analyzeAudio(audioBuffer: Buffer): Promise<VoiceQuality> {
    try {
      // Basic audio analysis - in a production environment, you'd use more sophisticated audio processing
      const signalStrength = this.calculateSignalStrength(audioBuffer);
      const noiseLevel = this.calculateNoiseLevel(audioBuffer);
      const clarity = this.calculateClarity(audioBuffer, signalStrength, noiseLevel);
      const overallScore = this.calculateOverallScore(signalStrength, noiseLevel, clarity);

      const quality: VoiceQuality = {
        signalStrength,
        noiseLevel,
        clarity,
        overallScore
      };

      // Log quality metrics for monitoring
      if (overallScore < 40) {
        logger.warn('Poor voice quality detected', quality);
      }

      return quality;

    } catch (error) {
      logger.error('Audio quality analysis failed', error);
      
      // Return default quality metrics on error
      return {
        signalStrength: 50,
        noiseLevel: 50,
        clarity: 50,
        overallScore: 50
      };
    }
  }

  private calculateSignalStrength(audioBuffer: Buffer): number {
    try {
      // Convert buffer to 16-bit PCM samples
      const samples = this.bufferToSamples(audioBuffer);
      
      if (samples.length === 0) {
        return 50; // Default value for empty buffer
      }
      
      // Calculate RMS (Root Mean Square) for signal strength
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }
      
      const rms = Math.sqrt(sumSquares / samples.length);
      
      // Normalize to 0-100 scale (assuming 16-bit audio)
      const normalizedRms = (rms / 32768) * 100;
      
      // Apply logarithmic scaling for better representation
      const signalStrength = Math.min(100, Math.max(0, Math.log10(normalizedRms + 1) * 50));
      
      return Math.round(signalStrength);
      
    } catch (error) {
      logger.error('Signal strength calculation failed', error);
      return 50; // Default value
    }
  }

  private calculateNoiseLevel(audioBuffer: Buffer): number {
    try {
      const samples = this.bufferToSamples(audioBuffer);
      
      if (samples.length <= 1) {
        return 30; // Default low noise for empty/minimal buffer
      }
      
      // Calculate noise using high-frequency content analysis
      let highFreqEnergy = 0;
      let totalEnergy = 0;
      
      // Simple high-pass filter approximation
      for (let i = 1; i < samples.length; i++) {
        const diff = samples[i] - samples[i - 1];
        highFreqEnergy += diff * diff;
        totalEnergy += samples[i] * samples[i];
      }
      
      // Noise ratio (higher ratio = more noise)
      const noiseRatio = totalEnergy > 0 ? highFreqEnergy / totalEnergy : 0;
      
      // Convert to 0-100 scale (inverted - higher noise = higher score)
      const noiseLevel = Math.min(100, Math.max(0, noiseRatio * 100));
      
      return Math.round(noiseLevel);
      
    } catch (error) {
      logger.error('Noise level calculation failed', error);
      return 30; // Default low noise
    }
  }

  private calculateClarity(audioBuffer: Buffer, signalStrength: number, noiseLevel: number): number {
    try {
      const samples = this.bufferToSamples(audioBuffer);
      
      // Calculate spectral centroid as a measure of clarity
      let weightedSum = 0;
      let magnitudeSum = 0;
      
      // Simple spectral analysis
      for (let i = 0; i < samples.length - 1; i++) {
        const magnitude = Math.abs(samples[i]);
        weightedSum += magnitude * i;
        magnitudeSum += magnitude;
      }
      
      const spectralCentroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
      
      // Normalize spectral centroid to clarity score
      const normalizedCentroid = Math.min(100, (spectralCentroid / samples.length) * 200);
      
      // Combine with signal strength and inverse noise level
      const clarity = (normalizedCentroid * 0.4) + (signalStrength * 0.4) + ((100 - noiseLevel) * 0.2);
      
      return Math.round(Math.min(100, Math.max(0, clarity)));
      
    } catch (error) {
      logger.error('Clarity calculation failed', error);
      return 60; // Default moderate clarity
    }
  }

  private calculateOverallScore(signalStrength: number, noiseLevel: number, clarity: number): number {
    // Weighted average with emphasis on clarity and signal strength
    const weights = {
      signalStrength: 0.35,
      noiseLevel: 0.25, // Inverted (lower noise = better)
      clarity: 0.40
    };
    
    const score = (
      (signalStrength * weights.signalStrength) +
      ((100 - noiseLevel) * weights.noiseLevel) +
      (clarity * weights.clarity)
    );
    
    return Math.round(Math.min(100, Math.max(0, score)));
  }

  private bufferToSamples(buffer: Buffer): number[] {
    const samples: number[] = [];
    
    // Assume 16-bit PCM audio
    for (let i = 0; i < buffer.length - 1; i += 2) {
      // Convert little-endian 16-bit to signed integer
      const sample = buffer.readInt16LE(i);
      samples.push(sample);
    }
    
    return samples;
  }

  public getQualityRating(quality: VoiceQuality): string {
    const score = quality.overallScore;
    
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'fair';
    return 'poor';
  }

  public generateQualityReport(quality: VoiceQuality): string {
    const rating = this.getQualityRating(quality);
    const issues: string[] = [];
    
    if (quality.signalStrength < this.qualityThresholds.signalStrength.fair) {
      issues.push('weak signal');
    }
    
    if (quality.noiseLevel > this.qualityThresholds.noiseLevel.fair) {
      issues.push('high noise');
    }
    
    if (quality.clarity < this.qualityThresholds.clarity.fair) {
      issues.push('poor clarity');
    }
    
    let report = `Voice quality: ${rating} (${quality.overallScore}/100)`;
    
    if (issues.length > 0) {
      report += `. Issues detected: ${issues.join(', ')}`;
    }
    
    return report;
  }

  public getSuggestions(quality: VoiceQuality): string[] {
    const suggestions: string[] = [];
    
    if (quality.signalStrength < this.qualityThresholds.signalStrength.good) {
      suggestions.push('Move closer to the microphone or increase input volume');
    }
    
    if (quality.noiseLevel > this.qualityThresholds.noiseLevel.good) {
      suggestions.push('Reduce background noise or use noise cancellation');
    }
    
    if (quality.clarity < this.qualityThresholds.clarity.good) {
      suggestions.push('Speak more clearly and at a steady pace');
    }
    
    if (quality.overallScore < 40) {
      suggestions.push('Consider using a better microphone or headset');
    }
    
    return suggestions;
  }
}
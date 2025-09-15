export interface VoiceSession {
  id: string;
  agentId: string;
  isActive: boolean;
  startTime: Date;
  endTime?: Date;
  quality: VoiceQuality;
  language: string;
  context?: any;
}

export interface VoiceQuality {
  signalStrength: number; // 0-100
  noiseLevel: number; // 0-100
  clarity: number; // 0-100
  overallScore: number; // 0-100
}

export interface VoiceInput {
  sessionId: string;
  audio: Buffer;
  timestamp: Date;
  source: 'browser' | 'assemblyai';
  quality?: VoiceQuality;
}

export interface VoiceOutput {
  sessionId: string;
  text: string;
  audio?: Buffer;
  timestamp: Date;
  source: 'elevenlabs' | 'browser';
}

export interface SpeechRecognitionResult {
  text: string;
  confidence: number;
  isFinal: boolean;
  alternatives?: Array<{
    text: string;
    confidence: number;
  }>;
}

export interface TextToSpeechRequest {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  language?: string;
}

export interface VoiceProcessingConfig {
  assemblyAI: {
    apiKey: string;
    model: string;
    language: string;
  };
  elevenLabs: {
    apiKey: string;
    voiceId: string;
    model: string;
  };
  quality: {
    minSignalStrength: number;
    maxNoiseLevel: number;
    minClarity: number;
  };
  fallback: {
    enableBrowserSpeech: boolean;
    enableAssemblyAIFallback: boolean;
  };
}

export interface VoiceError {
  type: 'recognition' | 'synthesis' | 'quality' | 'network' | 'config';
  message: string;
  code?: string;
  sessionId?: string;
  timestamp: Date;
}
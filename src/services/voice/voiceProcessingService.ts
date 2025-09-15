import axios from 'axios';
import FormData from 'form-data';
import { VoiceInput, VoiceOutput, SpeechRecognitionResult, TextToSpeechRequest, VoiceProcessingConfig } from '../../types/voice';
import { logger } from '../../utils/logger';

export class VoiceProcessingService {
  private config: VoiceProcessingConfig;

  constructor() {
    this.config = {
      assemblyAI: {
        apiKey: process.env.ASSEMBLYAI_API_KEY || '',
        model: 'best',
        language: 'en'
      },
      elevenLabs: {
        apiKey: process.env.ELEVENLABS_API_KEY || '',
        voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Default voice
        model: 'eleven_monolingual_v1'
      },
      quality: {
        minSignalStrength: 30,
        maxNoiseLevel: 70,
        minClarity: 40
      },
      fallback: {
        enableBrowserSpeech: true,
        enableAssemblyAIFallback: true
      }
    };
  }

  async processVoiceInput(voiceInput: VoiceInput): Promise<SpeechRecognitionResult> {
    try {
      // Check voice quality first
      if (!this.isQualityAcceptable(voiceInput.quality)) {
        logger.warn(`Poor voice quality detected for session ${voiceInput.sessionId}`, voiceInput.quality);
      }

      // Try AssemblyAI for speech recognition
      if (this.config.assemblyAI.apiKey && this.config.fallback.enableAssemblyAIFallback) {
        try {
          return await this.processWithAssemblyAI(voiceInput);
        } catch (error) {
          logger.error('AssemblyAI processing failed, falling back to browser speech recognition', error);
          // Fallback: Return placeholder for browser-based processing
          return {
            text: '',
            confidence: 0,
            isFinal: false,
            alternatives: []
          };
        }
      }

      // Fallback: Return placeholder for browser-based processing
      // In a real implementation, this would be handled on the client side
      return {
        text: '',
        confidence: 0,
        isFinal: false,
        alternatives: []
      };

    } catch (error) {
      logger.error('Voice input processing failed', error);
      throw new Error('Failed to process voice input');
    }
  }

  private async processWithAssemblyAI(voiceInput: VoiceInput): Promise<SpeechRecognitionResult> {
    try {
      // First, upload the audio file
      const uploadResponse = await this.uploadAudioToAssemblyAI(voiceInput.audio);
      const audioUrl = uploadResponse.upload_url;

      // Then, create a transcription job
      const transcriptionResponse = await axios.post(
        'https://api.assemblyai.com/v2/transcript',
        {
          audio_url: audioUrl,
          language_code: this.config.assemblyAI.language,
          model: this.config.assemblyAI.model,
          punctuate: true,
          format_text: true
        },
        {
          headers: {
            'Authorization': this.config.assemblyAI.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const transcriptId = transcriptionResponse.data.id;

      // Poll for completion
      const result = await this.pollAssemblyAITranscription(transcriptId);

      return {
        text: result.text || '',
        confidence: result.confidence || 0,
        isFinal: true,
        alternatives: result.words ? result.words.map((word: any) => ({
          text: word.text,
          confidence: word.confidence
        })) : []
      };

    } catch (error) {
      logger.error('AssemblyAI processing error', error);
      throw error;
    }
  }

  private async uploadAudioToAssemblyAI(audioBuffer: Buffer): Promise<any> {
    const formData = new FormData();
    formData.append('audio', audioBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav'
    });

    const response = await axios.post('https://api.assemblyai.com/v2/upload', formData, {
      headers: {
        'Authorization': this.config.assemblyAI.apiKey,
        ...formData.getHeaders()
      }
    });

    return response.data;
  }

  private async pollAssemblyAITranscription(transcriptId: string): Promise<any> {
    const maxAttempts = 30; // 30 seconds max wait
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: {
            'Authorization': this.config.assemblyAI.apiKey
          }
        }
      );

      const status = response.data.status;

      if (status === 'completed') {
        return response.data;
      } else if (status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${response.data.error}`);
      }

      // Wait 1 second before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error('AssemblyAI transcription timeout');
  }

  async synthesizeSpeech(request: TextToSpeechRequest): Promise<VoiceOutput> {
    try {
      if (!this.config.elevenLabs.apiKey) {
        throw new Error('ElevenLabs API key not configured');
      }

      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.config.elevenLabs.voiceId}`,
        {
          text: request.text,
          model_id: this.config.elevenLabs.model,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5,
            style: 0.0,
            use_speaker_boost: true
          }
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.config.elevenLabs.apiKey
          },
          responseType: 'arraybuffer'
        }
      );

      return {
        sessionId: '', // Will be set by caller
        text: request.text,
        audio: Buffer.from(response.data),
        timestamp: new Date(),
        source: 'elevenlabs'
      };

    } catch (error) {
      logger.error('ElevenLabs TTS error', error);
      throw new Error('Failed to synthesize speech');
    }
  }

  private isQualityAcceptable(quality?: any): boolean {
    if (!quality) return true; // Assume acceptable if no quality data

    return (
      quality.signalStrength >= this.config.quality.minSignalStrength &&
      quality.noiseLevel <= this.config.quality.maxNoiseLevel &&
      quality.clarity >= this.config.quality.minClarity
    );
  }

  public updateConfig(newConfig: Partial<VoiceProcessingConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): VoiceProcessingConfig {
    return { ...this.config };
  }
}
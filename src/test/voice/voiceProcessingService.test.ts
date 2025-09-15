import { VoiceProcessingService } from '../../services/voice/voiceProcessingService';
import { VoiceInput, TextToSpeechRequest } from '../../types/voice';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('VoiceProcessingService', () => {
  let service: VoiceProcessingService;
  let mockAudioBuffer: Buffer;

  beforeEach(() => {
    service = new VoiceProcessingService();
    mockAudioBuffer = Buffer.from('mock audio data');
    jest.clearAllMocks();
  });

  describe('processVoiceInput', () => {
    it('should process voice input with AssemblyAI when API key is configured', async () => {
      // Mock environment variable
      process.env.ASSEMBLYAI_API_KEY = 'test-api-key';

      // Mock FormData constructor and methods
      const mockFormData = {
        append: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' })
      };
      
      // Mock AssemblyAI responses
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { upload_url: 'https://mock-upload-url.com/audio.wav' }
        })
        .mockResolvedValueOnce({
          data: { id: 'transcript-123' }
        });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          status: 'completed',
          text: 'Hello world',
          confidence: 0.95,
          words: [
            { text: 'Hello', confidence: 0.98 },
            { text: 'world', confidence: 0.92 }
          ]
        }
      });

      const voiceInput: VoiceInput = {
        sessionId: 'test-session',
        audio: mockAudioBuffer,
        timestamp: new Date(),
        source: 'browser',
        quality: {
          signalStrength: 80,
          noiseLevel: 20,
          clarity: 85,
          overallScore: 82
        }
      };

      const result = await service.processVoiceInput(voiceInput);

      expect(result.text).toBe('Hello world');
      expect(result.confidence).toBe(0.95);
      expect(result.isFinal).toBe(true);
      expect(result.alternatives).toHaveLength(2);
    });

    it('should handle AssemblyAI errors gracefully', async () => {
      process.env.ASSEMBLYAI_API_KEY = 'test-api-key';

      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      const voiceInput: VoiceInput = {
        sessionId: 'test-session',
        audio: mockAudioBuffer,
        timestamp: new Date(),
        source: 'browser'
      };

      const result = await service.processVoiceInput(voiceInput);

      // Should fallback to browser processing
      expect(result.text).toBe('');
      expect(result.confidence).toBe(0);
      expect(result.isFinal).toBe(false);
    });

    it('should handle poor quality audio', async () => {
      const voiceInput: VoiceInput = {
        sessionId: 'test-session',
        audio: mockAudioBuffer,
        timestamp: new Date(),
        source: 'browser',
        quality: {
          signalStrength: 20, // Poor signal
          noiseLevel: 80,     // High noise
          clarity: 30,        // Poor clarity
          overallScore: 25    // Poor overall
        }
      };

      // Should still process but log warning
      const result = await service.processVoiceInput(voiceInput);
      expect(result).toBeDefined();
    });
  });

  describe('synthesizeSpeech', () => {
    it('should synthesize speech with ElevenLabs', async () => {
      process.env.ELEVENLABS_API_KEY = 'test-api-key';
      process.env.ELEVENLABS_VOICE_ID = 'test-voice-id';

      const mockAudioData = Buffer.from('mock audio response');
      mockedAxios.post.mockResolvedValueOnce({
        data: mockAudioData
      });

      const request: TextToSpeechRequest = {
        text: 'Hello, how can I help you today?',
        voice: 'professional',
        language: 'en-US'
      };

      const result = await service.synthesizeSpeech(request);

      expect(result.text).toBe(request.text);
      expect(result.audio).toEqual(mockAudioData);
      expect(result.source).toBe('elevenlabs');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('elevenlabs.io'),
        expect.objectContaining({
          text: request.text,
          model_id: 'eleven_monolingual_v1'
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'xi-api-key': 'test-api-key'
          })
        })
      );
    });

    it('should throw error when ElevenLabs API key is not configured', async () => {
      // Create a new service instance without API key
      const serviceWithoutKey = new VoiceProcessingService();
      serviceWithoutKey.updateConfig({
        elevenLabs: {
          apiKey: '',
          voiceId: 'test-voice',
          model: 'test-model'
        }
      });

      const request: TextToSpeechRequest = {
        text: 'Hello world'
      };

      await expect(serviceWithoutKey.synthesizeSpeech(request)).rejects.toThrow(
        'ElevenLabs API key not configured'
      );
    });

    it('should handle ElevenLabs API errors', async () => {
      process.env.ELEVENLABS_API_KEY = 'test-api-key';

      mockedAxios.post.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const request: TextToSpeechRequest = {
        text: 'Hello world'
      };

      await expect(service.synthesizeSpeech(request)).rejects.toThrow(
        'Failed to synthesize speech'
      );
    });
  });

  describe('configuration management', () => {
    it('should update configuration', () => {
      const newConfig = {
        quality: {
          minSignalStrength: 50,
          maxNoiseLevel: 60,
          minClarity: 70
        }
      };

      service.updateConfig(newConfig);
      const config = service.getConfig();

      expect(config.quality.minSignalStrength).toBe(50);
      expect(config.quality.maxNoiseLevel).toBe(60);
      expect(config.quality.minClarity).toBe(70);
    });

    it('should return current configuration', () => {
      const config = service.getConfig();

      expect(config).toHaveProperty('assemblyAI');
      expect(config).toHaveProperty('elevenLabs');
      expect(config).toHaveProperty('quality');
      expect(config).toHaveProperty('fallback');
    });
  });
});
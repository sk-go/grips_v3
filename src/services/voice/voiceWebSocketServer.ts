import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { VoiceSession, VoiceInput, VoiceOutput, VoiceError } from '../../types/voice';
import { logger } from '../../utils/logger';
import { VoiceProcessingService } from './voiceProcessingService';
import { VoiceQualityMonitor } from './voiceQualityMonitor';

export class VoiceWebSocketServer {
  private io: SocketIOServer;
  private activeSessions: Map<string, VoiceSession> = new Map();
  private voiceProcessor: VoiceProcessingService;
  private qualityMonitor: VoiceQualityMonitor;

  constructor(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    this.voiceProcessor = new VoiceProcessingService();
    this.qualityMonitor = new VoiceQualityMonitor();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info(`Voice WebSocket client connected: ${socket.id}`);

      socket.on('voice_session_start', async (data: { agentId: string, language?: string }) => {
        try {
          const session = await this.startVoiceSession(socket.id, data.agentId, data.language);
          socket.emit('voice_session_started', { sessionId: session.id });
          logger.info(`Voice session started: ${session.id} for agent: ${data.agentId}`);
        } catch (error) {
          this.handleError(socket, 'Failed to start voice session', error);
        }
      });

      socket.on('voice_input', async (data: { audio: ArrayBuffer, sessionId: string }) => {
        try {
          const session = this.activeSessions.get(data.sessionId);
          if (!session) {
            throw new Error('Invalid session ID');
          }

          const audioBuffer = Buffer.from(data.audio);
          const quality = await this.qualityMonitor.analyzeAudio(audioBuffer);
          
          const voiceInput: VoiceInput = {
            sessionId: data.sessionId,
            audio: audioBuffer,
            timestamp: new Date(),
            source: 'browser',
            quality
          };

          // Update session quality
          session.quality = quality;
          this.activeSessions.set(data.sessionId, session);

          // Process voice input
          const result = await this.voiceProcessor.processVoiceInput(voiceInput);
          
          socket.emit('voice_recognition_result', {
            sessionId: data.sessionId,
            text: result.text,
            confidence: result.confidence,
            isFinal: result.isFinal,
            quality: quality
          });

          // If recognition is final, trigger AI processing
          if (result.isFinal) {
            socket.emit('voice_processing_complete', {
              sessionId: data.sessionId,
              text: result.text,
              confidence: result.confidence
            });
          }

        } catch (error) {
          this.handleError(socket, 'Voice input processing failed', error);
        }
      });

      socket.on('text_to_speech', async (data: { text: string, sessionId: string, voice?: string }) => {
        try {
          const session = this.activeSessions.get(data.sessionId);
          if (!session) {
            throw new Error('Invalid session ID');
          }

          const voiceOutput = await this.voiceProcessor.synthesizeSpeech({
            text: data.text,
            voice: data.voice,
            language: session.language
          });

          socket.emit('voice_output', {
            sessionId: data.sessionId,
            audio: voiceOutput.audio,
            text: data.text,
            timestamp: new Date()
          });

        } catch (error) {
          this.handleError(socket, 'Text-to-speech failed', error);
        }
      });

      socket.on('voice_session_end', async (data: { sessionId: string }) => {
        try {
          await this.endVoiceSession(data.sessionId);
          socket.emit('voice_session_ended', { sessionId: data.sessionId });
          logger.info(`Voice session ended: ${data.sessionId}`);
        } catch (error) {
          this.handleError(socket, 'Failed to end voice session', error);
        }
      });

      socket.on('disconnect', () => {
        logger.info(`Voice WebSocket client disconnected: ${socket.id}`);
        // Clean up any active sessions for this socket
        this.cleanupSocketSessions(socket.id);
      });
    });
  }

  private async startVoiceSession(socketId: string, agentId: string, language: string = 'en-US'): Promise<VoiceSession> {
    const session: VoiceSession = {
      id: `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentId,
      isActive: true,
      startTime: new Date(),
      quality: {
        signalStrength: 0,
        noiseLevel: 0,
        clarity: 0,
        overallScore: 0
      },
      language,
      context: { socketId }
    };

    this.activeSessions.set(session.id, session);
    return session;
  }

  private async endVoiceSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isActive = false;
      session.endTime = new Date();
      this.activeSessions.delete(sessionId);
      
      // Log session metrics
      const duration = session.endTime.getTime() - session.startTime.getTime();
      logger.info(`Voice session ${sessionId} ended. Duration: ${duration}ms, Quality: ${session.quality.overallScore}`);
    }
  }

  private cleanupSocketSessions(socketId: string): void {
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.context?.socketId === socketId) {
        this.endVoiceSession(sessionId);
      }
    }
  }

  private handleError(socket: any, message: string, error: any): void {
    logger.error(`Voice WebSocket error: ${message}`, error);
    
    const voiceError: VoiceError = {
      type: 'network',
      message,
      timestamp: new Date()
    };

    socket.emit('voice_error', voiceError);
  }

  public getActiveSessions(): VoiceSession[] {
    return Array.from(this.activeSessions.values());
  }

  public getSessionById(sessionId: string): VoiceSession | undefined {
    return this.activeSessions.get(sessionId);
  }
}
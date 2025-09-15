export { VoiceWebSocketServer } from './voiceWebSocketServer';
export { VoiceProcessingService } from './voiceProcessingService';
export { VoiceQualityMonitor } from './voiceQualityMonitor';
export { VoiceErrorHandler } from './voiceErrorHandler';

import { VoiceWebSocketServer } from './voiceWebSocketServer';
import { VoiceProcessingService } from './voiceProcessingService';
import { VoiceQualityMonitor } from './voiceQualityMonitor';
import { VoiceErrorHandler } from './voiceErrorHandler';
import { Server as HTTPServer } from 'http';

export class VoiceService {
  private webSocketServer: VoiceWebSocketServer;
  private processingService: VoiceProcessingService;
  private qualityMonitor: VoiceQualityMonitor;
  private errorHandler: VoiceErrorHandler;

  constructor(httpServer: HTTPServer) {
    this.processingService = new VoiceProcessingService();
    this.qualityMonitor = new VoiceQualityMonitor();
    this.errorHandler = new VoiceErrorHandler();
    this.webSocketServer = new VoiceWebSocketServer(httpServer);
  }

  public getWebSocketServer(): VoiceWebSocketServer {
    return this.webSocketServer;
  }

  public getProcessingService(): VoiceProcessingService {
    return this.processingService;
  }

  public getQualityMonitor(): VoiceQualityMonitor {
    return this.qualityMonitor;
  }

  public getErrorHandler(): VoiceErrorHandler {
    return this.errorHandler;
  }

  public getActiveSessions() {
    return this.webSocketServer.getActiveSessions();
  }

  public getSessionById(sessionId: string) {
    return this.webSocketServer.getSessionById(sessionId);
  }
}
import express from 'express';
import multer from 'multer';
import { VoiceService } from '../services/voice';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = express.Router();

// Configure multer for audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

let voiceService: VoiceService;

export function initializeVoiceRoutes(service: VoiceService) {
  voiceService = service;
}

// Get voice processing configuration
router.get('/config', authenticateToken, (req, res) => {
  try {
    const config = voiceService.getProcessingService().getConfig();
    
    // Remove sensitive information
    const publicConfig = {
      quality: config.quality,
      fallback: config.fallback,
      assemblyAI: {
        model: config.assemblyAI.model,
        language: config.assemblyAI.language
      },
      elevenLabs: {
        model: config.elevenLabs.model
      }
    };

    res.json(publicConfig);
  } catch (error: any) {
    logger.error('Failed to get voice config', error);
    res.status(500).json({ error: 'Failed to get voice configuration' });
  }
});

// Update voice processing configuration
router.put('/config', authenticateToken, (req, res) => {
  try {
    const { quality, fallback, language } = req.body;
    
    const updates: any = {};
    
    if (quality) {
      updates.quality = quality;
    }
    
    if (fallback) {
      updates.fallback = fallback;
    }
    
    if (language) {
      updates.assemblyAI = { language };
    }

    voiceService.getProcessingService().updateConfig(updates);
    
    res.json({ message: 'Configuration updated successfully' });
  } catch (error: any) {
    logger.error('Failed to update voice config', error);
    res.status(500).json({ error: 'Failed to update voice configuration' });
  }
});

// Process audio file for speech recognition
router.post('/recognize', authenticateToken, upload.single('audio'), async (req, res): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No audio file provided' });
      return;
    }

    const { sessionId, language } = req.body;
    
    const voiceInput: any = {
      sessionId: sessionId || 'api_request',
      audio: req.file.buffer,
      timestamp: new Date(),
      source: 'browser' as const
    };

    // Analyze audio quality
    const quality = await voiceService.getQualityMonitor().analyzeAudio(req.file.buffer);
    voiceInput.quality = quality;

    // Process speech recognition
    const result = await voiceService.getProcessingService().processVoiceInput(voiceInput);

    res.json({
      text: result.text,
      confidence: result.confidence,
      isFinal: result.isFinal,
      alternatives: result.alternatives,
      quality: quality,
      qualityReport: voiceService.getQualityMonitor().generateQualityReport(quality)
    });

  } catch (error: any) {
    const voiceError = voiceService.getErrorHandler().handleError(error, {
      type: 'recognition'
    });

    logger.error('Speech recognition failed', error);
    res.status(500).json({
      error: voiceService.getErrorHandler().generateUserFriendlyMessage(voiceError),
      suggestions: voiceService.getErrorHandler().generateRecoveryActions(voiceError)
    });
  }
});

// Synthesize text to speech
router.post('/synthesize', authenticateToken, async (req, res): Promise<void> => {
  try {
    const { text, voice, speed, pitch, language } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    const request = {
      text,
      voice,
      speed,
      pitch,
      language
    };

    const result = await voiceService.getProcessingService().synthesizeSpeech(request);

    // Set appropriate headers for audio response
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': result.audio?.length.toString() || '0',
      'Cache-Control': 'no-cache'
    });

    res.send(result.audio);

  } catch (error: any) {
    const voiceError = voiceService.getErrorHandler().handleError(error, {
      type: 'synthesis'
    });

    logger.error('Text-to-speech failed', error);
    res.status(500).json({
      error: voiceService.getErrorHandler().generateUserFriendlyMessage(voiceError),
      suggestions: voiceService.getErrorHandler().generateRecoveryActions(voiceError)
    });
  }
});

// Get active voice sessions
router.get('/sessions', authenticateToken, (req, res) => {
  try {
    const sessions = voiceService.getActiveSessions();
    res.json(sessions);
  } catch (error: any) {
    logger.error('Failed to get voice sessions', error);
    res.status(500).json({ error: 'Failed to get voice sessions' });
  }
});

// Get specific voice session
router.get('/sessions/:sessionId', authenticateToken, (req, res): void => {
  try {
    const { sessionId } = req.params;
    const session = voiceService.getSessionById(sessionId);
    
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(session);
  } catch (error: any) {
    logger.error('Failed to get voice session', error);
    res.status(500).json({ error: 'Failed to get voice session' });
  }
});

// Get voice quality analysis for audio
router.post('/quality', authenticateToken, upload.single('audio'), async (req, res): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No audio file provided' });
      return;
    }

    const quality = await voiceService.getQualityMonitor().analyzeAudio(req.file.buffer);
    const report = voiceService.getQualityMonitor().generateQualityReport(quality);
    const suggestions = voiceService.getQualityMonitor().getSuggestions(quality);

    res.json({
      quality,
      report,
      suggestions,
      rating: voiceService.getQualityMonitor().getQualityRating(quality)
    });

  } catch (error: any) {
    logger.error('Voice quality analysis failed', error);
    res.status(500).json({ error: 'Failed to analyze voice quality' });
  }
});

// Get error statistics
router.get('/errors/stats', authenticateToken, (req, res) => {
  try {
    const stats = voiceService.getErrorHandler().getErrorStats();
    res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get error stats', error);
    res.status(500).json({ error: 'Failed to get error statistics' });
  }
});

// Clear error history
router.delete('/errors', authenticateToken, (req, res) => {
  try {
    voiceService.getErrorHandler().clearErrorHistory();
    res.json({ message: 'Error history cleared' });
  } catch (error: any) {
    logger.error('Failed to clear error history', error);
    res.status(500).json({ error: 'Failed to clear error history' });
  }
});

export default router;
import express from 'express';
import { NLPService } from '../services/nlp';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = express.Router();

let nlpService: NLPService;

export function initializeNLPRoutes(service: NLPService) {
  nlpService = service;
}

// Process text with NLP
router.post('/process', authenticateToken, async (req, res) => {
  try {
    const { text, sessionId, language, context } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const request = {
      text,
      sessionId,
      language,
      context
    };

    const result = await nlpService.processText(request);

    return res.json(result);

  } catch (error: any) {
    logger.error('NLP processing failed', error);
    return res.status(500).json({ 
      error: 'Failed to process text',
      message: error.message 
    });
  }
});

// Extract tasks from text
router.post('/extract-tasks', authenticateToken, async (req, res) => {
  try {
    const { text, entities = [], context } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const tasks = nlpService.getTaskExtractor().extractTasks(text, entities, context);

    return res.json({ tasks });

  } catch (error: any) {
    logger.error('Task extraction failed', error);
    return res.status(500).json({ 
      error: 'Failed to extract tasks',
      message: error.message 
    });
  }
});

// Get conversation context
router.get('/context/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { agentId, clientId } = req.query;

    const context = await nlpService.getContextAggregator().getContext(
      sessionId,
      agentId as string || 'unknown',
      clientId as string
    );

    return res.json(context);

  } catch (error: any) {
    logger.error('Failed to get context', error);
    return res.status(500).json({ 
      error: 'Failed to get conversation context',
      message: error.message 
    });
  }
});

// Update conversation context
router.post('/context/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, additionalData } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    await nlpService.getContextAggregator().updateContext(sessionId, message, additionalData);

    return res.json({ success: true });

  } catch (error: any) {
    logger.error('Failed to update context', error);
    return res.status(500).json({ 
      error: 'Failed to update conversation context',
      message: error.message 
    });
  }
});

// Get context summary
router.get('/context/:sessionId/summary', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const summary = await nlpService.getContextAggregator().getContextSummary(sessionId);

    res.json({ summary });

  } catch (error: any) {
    logger.error('Failed to get context summary', error);
    res.status(500).json({ 
      error: 'Failed to get context summary',
      message: error.message 
    });
  }
});

// Clear conversation context
router.delete('/context/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;

    await nlpService.getContextAggregator().clearContext(sessionId);

    res.json({ success: true });

  } catch (error: any) {
    logger.error('Failed to clear context', error);
    res.status(500).json({ 
      error: 'Failed to clear conversation context',
      message: error.message 
    });
  }
});

// Semantic search
router.post('/search', authenticateToken, async (req, res) => {
  try {
    const { query, limit = 10, threshold = 0.7, filters = {} } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const results = await nlpService.getVectorSearch().search({
      query,
      limit,
      threshold,
      filters
    });

    return res.json({ results });

  } catch (error: any) {
    logger.error('Semantic search failed', error);
    return res.status(500).json({ 
      error: 'Semantic search failed',
      message: error.message 
    });
  }
});

// Index document for search
router.post('/index', authenticateToken, async (req, res) => {
  try {
    const { id, content, metadata = {} } = req.body;

    if (!id || !content) {
      return res.status(400).json({ error: 'ID and content are required' });
    }

    // Generate embedding
    const embedding = await nlpService.getClaudeClient().generateEmbedding(content);
    
    await nlpService.getVectorSearch().indexDocument(id, content, embedding, metadata);

    return res.json({ success: true, id });

  } catch (error: any) {
    logger.error('Document indexing failed', error);
    return res.status(500).json({ 
      error: 'Failed to index document',
      message: error.message 
    });
  }
});

// Find similar documents
router.get('/similar/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { limit = 5, threshold = 0.8 } = req.query;

    const results = await nlpService.getVectorSearch().findSimilarDocuments(
      documentId,
      parseInt(limit as string),
      parseFloat(threshold as string)
    );

    res.json({ results });

  } catch (error: any) {
    logger.error('Similar document search failed', error);
    res.status(500).json({ 
      error: 'Failed to find similar documents',
      message: error.message 
    });
  }
});

// Test Claude API connection
router.get('/test-connection', authenticateToken, async (req, res) => {
  try {
    const isConnected = await nlpService.getClaudeClient().testConnection();

    res.json({ 
      connected: isConnected,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Claude connection test failed', error);
    res.status(500).json({ 
      error: 'Connection test failed',
      message: error.message 
    });
  }
});

// Get NLP processing statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await nlpService.getStats();

    res.json(stats);

  } catch (error: any) {
    logger.error('Failed to get NLP stats', error);
    res.status(500).json({ 
      error: 'Failed to get processing statistics',
      message: error.message 
    });
  }
});

// Get NLP configuration
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const config = nlpService.getProcessor().getConfig();
    
    // Remove sensitive information
    const publicConfig = {
      languages: config.languages,
      sentiment: config.sentiment,
      taskExtraction: config.taskExtraction,
      vectorSearch: {
        enabled: config.vectorSearch.enabled,
        dimensions: config.vectorSearch.dimensions,
        similarityThreshold: config.vectorSearch.similarityThreshold
      },
      claude: {
        model: config.claude.model,
        temperature: config.claude.temperature,
        maxTokens: config.claude.maxTokens,
        costThreshold: config.claude.costThreshold
      },
      grok: config.grok ? {
        model: config.grok.model,
        temperature: config.grok.temperature,
        maxTokens: config.grok.maxTokens
      } : null
    };

    res.json(publicConfig);

  } catch (error: any) {
    logger.error('Failed to get NLP config', error);
    res.status(500).json({ 
      error: 'Failed to get configuration',
      message: error.message 
    });
  }
});

// Update NLP configuration
router.put('/config', authenticateToken, async (req, res) => {
  try {
    const updates = req.body;
    
    nlpService.getProcessor().updateConfig(updates);
    
    res.json({ success: true });

  } catch (error: any) {
    logger.error('Failed to update NLP config', error);
    res.status(500).json({ 
      error: 'Failed to update configuration',
      message: error.message 
    });
  }
});

export default router;
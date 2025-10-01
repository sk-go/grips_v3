import express from 'express';
import { ConfigurationService } from '../services/configuration/configurationService';
import { authMiddleware } from '../middleware/auth';
import { body, validationResult } from 'express-validator';

const router = express.Router();

// Get all user configurations
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const configurations = await ConfigurationService.getAllConfigurations(userId);
    res.json(configurations);
  } catch (error) {
    console.error('Error getting configurations:', error);
    res.status(500).json({ error: 'Failed to get configurations' });
  }
});

// Get specific configuration type
router.get('/:type', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { type } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const configuration = await ConfigurationService.getConfiguration(userId, type);
    res.json(configuration);
  } catch (error) {
    console.error('Error getting configuration:', error);
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

// Update configuration
router.put('/:type', [
  authMiddleware,
  body('data').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    const { type } = req.params;
    const { data } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const configuration = await ConfigurationService.updateConfiguration(userId, type, data);
    res.json(configuration);
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Get feature toggles
router.get('/features/toggles', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const featureToggles = await ConfigurationService.getFeatureToggles(userId);
    res.json(featureToggles);
  } catch (error) {
    console.error('Error getting feature toggles:', error);
    res.status(500).json({ error: 'Failed to get feature toggles' });
  }
});

// Update feature toggle
router.put('/features/:feature', [
  authMiddleware,
  body('enabled').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    const { feature } = req.params;
    const { enabled } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await ConfigurationService.updateFeatureToggle(userId, feature, enabled);
    res.json(result);
  } catch (error) {
    console.error('Error updating feature toggle:', error);
    res.status(500).json({ error: 'Failed to update feature toggle' });
  }
});

// Get approval gates configuration
router.get('/approval/gates', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const approvalGates = await ConfigurationService.getApprovalGates(userId);
    res.json(approvalGates);
  } catch (error) {
    console.error('Error getting approval gates:', error);
    res.status(500).json({ error: 'Failed to get approval gates' });
  }
});

// Update approval gates
router.put('/approval/gates', [
  authMiddleware,
  body('gates').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    const { gates } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await ConfigurationService.updateApprovalGates(userId, gates);
    res.json(result);
  } catch (error) {
    console.error('Error updating approval gates:', error);
    res.status(500).json({ error: 'Failed to update approval gates' });
  }
});

// Get language configuration
router.get('/language/settings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const languageSettings = await ConfigurationService.getLanguageSettings(userId);
    res.json(languageSettings);
  } catch (error) {
    console.error('Error getting language settings:', error);
    res.status(500).json({ error: 'Failed to get language settings' });
  }
});

// Update language configuration
router.put('/language/settings', [
  authMiddleware,
  body('language').isString(),
  body('dialect').optional().isString(),
  body('aiModel').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    const { language, dialect, aiModel } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await ConfigurationService.updateLanguageSettings(userId, {
      language,
      dialect,
      aiModel
    });
    res.json(result);
  } catch (error) {
    console.error('Error updating language settings:', error);
    res.status(500).json({ error: 'Failed to update language settings' });
  }
});

// Get accessibility settings
router.get('/accessibility/settings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const accessibilitySettings = await ConfigurationService.getAccessibilitySettings(userId);
    res.json(accessibilitySettings);
  } catch (error) {
    console.error('Error getting accessibility settings:', error);
    res.status(500).json({ error: 'Failed to get accessibility settings' });
  }
});

// Update accessibility settings
router.put('/accessibility/settings', [
  authMiddleware,
  body('settings').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    const { settings } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await ConfigurationService.updateAccessibilitySettings(userId, settings);
    res.json(result);
  } catch (error) {
    console.error('Error updating accessibility settings:', error);
    res.status(500).json({ error: 'Failed to update accessibility settings' });
  }
});

// Get available languages and dialects
router.get('/language/available', async (req, res) => {
  try {
    const availableLanguages = await ConfigurationService.getAvailableLanguages();
    res.json(availableLanguages);
  } catch (error) {
    console.error('Error getting available languages:', error);
    res.status(500).json({ error: 'Failed to get available languages' });
  }
});

// Reset configuration to defaults
router.post('/reset/:type', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { type } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await ConfigurationService.resetConfiguration(userId, type);
    res.json(result);
  } catch (error) {
    console.error('Error resetting configuration:', error);
    res.status(500).json({ error: 'Failed to reset configuration' });
  }
});

export default router;
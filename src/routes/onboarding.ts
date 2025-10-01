import express from 'express';
import { OnboardingService } from '../services/onboarding/onboardingService';
import { authMiddleware } from '../middleware/auth';
import { body, validationResult } from 'express-validator';

const router = express.Router();

// Get onboarding status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const status = await OnboardingService.getOnboardingStatus(userId);
    res.json(status);
  } catch (error) {
    console.error('Error getting onboarding status:', error);
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
});

// Start onboarding process
router.post('/start', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const onboardingSession = await OnboardingService.startOnboarding(userId);
    res.json(onboardingSession);
  } catch (error) {
    console.error('Error starting onboarding:', error);
    res.status(500).json({ error: 'Failed to start onboarding' });
  }
});

// Configure email accounts
router.post('/email-config', [
  authMiddleware,
  body('provider').isIn(['gmail', 'outlook', 'exchange']),
  body('email').isEmail(),
  body('displayName').notEmpty(),
  body('oauthToken').optional(),
  body('imapSettings').optional().isObject(),
  body('smtpSettings').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const emailConfig = await OnboardingService.configureEmailAccount(userId, req.body);
    res.json(emailConfig);
  } catch (error) {
    console.error('Error configuring email account:', error);
    res.status(500).json({ error: 'Failed to configure email account' });
  }
});

// Configure Twilio integration
router.post('/twilio-config', [
  authMiddleware,
  body('accountSid').notEmpty(),
  body('authToken').notEmpty(),
  body('phoneNumber').notEmpty(),
  body('webhookUrl').optional().isURL(),
  body('officeHours').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const twilioConfig = await OnboardingService.configureTwilioIntegration(userId, req.body);
    res.json(twilioConfig);
  } catch (error) {
    console.error('Error configuring Twilio integration:', error);
    res.status(500).json({ error: 'Failed to configure Twilio integration' });
  }
});

// Configure CRM connection
router.post('/crm-config', [
  authMiddleware,
  body('crmSystem').isIn(['zoho', 'salesforce', 'hubspot', 'agencybloc']),
  body('apiCredentials').isObject(),
  body('syncSettings').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const crmConfig = await OnboardingService.configureCrmConnection(userId, req.body);
    res.json(crmConfig);
  } catch (error) {
    console.error('Error configuring CRM connection:', error);
    res.status(500).json({ error: 'Failed to configure CRM connection' });
  }
});

// Complete onboarding step
router.post('/complete-step', [
  authMiddleware,
  body('step').isIn(['email', 'twilio', 'crm', 'preferences']),
  body('data').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await OnboardingService.completeStep(userId, req.body.step, req.body.data);
    res.json(result);
  } catch (error) {
    console.error('Error completing onboarding step:', error);
    res.status(500).json({ error: 'Failed to complete onboarding step' });
  }
});

// Finish onboarding
router.post('/finish', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await OnboardingService.finishOnboarding(userId);
    res.json(result);
  } catch (error) {
    console.error('Error finishing onboarding:', error);
    res.status(500).json({ error: 'Failed to finish onboarding' });
  }
});

export default router;
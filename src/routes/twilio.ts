import { Router, Request, Response } from 'express';
import { TwilioService } from '../services/twilio/twilioService';
import { OfficeHoursService } from '../services/twilio/officeHoursService';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const officeHoursSchema = Joi.object({
  timezone: Joi.string().required(),
  monday: Joi.object({
    isWorkingDay: Joi.boolean().required(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    breaks: Joi.array().items(Joi.object({
      startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
      endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    })).optional(),
  }).required(),
  tuesday: Joi.object({
    isWorkingDay: Joi.boolean().required(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    breaks: Joi.array().items(Joi.object({
      startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
      endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    })).optional(),
  }).required(),
  wednesday: Joi.object({
    isWorkingDay: Joi.boolean().required(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    breaks: Joi.array().items(Joi.object({
      startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
      endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    })).optional(),
  }).required(),
  thursday: Joi.object({
    isWorkingDay: Joi.boolean().required(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    breaks: Joi.array().items(Joi.object({
      startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
      endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    })).optional(),
  }).required(),
  friday: Joi.object({
    isWorkingDay: Joi.boolean().required(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    breaks: Joi.array().items(Joi.object({
      startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
      endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    })).optional(),
  }).required(),
  saturday: Joi.object({
    isWorkingDay: Joi.boolean().required(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    breaks: Joi.array().items(Joi.object({
      startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
      endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    })).optional(),
  }).required(),
  sunday: Joi.object({
    isWorkingDay: Joi.boolean().required(),
    startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    breaks: Joi.array().items(Joi.object({
      startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
      endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    })).optional(),
  }).required(),
  holidays: Joi.array().items(Joi.date()).default([]),
  isActive: Joi.boolean().default(true),
});

const sendSmsSchema = Joi.object({
  to: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  body: Joi.string().max(1600).required(),
  from: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
});

const makeCallSchema = Joi.object({
  to: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  from: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
});

// Initialize services (these would be injected in a real app)
let twilioService: TwilioService;
let officeHoursService: OfficeHoursService;

// Middleware to ensure services are initialized
const ensureServices = (req: Request, res: Response, next: any): void => {
  if (!twilioService || !officeHoursService) {
    res.status(500).json({ error: 'Twilio services not initialized' });
    return;
  }
  next();
};

// Webhook endpoints (no auth required - Twilio calls these)
router.post('/voice', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!twilioService) {
      res.status(500).send('Service not initialized');
      return;
    }

    const twiml = await twilioService.handleIncomingCall(req.body);
    res.type('text/xml').send(twiml);
  } catch (error) {
    logger.error('Voice webhook error:', error);
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Error processing call</Say></Response>');
  }
});

router.post('/sms', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!twilioService) {
      res.status(500).send('Service not initialized');
      return;
    }

    const twiml = await twilioService.handleIncomingSms(req.body);
    res.type('text/xml').send(twiml);
  } catch (error) {
    logger.error('SMS webhook error:', error);
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

router.post('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!twilioService) {
      res.status(200).send('OK');
      return;
    }

    await twilioService.handleCallStatus(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Status webhook error:', error);
    res.status(200).send('OK'); // Always return OK to Twilio
  }
});

router.post('/recording', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!twilioService) {
      res.status(200).send('OK');
      return;
    }

    await twilioService.handleRecording(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Recording webhook error:', error);
    res.status(200).send('OK'); // Always return OK to Twilio
  }
});

router.post('/transcription', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!twilioService) {
      res.status(200).send('OK');
      return;
    }

    await twilioService.handleTranscription(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Transcription webhook error:', error);
    res.status(200).send('OK'); // Always return OK to Twilio
  }
});

// Authenticated endpoints
router.get('/office-hours', authMiddleware, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const officeHours = await officeHoursService.getOfficeHours(userId);
    
    if (!officeHours) {
      // Return default office hours
      const defaultHours = officeHoursService.getDefaultOfficeHours();
      res.json(defaultHours);
      return;
    }
    
    res.json(officeHours);
  } catch (error) {
    logger.error('Get office hours error:', error);
    res.status(500).json({ error: 'Failed to get office hours' });
  }
});

router.post('/office-hours', authMiddleware, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = officeHoursSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }

    const userId = (req as any).user.id;
    const officeHours = await officeHoursService.setOfficeHours(userId, value);
    
    res.json(officeHours);
  } catch (error) {
    logger.error('Set office hours error:', error);
    res.status(500).json({ error: 'Failed to set office hours' });
  }
});

router.get('/office-hours/status', authMiddleware, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const timestamp = req.query.timestamp ? new Date(req.query.timestamp as string) : new Date();
    
    const isWithinHours = await officeHoursService.isWithinOfficeHours(userId, timestamp);
    const nextBusinessHours = await officeHoursService.getNextBusinessHours(userId, timestamp);
    
    res.json({
      isWithinOfficeHours: isWithinHours,
      nextBusinessHours,
      currentTime: timestamp,
    });
  } catch (error) {
    logger.error('Office hours status error:', error);
    res.status(500).json({ error: 'Failed to check office hours status' });
  }
});

router.get('/office-hours/status', authMiddleware, ensureServices, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const timestamp = req.query.timestamp ? new Date(req.query.timestamp as string) : new Date();
    
    const isWithinHours = await officeHoursService.isWithinOfficeHours(userId, timestamp);
    const nextBusinessHours = await officeHoursService.getNextBusinessHours(userId, timestamp);
    
    res.json({
      isWithinOfficeHours: isWithinHours,
      nextBusinessHours,
      currentTime: timestamp,
    });
  } catch (error) {
    logger.error('Office hours status error:', error);
    res.status(500).json({ error: 'Failed to check office hours status' });
  }
});

router.post('/sms/send', authMiddleware, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = sendSmsSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }

    const sms = await twilioService.sendSms(value.to, value.body, value.from);
    res.json(sms);
  } catch (error) {
    logger.error('Send SMS error:', error);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

router.post('/call/make', authMiddleware, ensureServices, async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = makeCallSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }

    const call = await twilioService.makeCall(value.to, value.from);
    res.json(call);
  } catch (error) {
    logger.error('Make call error:', error);
    res.status(500).json({ error: 'Failed to make call' });
  }
});

// Initialize services function (to be called from main app)
export const initializeTwilioServices = (
  twilioServiceInstance: TwilioService,
  officeHoursServiceInstance: OfficeHoursService
) => {
  twilioService = twilioServiceInstance;
  officeHoursService = officeHoursServiceInstance;
};

export default router;
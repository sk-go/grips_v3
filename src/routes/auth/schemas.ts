import Joi from 'joi';

// Shared validation schemas for auth routes
export const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  role: Joi.string().valid('agent', 'admin').default('agent'),
  // CAPTCHA fields
  captchaToken: Joi.string().optional(),
  // Accessibility fallback fields
  accessibilityChallenge: Joi.object({
    id: Joi.string().required(),
    answer: Joi.string().required()
  }).optional()
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

export const resendVerificationSchema = Joi.object({
  email: Joi.string().email().required()
});

export const rejectionSchema = Joi.object({
  reason: Joi.string().min(1).max(500).required()
});
/**
 * Email Verification Services
 * 
 * This module provides comprehensive email verification functionality including:
 * - Secure token generation and validation
 * - Email template management and sending
 * - Rate limiting and security measures
 * - Automatic cleanup of expired tokens
 */

export {
  EmailVerificationService,
  type EmailVerificationToken,
  type TokenValidationResult,
  type RegistrationSettings
} from '../emailVerificationService';

export {
  VerificationTokenService,
  type VerificationAttemptResult,
  type VerificationRateLimitConfig
} from '../verificationTokenService';

export {
  EmailNotificationService,
  type EmailVerificationData,
  type PasswordResetEmailData,
  type PasswordChangeNotificationData
} from '../email/emailNotificationService';

// Re-export commonly used types for convenience
export type {
  RateLimitResult,
  RateLimitConfig
} from '../rateLimitingService';
import * as nodemailer from 'nodemailer';
import { logger } from '../../utils/logger';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

interface PasswordResetEmailData {
  email: string;
  firstName: string;
  resetToken: string;
  resetUrl: string;
  expiresAt: Date;
}

interface PasswordChangeNotificationData {
  email: string;
  firstName: string;
  changeTime: Date;
  ipAddress?: string;
}

interface EmailVerificationData {
  email: string;
  firstName: string;
  lastName: string;
  verificationToken: string;
  verificationUrl: string;
  expiresAt: Date;
}

interface RegistrationApprovalData {
  email: string;
  firstName: string;
  lastName: string;
  loginUrl: string;
}

interface RegistrationRejectionData {
  email: string;
  firstName: string;
  lastName: string;
  reason: string;
  supportEmail: string;
}

class EmailNotificationService {
  private transporter: nodemailer.Transporter | null = null;
  private isInitialized = false;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    try {
      const config: EmailConfig = {
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || ''
        }
      };

      // Validate required configuration
      if (!config.auth.user || !config.auth.pass) {
        logger.warn('SMTP credentials not configured. Email notifications will be disabled.');
        return;
      }

      this.transporter = nodemailer.createTransport(config);
      this.isInitialized = true;

      logger.info('Email notification service initialized', {
        host: config.host,
        port: config.port,
        secure: config.secure
      });
    } catch (error) {
      logger.error('Failed to initialize email transporter:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Check if email service is properly configured and ready to send emails
   */
  public isReady(): boolean {
    return this.isInitialized && this.transporter !== null;
  }

  /**
   * Send password reset email to user
   */
  public async sendPasswordResetEmail(data: PasswordResetEmailData): Promise<void> {
    if (!this.isReady()) {
      logger.warn('Email service not ready, skipping password reset email', { email: data.email });
      return;
    }

    try {
      const template = this.generatePasswordResetTemplate(data);
      
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: data.email,
        subject: template.subject,
        text: template.text,
        html: template.html
      };

      const result = await this.transporter!.sendMail(mailOptions);
      
      logger.info('Password reset email sent successfully', {
        email: data.email,
        messageId: result.messageId,
        expiresAt: data.expiresAt.toISOString()
      });
    } catch (error) {
      logger.error('Failed to send password reset email:', error, { email: data.email });
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Send password change notification email
   */
  public async sendPasswordChangeNotification(data: PasswordChangeNotificationData): Promise<void> {
    if (!this.isReady()) {
      logger.warn('Email service not ready, skipping password change notification', { email: data.email });
      return;
    }

    try {
      const template = this.generatePasswordChangeTemplate(data);
      
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: data.email,
        subject: template.subject,
        text: template.text,
        html: template.html
      };

      const result = await this.transporter!.sendMail(mailOptions);
      
      logger.info('Password change notification sent successfully', {
        email: data.email,
        messageId: result.messageId,
        changeTime: data.changeTime.toISOString()
      });
    } catch (error) {
      logger.error('Failed to send password change notification:', error, { email: data.email });
      // Don't throw error for notifications - they're not critical
    }
  }

  /**
   * Send email verification email to user
   */
  public async sendVerificationEmail(data: EmailVerificationData): Promise<void> {
    if (!this.isReady()) {
      logger.warn('Email service not ready, skipping email verification', { email: data.email });
      throw new Error('Email service not configured');
    }

    try {
      const template = this.generateEmailVerificationTemplate(data);
      
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: data.email,
        subject: template.subject,
        text: template.text,
        html: template.html
      };

      const result = await this.transporter!.sendMail(mailOptions);
      
      logger.info('Email verification sent successfully', {
        email: data.email,
        messageId: result.messageId,
        expiresAt: data.expiresAt.toISOString()
      });
    } catch (error) {
      logger.error('Failed to send email verification:', error, { email: data.email });
      throw new Error('Failed to send verification email');
    }
  }

  /**
   * Send email verification resend notification
   */
  public async sendVerificationResendEmail(data: EmailVerificationData): Promise<void> {
    if (!this.isReady()) {
      logger.warn('Email service not ready, skipping verification resend', { email: data.email });
      throw new Error('Email service not configured');
    }

    try {
      const template = this.generateEmailVerificationResendTemplate(data);
      
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: data.email,
        subject: template.subject,
        text: template.text,
        html: template.html
      };

      const result = await this.transporter!.sendMail(mailOptions);
      
      logger.info('Email verification resend sent successfully', {
        email: data.email,
        messageId: result.messageId,
        expiresAt: data.expiresAt.toISOString()
      });
    } catch (error) {
      logger.error('Failed to send verification resend email:', error, { email: data.email });
      throw new Error('Failed to send verification resend email');
    }
  }

  /**
   * Generate password reset email template
   */
  private generatePasswordResetTemplate(data: PasswordResetEmailData): EmailTemplate {
    const appName = process.env.APP_NAME || 'Relationship Care Platform';
    const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    const expiryMinutes = Math.ceil((data.expiresAt.getTime() - Date.now()) / (1000 * 60));

    const subject = `Password Reset Request - ${appName}`;

    const text = `
Hello ${data.firstName},

You have requested to reset your password for ${appName}.

To reset your password, please click on the following link or copy and paste it into your browser:
${data.resetUrl}

This link will expire in ${expiryMinutes} minutes for security reasons.

If you did not request this password reset, please ignore this email. Your password will remain unchanged.

For security reasons, please do not share this link with anyone.

If you need assistance, please contact our support team at ${supportEmail}.

Best regards,
${appName} Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset Request</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .content { background-color: #ffffff; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .button:hover { background-color: #0056b3; }
        .warning { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; font-size: 14px; color: #6c757d; }
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0; color: #007bff;">${appName}</h1>
        <p style="margin: 10px 0 0 0;">Password Reset Request</p>
    </div>
    
    <div class="content">
        <h2>Hello ${data.firstName},</h2>
        
        <p>You have requested to reset your password for ${appName}.</p>
        
        <p>To reset your password, please click the button below:</p>
        
        <a href="${data.resetUrl}" class="button">Reset Password</a>
        
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace;">
            ${data.resetUrl}
        </p>
        
        <div class="warning">
            <strong>Important:</strong> This link will expire in ${expiryMinutes} minutes for security reasons.
        </div>
        
        <p>If you did not request this password reset, please ignore this email. Your password will remain unchanged.</p>
        
        <p>For security reasons, please do not share this link with anyone.</p>
    </div>
    
    <div class="footer">
        <p>If you need assistance, please contact our support team at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
        <p>Best regards,<br>${appName} Team</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  /**
   * Generate password change notification template
   */
  private generatePasswordChangeTemplate(data: PasswordChangeNotificationData): EmailTemplate {
    const appName = process.env.APP_NAME || 'Relationship Care Platform';
    const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    const changeTimeFormatted = data.changeTime.toLocaleString();

    const subject = `Password Changed - ${appName}`;

    const text = `
Hello ${data.firstName},

Your password for ${appName} has been successfully changed.

Change Details:
- Time: ${changeTimeFormatted}
${data.ipAddress ? `- IP Address: ${data.ipAddress}` : ''}

If you made this change, no further action is required.

If you did not change your password, please contact our support team immediately at ${supportEmail} as your account may have been compromised.

For your security, we recommend:
- Using a strong, unique password
- Enabling two-factor authentication if available
- Regularly reviewing your account activity

Best regards,
${appName} Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Changed</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .content { background-color: #ffffff; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px; }
        .success { background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 4px; margin: 20px 0; color: #155724; }
        .warning { background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 4px; margin: 20px 0; color: #721c24; }
        .details { background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; font-size: 14px; color: #6c757d; }
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0; color: #28a745;">${appName}</h1>
        <p style="margin: 10px 0 0 0;">Password Changed Successfully</p>
    </div>
    
    <div class="content">
        <h2>Hello ${data.firstName},</h2>
        
        <div class="success">
            <strong>✓ Password Changed:</strong> Your password for ${appName} has been successfully changed.
        </div>
        
        <div class="details">
            <h3>Change Details:</h3>
            <ul>
                <li><strong>Time:</strong> ${changeTimeFormatted}</li>
                ${data.ipAddress ? `<li><strong>IP Address:</strong> ${data.ipAddress}</li>` : ''}
            </ul>
        </div>
        
        <p>If you made this change, no further action is required.</p>
        
        <div class="warning">
            <strong>⚠ Didn't make this change?</strong> If you did not change your password, please contact our support team immediately as your account may have been compromised.
        </div>
        
        <h3>Security Recommendations:</h3>
        <ul>
            <li>Use a strong, unique password</li>
            <li>Enable two-factor authentication if available</li>
            <li>Regularly review your account activity</li>
        </ul>
    </div>
    
    <div class="footer">
        <p>If you need assistance, please contact our support team at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
        <p>Best regards,<br>${appName} Team</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  /**
   * Generate email verification template
   */
  private generateEmailVerificationTemplate(data: EmailVerificationData): EmailTemplate {
    const appName = process.env.APP_NAME || 'Relationship Care Platform';
    const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    const expiryMinutes = Math.ceil((data.expiresAt.getTime() - Date.now()) / (1000 * 60));

    const subject = `Verify Your Email Address - ${appName}`;

    const text = `
Hello ${data.firstName} ${data.lastName},

Welcome to ${appName}! To complete your registration, please verify your email address.

To verify your email, please click on the following link or copy and paste it into your browser:
${data.verificationUrl}

This link will expire in ${expiryMinutes} minutes for security reasons.

If you did not create an account with us, please ignore this email.

If you need assistance, please contact our support team at ${supportEmail}.

Best regards,
${appName} Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email Address</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
        .content { background-color: #ffffff; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #28a745; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; font-weight: bold; }
        .button:hover { background-color: #218838; }
        .info { background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 4px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; font-size: 14px; color: #6c757d; }
        .welcome { background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 4px; margin: 20px 0; color: #155724; }
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0; color: #28a745;">${appName}</h1>
        <p style="margin: 10px 0 0 0; font-size: 18px;">Welcome! Please verify your email</p>
    </div>
    
    <div class="content">
        <div class="welcome">
            <h2 style="margin-top: 0;">Hello ${data.firstName} ${data.lastName}!</h2>
            <p style="margin-bottom: 0;">Welcome to ${appName}! We're excited to have you on board.</p>
        </div>
        
        <p>To complete your registration and start using your account, please verify your email address by clicking the button below:</p>
        
        <div style="text-align: center;">
            <a href="${data.verificationUrl}" class="button">Verify Email Address</a>
        </div>
        
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace;">
            ${data.verificationUrl}
        </p>
        
        <div class="info">
            <strong>Important:</strong> This verification link will expire in ${expiryMinutes} minutes for security reasons.
        </div>
        
        <p>If you did not create an account with us, please ignore this email and no account will be created.</p>
        
        <h3>What's Next?</h3>
        <p>Once you verify your email, you'll be able to:</p>
        <ul>
            <li>Access your personalized dashboard</li>
            <li>Manage client relationships</li>
            <li>Use our AI-powered communication tools</li>
            <li>Generate documents and reports</li>
        </ul>
    </div>
    
    <div class="footer">
        <p>If you need assistance, please contact our support team at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
        <p>Best regards,<br>${appName} Team</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  /**
   * Generate email verification resend template
   */
  private generateEmailVerificationResendTemplate(data: EmailVerificationData): EmailTemplate {
    const appName = process.env.APP_NAME || 'Relationship Care Platform';
    const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    const expiryMinutes = Math.ceil((data.expiresAt.getTime() - Date.now()) / (1000 * 60));

    const subject = `Email Verification Link (Resent) - ${appName}`;

    const text = `
Hello ${data.firstName} ${data.lastName},

You requested a new email verification link for your ${appName} account.

To verify your email, please click on the following link or copy and paste it into your browser:
${data.verificationUrl}

This link will expire in ${expiryMinutes} minutes for security reasons.

If you did not request this verification link, please ignore this email.

If you continue to have trouble verifying your email, please contact our support team at ${supportEmail}.

Best regards,
${appName} Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Verification Link (Resent)</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
        .content { background-color: #ffffff; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; font-weight: bold; }
        .button:hover { background-color: #0056b3; }
        .info { background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 4px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; font-size: 14px; color: #6c757d; }
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0; color: #007bff;">${appName}</h1>
        <p style="margin: 10px 0 0 0; font-size: 18px;">New Verification Link</p>
    </div>
    
    <div class="content">
        <h2>Hello ${data.firstName} ${data.lastName},</h2>
        
        <p>You requested a new email verification link for your ${appName} account.</p>
        
        <p>To verify your email address, please click the button below:</p>
        
        <div style="text-align: center;">
            <a href="${data.verificationUrl}" class="button">Verify Email Address</a>
        </div>
        
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace;">
            ${data.verificationUrl}
        </p>
        
        <div class="info">
            <strong>Note:</strong> This verification link will expire in ${expiryMinutes} minutes for security reasons.
        </div>
        
        <p>If you did not request this verification link, please ignore this email.</p>
        
        <p>If you continue to have trouble verifying your email, please don't hesitate to contact our support team.</p>
    </div>
    
    <div class="footer">
        <p>If you need assistance, please contact our support team at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
        <p>Best regards,<br>${appName} Team</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  /**
   * Generate registration approval template
   */
  private generateRegistrationApprovalTemplate(data: RegistrationApprovalData): EmailTemplate {
    const appName = process.env.APP_NAME || 'Relationship Care Platform';
    const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;

    const subject = `Registration Approved - Welcome to ${appName}!`;

    const text = `
Hello ${data.firstName} ${data.lastName},

Great news! Your registration for ${appName} has been approved by our administrators.

You can now log in to your account and start using all the features:
${data.loginUrl}

Welcome to the team! We're excited to have you on board.

If you need any assistance getting started, please contact our support team at ${supportEmail}.

Best regards,
${appName} Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Registration Approved</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #d4edda; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; border: 1px solid #c3e6cb; }
        .content { background-color: #ffffff; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #28a745; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; font-weight: bold; }
        .button:hover { background-color: #218838; }
        .success { background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 4px; margin: 20px 0; color: #155724; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; font-size: 14px; color: #6c757d; }
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0; color: #28a745;">${appName}</h1>
        <p style="margin: 10px 0 0 0; font-size: 18px; color: #155724;">🎉 Registration Approved!</p>
    </div>
    
    <div class="content">
        <div class="success">
            <h2 style="margin-top: 0;">Hello ${data.firstName} ${data.lastName}!</h2>
            <p style="margin-bottom: 0;"><strong>Great news!</strong> Your registration for ${appName} has been approved by our administrators.</p>
        </div>
        
        <p>You can now log in to your account and start using all the powerful features we have to offer:</p>
        
        <div style="text-align: center;">
            <a href="${data.loginUrl}" class="button">Log In to Your Account</a>
        </div>
        
        <h3>What You Can Do Now:</h3>
        <ul>
            <li>Access your personalized dashboard</li>
            <li>Manage client relationships and communications</li>
            <li>Use AI-powered tools for enhanced productivity</li>
            <li>Generate documents and reports</li>
            <li>Integrate with your existing CRM systems</li>
        </ul>
        
        <p><strong>Welcome to the team!</strong> We're excited to have you on board and look forward to helping you enhance your client relationships.</p>
        
        <p>If you need any assistance getting started or have questions about using the platform, please don't hesitate to reach out to our support team.</p>
    </div>
    
    <div class="footer">
        <p>If you need assistance, please contact our support team at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
        <p>Best regards,<br>${appName} Team</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  /**
   * Generate registration rejection template
   */
  private generateRegistrationRejectionTemplate(data: RegistrationRejectionData): EmailTemplate {
    const appName = process.env.APP_NAME || 'Relationship Care Platform';

    const subject = `Registration Update - ${appName}`;

    const text = `
Hello ${data.firstName} ${data.lastName},

Thank you for your interest in ${appName}.

After reviewing your registration, we are unable to approve your account at this time.

Reason: ${data.reason}

If you believe this decision was made in error or if you have additional information that might help us reconsider, please contact our support team at ${data.supportEmail}.

We appreciate your understanding.

Best regards,
${appName} Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Registration Update</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
        .content { background-color: #ffffff; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px; }
        .info { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; color: #856404; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; font-size: 14px; color: #6c757d; }
        .contact { background-color: #e2e3e5; border: 1px solid #d6d8db; padding: 15px; border-radius: 4px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0; color: #495057;">${appName}</h1>
        <p style="margin: 10px 0 0 0; font-size: 18px;">Registration Update</p>
    </div>
    
    <div class="content">
        <h2>Hello ${data.firstName} ${data.lastName},</h2>
        
        <p>Thank you for your interest in ${appName}.</p>
        
        <p>After reviewing your registration, we are unable to approve your account at this time.</p>
        
        <div class="info">
            <strong>Reason:</strong> ${data.reason}
        </div>
        
        <div class="contact">
            <h3 style="margin-top: 0;">Need to Discuss This Decision?</h3>
            <p style="margin-bottom: 0;">If you believe this decision was made in error or if you have additional information that might help us reconsider, please contact our support team at <a href="mailto:${data.supportEmail}">${data.supportEmail}</a>.</p>
        </div>
        
        <p>We appreciate your understanding and thank you for your interest in our platform.</p>
    </div>
    
    <div class="footer">
        <p>If you have questions, please contact our support team at <a href="mailto:${data.supportEmail}">${data.supportEmail}</a>.</p>
        <p>Best regards,<br>${appName} Team</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, text, html };
  }

  /**
   * Send registration approval email to user
   */
  public async sendRegistrationApprovalEmail(data: RegistrationApprovalData): Promise<void> {
    if (!this.isReady()) {
      logger.warn('Email service not ready, skipping registration approval email', { email: data.email });
      return;
    }

    try {
      const template = this.generateRegistrationApprovalTemplate(data);
      
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: data.email,
        subject: template.subject,
        text: template.text,
        html: template.html
      };

      await this.transporter!.sendMail(mailOptions);
      logger.info('Registration approval email sent successfully', { email: data.email });
    } catch (error) {
      logger.error('Failed to send registration approval email:', error);
      throw new Error('Failed to send registration approval email');
    }
  }

  /**
   * Send registration rejection email to user
   */
  public async sendRegistrationRejectionEmail(data: RegistrationRejectionData): Promise<void> {
    if (!this.isReady()) {
      logger.warn('Email service not ready, skipping registration rejection email', { email: data.email });
      return;
    }

    try {
      const template = this.generateRegistrationRejectionTemplate(data);
      
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: data.email,
        subject: template.subject,
        text: template.text,
        html: template.html
      };

      await this.transporter!.sendMail(mailOptions);
      logger.info('Registration rejection email sent successfully', { email: data.email });
    } catch (error) {
      logger.error('Failed to send registration rejection email:', error);
      throw new Error('Failed to send registration rejection email');
    }
  }

  /**
   * Test email configuration by sending a test email
   */
  public async testConfiguration(testEmail: string): Promise<boolean> {
    if (!this.isReady()) {
      return false;
    }

    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: testEmail,
        subject: 'Email Configuration Test',
        text: 'This is a test email to verify SMTP configuration.',
        html: '<p>This is a test email to verify SMTP configuration.</p>'
      };

      await this.transporter!.sendMail(mailOptions);
      logger.info('Test email sent successfully', { testEmail });
      return true;
    } catch (error) {
      logger.error('Test email failed:', error);
      return false;
    }
  }
}

export {
  EmailNotificationService,
  PasswordResetEmailData,
  PasswordChangeNotificationData,
  EmailVerificationData,
  RegistrationApprovalData,
  RegistrationRejectionData
};
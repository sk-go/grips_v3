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
  PasswordChangeNotificationData
};
import { EmailMessage } from '../../types/email';
import { logger } from '../../utils/logger';

export class EmailParser {
  private phoneRegex = /(\+?1?[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
  private emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  private dateRegex = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g;
  
  // Keywords for auto-tagging
  private urgentKeywords = [
    'urgent', 'emergency', 'asap', 'immediate', 'critical', 'important',
    'deadline', 'time sensitive', 'rush', 'priority'
  ];
  
  private followUpKeywords = [
    'follow up', 'next steps', 'action items', 'todo', 'reminder',
    'schedule', 'meeting', 'call back', 'get back to'
  ];
  
  private clientKeywords = [
    'policy', 'claim', 'premium', 'coverage', 'deductible', 'renewal',
    'quote', 'insurance', 'beneficiary', 'liability'
  ];

  public parseAndExtractMetadata(message: EmailMessage): EmailMessage {
    try {
      // Extract data from email content
      const content = this.getEmailContent(message);
      
      message.extractedData = {
        phoneNumbers: this.extractPhoneNumbers(content),
        emails: this.extractEmails(content),
        dates: this.extractDates(content),
        keywords: this.extractKeywords(content),
      };

      // Auto-tag based on content
      message.tags = this.generateAutoTags(message);

      // Calculate sentiment (basic implementation)
      message.sentiment = this.calculateSentiment(content);

      logger.debug(`Parsed email metadata for message: ${message.id}`);
      return message;
    } catch (error) {
      logger.error(`Failed to parse email metadata for ${message.id}:`, error);
      return message;
    }
  }

  private getEmailContent(message: EmailMessage): string {
    let content = '';
    
    if (message.subject) {
      content += message.subject + ' ';
    }
    
    if (message.body?.text) {
      content += message.body.text + ' ';
    }
    
    if (message.body?.html) {
      // Strip HTML tags for text analysis
      content += message.body.html.replace(/<[^>]*>/g, ' ');
    }
    
    return content.toLowerCase();
  }

  private extractPhoneNumbers(content: string): string[] {
    const matches = content.match(this.phoneRegex);
    return matches ? [...new Set(matches.map(match => match.trim()))] : [];
  }

  private extractEmails(content: string): string[] {
    const matches = content.match(this.emailRegex);
    return matches ? [...new Set(matches)] : [];
  }

  private extractDates(content: string): Date[] {
    const matches = content.match(this.dateRegex);
    if (!matches) return [];

    const dates: Date[] = [];
    for (const match of matches) {
      try {
        const date = new Date(match);
        if (!isNaN(date.getTime())) {
          dates.push(date);
        }
      } catch (error) {
        // Invalid date, skip
      }
    }
    
    return dates;
  }

  private extractKeywords(content: string): string[] {
    const words = content.split(/\s+/);
    const keywords: string[] = [];
    
    // Extract important business terms
    const businessTerms = [
      'policy', 'claim', 'premium', 'coverage', 'deductible', 'renewal',
      'quote', 'insurance', 'beneficiary', 'liability', 'auto', 'home',
      'life', 'health', 'business', 'commercial', 'personal'
    ];
    
    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
      if (businessTerms.includes(cleanWord) && !keywords.includes(cleanWord)) {
        keywords.push(cleanWord);
      }
    }
    
    return keywords;
  }

  private generateAutoTags(message: EmailMessage): string[] {
    const tags: string[] = [];
    const content = this.getEmailContent(message);
    
    // Check for urgent keywords
    if (this.urgentKeywords.some(keyword => content.includes(keyword))) {
      tags.push('urgent');
    }
    
    // Check for follow-up keywords
    if (this.followUpKeywords.some(keyword => content.includes(keyword))) {
      tags.push('follow-up');
    }
    
    // Check for client-related keywords
    if (this.clientKeywords.some(keyword => content.includes(keyword))) {
      tags.push('client-related');
    }
    
    // Tag based on sender domain
    if (message.from && message.from.length > 0) {
      const senderDomain = message.from[0].address.split('@')[1];
      if (senderDomain) {
        tags.push(`domain:${senderDomain}`);
      }
    }
    
    // Tag based on time of day
    const hour = message.date.getHours();
    if (hour < 9 || hour > 17) {
      tags.push('after-hours');
    }
    
    // Tag based on attachments
    if (message.attachments && message.attachments.length > 0) {
      tags.push('has-attachments');
    }
    
    return tags;
  }

  private calculateSentiment(content: string): number {
    // Basic sentiment analysis using word lists
    const positiveWords = [
      'good', 'great', 'excellent', 'wonderful', 'amazing', 'fantastic',
      'happy', 'pleased', 'satisfied', 'thank', 'thanks', 'appreciate',
      'love', 'perfect', 'awesome', 'brilliant', 'outstanding'
    ];
    
    const negativeWords = [
      'bad', 'terrible', 'awful', 'horrible', 'hate', 'angry', 'frustrated',
      'disappointed', 'upset', 'annoyed', 'problem', 'issue', 'complaint',
      'wrong', 'error', 'mistake', 'fail', 'broken', 'poor'
    ];
    
    const words = content.split(/\s+/);
    let positiveCount = 0;
    let negativeCount = 0;
    
    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
      if (positiveWords.includes(cleanWord)) {
        positiveCount++;
      } else if (negativeWords.includes(cleanWord)) {
        negativeCount++;
      }
    }
    
    const totalSentimentWords = positiveCount + negativeCount;
    if (totalSentimentWords === 0) {
      return 0; // Neutral
    }
    
    // Return sentiment score between -1 (negative) and 1 (positive)
    return (positiveCount - negativeCount) / totalSentimentWords;
  }

  public extractClientIdentifiers(message: EmailMessage, crmClients: any[]): string | null {
    try {
      const content = this.getEmailContent(message);
      const senderEmail = message.from?.[0]?.address?.toLowerCase();
      
      // Try to match by email address first
      if (senderEmail) {
        const clientByEmail = crmClients.find(client => 
          client.email?.toLowerCase() === senderEmail
        );
        if (clientByEmail) {
          return clientByEmail.id;
        }
      }
      
      // Try to match by phone number
      const phoneNumbers = this.extractPhoneNumbers(content);
      for (const phone of phoneNumbers) {
        const normalizedPhone = phone.replace(/\D/g, '');
        const clientByPhone = crmClients.find(client => {
          const clientPhone = client.phone?.replace(/\D/g, '');
          return clientPhone && clientPhone === normalizedPhone;
        });
        if (clientByPhone) {
          return clientByPhone.id;
        }
      }
      
      // Try to match by name in subject or content
      const senderName = message.from?.[0]?.name?.toLowerCase();
      if (senderName) {
        const clientByName = crmClients.find(client => {
          const clientName = client.name?.toLowerCase();
          return clientName && (
            senderName.includes(clientName) || 
            clientName.includes(senderName)
          );
        });
        if (clientByName) {
          return clientByName.id;
        }
      }
      
      return null;
    } catch (error) {
      logger.error(`Failed to extract client identifier from email ${message.id}:`, error);
      return null;
    }
  }
}
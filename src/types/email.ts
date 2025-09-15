export interface EmailAccount {
  id: string;
  userId: string;
  email: string;
  provider: 'gmail' | 'outlook' | 'exchange' | 'imap';
  imapConfig: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass?: string;
      accessToken?: string;
      refreshToken?: string;
    };
  };
  smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass?: string;
      accessToken?: string;
      refreshToken?: string;
    };
  };
  isActive: boolean;
  lastSyncAt?: Date;
  syncState?: {
    lastUid?: number;
    lastModSeq?: string;
    folderStates?: Record<string, any>;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailMessage {
  id: string;
  accountId: string;
  messageId: string;
  uid: number;
  threadId?: string;
  folder: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body: {
    text?: string;
    html?: string;
  };
  attachments?: EmailAttachment[];
  date: Date;
  flags: string[];
  isRead: boolean;
  isImportant: boolean;
  labels?: string[];
  clientId?: string; // Linked to CRM client
  tags: string[];
  sentiment?: number;
  extractedData?: {
    phoneNumbers?: string[];
    emails?: string[];
    dates?: Date[];
    keywords?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  isInline: boolean;
  data?: Buffer;
}

export interface EmailSyncResult {
  accountId: string;
  newMessages: number;
  updatedMessages: number;
  errors: string[];
  syncDuration: number;
  lastSyncAt: Date;
}

export interface EmailSearchQuery {
  accountId?: string;
  clientId?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  dateFrom?: Date;
  dateTo?: Date;
  hasAttachments?: boolean;
  isRead?: boolean;
  tags?: string[];
  folder?: string;
  limit?: number;
  offset?: number;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface EmailProviderConfig {
  gmail: {
    oauth: OAuthConfig;
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
  };
  outlook: {
    oauth: OAuthConfig;
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
  };
  exchange: {
    oauth: OAuthConfig;
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
  };
}
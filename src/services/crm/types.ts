/**
 * CRM Integration Types and Interfaces
 * Defines the contracts for CRM system integration
 */

import { Client, CrmSystem } from '../../types';

// ============================================================================
// Core CRM Interfaces
// ============================================================================

export interface CrmConfig {
  system: CrmSystem;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  baseUrl: string;
  apiVersion?: string;
}

export interface CrmAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType: string;
  scope?: string;
}

export interface CrmClient {
  id: string;
  name: string;
  email: string;
  phone: string;
  company?: string;
  address?: CrmAddress;
  customFields: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  lastActivity?: Date;
}

export interface CrmAddress {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

export interface CrmSyncResult {
  success: boolean;
  clientsProcessed: number;
  clientsUpdated: number;
  clientsCreated: number;
  errors: CrmSyncError[];
  lastSyncTime: Date;
  nextSyncTime?: Date;
}

export interface CrmSyncError {
  clientId?: string;
  error: string;
  code?: string;
  retryable: boolean;
}

export interface CrmApiResponse<T> {
  data: T;
  pagination?: CrmPagination;
  rateLimit?: CrmRateLimit;
}

export interface CrmPagination {
  page: number;
  pageSize: number;
  totalPages: number;
  totalRecords: number;
  hasNext: boolean;
  nextPageToken?: string;
}

export interface CrmRateLimit {
  remaining: number;
  limit: number;
  resetTime: Date;
}

// ============================================================================
// Abstract CRM Connector Interface
// ============================================================================

export interface ICrmConnector {
  readonly system: CrmSystem;
  readonly config: CrmConfig;
  
  // Authentication methods
  authenticate(authCode: string): Promise<CrmAuthTokens>;
  refreshToken(refreshToken: string): Promise<CrmAuthTokens>;
  validateToken(tokens: CrmAuthTokens): Promise<boolean>;
  
  // Client data methods
  getClients(options?: CrmQueryOptions): Promise<CrmApiResponse<CrmClient[]>>;
  getClient(clientId: string): Promise<CrmClient>;
  updateClient(clientId: string, data: Partial<CrmClient>): Promise<CrmClient>;
  createClient(data: Omit<CrmClient, 'id' | 'createdAt' | 'updatedAt'>): Promise<CrmClient>;
  
  // Sync methods
  syncClients(lastSyncTime?: Date): Promise<CrmSyncResult>;
  
  // Health check
  healthCheck(): Promise<boolean>;
}

export interface CrmQueryOptions {
  page?: number;
  pageSize?: number;
  modifiedSince?: Date;
  searchQuery?: string;
  fields?: string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// CRM System Specific Types
// ============================================================================

// Zoho CRM specific types
export interface ZohoCrmConfig extends CrmConfig {
  system: 'zoho';
  datacenter: 'us' | 'eu' | 'in' | 'au' | 'jp';
}

export interface ZohoCrmClient {
  id: string;
  Account_Name: string;
  Email: string;
  Phone: string;
  Mailing_Street?: string;
  Mailing_City?: string;
  Mailing_State?: string;
  Mailing_Code?: string;
  Mailing_Country?: string;
  Created_Time: string;
  Modified_Time: string;
  Last_Activity_Time?: string;
  [key: string]: any;
}

// Salesforce specific types
export interface SalesforceCrmConfig extends CrmConfig {
  system: 'salesforce';
  instanceUrl: string;
  isSandbox: boolean;
}

export interface SalesforceContact {
  Id: string;
  Name: string;
  Email: string;
  Phone: string;
  AccountId?: string;
  MailingStreet?: string;
  MailingCity?: string;
  MailingState?: string;
  MailingPostalCode?: string;
  MailingCountry?: string;
  CreatedDate: string;
  LastModifiedDate: string;
  LastActivityDate?: string;
  [key: string]: any;
}

// HubSpot specific types
export interface HubSpotCrmConfig extends CrmConfig {
  system: 'hubspot';
  portalId: string;
}

export interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    company?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    createdate?: string;
    lastmodifieddate?: string;
    notes_last_contacted?: string;
    [key: string]: any;
  };
}

// AgencyBloc specific types
export interface AgencyBlocCrmConfig extends CrmConfig {
  system: 'agencybloc';
  environment: 'production' | 'sandbox';
}

export interface AgencyBlocContact {
  ContactId: number;
  FirstName: string;
  LastName: string;
  Email: string;
  Phone: string;
  Address1?: string;
  City?: string;
  State?: string;
  Zip?: string;
  Country?: string;
  DateCreated: string;
  DateModified: string;
  LastContactDate?: string;
  [key: string]: any;
}

// ============================================================================
// Error Types
// ============================================================================

export class CrmError extends Error {
  constructor(
    message: string,
    public code: string,
    public system: CrmSystem,
    public retryable: boolean = false,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'CrmError';
  }
}

export class CrmAuthError extends CrmError {
  constructor(message: string, system: CrmSystem, statusCode?: number) {
    super(message, 'AUTH_ERROR', system, false, statusCode);
    this.name = 'CrmAuthError';
  }
}

export class CrmRateLimitError extends CrmError {
  constructor(
    message: string,
    system: CrmSystem,
    public resetTime: Date,
    statusCode?: number
  ) {
    super(message, 'RATE_LIMIT', system, true, statusCode);
    this.name = 'CrmRateLimitError';
  }
}

export class CrmApiError extends CrmError {
  constructor(
    message: string,
    system: CrmSystem,
    code: string,
    retryable: boolean = false,
    statusCode?: number
  ) {
    super(message, code, system, retryable, statusCode);
    this.name = 'CrmApiError';
  }
}
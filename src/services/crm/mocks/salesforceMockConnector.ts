/**
 * Salesforce CRM Mock Connector
 * Simulates Salesforce API behavior for development and testing
 */

import { BaseMockConnector } from './baseMockConnector';
import { SalesforceCrmConfig } from '../types';

export class SalesforceMockConnector extends BaseMockConnector {
  constructor(config: SalesforceCrmConfig) {
    super('salesforce', config);
  }

  protected initializeMockData(): void {
    // Generate mock clients with Salesforce-specific characteristics
    this.generateMockClients(75);
    
    // Add Salesforce-specific fields to existing clients
    for (const client of this.mockClients.values()) {
      client.customFields = {
        ...client.customFields,
        'LeadSource': ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List'][Math.floor(Math.random() * 4)],
        'AnnualRevenue': Math.floor(Math.random() * 5000000) + 100000,
        'NumberOfEmployees': Math.floor(Math.random() * 1000) + 1,
        'Industry': ['Insurance', 'Technology', 'Healthcare', 'Financial Services', 'Manufacturing'][Math.floor(Math.random() * 5)],
        'Rating': ['Hot', 'Warm', 'Cold'][Math.floor(Math.random() * 3)],
        'OwnerId': 'mock_owner_' + Math.floor(Math.random() * 10),
        'CreatedById': 'mock_creator_123',
        'LastModifiedById': 'mock_modifier_456',
        'IsDeleted': false,
        'SystemModstamp': new Date().toISOString(),
        'LastActivityDate': new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
      };
    }

    // Add Salesforce-specific test scenarios
    this.addSalesforceTestScenarios();
  }

  private addSalesforceTestScenarios(): void {
    // Contact with Account relationship
    this.addMockClient({
      name: 'Salesforce Account Contact',
      email: 'sf.account@example.com',
      phone: '555-SF-ACC',
      company: 'Salesforce Enterprise Corp',
      customFields: {
        'AccountId': 'ACC_SF_001',
        'Account': {
          'Id': 'ACC_SF_001',
          'Name': 'Salesforce Enterprise Corp',
          'Type': 'Customer - Direct',
          'Industry': 'Technology',
          'AnnualRevenue': 10000000,
          'NumberOfEmployees': 500
        },
        'Title': 'VP of Sales',
        'Department': 'Sales',
        'ReportsToId': 'CON_SF_MANAGER',
        'Level__c': 'Executive', // Custom field
        'Languages__c': 'English;Spanish', // Multi-select picklist
        'Birthdate': '1980-05-15',
        'DoNotCall': false,
        'HasOptedOutOfEmail': false
      }
    });

    // Contact with Opportunity relationships
    this.addMockClient({
      name: 'Salesforce Opportunity Contact',
      email: 'sf.opportunity@example.com',
      phone: '555-SF-OPP',
      company: 'Opportunity Dynamics Inc',
      customFields: {
        'AccountId': 'ACC_SF_002',
        'Opportunities': [
          {
            'Id': 'OPP_SF_001',
            'Name': 'Q4 Insurance Renewal',
            'StageName': 'Negotiation/Review',
            'Amount': 250000,
            'CloseDate': '2024-12-31',
            'Probability': 75
          },
          {
            'Id': 'OPP_SF_002',
            'Name': 'Additional Coverage',
            'StageName': 'Prospecting',
            'Amount': 50000,
            'CloseDate': '2024-06-30',
            'Probability': 25
          }
        ],
        'OpportunityContactRoles': [
          {
            'OpportunityId': 'OPP_SF_001',
            'Role': 'Decision Maker',
            'IsPrimary': true
          },
          {
            'OpportunityId': 'OPP_SF_002',
            'Role': 'Influencer',
            'IsPrimary': false
          }
        ]
      }
    });

    // Contact with Case history
    this.addMockClient({
      name: 'Salesforce Support Contact',
      email: 'sf.support@example.com',
      phone: '555-SF-SUP',
      company: 'Support Services LLC',
      customFields: {
        'AccountId': 'ACC_SF_003',
        'Cases': [
          {
            'Id': 'CASE_SF_001',
            'CaseNumber': '00001001',
            'Subject': 'Policy Coverage Question',
            'Status': 'Closed',
            'Priority': 'Medium',
            'Origin': 'Phone',
            'CreatedDate': '2024-01-15T10:00:00Z',
            'ClosedDate': '2024-01-16T14:30:00Z'
          },
          {
            'Id': 'CASE_SF_002',
            'CaseNumber': '00001002',
            'Subject': 'Billing Inquiry',
            'Status': 'In Progress',
            'Priority': 'High',
            'Origin': 'Email',
            'CreatedDate': '2024-02-01T09:15:00Z'
          }
        ],
        'TotalCases': 2,
        'OpenCases': 1,
        'ClosedCases': 1,
        'LastCaseDate': '2024-02-01T09:15:00Z'
      }
    });

    // Contact with custom objects and fields
    this.addMockClient({
      name: 'Salesforce Custom Contact',
      email: 'sf.custom@example.com',
      phone: '555-SF-CUS',
      company: 'Custom Objects Corp',
      customFields: {
        'AccountId': 'ACC_SF_004',
        // Standard Salesforce custom field naming (ends with __c)
        'Customer_Tier__c': 'Platinum',
        'Preferred_Contact_Method__c': 'Email',
        'Marketing_Opt_In__c': true,
        'Last_Survey_Score__c': 9.5,
        'Renewal_Date__c': '2024-12-31',
        'Contract_Value__c': 500000,
        'Risk_Score__c': 'Low',
        'Segment__c': 'Enterprise',
        'Territory__c': 'West Coast',
        'Partner_Channel__c': 'Direct',
        // Custom object relationships
        'Insurance_Policies__r': [
          {
            'Id': 'POL_SF_001',
            'Name': 'Auto Insurance Policy',
            'Policy_Number__c': 'AUTO-2024-001',
            'Premium__c': 1200,
            'Effective_Date__c': '2024-01-01',
            'Expiration_Date__c': '2024-12-31'
          }
        ],
        'Claims__r': [
          {
            'Id': 'CLM_SF_001',
            'Name': 'Minor Fender Bender',
            'Claim_Number__c': 'CLM-2024-001',
            'Amount__c': 2500,
            'Status__c': 'Closed',
            'Date_of_Loss__c': '2024-03-15'
          }
        ]
      }
    });
  }

  /**
   * Simulate Salesforce-specific API behaviors
   */
  async simulateSalesforceSpecificBehavior(scenario: 'api_limit' | 'maintenance' | 'governor_limit'): Promise<void> {
    switch (scenario) {
      case 'api_limit':
        // Salesforce has daily API limits based on license type
        throw new Error('REQUEST_LIMIT_EXCEEDED: TotalRequests Limit exceeded. Limit: 15000');
      
      case 'maintenance':
        // Salesforce maintenance windows
        throw new Error('UNABLE_TO_LOCK_ROW: unable to obtain exclusive access to this record or 1 records');
      
      case 'governor_limit':
        // Salesforce governor limits (CPU time, heap size, etc.)
        throw new Error('LIMIT_EXCEEDED: Apex CPU time limit exceeded');
    }
  }

  /**
   * Simulate Salesforce SOQL queries
   */
  async simulateSOQLQuery(soql: string): Promise<any> {
    await this.simulateDelay(200, 800);
    
    // Simple SOQL parsing simulation
    const clients = Array.from(this.mockClients.values());
    
    // Extract WHERE conditions (very basic parsing)
    const whereMatch = soql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);
    let filteredClients = clients;
    
    if (whereMatch) {
      const whereClause = whereMatch[1];
      
      // Handle simple conditions like "Email LIKE '%example%'"
      if (whereClause.includes('LIKE')) {
        const likeMatch = whereClause.match(/(\w+)\s+LIKE\s+'%(.+?)%'/i);
        if (likeMatch) {
          const field = likeMatch[1].toLowerCase();
          const value = likeMatch[2].toLowerCase();
          
          filteredClients = clients.filter(client => {
            const fieldValue = (client as any)[field] || '';
            return fieldValue.toLowerCase().includes(value);
          });
        }
      }
      
      // Handle date conditions like "LastModifiedDate >= 2024-01-01T00:00:00Z"
      if (whereClause.includes('LastModifiedDate')) {
        const dateMatch = whereClause.match(/LastModifiedDate\s*>=\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/i);
        if (dateMatch) {
          const sinceDate = new Date(dateMatch[1]);
          filteredClients = filteredClients.filter(client => 
            client.updatedAt >= sinceDate
          );
        }
      }
    }

    // Handle LIMIT
    const limitMatch = soql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1]);
      filteredClients = filteredClients.slice(0, limit);
    }

    return {
      totalSize: filteredClients.length,
      done: true,
      records: filteredClients.map(client => ({
        ...client,
        attributes: {
          type: 'Contact',
          url: `/services/data/v58.0/sobjects/Contact/${client.id}`
        }
      }))
    };
  }

  /**
   * Simulate Salesforce bulk operations
   */
  async simulateBulkOperation(operation: 'insert' | 'update' | 'upsert' | 'delete', records: any[]): Promise<any> {
    await this.simulateDelay(3000, 8000); // Bulk operations take longer
    
    const results = records.map((record, index) => {
      const success = Math.random() > 0.05; // 95% success rate
      
      if (success) {
        return {
          id: record.Id || this.generateMockId(),
          success: true,
          created: operation === 'insert' || (operation === 'upsert' && !record.Id)
        };
      } else {
        return {
          success: false,
          errors: [
            {
              statusCode: 'REQUIRED_FIELD_MISSING',
              message: 'Required fields are missing: [LastName]',
              fields: ['LastName']
            }
          ]
        };
      }
    });

    return results;
  }

  /**
   * Get Salesforce-specific metadata
   */
  getMockSalesforceMetadata(): any {
    return {
      sobjects: [
        {
          name: 'Contact',
          label: 'Contact',
          keyPrefix: '003',
          createable: true,
          updateable: true,
          deletable: true,
          queryable: true,
          searchable: true,
          custom: false,
          customSetting: false
        },
        {
          name: 'Account',
          label: 'Account',
          keyPrefix: '001',
          createable: true,
          updateable: true,
          deletable: true,
          queryable: true,
          searchable: true,
          custom: false,
          customSetting: false
        }
      ],
      fields: [
        {
          name: 'Id',
          type: 'id',
          label: 'Contact ID',
          length: 18,
          unique: true,
          nillable: false,
          createable: false,
          updateable: false
        },
        {
          name: 'FirstName',
          type: 'string',
          label: 'First Name',
          length: 40,
          nillable: true,
          createable: true,
          updateable: true
        },
        {
          name: 'LastName',
          type: 'string',
          label: 'Last Name',
          length: 80,
          nillable: false,
          createable: true,
          updateable: true
        },
        {
          name: 'Email',
          type: 'email',
          label: 'Email',
          length: 80,
          nillable: true,
          createable: true,
          updateable: true
        },
        {
          name: 'Phone',
          type: 'phone',
          label: 'Business Phone',
          length: 40,
          nillable: true,
          createable: true,
          updateable: true
        }
      ],
      recordTypes: [
        {
          name: 'Standard',
          developerName: 'Standard',
          id: '012000000000000AAA',
          active: true,
          defaultRecordTypeMapping: true,
          master: true
        }
      ]
    };
  }

  /**
   * Simulate Salesforce limits information
   */
  getMockLimitsInfo(): any {
    return {
      DailyApiRequests: {
        Max: 15000,
        Remaining: 14750
      },
      DailyBulkApiRequests: {
        Max: 5000,
        Remaining: 4995
      },
      DailyStreamingApiEvents: {
        Max: 25000,
        Remaining: 25000
      },
      HourlyODataCallout: {
        Max: 20000,
        Remaining: 20000
      },
      HourlyShortTermIdMapping: {
        Max: 100000,
        Remaining: 100000
      },
      HourlyLongTermIdMapping: {
        Max: 100000,
        Remaining: 100000
      }
    };
  }
}
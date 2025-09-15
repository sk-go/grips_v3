/**
 * Zoho CRM Mock Connector
 * Simulates Zoho CRM API behavior for development and testing
 */

import { BaseMockConnector } from './baseMockConnector';
import { ZohoCrmConfig } from '../types';

export class ZohoMockConnector extends BaseMockConnector {
  constructor(config: ZohoCrmConfig) {
    super('zoho', config);
  }

  protected initializeMockData(): void {
    // Generate mock clients with Zoho-specific characteristics
    this.generateMockClients(50);
    
    // Add some Zoho-specific custom fields to existing clients
    for (const client of this.mockClients.values()) {
      client.customFields = {
        ...client.customFields,
        'Lead_Source': ['Website', 'Referral', 'Cold Call', 'Trade Show'][Math.floor(Math.random() * 4)],
        'Annual_Revenue': Math.floor(Math.random() * 1000000) + 50000,
        'Number_of_Employees': Math.floor(Math.random() * 500) + 1,
        'Industry': ['Insurance', 'Technology', 'Healthcare', 'Finance', 'Manufacturing'][Math.floor(Math.random() * 5)],
        'Rating': ['Hot', 'Warm', 'Cold'][Math.floor(Math.random() * 3)],
        'Zoho_Account_Owner': 'Mock Agent',
        'Created_By': 'System',
        'Modified_By': 'System'
      };
    }

    // Add some Zoho-specific test scenarios
    this.addZohoTestScenarios();
  }

  private addZohoTestScenarios(): void {
    // Client with complex custom fields (Zoho allows many custom fields)
    this.addMockClient({
      name: 'Zoho Test Client - Complex',
      email: 'zoho.complex@example.com',
      phone: '555-ZOHO-1',
      company: 'Zoho Complex Industries',
      customFields: {
        'Custom_Field_1': 'Value 1',
        'Custom_Field_2': 'Value 2',
        'Custom_Picklist': 'Option A',
        'Custom_Number': 12345,
        'Custom_Date': new Date().toISOString(),
        'Custom_Boolean': true,
        'Custom_Currency': 50000.00,
        'Custom_Percent': 85.5,
        'Custom_URL': 'https://example.com',
        'Custom_Email': 'custom@example.com',
        'Custom_Phone': '555-CUSTOM',
        'Multi_Select_Picklist': ['Option 1', 'Option 2'],
        'Long_Text_Area': 'This is a long text area with multiple lines\nLine 2\nLine 3',
        'Rich_Text_Area': '<p>This is <strong>rich text</strong> with <em>formatting</em></p>'
      }
    });

    // Client with Indian address format (Zoho is Indian company)
    this.addMockClient({
      name: 'Zoho Test Client - India',
      email: 'zoho.india@example.com',
      phone: '+91-9876543210',
      company: 'Zoho India Pvt Ltd',
      address: {
        street: 'Estancia IT Park, Plot No. 140 & 151, GST Road',
        city: 'Chennai',
        state: 'Tamil Nadu',
        zipCode: '600127',
        country: 'India'
      },
      customFields: {
        'GST_Number': '33AABCZ1234L1Z5',
        'PAN_Number': 'AABCZ1234L',
        'Currency': 'INR',
        'Time_Zone': 'Asia/Kolkata'
      }
    });

    // Client with integration-specific fields
    this.addMockClient({
      name: 'Zoho Integration Test',
      email: 'zoho.integration@example.com',
      phone: '555-INTEG-1',
      company: 'Integration Test Corp',
      customFields: {
        'External_ID': 'EXT_12345',
        'Sync_Status': 'Synced',
        'Last_Sync_Time': new Date().toISOString(),
        'Sync_Errors': null,
        'Integration_Source': 'RelationshipCarePlatform',
        'Webhook_URL': 'https://api.example.com/webhook',
        'API_Version': 'v2'
      }
    });

    // Client that simulates Zoho's module relationships
    this.addMockClient({
      name: 'Zoho Relationship Test',
      email: 'zoho.relationships@example.com',
      phone: '555-REL-01',
      company: 'Relationship Dynamics LLC',
      customFields: {
        'Account_ID': 'ACC_789',
        'Contact_Owner': 'john.doe@company.com',
        'Related_Deals': ['DEAL_001', 'DEAL_002'],
        'Related_Cases': ['CASE_001'],
        'Related_Tasks': ['TASK_001', 'TASK_002', 'TASK_003'],
        'Related_Events': ['EVENT_001'],
        'Related_Calls': ['CALL_001', 'CALL_002']
      }
    });
  }

  /**
   * Simulate Zoho-specific API behaviors
   */
  async simulateZohoSpecificBehavior(scenario: 'rate_limit' | 'api_limit' | 'maintenance'): Promise<void> {
    switch (scenario) {
      case 'rate_limit':
        // Zoho has per-minute rate limits
        throw new Error('Rate limit exceeded. Maximum 100 requests per minute allowed.');
      
      case 'api_limit':
        // Zoho has daily API limits based on edition
        throw new Error('Daily API limit exceeded. Upgrade your Zoho CRM edition for higher limits.');
      
      case 'maintenance':
        // Zoho maintenance windows
        throw new Error('Zoho CRM is under maintenance. Please try again later.');
    }
  }

  /**
   * Simulate Zoho's bulk operations
   */
  async simulateBulkOperation(operation: 'insert' | 'update' | 'upsert', records: any[]): Promise<any> {
    await this.simulateDelay(2000, 5000); // Bulk operations take longer
    
    const results = records.map((record, index) => ({
      code: Math.random() > 0.1 ? 'SUCCESS' : 'ERROR', // 90% success rate
      details: {
        Modified_Time: new Date().toISOString(),
        Modified_By: {
          name: 'Mock User',
          id: 'mock_user_123'
        },
        Created_Time: operation === 'insert' ? new Date().toISOString() : record.Created_Time,
        id: record.id || this.generateMockId()
      },
      message: Math.random() > 0.1 ? 'Record saved successfully' : 'Duplicate data',
      status: Math.random() > 0.1 ? 'success' : 'error'
    }));

    return {
      data: results,
      info: {
        per_page: records.length,
        count: results.filter(r => r.code === 'SUCCESS').length,
        page: 1,
        more_records: false
      }
    };
  }

  /**
   * Simulate Zoho's search functionality
   */
  async simulateZohoSearch(criteria: string): Promise<any> {
    await this.simulateDelay();
    
    // Parse Zoho search criteria format: (Field:Operator:Value)
    const clients = Array.from(this.mockClients.values());
    
    // Simple simulation - in real Zoho, this would be more complex
    const searchResults = clients.filter(client => {
      const searchText = criteria.toLowerCase();
      return client.name.toLowerCase().includes(searchText) ||
             client.email.toLowerCase().includes(searchText) ||
             client.company?.toLowerCase().includes(searchText);
    });

    return {
      data: searchResults.slice(0, 20), // Zoho limits search results
      info: {
        count: searchResults.length,
        per_page: 20,
        page: 1,
        more_records: searchResults.length > 20
      }
    };
  }

  /**
   * Get Zoho-specific metadata
   */
  getMockZohoMetadata(): any {
    return {
      modules: [
        {
          api_name: 'Contacts',
          module_name: 'Contacts',
          business_card_field_limit: 5,
          custom_view: {
            display_value: 'All Contacts',
            created_time: null,
            access_type: 'shared',
            criteria: null,
            system_name: 'ALLVIEWS',
            shared_type: 'AllUsers',
            category: 'shared_with_me',
            id: '554023000000093005'
          }
        }
      ],
      fields: [
        { api_name: 'First_Name', field_label: 'First Name', data_type: 'text', required: true },
        { api_name: 'Last_Name', field_label: 'Last Name', data_type: 'text', required: true },
        { api_name: 'Email', field_label: 'Email', data_type: 'email', required: false },
        { api_name: 'Phone', field_label: 'Phone', data_type: 'phone', required: false },
        { api_name: 'Account_Name', field_label: 'Account Name', data_type: 'lookup', required: false }
      ],
      layouts: [
        {
          name: 'Standard',
          id: '554023000000091055',
          created_time: '2023-01-01T00:00:00+00:00',
          modified_time: '2023-01-01T00:00:00+00:00',
          visible: true,
          status: 0
        }
      ]
    };
  }
}
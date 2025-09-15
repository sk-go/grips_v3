/**
 * HubSpot CRM Mock Connector
 * Simulates HubSpot API behavior for development and testing
 */

import { BaseMockConnector } from './baseMockConnector';
import { HubSpotCrmConfig } from '../types';

export class HubSpotMockConnector extends BaseMockConnector {
  constructor(config: HubSpotCrmConfig) {
    super('hubspot', config);
  }

  protected initializeMockData(): void {
    // Generate mock clients with HubSpot-specific characteristics
    this.generateMockClients(60);
    
    // Add HubSpot-specific properties to existing clients
    for (const client of this.mockClients.values()) {
      client.customFields = {
        ...client.customFields,
        'hs_lead_status': ['NEW', 'OPEN', 'IN_PROGRESS', 'OPEN_DEAL', 'UNQUALIFIED', 'ATTEMPTED_TO_CONTACT', 'CONNECTED', 'BAD_TIMING'][Math.floor(Math.random() * 8)],
        'lifecyclestage': ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other'][Math.floor(Math.random() * 8)],
        'hs_analytics_source': ['ORGANIC_SEARCH', 'PAID_SEARCH', 'EMAIL_MARKETING', 'SOCIAL_MEDIA', 'REFERRALS', 'OTHER_CAMPAIGNS', 'DIRECT_TRAFFIC', 'OFFLINE_SOURCES'][Math.floor(Math.random() * 8)],
        'hubspot_owner_id': Math.floor(Math.random() * 100) + 1,
        'hs_createdate': new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
        'lastmodifieddate': new Date().toISOString(),
        'hs_object_id': Math.floor(Math.random() * 1000000) + 1,
        'hs_analytics_num_page_views': Math.floor(Math.random() * 50) + 1,
        'hs_analytics_num_visits': Math.floor(Math.random() * 20) + 1,
        'hs_analytics_num_event_completions': Math.floor(Math.random() * 10),
        'hs_email_optout': Math.random() > 0.8, // 20% opted out
        'hs_marketable_status': Math.random() > 0.2 ? 'MARKETABLE' : 'NON_MARKETABLE',
        'hs_marketable_reason_type': 'OPTED_IN',
        'hs_marketable_reason_id': '1'
      };
    }

    // Add HubSpot-specific test scenarios
    this.addHubSpotTestScenarios();
  }

  private addHubSpotTestScenarios(): void {
    // Contact with marketing automation history
    this.addMockClient({
      name: 'HubSpot Marketing Contact',
      email: 'hs.marketing@example.com',
      phone: '555-HS-MKT',
      company: 'Marketing Automation Inc',
      customFields: {
        'lifecyclestage': 'marketingqualifiedlead',
        'hs_lead_status': 'OPEN',
        'hs_analytics_source': 'EMAIL_MARKETING',
        'hs_email_optout': false,
        'hs_marketable_status': 'MARKETABLE',
        'hs_analytics_num_page_views': 45,
        'hs_analytics_num_visits': 12,
        'hs_analytics_num_event_completions': 8,
        'hs_analytics_first_touch_converting_campaign': 'Q1 Insurance Campaign',
        'hs_analytics_last_touch_converting_campaign': 'Renewal Reminder Email',
        'hs_email_first_send_date': '2024-01-15T10:00:00Z',
        'hs_email_last_send_date': '2024-02-28T14:30:00Z',
        'hs_email_first_open_date': '2024-01-15T10:15:00Z',
        'hs_email_last_open_date': '2024-02-28T15:00:00Z',
        'hs_email_first_click_date': '2024-01-15T10:20:00Z',
        'hs_email_last_click_date': '2024-02-28T15:05:00Z',
        'num_associated_deals': 2,
        'recent_deal_amount': 75000,
        'recent_deal_close_date': '2024-06-30'
      }
    });

    // Contact with sales pipeline data
    this.addMockClient({
      name: 'HubSpot Sales Contact',
      email: 'hs.sales@example.com',
      phone: '555-HS-SAL',
      company: 'Sales Pipeline Corp',
      customFields: {
        'lifecyclestage': 'opportunity',
        'hs_lead_status': 'OPEN_DEAL',
        'hubspot_owner_id': 12345,
        'hubspot_owner_assigneddate': '2024-01-20T09:00:00Z',
        'notes_last_contacted': '2024-02-25T16:30:00Z',
        'notes_last_updated': '2024-02-25T16:35:00Z',
        'notes_next_activity_date': '2024-03-05T10:00:00Z',
        'num_contacted_notes': 8,
        'num_notes': 15,
        'hs_sales_email_last_replied': '2024-02-20T11:15:00Z',
        'hs_sequences_enrolled_count': 2,
        'hs_sequences_actively_enrolled_count': 1,
        'currentlyinworkflow': true,
        'hs_predictivecontactscore_v2': 85,
        'hs_predictivecontactscorebucket': 'HIGH',
        'associatedcompanyid': 98765,
        'associatedcompanylastupdated': '2024-02-28T12:00:00Z'
      }
    });

    // Contact with custom properties and integrations
    this.addMockClient({
      name: 'HubSpot Integration Contact',
      email: 'hs.integration@example.com',
      phone: '555-HS-INT',
      company: 'Integration Solutions LLC',
      customFields: {
        'lifecyclestage': 'customer',
        'hs_lead_status': 'CONNECTED',
        // Custom properties (HubSpot allows many custom properties)
        'insurance_policy_type': 'Comprehensive',
        'policy_renewal_date': '2024-12-31',
        'annual_premium': 2400,
        'risk_assessment_score': 'Low',
        'preferred_contact_method': 'Email',
        'customer_satisfaction_score': 9,
        'last_claim_date': '2023-08-15',
        'total_claims_amount': 5000,
        'years_as_customer': 5,
        'referral_source': 'Existing Customer',
        'marketing_persona': 'Safety-Conscious Family',
        'buying_stage': 'Decision',
        'budget_range': '$2000-$3000',
        'decision_maker_role': 'Primary',
        'pain_points': 'Cost;Coverage;Claims Process',
        'goals': 'Comprehensive Coverage;Competitive Pricing',
        'challenges': 'Understanding Policy Details',
        // Integration-specific fields
        'external_system_id': 'EXT_HS_12345',
        'sync_status': 'SYNCED',
        'last_sync_timestamp': new Date().toISOString(),
        'sync_errors': null,
        'data_source': 'RelationshipCarePlatform',
        'integration_version': '2.1'
      }
    });

    // Contact with workflow and automation data
    this.addMockClient({
      name: 'HubSpot Workflow Contact',
      email: 'hs.workflow@example.com',
      phone: '555-HS-WRK',
      company: 'Workflow Dynamics Inc',
      customFields: {
        'lifecyclestage': 'salesqualifiedlead',
        'hs_lead_status': 'IN_PROGRESS',
        'currentlyinworkflow': true,
        'hs_workflows': [
          {
            'workflowId': 12345,
            'workflowName': 'New Lead Nurturing',
            'enrolledAt': '2024-02-01T10:00:00Z',
            'currentStep': 'Send Welcome Email'
          },
          {
            'workflowId': 67890,
            'workflowName': 'Insurance Quote Follow-up',
            'enrolledAt': '2024-02-15T14:30:00Z',
            'currentStep': 'Schedule Consultation Call'
          }
        ],
        'hs_sequences_enrolled': [
          {
            'sequenceId': 111,
            'sequenceName': 'Insurance Sales Sequence',
            'enrolledAt': '2024-02-20T09:00:00Z',
            'currentStep': 3,
            'totalSteps': 7
          }
        ],
        'hs_calculated_form_submissions': 3,
        'hs_calculated_merged_vids': 0,
        'hs_calculated_mobile_number': '555-HS-WRK',
        'hs_calculated_phone_number': '555-HS-WRK',
        'hs_calculated_phone_number_area_code': '555',
        'hs_calculated_phone_number_country_code': 'US',
        'hs_calculated_phone_number_region_code': 'CA'
      }
    });
  }

  /**
   * Simulate HubSpot-specific API behaviors
   */
  async simulateHubSpotSpecificBehavior(scenario: 'rate_limit' | 'property_limit' | 'search_limit'): Promise<void> {
    switch (scenario) {
      case 'rate_limit':
        // HubSpot has per-second rate limits
        throw new Error('Rate limit exceeded. Maximum 100 requests per 10 seconds allowed.');
      
      case 'property_limit':
        // HubSpot limits on custom properties
        throw new Error('Property limit exceeded. Maximum 1000 custom properties allowed per object type.');
      
      case 'search_limit':
        // HubSpot search API limits
        throw new Error('Search limit exceeded. Maximum 10,000 results per search query.');
    }
  }

  /**
   * Simulate HubSpot search functionality
   */
  async simulateHubSpotSearch(query: string, properties: string[] = []): Promise<any> {
    await this.simulateDelay(300, 700);
    
    const clients = Array.from(this.mockClients.values());
    
    // Simple search simulation
    const searchResults = clients.filter(client => {
      const searchText = query.toLowerCase();
      return client.name.toLowerCase().includes(searchText) ||
             client.email.toLowerCase().includes(searchText) ||
             client.company?.toLowerCase().includes(searchText);
    });

    return {
      total: searchResults.length,
      results: searchResults.slice(0, 100).map(client => ({
        id: client.id,
        properties: properties.length > 0 
          ? this.filterProperties(client, properties)
          : client,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
        archived: false
      })),
      paging: {
        next: searchResults.length > 100 ? {
          after: '100',
          link: `?after=100&limit=100`
        } : undefined
      }
    };
  }

  /**
   * Simulate HubSpot batch operations
   */
  async simulateBatchOperation(operation: 'create' | 'read' | 'update' | 'archive', inputs: any[]): Promise<any> {
    await this.simulateDelay(1000, 3000);
    
    const results = inputs.map((input, index) => {
      const success = Math.random() > 0.03; // 97% success rate
      
      if (success) {
        return {
          id: input.id || this.generateMockId(),
          properties: input.properties || {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          archived: false
        };
      } else {
        return {
          status: 'error',
          category: 'VALIDATION_ERROR',
          message: 'Property "email" is not valid',
          errors: [
            {
              isValid: false,
              message: 'Property "email" is not valid',
              error: 'INVALID_EMAIL',
              name: 'email'
            }
          ]
        };
      }
    });

    return {
      status: 'COMPLETE',
      results,
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    };
  }

  /**
   * Get HubSpot-specific metadata
   */
  getMockHubSpotMetadata(): any {
    return {
      properties: [
        {
          name: 'email',
          label: 'Email',
          type: 'string',
          fieldType: 'text',
          description: 'A contact\'s email address',
          groupName: 'contactinformation',
          options: [],
          createdAt: '2019-10-30T03:30:17.883Z',
          updatedAt: '2019-12-07T16:50:06.678Z',
          displayOrder: -1,
          calculated: false,
          externalOptions: false,
          hasUniqueValue: true,
          hidden: false,
          hubspotDefined: true,
          modificationMetadata: {
            archivable: true,
            readOnlyDefinition: true,
            readOnlyValue: false
          },
          formField: true
        },
        {
          name: 'firstname',
          label: 'First name',
          type: 'string',
          fieldType: 'text',
          description: 'A contact\'s first name',
          groupName: 'contactinformation',
          options: [],
          createdAt: '2019-10-30T03:30:17.883Z',
          updatedAt: '2019-12-07T16:50:06.678Z',
          displayOrder: -1,
          calculated: false,
          externalOptions: false,
          hasUniqueValue: false,
          hidden: false,
          hubspotDefined: true,
          modificationMetadata: {
            archivable: true,
            readOnlyDefinition: true,
            readOnlyValue: false
          },
          formField: true
        }
      ],
      propertyGroups: [
        {
          name: 'contactinformation',
          displayName: 'Contact information',
          displayOrder: 0,
          hubspotDefined: true,
          properties: ['email', 'firstname', 'lastname', 'phone', 'company']
        },
        {
          name: 'lead_intelligence',
          displayName: 'Lead intelligence',
          displayOrder: 1,
          hubspotDefined: true,
          properties: ['hs_analytics_source', 'hs_lead_status', 'lifecyclestage']
        }
      ],
      associations: [
        {
          fromObjectTypeId: '0-1',
          toObjectTypeId: '0-2',
          name: 'contact_to_company',
          label: 'Contact to Company'
        },
        {
          fromObjectTypeId: '0-1',
          toObjectTypeId: '0-3',
          name: 'contact_to_deal',
          label: 'Contact to Deal'
        }
      ]
    };
  }

  /**
   * Simulate HubSpot analytics data
   */
  getMockAnalyticsData(): any {
    return {
      attribution: {
        firstTouch: {
          source: 'ORGANIC_SEARCH',
          medium: 'organic',
          campaign: null,
          content: null,
          term: 'insurance quotes',
          timestamp: '2024-01-10T14:30:00Z'
        },
        lastTouch: {
          source: 'EMAIL_MARKETING',
          medium: 'email',
          campaign: 'Q1 Renewal Campaign',
          content: 'renewal_reminder',
          term: null,
          timestamp: '2024-02-25T10:15:00Z'
        }
      },
      engagement: {
        emailsSent: 12,
        emailsOpened: 8,
        emailsClicked: 3,
        formSubmissions: 2,
        pageViews: 45,
        sessions: 12,
        averageSessionDuration: 180, // seconds
        bounceRate: 0.25
      },
      conversion: {
        conversionEvents: [
          {
            eventName: 'Quote Request',
            timestamp: '2024-01-15T16:20:00Z',
            value: 0
          },
          {
            eventName: 'Policy Purchase',
            timestamp: '2024-02-01T11:45:00Z',
            value: 2400
          }
        ],
        totalConversions: 2,
        totalConversionValue: 2400
      }
    };
  }

  private filterProperties(client: any, properties: string[]): any {
    const filtered: any = {};
    properties.forEach(prop => {
      if (client[prop] !== undefined) {
        filtered[prop] = client[prop];
      } else if (client.customFields && client.customFields[prop] !== undefined) {
        filtered[prop] = client.customFields[prop];
      }
    });
    return filtered;
  }
}
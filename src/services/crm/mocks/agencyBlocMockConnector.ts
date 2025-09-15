/**
 * AgencyBloc CRM Mock Connector
 * Simulates AgencyBloc API behavior for development and testing
 */

import { BaseMockConnector } from './baseMockConnector';
import { AgencyBlocCrmConfig } from '../types';

export class AgencyBlocMockConnector extends BaseMockConnector {
  constructor(config: AgencyBlocCrmConfig) {
    super('agencybloc', config);
  }

  protected initializeMockData(): void {
    // Generate mock clients with AgencyBloc-specific characteristics
    this.generateMockClients(40);
    
    // Add AgencyBloc-specific fields to existing clients
    for (const client of this.mockClients.values()) {
      client.customFields = {
        ...client.customFields,
        'ContactType': ['Individual', 'Business', 'Trust', 'Estate'][Math.floor(Math.random() * 4)],
        'Status': ['Active', 'Inactive', 'Prospect', 'Suspended'][Math.floor(Math.random() * 4)],
        'Source': ['Referral', 'Website', 'Cold Call', 'Marketing Campaign', 'Walk-in'][Math.floor(Math.random() * 5)],
        'AgentId': Math.floor(Math.random() * 20) + 1,
        'AgentName': ['John Smith', 'Sarah Johnson', 'Mike Wilson', 'Lisa Brown'][Math.floor(Math.random() * 4)],
        'DateCreated': new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
        'DateModified': new Date().toISOString(),
        'LastContactDate': new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        'PreferredContactMethod': ['Phone', 'Email', 'Mail', 'Text'][Math.floor(Math.random() * 4)],
        'DoNotCall': Math.random() > 0.9, // 10% do not call
        'DoNotEmail': Math.random() > 0.95, // 5% do not email
        'DoNotMail': Math.random() > 0.85, // 15% do not mail
        'IsVIP': Math.random() > 0.8, // 20% VIP
        'RiskRating': ['Low', 'Medium', 'High'][Math.floor(Math.random() * 3)],
        'CreditRating': ['Excellent', 'Good', 'Fair', 'Poor'][Math.floor(Math.random() * 4)]
      };
    }

    // Add AgencyBloc-specific test scenarios
    this.addAgencyBlocTestScenarios();
  }

  private addAgencyBlocTestScenarios(): void {
    // Individual contact with multiple policies
    this.addMockClient({
      name: 'AgencyBloc Individual Client',
      email: 'ab.individual@example.com',
      phone: '555-AB-IND',
      company: undefined,
      customFields: {
        'ContactType': 'Individual',
        'Status': 'Active',
        'Source': 'Referral',
        'AgentId': 5,
        'AgentName': 'Sarah Johnson',
        'PreferredContactMethod': 'Email',
        'IsVIP': true,
        'RiskRating': 'Low',
        'CreditRating': 'Excellent',
        'DateOfBirth': '1985-06-15',
        'Gender': 'Female',
        'MaritalStatus': 'Married',
        'Occupation': 'Software Engineer',
        'AnnualIncome': 95000,
        'Policies': [
          {
            'PolicyId': 'POL_AB_001',
            'PolicyNumber': 'AUTO-2024-001',
            'PolicyType': 'Auto',
            'Carrier': 'State Farm',
            'Premium': 1200,
            'EffectiveDate': '2024-01-01',
            'ExpirationDate': '2024-12-31',
            'Status': 'Active'
          },
          {
            'PolicyId': 'POL_AB_002',
            'PolicyNumber': 'HOME-2024-001',
            'PolicyType': 'Homeowners',
            'Carrier': 'Allstate',
            'Premium': 800,
            'EffectiveDate': '2024-01-01',
            'ExpirationDate': '2024-12-31',
            'Status': 'Active'
          }
        ],
        'TotalPremium': 2000,
        'PolicyCount': 2,
        'LastPolicyUpdate': '2024-01-01T00:00:00Z'
      }
    });

    // Business contact with commercial policies
    this.addMockClient({
      name: 'AgencyBloc Business Client',
      email: 'ab.business@example.com',
      phone: '555-AB-BIZ',
      company: 'Business Solutions Corp',
      customFields: {
        'ContactType': 'Business',
        'Status': 'Active',
        'Source': 'Marketing Campaign',
        'AgentId': 3,
        'AgentName': 'Mike Wilson',
        'PreferredContactMethod': 'Phone',
        'IsVIP': true,
        'RiskRating': 'Medium',
        'CreditRating': 'Good',
        'BusinessType': 'Corporation',
        'Industry': 'Technology',
        'YearsInBusiness': 8,
        'NumberOfEmployees': 25,
        'AnnualRevenue': 2500000,
        'FederalTaxId': '12-3456789',
        'Policies': [
          {
            'PolicyId': 'POL_AB_003',
            'PolicyNumber': 'GL-2024-001',
            'PolicyType': 'General Liability',
            'Carrier': 'Hartford',
            'Premium': 5000,
            'EffectiveDate': '2024-01-01',
            'ExpirationDate': '2024-12-31',
            'Status': 'Active'
          },
          {
            'PolicyId': 'POL_AB_004',
            'PolicyNumber': 'WC-2024-001',
            'PolicyType': 'Workers Compensation',
            'Carrier': 'Travelers',
            'Premium': 8000,
            'EffectiveDate': '2024-01-01',
            'ExpirationDate': '2024-12-31',
            'Status': 'Active'
          },
          {
            'PolicyId': 'POL_AB_005',
            'PolicyNumber': 'CYBER-2024-001',
            'PolicyType': 'Cyber Liability',
            'Carrier': 'AIG',
            'Premium': 3000,
            'EffectiveDate': '2024-01-01',
            'ExpirationDate': '2024-12-31',
            'Status': 'Active'
          }
        ],
        'TotalPremium': 16000,
        'PolicyCount': 3,
        'LastPolicyUpdate': '2024-01-01T00:00:00Z'
      }
    });

    // Contact with claims history
    this.addMockClient({
      name: 'AgencyBloc Claims Client',
      email: 'ab.claims@example.com',
      phone: '555-AB-CLM',
      company: 'Claims History Inc',
      customFields: {
        'ContactType': 'Individual',
        'Status': 'Active',
        'Source': 'Website',
        'AgentId': 1,
        'AgentName': 'John Smith',
        'PreferredContactMethod': 'Email',
        'IsVIP': false,
        'RiskRating': 'High',
        'CreditRating': 'Fair',
        'Claims': [
          {
            'ClaimId': 'CLM_AB_001',
            'ClaimNumber': 'AUTO-CLM-2023-001',
            'PolicyId': 'POL_AB_006',
            'DateOfLoss': '2023-08-15',
            'ClaimType': 'Auto Collision',
            'Status': 'Closed',
            'Amount': 8500,
            'Deductible': 500,
            'PayoutAmount': 8000,
            'CloseDate': '2023-09-30'
          },
          {
            'ClaimId': 'CLM_AB_002',
            'ClaimNumber': 'HOME-CLM-2023-002',
            'PolicyId': 'POL_AB_007',
            'DateOfLoss': '2023-12-10',
            'ClaimType': 'Water Damage',
            'Status': 'Open',
            'Amount': 12000,
            'Deductible': 1000,
            'PayoutAmount': 0,
            'CloseDate': null
          }
        ],
        'TotalClaims': 2,
        'TotalClaimAmount': 20500,
        'TotalPayoutAmount': 8000,
        'LastClaimDate': '2023-12-10',
        'ClaimsFrequency': 'High'
      }
    });

    // Prospect contact (not yet a client)
    this.addMockClient({
      name: 'AgencyBloc Prospect',
      email: 'ab.prospect@example.com',
      phone: '555-AB-PRO',
      company: 'Prospect Industries',
      customFields: {
        'ContactType': 'Business',
        'Status': 'Prospect',
        'Source': 'Cold Call',
        'AgentId': 4,
        'AgentName': 'Lisa Brown',
        'PreferredContactMethod': 'Phone',
        'IsVIP': false,
        'RiskRating': 'Medium',
        'CreditRating': 'Good',
        'ProspectStage': 'Qualified',
        'LeadScore': 75,
        'EstimatedPremium': 5000,
        'QuoteRequests': [
          {
            'QuoteId': 'QUO_AB_001',
            'QuoteNumber': 'Q-2024-001',
            'PolicyType': 'General Liability',
            'RequestDate': '2024-02-15',
            'QuoteAmount': 4500,
            'Status': 'Pending',
            'ExpirationDate': '2024-03-15',
            'FollowUpDate': '2024-03-01'
          }
        ],
        'LastContactDate': '2024-02-20',
        'NextFollowUpDate': '2024-03-01',
        'ConversionProbability': 0.65,
        'ExpectedCloseDate': '2024-03-15'
      }
    });
  }

  /**
   * Simulate AgencyBloc-specific API behaviors
   */
  async simulateAgencyBlocSpecificBehavior(scenario: 'rate_limit' | 'maintenance' | 'data_limit'): Promise<void> {
    switch (scenario) {
      case 'rate_limit':
        // AgencyBloc rate limits
        throw new Error('Rate limit exceeded. Maximum 1000 requests per hour allowed.');
      
      case 'maintenance':
        // AgencyBloc maintenance windows
        throw new Error('AgencyBloc system is under maintenance. Please try again later.');
      
      case 'data_limit':
        // AgencyBloc data export limits
        throw new Error('Data export limit exceeded. Maximum 10,000 records per request.');
    }
  }

  /**
   * Simulate AgencyBloc policy operations
   */
  async simulatePolicyOperations(operation: 'list' | 'create' | 'update' | 'renew', contactId: string, policyData?: any): Promise<any> {
    await this.simulateDelay(500, 1500);
    
    switch (operation) {
      case 'list':
        return {
          policies: [
            {
              PolicyId: 'POL_001',
              PolicyNumber: 'AUTO-2024-001',
              PolicyType: 'Auto',
              Carrier: 'State Farm',
              Premium: 1200,
              EffectiveDate: '2024-01-01',
              ExpirationDate: '2024-12-31',
              Status: 'Active'
            }
          ],
          totalCount: 1
        };
      
      case 'create':
        return {
          PolicyId: this.generateMockId(),
          PolicyNumber: `NEW-${Date.now()}`,
          ...policyData,
          Status: 'Pending',
          CreatedDate: new Date().toISOString()
        };
      
      case 'update':
        return {
          ...policyData,
          ModifiedDate: new Date().toISOString(),
          Status: 'Updated'
        };
      
      case 'renew':
        return {
          ...policyData,
          PolicyNumber: `REN-${Date.now()}`,
          EffectiveDate: new Date().toISOString(),
          Status: 'Renewed',
          RenewalDate: new Date().toISOString()
        };
    }
  }

  /**
   * Simulate AgencyBloc claims operations
   */
  async simulateClaimsOperations(operation: 'list' | 'create' | 'update', contactId: string, claimData?: any): Promise<any> {
    await this.simulateDelay(300, 800);
    
    switch (operation) {
      case 'list':
        return {
          claims: [
            {
              ClaimId: 'CLM_001',
              ClaimNumber: 'AUTO-CLM-2024-001',
              PolicyId: 'POL_001',
              DateOfLoss: '2024-02-15',
              ClaimType: 'Auto Collision',
              Status: 'Open',
              Amount: 5000
            }
          ],
          totalCount: 1
        };
      
      case 'create':
        return {
          ClaimId: this.generateMockId(),
          ClaimNumber: `CLM-${Date.now()}`,
          ...claimData,
          Status: 'Reported',
          ReportedDate: new Date().toISOString()
        };
      
      case 'update':
        return {
          ...claimData,
          ModifiedDate: new Date().toISOString(),
          LastUpdatedBy: 'System'
        };
    }
  }

  /**
   * Get AgencyBloc-specific metadata
   */
  getMockAgencyBlocMetadata(): any {
    return {
      contactTypes: [
        { value: 'Individual', label: 'Individual' },
        { value: 'Business', label: 'Business' },
        { value: 'Trust', label: 'Trust' },
        { value: 'Estate', label: 'Estate' }
      ],
      contactStatuses: [
        { value: 'Active', label: 'Active' },
        { value: 'Inactive', label: 'Inactive' },
        { value: 'Prospect', label: 'Prospect' },
        { value: 'Suspended', label: 'Suspended' }
      ],
      policyTypes: [
        { value: 'Auto', label: 'Auto Insurance' },
        { value: 'Homeowners', label: 'Homeowners Insurance' },
        { value: 'Life', label: 'Life Insurance' },
        { value: 'Health', label: 'Health Insurance' },
        { value: 'General Liability', label: 'General Liability' },
        { value: 'Workers Compensation', label: 'Workers Compensation' },
        { value: 'Professional Liability', label: 'Professional Liability' },
        { value: 'Cyber Liability', label: 'Cyber Liability' }
      ],
      carriers: [
        { value: 'State Farm', label: 'State Farm' },
        { value: 'Allstate', label: 'Allstate' },
        { value: 'Progressive', label: 'Progressive' },
        { value: 'GEICO', label: 'GEICO' },
        { value: 'Hartford', label: 'Hartford' },
        { value: 'Travelers', label: 'Travelers' },
        { value: 'AIG', label: 'AIG' },
        { value: 'Chubb', label: 'Chubb' }
      ],
      claimTypes: [
        { value: 'Auto Collision', label: 'Auto Collision' },
        { value: 'Auto Comprehensive', label: 'Auto Comprehensive' },
        { value: 'Property Damage', label: 'Property Damage' },
        { value: 'Water Damage', label: 'Water Damage' },
        { value: 'Fire Damage', label: 'Fire Damage' },
        { value: 'Theft', label: 'Theft' },
        { value: 'Liability', label: 'Liability' },
        { value: 'Workers Comp', label: 'Workers Compensation' }
      ],
      customFields: [
        {
          name: 'PreferredContactMethod',
          type: 'picklist',
          label: 'Preferred Contact Method',
          options: ['Phone', 'Email', 'Mail', 'Text']
        },
        {
          name: 'RiskRating',
          type: 'picklist',
          label: 'Risk Rating',
          options: ['Low', 'Medium', 'High']
        },
        {
          name: 'CreditRating',
          type: 'picklist',
          label: 'Credit Rating',
          options: ['Excellent', 'Good', 'Fair', 'Poor']
        },
        {
          name: 'AnnualIncome',
          type: 'currency',
          label: 'Annual Income'
        },
        {
          name: 'IsVIP',
          type: 'boolean',
          label: 'VIP Client'
        }
      ]
    };
  }

  /**
   * Simulate AgencyBloc reporting functionality
   */
  async simulateReporting(reportType: 'premium' | 'claims' | 'renewals' | 'commissions', filters?: any): Promise<any> {
    await this.simulateDelay(1000, 3000);
    
    const baseData = {
      reportType,
      generatedAt: new Date().toISOString(),
      filters: filters || {},
      totalRecords: Math.floor(Math.random() * 1000) + 100
    };

    switch (reportType) {
      case 'premium':
        return {
          ...baseData,
          data: {
            totalPremium: 1250000,
            averagePremium: 2500,
            premiumByType: {
              'Auto': 450000,
              'Homeowners': 350000,
              'Life': 250000,
              'Commercial': 200000
            },
            monthlyTrend: [
              { month: '2024-01', premium: 95000 },
              { month: '2024-02', premium: 105000 },
              { month: '2024-03', premium: 110000 }
            ]
          }
        };
      
      case 'claims':
        return {
          ...baseData,
          data: {
            totalClaims: 45,
            totalClaimAmount: 125000,
            averageClaimAmount: 2778,
            claimsByType: {
              'Auto Collision': 15,
              'Property Damage': 12,
              'Water Damage': 8,
              'Theft': 5,
              'Other': 5
            },
            claimsRatio: 0.10 // 10% of premium
          }
        };
      
      case 'renewals':
        return {
          ...baseData,
          data: {
            upcomingRenewals: 125,
            renewalRate: 0.85, // 85% renewal rate
            renewalsByMonth: {
              '2024-04': 25,
              '2024-05': 30,
              '2024-06': 35,
              '2024-07': 35
            },
            atRiskRenewals: 18
          }
        };
      
      case 'commissions':
        return {
          ...baseData,
          data: {
            totalCommissions: 87500,
            averageCommissionRate: 0.07, // 7%
            commissionsByAgent: [
              { agentId: 1, agentName: 'John Smith', commission: 25000 },
              { agentId: 2, agentName: 'Sarah Johnson', commission: 22000 },
              { agentId: 3, agentName: 'Mike Wilson', commission: 20000 },
              { agentId: 4, agentName: 'Lisa Brown', commission: 20500 }
            ]
          }
        };
    }
  }
}
import { Pool } from 'pg';
import { DocumentGenerationService } from '../services/documents/documentGenerationService';
import { TemplateManagementService } from '../services/documents/templateManagementService';
import { DocumentGenerationContext } from '../types/documents';

/**
 * Demo script showing document generation capabilities
 */
async function documentGenerationDemo() {
  // Mock database connection
  const mockDb = {
    query: jest.fn()
  } as any;

  const templateService = new TemplateManagementService(mockDb);
  const documentService = new DocumentGenerationService(mockDb);

  console.log('=== Document Generation Demo ===\n');

  // Example 1: Advisory Protocol Generation
  console.log('1. Generating Advisory Protocol...');
  
  const advisoryContext: DocumentGenerationContext = {
    client: {
      name: 'Sarah Johnson',
      policyNumber: 'POL-2024-001',
      email: 'sarah.johnson@email.com',
      phone: '555-123-4567'
    },
    customData: {
      agent: {
        name: 'Michael Smith',
        licenseNumber: 'LIC-12345',
        agency: 'Premier Insurance Group'
      },
      date: '2024-01-15',
      protocolId: 'AP-2024-001',
      recommendations: [
        'Increase liability coverage to $1M based on asset review',
        'Add umbrella policy for additional protection',
        'Review beneficiaries annually'
      ],
      risks: [
        'Current coverage may be insufficient for high-value assets',
        'Gap in coverage during travel periods'
      ],
      disclosures: [
        'This advisory protocol is based on information provided as of January 15, 2024',
        'Market conditions and regulations may affect recommendations'
      ]
    }
  };

  try {
    // Mock successful template fetch and document creation
    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'template-1',
          name: 'Advisory Protocol',
          type: 'advisory_protocol',
          template: `
<!DOCTYPE html>
<html>
<head>
    <title>Advisory Protocol - {{ client.name }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { text-align: center; border-bottom: 2px solid #333; }
        .recommendations { background: #e8f4fd; padding: 15px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>ADVISORY PROTOCOL</h1>
        <p><strong>Date:</strong> {{ date }}</p>
        <p><strong>Protocol ID:</strong> {{ protocolId }}</p>
    </div>
    
    <h2>Client Information</h2>
    <p><strong>Name:</strong> {{ client.name }}</p>
    <p><strong>Policy:</strong> {{ client.policyNumber }}</p>
    
    <div class="recommendations">
        <h2>Recommendations</h2>
        {% for rec in recommendations %}
            <p>{{ loop.index }}. {{ rec }}</p>
        {% endfor %}
    </div>
</body>
</html>`,
          required_fields: ['client', 'agent', 'date', 'recommendations'],
          risk_level: 'high',
          status: 'approved'
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-1',
          template_id: 'template-1',
          title: 'Advisory Protocol - Sarah Johnson',
          content: '<html>Generated content...</html>',
          pdf_path: '/temp/advisory-protocol.pdf',
          status: 'pending_approval',
          created_at: new Date()
        }]
      });

    const advisoryDoc = await documentService.generateDocument('template-1', advisoryContext, {
      title: 'Advisory Protocol - Sarah Johnson',
      clientId: 'client-123',
      createdBy: 'agent'
    });

    console.log(`✓ Advisory Protocol generated: ${advisoryDoc.id}`);
    console.log(`  Status: ${advisoryDoc.status}`);
    console.log(`  PDF Path: ${advisoryDoc.pdfPath}\n`);

    // Example 2: Policy Summary Generation
    console.log('2. Generating Policy Summary...');
    
    const policyContext: DocumentGenerationContext = {
      client: {
        name: 'Robert Chen',
        address: '123 Main St, Anytown, ST 12345',
        phone: '555-987-6543',
        email: 'robert.chen@email.com'
      },
      customData: {
        policy: {
          number: 'POL-2024-002',
          type: 'Homeowners Insurance',
          effectiveDate: '2024-02-01',
          expirationDate: '2025-02-01',
          carrier: 'Reliable Insurance Co.'
        },
        coverage: [
          { type: 'Dwelling', limit: '$500,000', deductible: '$1,000' },
          { type: 'Personal Property', limit: '$250,000', deductible: '$1,000' },
          { type: 'Liability', limit: '$300,000', deductible: '$0' }
        ],
        premiums: {
          annual: '$1,200',
          schedule: 'Monthly',
          nextDue: '2024-03-01'
        }
      }
    };

    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'template-2',
          name: 'Policy Summary',
          type: 'policy_summary',
          template: 'Policy summary template...',
          required_fields: ['client', 'policy', 'coverage', 'premiums'],
          risk_level: 'medium',
          status: 'approved'
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-2',
          template_id: 'template-2',
          title: 'Policy Summary - Robert Chen',
          content: '<html>Policy summary content...</html>',
          pdf_path: '/temp/policy-summary.pdf',
          status: 'approved',
          created_at: new Date()
        }]
      });

    const policyDoc = await documentService.generateDocument('template-2', policyContext, {
      title: 'Policy Summary - Robert Chen',
      clientId: 'client-456',
      createdBy: 'ai'
    });

    console.log(`✓ Policy Summary generated: ${policyDoc.id}`);
    console.log(`  Status: ${policyDoc.status}`);
    console.log(`  Created by: ${policyDoc.createdBy}\n`);

    // Example 3: Meeting Notes Generation
    console.log('3. Generating Meeting Notes...');
    
    const meetingContext: DocumentGenerationContext = {
      client: { name: 'Lisa Martinez' },
      customData: {
        agent: { name: 'David Wilson' },
        date: '2024-01-20',
        meetingType: 'Annual Review',
        duration: '45 minutes',
        location: 'Client Office',
        topics: [
          {
            title: 'Coverage Review',
            discussion: 'Reviewed current auto and home policies. Client satisfied with coverage levels.'
          },
          {
            title: 'Life Insurance',
            discussion: 'Discussed increasing life insurance coverage due to new mortgage.'
          }
        ],
        actionItems: [
          {
            action: 'Provide life insurance quotes',
            responsible: 'David Wilson',
            dueDate: '2024-01-25'
          },
          {
            action: 'Review beneficiary information',
            responsible: 'Lisa Martinez',
            dueDate: '2024-02-01'
          }
        ],
        nextSteps: 'Schedule follow-up meeting after life insurance review',
        additionalNotes: 'Client mentioned potential home renovation - may affect coverage needs'
      }
    };

    mockDb.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'template-3',
          name: 'Meeting Notes',
          type: 'meeting_notes',
          template: 'Meeting notes template...',
          required_fields: ['client', 'agent', 'date', 'topics', 'actionItems'],
          risk_level: 'low',
          status: 'approved'
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'doc-3',
          template_id: 'template-3',
          title: 'Meeting Notes - Lisa Martinez',
          content: '<html>Meeting notes content...</html>',
          pdf_path: '/temp/meeting-notes.pdf',
          status: 'approved',
          created_at: new Date()
        }]
      });

    const meetingDoc = await documentService.generateDocument('template-3', meetingContext, {
      title: 'Meeting Notes - Lisa Martinez',
      clientId: 'client-789',
      createdBy: 'agent'
    });

    console.log(`✓ Meeting Notes generated: ${meetingDoc.id}`);
    console.log(`  Status: ${meetingDoc.status}\n`);

    // Example 4: Document Approval Workflow
    console.log('4. Document Approval Workflow...');
    
    // Approve pending document
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-1',
        status: 'approved',
        template_id: 'template-1',
        title: 'Advisory Protocol - Sarah Johnson'
      }]
    });

    const approvedDoc = await documentService.approveDocument('doc-1', 'supervisor');
    console.log(`✓ Document approved: ${approvedDoc.id}`);
    console.log(`  New status: ${approvedDoc.status}\n`);

    // Example 5: Document Retrieval and Filtering
    console.log('5. Document Retrieval...');
    
    mockDb.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'doc-1',
          template_id: 'template-1',
          client_id: 'client-123',
          title: 'Advisory Protocol - Sarah Johnson',
          status: 'approved',
          created_at: new Date('2024-01-15')
        },
        {
          id: 'doc-2',
          template_id: 'template-2',
          client_id: 'client-456',
          title: 'Policy Summary - Robert Chen',
          status: 'approved',
          created_at: new Date('2024-01-16')
        }
      ]
    });

    const clientDocs = await documentService.getDocuments({
      status: 'approved',
      limit: 10
    });

    console.log(`✓ Retrieved ${clientDocs.length} approved documents:`);
    clientDocs.forEach(doc => {
      console.log(`  - ${doc.title} (${doc.status})`);
    });

    console.log('\n=== Demo completed successfully! ===');

  } catch (error) {
    console.error('Demo failed:', error);
  }
}

// Export for use in tests or standalone execution
export { documentGenerationDemo };

// Run demo if executed directly
if (require.main === module) {
  documentGenerationDemo().catch(console.error);
}
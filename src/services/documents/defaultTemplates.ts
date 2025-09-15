import { TemplateUploadRequest } from '../../types/documents';

export const defaultTemplates: TemplateUploadRequest[] = [
  {
    name: 'Advisory Protocol',
    type: 'advisory_protocol',
    riskLevel: 'high',
    requiredFields: ['client', 'agent', 'date', 'recommendations', 'risks', 'disclosures'],
    template: `
<!DOCTYPE html>
<html>
<head>
    <title>Advisory Protocol - {{ client.name }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .section { margin-bottom: 25px; }
        .section h2 { color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
        .client-info { background: #f5f5f5; padding: 15px; border-radius: 5px; }
        .recommendations { background: #e8f4fd; padding: 15px; border-left: 4px solid #2196F3; }
        .risks { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; }
        .disclosures { background: #f8d7da; padding: 15px; border-left: 4px solid #dc3545; font-size: 0.9em; }
        .signature-section { margin-top: 40px; display: flex; justify-content: space-between; }
        .signature-box { width: 45%; border-top: 1px solid #333; padding-top: 10px; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>ADVISORY PROTOCOL</h1>
        <p><strong>Date:</strong> {{ date | default('_____________') }}</p>
        <p><strong>Protocol ID:</strong> {{ protocolId | default('_____________') }}</p>
    </div>

    <div class="section client-info">
        <h2>Client Information</h2>
        <p><strong>Name:</strong> {{ client.name | default('_____________') }}</p>
        <p><strong>Policy Number:</strong> {{ client.policyNumber | default('_____________') }}</p>
        <p><strong>Contact:</strong> {{ client.email | default('_____________') }} | {{ client.phone | default('_____________') }}</p>
    </div>

    <div class="section">
        <h2>Agent Information</h2>
        <p><strong>Agent Name:</strong> {{ agent.name | default('_____________') }}</p>
        <p><strong>License Number:</strong> {{ agent.licenseNumber | default('_____________') }}</p>
        <p><strong>Agency:</strong> {{ agent.agency | default('_____________') }}</p>
    </div>

    <div class="section recommendations">
        <h2>Recommendations</h2>
        {% if recommendations %}
            {% for recommendation in recommendations %}
                <p><strong>{{ loop.index }}.</strong> {{ recommendation }}</p>
            {% endfor %}
        {% else %}
            <p>_____________________________________________________________________________</p>
            <p>_____________________________________________________________________________</p>
            <p>_____________________________________________________________________________</p>
        {% endif %}
    </div>

    <div class="section risks">
        <h2>Risk Assessment</h2>
        {% if risks %}
            {% for risk in risks %}
                <p><strong>{{ loop.index }}.</strong> {{ risk }}</p>
            {% endfor %}
        {% else %}
            <p>_____________________________________________________________________________</p>
            <p>_____________________________________________________________________________</p>
        {% endif %}
    </div>

    <div class="section disclosures">
        <h2>Important Disclosures</h2>
        {% if disclosures %}
            {% for disclosure in disclosures %}
                <p>{{ disclosure }}</p>
            {% endfor %}
        {% else %}
            <p>This advisory protocol is provided for informational purposes only and does not constitute legal or financial advice. Please consult with qualified professionals for specific guidance related to your situation.</p>
            <p>All recommendations are based on information provided by the client and current market conditions, which may change.</p>
        {% endif %}
    </div>

    <div class="signature-section">
        <div class="signature-box">
            <p>Client Signature</p>
            <p>{{ client.name | default('_____________') }}</p>
        </div>
        <div class="signature-box">
            <p>Agent Signature</p>
            <p>{{ agent.name | default('_____________') }}</p>
        </div>
    </div>
</body>
</html>
    `
  },
  {
    name: 'Policy Summary',
    type: 'policy_summary',
    riskLevel: 'medium',
    requiredFields: ['client', 'policy', 'coverage', 'premiums'],
    template: '<!DOCTYPE html><html><head><title>Policy Summary - {{ client.name }}</title><style>body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }.header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }.section { margin-bottom: 25px; }.section h2 { color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; }.policy-details { background: #f0f8ff; padding: 15px; border-radius: 5px; }.coverage-table { width: 100%; border-collapse: collapse; margin: 15px 0; }.coverage-table th, .coverage-table td { border: 1px solid #ddd; padding: 10px; text-align: left; }.coverage-table th { background-color: #f2f2f2; }.premium-box { background: #e8f5e8; padding: 15px; border-radius: 5px; text-align: center; }</style></head><body><div class="header"><h1>POLICY SUMMARY</h1><p><strong>Generated:</strong> {{ date | default(\'_____________\') }}</p></div><div class="section policy-details"><h2>Policy Information</h2><p><strong>Policy Number:</strong> {{ policy.number | default(\'_____________\') }}</p><p><strong>Policy Type:</strong> {{ policy.type | default(\'_____________\') }}</p><p><strong>Effective Date:</strong> {{ policy.effectiveDate | default(\'_____________\') }}</p><p><strong>Expiration Date:</strong> {{ policy.expirationDate | default(\'_____________\') }}</p><p><strong>Carrier:</strong> {{ policy.carrier | default(\'_____________\') }}</p></div><div class="section"><h2>Insured Information</h2><p><strong>Primary Insured:</strong> {{ client.name | default(\'_____________\') }}</p><p><strong>Address:</strong> {{ client.address | default(\'_____________\') }}</p><p><strong>Contact:</strong> {{ client.phone | default(\'_____________\') }} | {{ client.email | default(\'_____________\') }}</p></div><div class="section"><h2>Coverage Details</h2><table class="coverage-table"><thead><tr><th>Coverage Type</th><th>Limit</th><th>Deductible</th></tr></thead><tbody>{% if coverage %}{% for item in coverage %}<tr><td>{{ item.type }}</td><td>{{ item.limit }}</td><td>{{ item.deductible }}</td></tr>{% endfor %}{% else %}<tr><td>_____________</td><td>_____________</td><td>_____________</td></tr><tr><td>_____________</td><td>_____________</td><td>_____________</td></tr><tr><td>_____________</td><td>_____________</td><td>_____________</td></tr>{% endif %}</tbody></table></div><div class="section premium-box"><h2>Premium Information</h2><p><strong>Annual Premium:</strong> ${{ premiums.annual | default(\'_____________\') }}</p><p><strong>Payment Schedule:</strong> {{ premiums.schedule | default(\'_____________\') }}</p><p><strong>Next Payment Due:</strong> {{ premiums.nextDue | default(\'_____________\') }}</p></div><div class="section"><h2>Important Notes</h2><p>{{ notes | default(\'Please review this summary carefully and contact your agent with any questions. This summary does not replace your complete policy documents.\') }}</p></div></body></html>'
  },
  {
    name: 'Meeting Notes',
    type: 'meeting_notes',
    riskLevel: 'low',
    requiredFields: ['client', 'agent', 'date', 'topics', 'actionItems'],
    template: `
<!DOCTYPE html>
<html>
<head>
    <title>Meeting Notes - {{ client.name }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .section { margin-bottom: 25px; }
        .section h2 { color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
        .meeting-info { background: #f5f5f5; padding: 15px; border-radius: 5px; }
        .topics { background: #f0f8ff; padding: 15px; border-radius: 5px; }
        .action-items { background: #fff8dc; padding: 15px; border-radius: 5px; }
        .action-item { margin: 10px 0; padding: 10px; background: white; border-left: 4px solid #ffa500; }
    </style>
</head>
<body>
    <div class="header">
        <h1>MEETING NOTES</h1>
        <p><strong>Date:</strong> {{ date | default('_____________') }}</p>
    </div>

    <div class="section meeting-info">
        <h2>Meeting Information</h2>
        <p><strong>Client:</strong> {{ client.name | default('_____________') }}</p>
        <p><strong>Agent:</strong> {{ agent.name | default('_____________') }}</p>
        <p><strong>Meeting Type:</strong> {{ meetingType | default('_____________') }}</p>
        <p><strong>Duration:</strong> {{ duration | default('_____________') }}</p>
        <p><strong>Location:</strong> {{ location | default('_____________') }}</p>
    </div>

    <div class="section topics">
        <h2>Topics Discussed</h2>
        {% if topics %}
            {% for topic in topics %}
                <div style="margin-bottom: 15px;">
                    <h3>{{ topic.title }}</h3>
                    <p>{{ topic.discussion }}</p>
                </div>
            {% endfor %}
        {% else %}
            <p>_____________________________________________________________________________</p>
            <p>_____________________________________________________________________________</p>
            <p>_____________________________________________________________________________</p>
        {% endif %}
    </div>

    <div class="section action-items">
        <h2>Action Items</h2>
        {% if actionItems %}
            {% for item in actionItems %}
                <div class="action-item">
                    <p><strong>Action:</strong> {{ item.action }}</p>
                    <p><strong>Responsible:</strong> {{ item.responsible | default('TBD') }}</p>
                    <p><strong>Due Date:</strong> {{ item.dueDate | default('TBD') }}</p>
                </div>
            {% endfor %}
        {% else %}
            <div class="action-item">
                <p><strong>Action:</strong> _____________________________________________</p>
                <p><strong>Responsible:</strong> _____________</p>
                <p><strong>Due Date:</strong> _____________</p>
            </div>
            <div class="action-item">
                <p><strong>Action:</strong> _____________________________________________</p>
                <p><strong>Responsible:</strong> _____________</p>
                <p><strong>Due Date:</strong> _____________</p>
            </div>
        {% endif %}
    </div>

    <div class="section">
        <h2>Next Steps</h2>
        <p>{{ nextSteps | default('_____________________________________________________________________________') }}</p>
    </div>

    <div class="section">
        <h2>Additional Notes</h2>
        <p>{{ additionalNotes | default('_____________________________________________________________________________') }}</p>
    </div>
</body>
</html>
    `
  }
];

export async function initializeDefaultTemplates(templateService: any): Promise<void> {
  try {
    for (const template of defaultTemplates) {
      // Check if template already exists
      const existing = await templateService.getTemplates({ 
        type: template.type, 
        isDefault: true 
      });
      
      if (existing.length === 0) {
        await templateService.createTemplate(template, 'system');
        
        // Auto-approve default templates
        const created = await templateService.getTemplates({ 
          type: template.type, 
          status: 'draft' 
        });
        
        if (created.length > 0) {
          await templateService.approveTemplate({
            templateId: created[0].id,
            approved: true,
            comments: 'Auto-approved default template'
          }, 'system');
          
          // Mark as default
          await templateService.db.query(
            'UPDATE document_templates SET is_default = true WHERE id = $1',
            [created[0].id]
          );
        }
      }
    }
  } catch (error) {
    console.error('Error initializing default templates:', error);
  }
}
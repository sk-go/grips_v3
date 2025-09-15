---
inclusion: always
---

# Relationship Care Platform - Product Guidelines

## Core Product Philosophy

This is an **overlay system** for insurance agents - enhance existing CRMs, never replace them. Always prioritize relationship-building over administrative tasks.

### Key Principles
- **Minimal Data Duplication**: Sync only essential relationship data, avoid CRM bloat
- **Human-Centric**: Automate admin tasks to free agents for relationship building
- **Context Preservation**: Maintain full conversation history and relationship insights
- **Compliance First**: All features must support HIPAA/GDPR requirements with audit trails

## Supported CRM Integrations

When implementing CRM features, support these systems in priority order:
1. **Zoho CRM** - Primary integration target
2. **Salesforce** - Enterprise focus
3. **HubSpot** - Mid-market focus  
4. **AgencyBloc** - Insurance-specific CRM

## Feature Implementation Guidelines

### Communication Center
- Aggregate all client touchpoints (email, SMS, voice, meetings)
- Real-time processing with intelligent categorization
- Preserve original message context and metadata
- Support offline message queuing for reliability

### AI Assistant Interactions
- Maintain conversation context across sessions
- Support both voice and text interfaces
- Implement agentic workflows for multi-step automation
- Always provide confidence scores for AI-generated content
- Enable human approval workflows for sensitive actions

### Relationship Enhancement
- Overlay personal details and insights on existing CRM data
- Track sentiment trends and relationship health metrics
- Generate proactive relationship recommendations
- Visualize relationship networks and connection strength

### Document Generation
- Use template-based approach for compliance documents
- Support dynamic content insertion from CRM data
- Maintain document version history and audit trails
- Enable collaborative review and approval workflows

## Data Handling Standards

### Client Data
- Store only relationship-enhancing metadata, not core CRM data
- Implement data retention policies aligned with insurance regulations
- Encrypt all PII at rest and in transit
- Support data export and deletion for compliance

### Communication Data
- Preserve original message integrity with checksums
- Tag communications with relationship context
- Support bulk operations for efficiency
- Implement intelligent deduplication

## User Experience Patterns

### Insurance Agent Workflow
1. **Morning Brief**: Relationship insights and priority actions
2. **Communication Triage**: Intelligent message prioritization
3. **Client Preparation**: Context-aware meeting briefs
4. **Follow-up Automation**: Template-based follow-up sequences

### Interface Design
- Dashboard-first approach with key metrics visible
- Mobile-responsive for field agents
- Voice-first interactions when hands-free needed
- Progressive disclosure of complex features

## Integration Architecture

### CRM Sync Strategy
- Bi-directional sync for relationship data only
- Conflict resolution favoring CRM as source of truth
- Batch processing for efficiency, real-time for urgent updates
- Comprehensive error handling and retry logic

### Communication Channels
- Email: IMAP/SMTP with OAuth2 authentication
- SMS: Twilio integration with office hours management
- Voice: WebSocket-based real-time processing
- Calendar: Read-only integration for meeting context

## Compliance Requirements

### Data Security
- End-to-end encryption for all client communications
- Role-based access control with audit logging
- Regular security assessments and penetration testing
- Secure key management with rotation policies

### Regulatory Compliance
- HIPAA compliance for health insurance agents
- GDPR compliance for international operations
- SOC 2 Type II certification requirements
- Industry-specific audit trail requirements

## Performance Standards

### Response Times
- API responses: < 200ms for cached data, < 2s for complex queries
- Real-time features: < 100ms latency for voice/chat
- CRM sync: Complete within 5 minutes for standard datasets
- Document generation: < 30 seconds for standard templates

### Scalability Targets
- Support 10,000+ concurrent users
- Handle 1M+ communications per day
- Process 100+ CRM sync operations simultaneously
- Maintain 99.9% uptime SLA
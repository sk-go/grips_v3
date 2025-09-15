import { 
  AIAction, 
  ApprovalRequest, 
  ApprovalResponse, 
  RiskAssessment, 
  RiskFactor,
  RiskLevel,
  ApprovalType
} from '../../types/aiActions';
import { CacheService } from '../cacheService';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export class ApprovalWorkflowService extends EventEmitter {
  private cacheService: CacheService;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private approvalTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(cacheService: CacheService) {
    super();
    this.cacheService = cacheService;
  }

  async requestApproval(action: AIAction): Promise<ApprovalRequest> {
    logger.info('Requesting approval for action', {
      actionId: action.id,
      type: action.type,
      riskLevel: action.riskLevel
    });

    // Perform risk assessment
    const riskAssessment = await this.assessRisk(action);

    // Check if auto-approval is possible
    if (riskAssessment.autoApprovalEligible) {
      return await this.autoApprove(action, riskAssessment);
    }

    // Create approval request
    const approvalRequest: ApprovalRequest = {
      id: uuidv4(),
      actionId: action.id,
      type: this.determineApprovalType(action, riskAssessment),
      description: this.generateApprovalDescription(action),
      riskAssessment,
      requestedBy: action.context.agentId,
      requestedAt: new Date(),
      timeout: this.calculateApprovalTimeout(action),
      approvers: await this.getRequiredApprovers(action, riskAssessment),
      escalated: false
    };

    // Store approval request
    this.pendingApprovals.set(approvalRequest.id, approvalRequest);
    await this.cacheApprovalRequest(approvalRequest);

    // Update action status
    action.status = 'waiting_approval';
    action.approvalRequest = approvalRequest;
    action.updatedAt = new Date();

    // Set timeout for approval
    this.setApprovalTimeout(approvalRequest);

    // Emit approval request event
    this.emit('approval_requested', { action, approvalRequest });

    logger.info('Approval request created', {
      approvalId: approvalRequest.id,
      actionId: action.id,
      approvers: approvalRequest.approvers,
      timeout: approvalRequest.timeout
    });

    return approvalRequest;
  }

  async processApprovalResponse(
    approvalId: string, 
    response: ApprovalResponse
  ): Promise<void> {
    const approvalRequest = this.pendingApprovals.get(approvalId);
    if (!approvalRequest) {
      throw new Error(`Approval request not found: ${approvalId}`);
    }

    // Update approval request
    approvalRequest.response = response;
    await this.cacheApprovalRequest(approvalRequest);

    // Clear timeout
    this.clearApprovalTimeout(approvalId);

    // Remove from pending
    this.pendingApprovals.delete(approvalId);

    logger.info('Approval response processed', {
      approvalId,
      approved: response.approved,
      approvedBy: response.approvedBy,
      actionId: approvalRequest.actionId
    });

    // Emit approval response event
    this.emit('approval_responded', { approvalRequest, response });
  }

  private async assessRisk(action: AIAction): Promise<RiskAssessment> {
    const factors: RiskFactor[] = [];

    // Data sensitivity assessment
    const dataSensitivityScore = this.assessDataSensitivity(action);
    factors.push({
      name: 'Data Sensitivity',
      score: dataSensitivityScore,
      weight: 0.25,
      description: 'Sensitivity of data being processed',
      category: 'data_sensitivity'
    });

    // External impact assessment
    const externalImpactScore = this.assessExternalImpact(action);
    factors.push({
      name: 'External Impact',
      score: externalImpactScore,
      weight: 0.30,
      description: 'Impact on external systems and stakeholders',
      category: 'external_impact'
    });

    // Reversibility assessment
    const reversibilityScore = this.assessReversibility(action);
    factors.push({
      name: 'Reversibility',
      score: reversibilityScore,
      weight: 0.20,
      description: 'Ability to reverse or undo the action',
      category: 'reversibility'
    });

    // Compliance assessment
    const complianceScore = this.assessCompliance(action);
    factors.push({
      name: 'Compliance Risk',
      score: complianceScore,
      weight: 0.15,
      description: 'Risk of compliance violations',
      category: 'compliance'
    });

    // Cost assessment
    const costScore = this.assessCost(action);
    factors.push({
      name: 'Cost Impact',
      score: costScore,
      weight: 0.10,
      description: 'Financial impact of the action',
      category: 'cost'
    });

    // Calculate overall risk score
    const overallScore = factors.reduce((sum, factor) => 
      sum + (factor.score * factor.weight), 0
    );

    // Determine risk level
    const level = this.calculateRiskLevel(overallScore);

    // Generate mitigations
    const mitigations = this.generateMitigations(factors, action);

    // Determine auto-approval eligibility
    const autoApprovalEligible = this.isAutoApprovalEligible(
      overallScore, 
      level, 
      action.confidence,
      factors
    );

    return {
      level,
      score: overallScore,
      factors,
      mitigations,
      autoApprovalEligible
    };
  }

  private assessDataSensitivity(action: AIAction): number {
    let score = 0.2; // Base score

    const parameters = action.parameters;
    const sensitiveFields = [
      'ssn', 'social_security', 'credit_card', 'bank_account', 
      'password', 'personal_info', 'medical_info', 'financial_data'
    ];

    // Check for sensitive data in parameters
    for (const [key, value] of Object.entries(parameters)) {
      const keyLower = key.toLowerCase();
      const valueLower = typeof value === 'string' ? value.toLowerCase() : '';

      if (sensitiveFields.some(field => keyLower.includes(field) || valueLower.includes(field))) {
        score += 0.3;
      }
    }

    // Action type specific scoring
    switch (action.type) {
      case 'send_email':
      case 'make_call':
        score += 0.2; // Communication actions have moderate sensitivity
        break;
      case 'update_crm':
        score += 0.3; // CRM updates can be sensitive
        break;
      case 'generate_document':
        score += 0.1; // Document generation is usually less sensitive
        break;
    }

    return Math.min(1.0, score);
  }

  private assessExternalImpact(action: AIAction): number {
    let score = 0.1; // Base score

    // Action type specific scoring
    switch (action.type) {
      case 'send_email':
        score += 0.6; // High external impact
        break;
      case 'make_call':
        score += 0.7; // Very high external impact
        break;
      case 'schedule_meeting':
        score += 0.5; // Moderate external impact
        break;
      case 'update_crm':
        score += 0.2; // Low external impact (internal system)
        break;
      case 'send_notification':
        score += 0.3; // Moderate external impact
        break;
      case 'generate_document':
        score += 0.1; // Low external impact initially
        break;
      default:
        score += 0.2;
    }

    // Check if action affects multiple recipients
    if (action.parameters.recipients && Array.isArray(action.parameters.recipients)) {
      const recipientCount = action.parameters.recipients.length;
      score += Math.min(0.3, recipientCount * 0.05);
    }

    return Math.min(1.0, score);
  }

  private assessReversibility(action: AIAction): number {
    let score = 0.5; // Base score (moderate reversibility)

    // Action type specific scoring (higher score = less reversible = higher risk)
    switch (action.type) {
      case 'send_email':
      case 'make_call':
        score = 0.9; // Very hard to reverse
        break;
      case 'send_notification':
        score = 0.8; // Hard to reverse
        break;
      case 'schedule_meeting':
        score = 0.3; // Easy to reverse (can cancel)
        break;
      case 'update_crm':
        score = 0.2; // Easy to reverse (can update again)
        break;
      case 'create_task':
        score = 0.1; // Very easy to reverse (can delete)
        break;
      case 'generate_document':
        score = 0.1; // Easy to reverse (can delete/regenerate)
        break;
    }

    return score;
  }

  private assessCompliance(action: AIAction): number {
    let score = 0.1; // Base score

    // Check for compliance-sensitive actions
    if (action.type === 'send_email' || action.type === 'make_call') {
      score += 0.3; // Communication compliance risks
    }

    if (action.type === 'update_crm') {
      score += 0.2; // Data handling compliance
    }

    // Check for regulated data
    const parameters = action.parameters;
    const regulatedTerms = ['hipaa', 'gdpr', 'pii', 'phi', 'financial', 'medical'];
    
    for (const [key, value] of Object.entries(parameters)) {
      const content = `${key} ${value}`.toLowerCase();
      if (regulatedTerms.some(term => content.includes(term))) {
        score += 0.2;
      }
    }

    return Math.min(1.0, score);
  }

  private assessCost(action: AIAction): number {
    let score = 0.1; // Base score

    // Action type specific scoring
    switch (action.type) {
      case 'make_call':
        score += 0.3; // Phone calls have direct costs
        break;
      case 'send_email':
        score += 0.1; // Minimal cost
        break;
      case 'generate_document':
        score += 0.2; // Processing costs
        break;
      default:
        score += 0.1;
    }

    // Check for bulk operations
    if (action.parameters.bulk || action.parameters.count > 10) {
      score += 0.2;
    }

    return Math.min(1.0, score);
  }

  private calculateRiskLevel(score: number): RiskLevel {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.4) return 'medium';
    return 'low';
  }

  private generateMitigations(factors: RiskFactor[], action: AIAction): string[] {
    const mitigations: string[] = [];

    // Generate mitigations based on high-risk factors
    for (const factor of factors) {
      if (factor.score > 0.6) {
        switch (factor.category) {
          case 'data_sensitivity':
            mitigations.push('Implement additional data encryption');
            mitigations.push('Require data handling approval');
            break;
          case 'external_impact':
            mitigations.push('Review recipient list carefully');
            mitigations.push('Use staged rollout approach');
            break;
          case 'reversibility':
            mitigations.push('Create backup before execution');
            mitigations.push('Implement rollback procedure');
            break;
          case 'compliance':
            mitigations.push('Conduct compliance review');
            mitigations.push('Document regulatory justification');
            break;
          case 'cost':
            mitigations.push('Implement cost controls');
            mitigations.push('Require budget approval');
            break;
        }
      }
    }

    // Action-specific mitigations
    if (action.type === 'send_email') {
      mitigations.push('Preview email content before sending');
      mitigations.push('Verify recipient addresses');
    }

    if (action.type === 'update_crm') {
      mitigations.push('Validate data before update');
      mitigations.push('Create audit trail');
    }

    return mitigations;
  }

  private isAutoApprovalEligible(
    riskScore: number, 
    riskLevel: RiskLevel, 
    confidence: number,
    factors: RiskFactor[]
  ): boolean {
    // Basic eligibility criteria
    if (riskLevel === 'critical' || riskLevel === 'high') {
      return false;
    }

    if (confidence < 0.8) {
      return false;
    }

    if (riskScore > 0.5) {
      return false;
    }

    // Check for specific high-risk factors
    const hasHighRiskFactors = factors.some(factor => 
      factor.score > 0.7 && (
        factor.category === 'data_sensitivity' || 
        factor.category === 'compliance'
      )
    );

    return !hasHighRiskFactors;
  }

  private async autoApprove(action: AIAction, riskAssessment: RiskAssessment): Promise<ApprovalRequest> {
    const approvalRequest: ApprovalRequest = {
      id: uuidv4(),
      actionId: action.id,
      type: 'automatic',
      description: 'Auto-approved based on low risk assessment',
      riskAssessment,
      requestedBy: action.context.agentId,
      requestedAt: new Date(),
      timeout: 0,
      approvers: ['system'],
      escalated: false,
      response: {
        approved: true,
        approvedBy: 'system',
        approvedAt: new Date(),
        reason: 'Auto-approved: low risk and high confidence'
      }
    };

    // Update action status
    action.status = 'approved';
    action.approvalRequest = approvalRequest;
    action.approvedAt = new Date();
    action.updatedAt = new Date();

    await this.cacheApprovalRequest(approvalRequest);

    logger.info('Action auto-approved', {
      actionId: action.id,
      riskScore: riskAssessment.score,
      confidence: action.confidence
    });

    this.emit('action_auto_approved', { action, approvalRequest });

    return approvalRequest;
  }

  private determineApprovalType(action: AIAction, riskAssessment: RiskAssessment): ApprovalType {
    if (riskAssessment.autoApprovalEligible) {
      return 'automatic';
    }

    if (riskAssessment.level === 'critical') {
      return 'escalated';
    }

    return 'manual';
  }

  private generateApprovalDescription(action: AIAction): string {
    const actionDescriptions = {
      send_email: `Send email: "${action.parameters.subject || 'No subject'}" to ${action.parameters.to || 'recipient'}`,
      make_call: `Make call to ${action.parameters.to || 'recipient'}`,
      schedule_meeting: `Schedule meeting: "${action.parameters.subject || 'Meeting'}" with ${action.parameters.attendees || 'attendees'}`,
      update_crm: `Update CRM record for ${action.parameters.clientId || 'client'}`,
      create_task: `Create task: "${action.parameters.title || action.description}"`,
      generate_document: `Generate document: ${action.parameters.type || 'document'} for ${action.parameters.clientId || 'client'}`,
      send_notification: `Send notification: "${action.parameters.message || 'notification'}"`,
      analyze_data: `Analyze data for ${action.parameters.clientId || 'analysis'}`,
      fetch_data: `Fetch data from ${action.parameters.source || 'source'}`,
      validate_data: `Validate data for ${action.parameters.clientId || 'validation'}`,
      custom: action.description
    };

    return actionDescriptions[action.type] || action.description;
  }

  private calculateApprovalTimeout(action: AIAction): number {
    // Base timeout based on action priority
    const baseTimeouts = {
      urgent: 5 * 60 * 1000,    // 5 minutes
      high: 15 * 60 * 1000,     // 15 minutes
      medium: 30 * 60 * 1000,   // 30 minutes
      low: 60 * 60 * 1000       // 1 hour
    };

    let timeout = baseTimeouts[action.priority];

    // Adjust based on risk level
    if (action.riskLevel === 'critical') {
      timeout *= 2; // More time for critical decisions
    } else if (action.riskLevel === 'low') {
      timeout *= 0.5; // Less time for low-risk decisions
    }

    return timeout;
  }

  private async getRequiredApprovers(action: AIAction, riskAssessment: RiskAssessment): Promise<string[]> {
    const approvers: string[] = [];

    // Default approver is the requesting agent's supervisor
    approvers.push('supervisor');

    // Add additional approvers based on risk level
    if (riskAssessment.level === 'high' || riskAssessment.level === 'critical') {
      approvers.push('manager');
    }

    if (riskAssessment.level === 'critical') {
      approvers.push('director');
    }

    // Add compliance officer for compliance-sensitive actions
    const hasComplianceRisk = riskAssessment.factors.some(f => 
      f.category === 'compliance' && f.score > 0.5
    );
    
    if (hasComplianceRisk) {
      approvers.push('compliance_officer');
    }

    return approvers;
  }

  private setApprovalTimeout(approvalRequest: ApprovalRequest): void {
    const timeout = setTimeout(async () => {
      await this.handleApprovalTimeout(approvalRequest.id);
    }, approvalRequest.timeout);

    this.approvalTimeouts.set(approvalRequest.id, timeout);
  }

  private clearApprovalTimeout(approvalId: string): void {
    const timeout = this.approvalTimeouts.get(approvalId);
    if (timeout) {
      clearTimeout(timeout);
      this.approvalTimeouts.delete(approvalId);
    }
  }

  private async handleApprovalTimeout(approvalId: string): Promise<void> {
    const approvalRequest = this.pendingApprovals.get(approvalId);
    if (!approvalRequest) return;

    logger.warn('Approval request timed out', {
      approvalId,
      actionId: approvalRequest.actionId,
      timeout: approvalRequest.timeout
    });

    // Mark as escalated and extend timeout
    approvalRequest.escalated = true;
    approvalRequest.timeout = approvalRequest.timeout * 2; // Double the timeout

    // Emit escalation event
    this.emit('approval_escalated', { approvalRequest });

    // Set new timeout
    this.setApprovalTimeout(approvalRequest);
  }

  async getPendingApprovals(approverId?: string): Promise<ApprovalRequest[]> {
    const approvals = Array.from(this.pendingApprovals.values());
    
    if (approverId) {
      return approvals.filter(approval => 
        approval.approvers.includes(approverId)
      );
    }
    
    return approvals;
  }

  async getApprovalRequest(approvalId: string): Promise<ApprovalRequest | null> {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) return pending;

    // Try cache
    try {
      const cached = await this.cacheService.get(`approval:${approvalId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Failed to get approval from cache', { error, approvalId });
      return null;
    }
  }

  private async cacheApprovalRequest(request: ApprovalRequest): Promise<void> {
    try {
      await this.cacheService.set(
        `approval:${request.id}`,
        JSON.stringify(request),
        86400 // 24 hours TTL
      );
    } catch (error) {
      logger.error('Failed to cache approval request', { error, approvalId: request.id });
    }
  }

  async shutdown(): Promise<void> {
    // Clear all timeouts
    for (const timeout of this.approvalTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.approvalTimeouts.clear();
    
    logger.info('Approval workflow service shutdown complete');
  }
}
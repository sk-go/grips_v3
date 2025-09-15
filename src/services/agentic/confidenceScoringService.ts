import { 
  ConfidenceScoring, 
  ConfidenceFactor, 
  AgenticWorkflow, 
  WorkflowStep, 
  RiskLevel 
} from '../../types/agentic';
import { logger } from '../../utils/logger';

export class ConfidenceScoringService {
  private confidenceWeights = {
    dataQuality: 0.25,
    stepComplexity: 0.20,
    historicalSuccess: 0.20,
    contextRelevance: 0.15,
    riskLevel: 0.10,
    timeConstraints: 0.10
  };

  private riskThresholds = {
    low: 0.8,
    medium: 0.6,
    high: 0.4,
    critical: 0.2
  };

  calculateWorkflowConfidence(workflow: AgenticWorkflow): ConfidenceScoring {
    logger.debug('Calculating workflow confidence', { workflowId: workflow.id });

    const factors: ConfidenceFactor[] = [];
    const stepScores: Record<string, number> = {};

    // Calculate confidence for each step
    for (const step of workflow.steps) {
      const stepConfidence = this.calculateStepConfidence(step, workflow);
      stepScores[step.id] = stepConfidence.score;
      factors.push(...stepConfidence.factors);
    }

    // Calculate overall workflow confidence
    const overallScore = this.calculateOverallScore(factors);
    const threshold = this.getConfidenceThreshold(workflow);
    const escalationRequired = overallScore < threshold;

    const scoring: ConfidenceScoring = {
      overall: overallScore,
      stepScores,
      factors,
      threshold,
      escalationRequired
    };

    logger.debug('Workflow confidence calculated', {
      workflowId: workflow.id,
      overallScore,
      escalationRequired,
      factorCount: factors.length
    });

    return scoring;
  }

  private calculateStepConfidence(step: WorkflowStep, workflow: AgenticWorkflow): {
    score: number;
    factors: ConfidenceFactor[];
  } {
    const factors: ConfidenceFactor[] = [];

    // Data quality factor
    const dataQualityScore = this.assessDataQuality(step, workflow);
    factors.push({
      name: 'Data Quality',
      score: dataQualityScore,
      weight: this.confidenceWeights.dataQuality,
      description: 'Quality and completeness of input data'
    });

    // Step complexity factor
    const complexityScore = this.assessStepComplexity(step);
    factors.push({
      name: 'Step Complexity',
      score: complexityScore,
      weight: this.confidenceWeights.stepComplexity,
      description: 'Complexity of the step execution'
    });

    // Historical success factor
    const historicalScore = this.assessHistoricalSuccess(step);
    factors.push({
      name: 'Historical Success',
      score: historicalScore,
      weight: this.confidenceWeights.historicalSuccess,
      description: 'Past success rate for similar steps'
    });

    // Context relevance factor
    const contextScore = this.assessContextRelevance(step, workflow);
    factors.push({
      name: 'Context Relevance',
      score: contextScore,
      weight: this.confidenceWeights.contextRelevance,
      description: 'Relevance of available context data'
    });

    // Risk level factor
    const riskScore = this.assessRiskLevel(step);
    factors.push({
      name: 'Risk Level',
      score: riskScore,
      weight: this.confidenceWeights.riskLevel,
      description: 'Risk associated with step execution'
    });

    // Time constraints factor
    const timeScore = this.assessTimeConstraints(step, workflow);
    factors.push({
      name: 'Time Constraints',
      score: timeScore,
      weight: this.confidenceWeights.timeConstraints,
      description: 'Impact of time constraints on execution'
    });

    // Calculate weighted score
    const weightedScore = factors.reduce((sum, factor) => 
      sum + (factor.score * factor.weight), 0
    );

    return {
      score: Math.min(1.0, Math.max(0.0, weightedScore)),
      factors
    };
  }

  private assessDataQuality(step: WorkflowStep, workflow: AgenticWorkflow): number {
    let score = 0.5; // Base score

    // Check if required context data is available
    const context = workflow.context;
    
    if (context.clientId) score += 0.2;
    if (context.crmData) score += 0.2;
    if (context.communicationHistory && context.communicationHistory.length > 0) score += 0.1;

    // Check step-specific data requirements
    const parameters = step.action.parameters;
    
    if (parameters) {
      const requiredFields = Object.keys(parameters);
      const availableFields = requiredFields.filter(field => 
        parameters[field] !== undefined && parameters[field] !== null
      );
      
      if (requiredFields.length > 0) {
        score += (availableFields.length / requiredFields.length) * 0.3;
      }
    }

    return Math.min(1.0, score);
  }

  private assessStepComplexity(step: WorkflowStep): number {
    let complexityScore = 0.8; // Start with high confidence

    // Reduce confidence based on step complexity factors
    switch (step.type) {
      case 'ai_processing':
        complexityScore -= 0.2;
        break;
      case 'document_generation':
        complexityScore -= 0.15;
        break;
      case 'communication':
        complexityScore -= 0.1;
        break;
      case 'crm_update':
        complexityScore -= 0.05;
        break;
      case 'validation':
        complexityScore += 0.1;
        break;
    }

    // Consider dependencies
    if (step.dependencies.length > 3) {
      complexityScore -= 0.1;
    }

    // Consider retry requirements
    if (step.maxRetries > 2) {
      complexityScore -= 0.05;
    }

    return Math.min(1.0, Math.max(0.1, complexityScore));
  }

  private assessHistoricalSuccess(step: WorkflowStep): number {
    // In a real implementation, this would query historical execution data
    // For now, return estimated success rates based on step type
    
    const successRates: Record<string, number> = {
      'data_fetch': 0.95,
      'validation': 0.98,
      'crm_update': 0.90,
      'ai_processing': 0.85,
      'communication': 0.88,
      'document_generation': 0.82,
      'notification': 0.95,
      'custom': 0.70
    };

    return successRates[step.type] || 0.75;
  }

  private assessContextRelevance(step: WorkflowStep, workflow: AgenticWorkflow): number {
    let relevanceScore = 0.5;

    const context = workflow.context;
    
    // Check if context matches step requirements
    switch (step.type) {
      case 'communication':
        if (context.clientId) relevanceScore += 0.3;
        if (context.communicationHistory) relevanceScore += 0.2;
        break;
        
      case 'crm_update':
        if (context.clientId) relevanceScore += 0.4;
        if (context.crmData) relevanceScore += 0.1;
        break;
        
      case 'ai_processing':
        if (context.originalRequest) relevanceScore += 0.2;
        if (context.entities && context.entities.length > 0) relevanceScore += 0.2;
        if (context.extractedIntent) relevanceScore += 0.1;
        break;
        
      case 'document_generation':
        if (context.clientId) relevanceScore += 0.3;
        if (context.crmData) relevanceScore += 0.2;
        break;
    }

    return Math.min(1.0, relevanceScore);
  }

  private assessRiskLevel(step: WorkflowStep): number {
    // Higher risk = lower confidence
    const riskScores: Record<RiskLevel, number> = {
      'low': 0.9,
      'medium': 0.7,
      'high': 0.5,
      'critical': 0.3
    };

    let baseScore = riskScores[step.riskLevel];

    // Adjust based on approval requirements
    if (step.requiresApproval) {
      baseScore += 0.1; // Approval adds confidence
    }

    return Math.min(1.0, baseScore);
  }

  private assessTimeConstraints(step: WorkflowStep, workflow: AgenticWorkflow): number {
    const config = workflow.config;
    let timeScore = 0.8;

    // Check if latency optimization is enabled
    if (config.latencyOptimization.enabled) {
      const maxLatency = config.latencyOptimization.maxLatency;
      const stepTimeout = step.timeout;
      
      if (stepTimeout > maxLatency * 0.5) {
        timeScore -= 0.2; // Step might be too slow
      }
      
      if (step.parallelGroup) {
        timeScore += 0.1; // Parallel execution helps
      }
    }

    // Consider total workflow timeout
    if (config.totalTimeout && step.timeout > config.totalTimeout * 0.3) {
      timeScore -= 0.1;
    }

    return Math.min(1.0, Math.max(0.2, timeScore));
  }

  private calculateOverallScore(factors: ConfidenceFactor[]): number {
    const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
    
    if (totalWeight === 0) return 0.5;
    
    const weightedSum = factors.reduce((sum, factor) => 
      sum + (factor.score * factor.weight), 0
    );
    
    return weightedSum / totalWeight;
  }

  private getConfidenceThreshold(workflow: AgenticWorkflow): number {
    // Base threshold from configuration
    let threshold = workflow.config.autoApproveThreshold;

    // Adjust based on workflow priority
    switch (workflow.priority) {
      case 'urgent':
        threshold -= 0.1; // Lower threshold for urgent workflows
        break;
      case 'high':
        threshold -= 0.05;
        break;
      case 'low':
        threshold += 0.05;
        break;
    }

    // Adjust based on risk levels in workflow
    const hasHighRiskSteps = workflow.steps.some(s => 
      s.riskLevel === 'high' || s.riskLevel === 'critical'
    );
    
    if (hasHighRiskSteps) {
      threshold += 0.1; // Higher threshold for risky workflows
    }

    return Math.min(0.95, Math.max(0.3, threshold));
  }

  assessStepRisk(step: WorkflowStep, context: any): RiskLevel {
    let riskScore = 0;

    // Base risk from step type
    const typeRiskScores: Record<string, number> = {
      'communication': 0.6,
      'crm_update': 0.4,
      'document_generation': 0.5,
      'ai_processing': 0.3,
      'data_fetch': 0.1,
      'validation': 0.1,
      'notification': 0.2
    };

    riskScore += typeRiskScores[step.type] || 0.3;

    // Adjust based on action type
    switch (step.action.type) {
      case 'send_email':
      case 'make_call':
        riskScore += 0.3;
        break;
      case 'update_crm_record':
        riskScore += 0.2;
        break;
      case 'generate_document':
        riskScore += 0.1;
        break;
    }

    // Consider data sensitivity
    if (this.containsSensitiveData(step.action.parameters)) {
      riskScore += 0.2;
    }

    // Consider external dependencies
    if (this.hasExternalDependencies(step)) {
      riskScore += 0.1;
    }

    // Convert score to risk level
    if (riskScore >= 0.8) return 'critical';
    if (riskScore >= 0.6) return 'high';
    if (riskScore >= 0.4) return 'medium';
    return 'low';
  }

  private containsSensitiveData(parameters: Record<string, any>): boolean {
    const sensitiveFields = ['ssn', 'credit_card', 'password', 'personal_info'];
    
    return Object.keys(parameters).some(key => 
      sensitiveFields.some(field => key.toLowerCase().includes(field))
    );
  }

  private hasExternalDependencies(step: WorkflowStep): boolean {
    const externalActions = [
      'send_email',
      'make_call',
      'update_crm_record',
      'fetch_crm_data'
    ];
    
    return externalActions.includes(step.action.type);
  }

  updateConfidenceWeights(newWeights: Partial<typeof this.confidenceWeights>): void {
    this.confidenceWeights = { ...this.confidenceWeights, ...newWeights };
    
    // Ensure weights sum to 1.0
    const totalWeight = Object.values(this.confidenceWeights).reduce((sum, w) => sum + w, 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      logger.warn('Confidence weights do not sum to 1.0', { 
        totalWeight, 
        weights: this.confidenceWeights 
      });
    }
  }

  getConfidenceWeights(): typeof this.confidenceWeights {
    return { ...this.confidenceWeights };
  }
}
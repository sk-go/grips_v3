import { ExtractedTask, Entity, ConversationContext } from '../../types/nlp';
import { logger } from '../../utils/logger';

export class TaskExtractionService {
  private taskPatterns: TaskPattern[] = [
    {
      type: 'email',
      patterns: [
        /send\s+(?:an?\s+)?email\s+to\s+(.+)/i,
        /email\s+(.+)\s+about\s+(.+)/i,
        /compose\s+(?:an?\s+)?email/i,
        /draft\s+(?:an?\s+)?email/i
      ],
      priority: 'medium',
      requiresApproval: true
    },
    {
      type: 'call',
      patterns: [
        /call\s+(.+)/i,
        /phone\s+(.+)/i,
        /contact\s+(.+)\s+by\s+phone/i,
        /schedule\s+(?:a\s+)?call\s+with\s+(.+)/i
      ],
      priority: 'high',
      requiresApproval: false
    },
    {
      type: 'meeting',
      patterns: [
        /schedule\s+(?:a\s+)?meeting\s+with\s+(.+)/i,
        /set\s+up\s+(?:a\s+)?meeting/i,
        /book\s+(?:a\s+)?meeting/i,
        /arrange\s+(?:a\s+)?meeting/i
      ],
      priority: 'medium',
      requiresApproval: true
    },
    {
      type: 'follow_up',
      patterns: [
        /follow\s+up\s+(?:with\s+)?(.+)/i,
        /remind\s+me\s+to\s+(.+)/i,
        /check\s+(?:back\s+)?(?:with\s+)?(.+)/i,
        /touch\s+base\s+with\s+(.+)/i
      ],
      priority: 'low',
      requiresApproval: false
    },
    {
      type: 'document_generation',
      patterns: [
        /generate\s+(?:a\s+)?(.+)\s+(?:document|report|summary)/i,
        /create\s+(?:a\s+)?(.+)\s+(?:document|report)/i,
        /prepare\s+(?:a\s+)?(.+)\s+(?:document|report)/i,
        /draft\s+(?:a\s+)?(.+)\s+(?:document|report)/i
      ],
      priority: 'medium',
      requiresApproval: true
    },
    {
      type: 'crm_update',
      patterns: [
        /update\s+(.+)\s+(?:in\s+)?(?:crm|system|record)/i,
        /add\s+(.+)\s+to\s+(?:crm|system|record)/i,
        /record\s+(.+)\s+(?:in\s+)?(?:crm|system)/i,
        /log\s+(.+)\s+(?:in\s+)?(?:crm|system)/i
      ],
      priority: 'low',
      requiresApproval: false
    },
    {
      type: 'research',
      patterns: [
        /research\s+(.+)/i,
        /look\s+up\s+(.+)/i,
        /find\s+(?:out\s+)?(?:about\s+)?(.+)/i,
        /investigate\s+(.+)/i
      ],
      priority: 'low',
      requiresApproval: false
    }
  ];

  private urgencyKeywords = [
    'urgent', 'asap', 'immediately', 'emergency', 'critical', 'important',
    'rush', 'priority', 'deadline', 'today', 'now'
  ];

  extractTasks(text: string, entities: Entity[], context?: ConversationContext): ExtractedTask[] {
    const tasks: ExtractedTask[] = [];
    const lowerText = text.toLowerCase();

    // Check for urgency indicators
    const isUrgent = this.urgencyKeywords.some(keyword => 
      lowerText.includes(keyword.toLowerCase())
    );

    // Extract tasks using patterns
    for (const taskPattern of this.taskPatterns) {
      for (const pattern of taskPattern.patterns) {
        const matches = text.match(pattern);
        if (matches) {
          const task = this.createTaskFromMatch(
            taskPattern,
            matches,
            entities,
            context,
            isUrgent
          );
          if (task) {
            tasks.push(task);
          }
        }
      }
    }

    // Extract tasks using entity-based analysis
    const entityTasks = this.extractTasksFromEntities(text, entities, context, isUrgent);
    tasks.push(...entityTasks);

    // Remove duplicates and merge similar tasks
    return this.deduplicateTasks(tasks);
  }

  private createTaskFromMatch(
    pattern: TaskPattern,
    matches: RegExpMatchArray,
    entities: Entity[],
    context?: ConversationContext,
    isUrgent: boolean = false
  ): ExtractedTask | null {
    try {
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Extract parameters from the match
      const parameters: Record<string, any> = {};
      
      if (matches[1]) {
        parameters.target = matches[1].trim();
      }
      
      if (matches[2]) {
        parameters.subject = matches[2].trim();
      }

      // Add relevant entities as parameters
      entities.forEach(entity => {
        if (entity.type === 'person' && !parameters.target) {
          parameters.target = entity.value;
        } else if (entity.type === 'date' && !parameters.dueDate) {
          parameters.dueDate = entity.value;
        } else if (entity.type === 'email') {
          parameters.email = entity.value;
        } else if (entity.type === 'phone') {
          parameters.phone = entity.value;
        }
      });

      // Add context information
      if (context?.clientId) {
        parameters.clientId = context.clientId;
      }

      // Determine priority
      let priority = pattern.priority;
      if (isUrgent) {
        priority = priority === 'low' ? 'medium' : 'high';
      }

      // Generate description
      const description = this.generateTaskDescription(pattern.type, parameters, matches[0]);

      // Calculate confidence based on pattern match quality
      const confidence = this.calculateTaskConfidence(matches, entities, pattern);

      return {
        id: taskId,
        type: pattern.type,
        description,
        priority,
        parameters,
        confidence,
        requiresApproval: pattern.requiresApproval || priority === 'high',
        dueDate: parameters.dueDate ? new Date(parameters.dueDate) : undefined,
        clientId: parameters.clientId
      };

    } catch (error) {
      logger.error('Failed to create task from match', { error, pattern: pattern.type });
      return null;
    }
  }

  private extractTasksFromEntities(
    text: string,
    entities: Entity[],
    context?: ConversationContext,
    isUrgent: boolean = false
  ): ExtractedTask[] {
    const tasks: ExtractedTask[] = [];

    // Look for action verbs near entities
    const actionVerbs = [
      'send', 'call', 'email', 'contact', 'schedule', 'update', 'create',
      'generate', 'prepare', 'follow', 'remind', 'check', 'research'
    ];

    entities.forEach(entity => {
      const entityIndex = text.indexOf(entity.value);
      const surroundingText = text.substring(
        Math.max(0, entityIndex - 50),
        Math.min(text.length, entityIndex + entity.value.length + 50)
      ).toLowerCase();

      for (const verb of actionVerbs) {
        if (surroundingText.includes(verb)) {
          const task = this.createEntityBasedTask(entity, verb, text, context, isUrgent);
          if (task) {
            tasks.push(task);
          }
          break; // Only create one task per entity
        }
      }
    });

    return tasks;
  }

  private createEntityBasedTask(
    entity: Entity,
    actionVerb: string,
    fullText: string,
    context?: ConversationContext,
    isUrgent: boolean = false
  ): ExtractedTask | null {
    const taskId = `entity_task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    let taskType: ExtractedTask['type'] = 'follow_up'; // Default
    let requiresApproval = false;
    let priority: ExtractedTask['priority'] = 'medium';

    // Determine task type based on action verb and entity type
    if (actionVerb === 'email' || actionVerb === 'send') {
      taskType = 'email';
      requiresApproval = true;
    } else if (actionVerb === 'call' || actionVerb === 'contact') {
      taskType = 'call';
      priority = 'high';
    } else if (actionVerb === 'schedule') {
      taskType = 'meeting';
      requiresApproval = true;
    } else if (actionVerb === 'update' || actionVerb === 'create') {
      taskType = 'crm_update';
    } else if (actionVerb === 'research' || actionVerb === 'check') {
      taskType = 'research';
      priority = 'low';
    }

    if (isUrgent) {
      priority = priority === 'low' ? 'medium' : 'high';
    }

    const parameters: Record<string, any> = {
      target: entity.value,
      entityType: entity.type,
      actionVerb
    };

    if (context?.clientId) {
      parameters.clientId = context.clientId;
    }

    const description = `${actionVerb.charAt(0).toUpperCase() + actionVerb.slice(1)} ${entity.value}`;

    return {
      id: taskId,
      type: taskType,
      description,
      priority,
      parameters,
      confidence: entity.confidence * 0.8, // Slightly lower confidence for entity-based tasks
      requiresApproval: requiresApproval || priority === 'high',
      clientId: parameters.clientId
    };
  }

  private generateTaskDescription(
    taskType: ExtractedTask['type'],
    parameters: Record<string, any>,
    originalMatch: string
  ): string {
    const target = parameters.target || 'unknown';
    const subject = parameters.subject || '';

    switch (taskType) {
      case 'email':
        return `Send email to ${target}${subject ? ` about ${subject}` : ''}`;
      case 'call':
        return `Call ${target}`;
      case 'meeting':
        return `Schedule meeting with ${target}`;
      case 'follow_up':
        return `Follow up with ${target}`;
      case 'document_generation':
        return `Generate ${target} document`;
      case 'crm_update':
        return `Update CRM with ${target}`;
      case 'research':
        return `Research ${target}`;
      default:
        return originalMatch;
    }
  }

  private calculateTaskConfidence(
    matches: RegExpMatchArray,
    entities: Entity[],
    pattern: TaskPattern
  ): number {
    let confidence = 0.7; // Base confidence

    // Increase confidence for more specific matches
    if (matches.length > 1) {
      confidence += 0.1;
    }

    // Increase confidence if relevant entities are present
    const relevantEntities = entities.filter(entity => 
      entity.type === 'person' || entity.type === 'email' || entity.type === 'phone'
    );
    
    confidence += Math.min(0.2, relevantEntities.length * 0.05);

    // Adjust based on pattern specificity
    if (pattern.patterns.length === 1) {
      confidence += 0.1; // More specific patterns get higher confidence
    }

    return Math.min(1.0, confidence);
  }

  private deduplicateTasks(tasks: ExtractedTask[]): ExtractedTask[] {
    const uniqueTasks: ExtractedTask[] = [];
    const seen = new Set<string>();

    for (const task of tasks) {
      // Create a signature for the task
      const signature = `${task.type}_${task.parameters.target || ''}_${task.description}`;
      
      if (!seen.has(signature)) {
        seen.add(signature);
        uniqueTasks.push(task);
      } else {
        // If we've seen this task before, merge with higher confidence
        const existingIndex = uniqueTasks.findIndex(t => 
          `${t.type}_${t.parameters.target || ''}_${t.description}` === signature
        );
        
        if (existingIndex >= 0 && task.confidence > uniqueTasks[existingIndex].confidence) {
          uniqueTasks[existingIndex] = task;
        }
      }
    }

    return uniqueTasks.sort((a, b) => b.confidence - a.confidence);
  }
}

interface TaskPattern {
  type: ExtractedTask['type'];
  patterns: RegExp[];
  priority: ExtractedTask['priority'];
  requiresApproval: boolean;
}
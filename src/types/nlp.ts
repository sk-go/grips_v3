export interface NLPRequest {
  text: string;
  context?: ConversationContext;
  language?: string;
  sessionId?: string;
}

export interface NLPResponse {
  intent: Intent;
  entities: Entity[];
  tasks: ExtractedTask[];
  sentiment: SentimentAnalysis;
  confidence: number;
  language: string;
  processingTime: number;
}

export interface Intent {
  name: string;
  confidence: number;
  category: 'task_request' | 'question' | 'greeting' | 'complaint' | 'compliment' | 'other';
  parameters?: Record<string, any>;
}

export interface Entity {
  type: 'person' | 'organization' | 'date' | 'time' | 'money' | 'phone' | 'email' | 'policy_number' | 'custom';
  value: string;
  confidence: number;
  startIndex: number;
  endIndex: number;
  metadata?: Record<string, any>;
}

export interface ExtractedTask {
  id: string;
  type: 'email' | 'call' | 'meeting' | 'follow_up' | 'document_generation' | 'crm_update' | 'research';
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: Date;
  clientId?: string;
  parameters: Record<string, any>;
  confidence: number;
  requiresApproval: boolean;
}

export interface SentimentAnalysis {
  score: number; // -1 to 1 (negative to positive)
  magnitude: number; // 0 to 1 (intensity)
  label: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';
  confidence: number;
}

export interface ConversationContext {
  sessionId: string;
  agentId: string;
  clientId?: string;
  previousMessages: ContextMessage[];
  crmData?: any;
  recentCommunications?: any[];
  activeTasks?: any[];
  metadata?: Record<string, any>;
}

export interface ContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface GrokAPIRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface GrokAPIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LanguageModel {
  code: string;
  name: string;
  grokModel: string;
  supported: boolean;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

export interface SemanticSearchRequest {
  query: string;
  limit?: number;
  threshold?: number;
  filters?: Record<string, any>;
}

export interface NLPConfig {
  grok: {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  languages: LanguageModel[];
  sentiment: {
    threshold: {
      veryNegative: number;
      negative: number;
      neutral: number;
      positive: number;
    };
  };
  taskExtraction: {
    confidenceThreshold: number;
    approvalThreshold: number;
  };
  vectorSearch: {
    enabled: boolean;
    dimensions: number;
    similarityThreshold: number;
  };
}
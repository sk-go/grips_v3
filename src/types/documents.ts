export interface DocumentTemplate {
  id: string;
  name: string;
  type: 'advisory_protocol' | 'policy_summary' | 'meeting_notes' | 'custom';
  template: string; // Nunjucks template content
  isDefault: boolean;
  requiredFields: string[];
  riskLevel: 'low' | 'medium' | 'high';
  version: number;
  status: 'draft' | 'approved' | 'archived';
  createdBy: string;
  approvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
}

export interface GeneratedDocument {
  id: string;
  templateId: string;
  clientId?: string;
  title: string;
  content: string; // HTML content
  pdfPath?: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'exported';
  metadata: Record<string, any>;
  createdBy: 'agent' | 'ai';
  createdAt: Date;
  expiresAt: Date; // Temporary storage expiration
}

export interface TemplateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  requiredFields: string[];
}

export interface DocumentGenerationContext {
  client?: any;
  communications?: any[];
  tasks?: any[];
  customData?: Record<string, any>;
}

export interface TemplateUploadRequest {
  name: string;
  type: DocumentTemplate['type'];
  template: string;
  requiredFields: string[];
  riskLevel: DocumentTemplate['riskLevel'];
}

export interface TemplateApprovalRequest {
  templateId: string;
  approved: boolean;
  comments?: string;
}
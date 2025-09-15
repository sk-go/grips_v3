import { Pool } from 'pg';
import nunjucks from 'nunjucks';
import { v4 as uuidv4 } from 'uuid';
import { 
  DocumentTemplate, 
  TemplateValidationResult, 
  TemplateUploadRequest,
  TemplateApprovalRequest 
} from '../../types/documents';
import { logger } from '../../utils/logger';

export class TemplateManagementService {
  private db: Pool;
  private nunjucksEnv: nunjucks.Environment;

  constructor(db: Pool) {
    this.db = db;
    this.nunjucksEnv = new nunjucks.Environment();
  }

  /**
   * Get all templates with optional filtering
   */
  async getTemplates(filters?: {
    type?: string;
    status?: string;
    isDefault?: boolean;
  }): Promise<DocumentTemplate[]> {
    try {
      let query = `
        SELECT 
          id, name, type, template, is_default, required_fields, 
          risk_level, version, status, created_by, approved_by,
          created_at, updated_at, approved_at
        FROM document_templates 
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (filters?.type) {
        query += ` AND type = $${paramIndex}`;
        params.push(filters.type);
        paramIndex++;
      }

      if (filters?.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }

      if (filters?.isDefault !== undefined) {
        query += ` AND is_default = $${paramIndex}`;
        params.push(filters.isDefault);
        paramIndex++;
      }

      query += ' ORDER BY created_at DESC';

      const result = await this.db.query(query, params);
      
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        template: row.template,
        isDefault: row.is_default,
        requiredFields: row.required_fields || [],
        riskLevel: row.risk_level,
        version: row.version,
        status: row.status,
        createdBy: row.created_by,
        approvedBy: row.approved_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        approvedAt: row.approved_at
      }));
    } catch (error) {
      logger.error('Error fetching templates:', error);
      throw new Error('Failed to fetch templates');
    }
  }

  /**
   * Get template by ID
   */
  async getTemplateById(id: string): Promise<DocumentTemplate | null> {
    try {
      const result = await this.db.query(
        `SELECT 
          id, name, type, template, is_default, required_fields, 
          risk_level, version, status, created_by, approved_by,
          created_at, updated_at, approved_at
        FROM document_templates 
        WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        template: row.template,
        isDefault: row.is_default,
        requiredFields: row.required_fields || [],
        riskLevel: row.risk_level,
        version: row.version,
        status: row.status,
        createdBy: row.created_by,
        approvedBy: row.approved_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        approvedAt: row.approved_at
      };
    } catch (error) {
      logger.error('Error fetching template by ID:', error);
      throw new Error('Failed to fetch template');
    }
  }

  /**
   * Validate template syntax and structure
   */
  validateTemplate(templateContent: string): TemplateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const requiredFields: string[] = [];

    try {
      // Parse template to check syntax
      this.nunjucksEnv.renderString(templateContent, {});
    } catch (error: any) {
      errors.push(`Template syntax error: ${error.message}`);
    }

    // Extract required fields from template
    const fieldMatches = templateContent.match(/\{\{\s*([^}]+)\s*\}\}/g);
    if (fieldMatches) {
      fieldMatches.forEach(match => {
        const field = match.replace(/[{}]/g, '').trim();
        // Skip Nunjucks control structures
        if (!field.includes('if') && !field.includes('for') && !field.includes('endif') && !field.includes('endfor')) {
          const baseField = field.split('.')[0].split('|')[0].trim();
          if (!requiredFields.includes(baseField)) {
            requiredFields.push(baseField);
          }
        }
      });
    }

    // Check for common issues
    if (templateContent.length < 10) {
      warnings.push('Template seems very short');
    }

    if (!templateContent.includes('{{')) {
      warnings.push('Template does not contain any variables');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      requiredFields
    };
  }

  /**
   * Create new template
   */
  async createTemplate(templateData: TemplateUploadRequest, createdBy: string): Promise<DocumentTemplate> {
    try {
      // Validate template
      const validation = this.validateTemplate(templateData.template);
      if (!validation.isValid) {
        throw new Error(`Template validation failed: ${validation.errors.join(', ')}`);
      }

      const id = uuidv4();
      const result = await this.db.query(
        `INSERT INTO document_templates 
        (id, name, type, template, required_fields, risk_level, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          id,
          templateData.name,
          templateData.type,
          templateData.template,
          JSON.stringify(templateData.requiredFields),
          templateData.riskLevel,
          createdBy
        ]
      );

      const row = result.rows[0];
      logger.info(`Template created: ${id} by ${createdBy}`);

      return {
        id: row.id,
        name: row.name,
        type: row.type,
        template: row.template,
        isDefault: row.is_default,
        requiredFields: row.required_fields || [],
        riskLevel: row.risk_level,
        version: row.version,
        status: row.status,
        createdBy: row.created_by,
        approvedBy: row.approved_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        approvedAt: row.approved_at
      };
    } catch (error) {
      logger.error('Error creating template:', error);
      throw error;
    }
  }

  /**
   * Update existing template (creates new version)
   */
  async updateTemplate(id: string, templateData: Partial<TemplateUploadRequest>, updatedBy: string): Promise<DocumentTemplate> {
    try {
      const existingTemplate = await this.getTemplateById(id);
      if (!existingTemplate) {
        throw new Error('Template not found');
      }

      // Validate template if provided
      if (templateData.template) {
        const validation = this.validateTemplate(templateData.template);
        if (!validation.isValid) {
          throw new Error(`Template validation failed: ${validation.errors.join(', ')}`);
        }
      }

      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (templateData.name) {
        updateFields.push(`name = $${paramIndex}`);
        updateValues.push(templateData.name);
        paramIndex++;
      }

      if (templateData.template) {
        updateFields.push(`template = $${paramIndex}`);
        updateValues.push(templateData.template);
        paramIndex++;
        
        // Increment version for template changes
        updateFields.push(`version = version + 1`);
        
        // Reset approval status for template changes
        updateFields.push(`status = 'draft'`);
        updateFields.push(`approved_by = NULL`);
        updateFields.push(`approved_at = NULL`);
      }

      if (templateData.requiredFields) {
        updateFields.push(`required_fields = $${paramIndex}`);
        updateValues.push(JSON.stringify(templateData.requiredFields));
        paramIndex++;
      }

      if (templateData.riskLevel) {
        updateFields.push(`risk_level = $${paramIndex}`);
        updateValues.push(templateData.riskLevel);
        paramIndex++;
      }

      updateValues.push(id);

      const result = await this.db.query(
        `UPDATE document_templates 
        SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex}
        RETURNING *`,
        updateValues
      );

      const row = result.rows[0];
      logger.info(`Template updated: ${id} by ${updatedBy}`);

      return {
        id: row.id,
        name: row.name,
        type: row.type,
        template: row.template,
        isDefault: row.is_default,
        requiredFields: row.required_fields || [],
        riskLevel: row.risk_level,
        version: row.version,
        status: row.status,
        createdBy: row.created_by,
        approvedBy: row.approved_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        approvedAt: row.approved_at
      };
    } catch (error) {
      logger.error('Error updating template:', error);
      throw error;
    }
  }

  /**
   * Approve or reject template
   */
  async approveTemplate(approvalData: TemplateApprovalRequest, approvedBy: string): Promise<DocumentTemplate> {
    try {
      const client = await this.db.connect();
      
      try {
        await client.query('BEGIN');

        // Update template status
        const templateResult = await client.query(
          `UPDATE document_templates 
          SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP
          WHERE id = $3
          RETURNING *`,
          [
            approvalData.approved ? 'approved' : 'draft',
            approvedBy,
            approvalData.templateId
          ]
        );

        if (templateResult.rows.length === 0) {
          throw new Error('Template not found');
        }

        // Record approval history
        await client.query(
          `INSERT INTO template_approvals (template_id, approved_by, approved, comments)
          VALUES ($1, $2, $3, $4)`,
          [
            approvalData.templateId,
            approvedBy,
            approvalData.approved,
            approvalData.comments
          ]
        );

        await client.query('COMMIT');

        const row = templateResult.rows[0];
        logger.info(`Template ${approvalData.approved ? 'approved' : 'rejected'}: ${approvalData.templateId} by ${approvedBy}`);

        return {
          id: row.id,
          name: row.name,
          type: row.type,
          template: row.template,
          isDefault: row.is_default,
          requiredFields: row.required_fields || [],
          riskLevel: row.risk_level,
          version: row.version,
          status: row.status,
          createdBy: row.created_by,
          approvedBy: row.approved_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          approvedAt: row.approved_at
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error approving template:', error);
      throw error;
    }
  }

  /**
   * Delete template (archive)
   */
  async deleteTemplate(id: string): Promise<void> {
    try {
      const result = await this.db.query(
        'UPDATE document_templates SET status = $1 WHERE id = $2',
        ['archived', id]
      );

      if (result.rowCount === 0) {
        throw new Error('Template not found');
      }

      logger.info(`Template archived: ${id}`);
    } catch (error) {
      logger.error('Error deleting template:', error);
      throw error;
    }
  }

  /**
   * Get template approval history
   */
  async getTemplateApprovalHistory(templateId: string): Promise<any[]> {
    try {
      const result = await this.db.query(
        `SELECT approved_by, approved, comments, created_at
        FROM template_approvals
        WHERE template_id = $1
        ORDER BY created_at DESC`,
        [templateId]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching template approval history:', error);
      throw new Error('Failed to fetch approval history');
    }
  }
}
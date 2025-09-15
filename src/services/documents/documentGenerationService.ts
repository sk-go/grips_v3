import { Pool } from 'pg';
import nunjucks from 'nunjucks';
import puppeteer, { Browser, Page } from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { 
  GeneratedDocument, 
  DocumentTemplate, 
  DocumentGenerationContext 
} from '../../types/documents';
import { logger } from '../../utils/logger';

export class DocumentGenerationService {
  private db: Pool;
  private nunjucksEnv: nunjucks.Environment;
  private browser: Browser | null = null;

  constructor(db: Pool) {
    this.db = db;
    this.nunjucksEnv = new nunjucks.Environment();
    
    // Configure Nunjucks with custom filters
    this.setupNunjucksFilters();
  }

  /**
   * Initialize Puppeteer browser for PDF generation
   */
  async initializeBrowser(): Promise<void> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      logger.info('Puppeteer browser initialized');
    }
  }

  /**
   * Close Puppeteer browser
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Puppeteer browser closed');
    }
  }

  /**
   * Setup custom Nunjucks filters
   */
  private setupNunjucksFilters(): void {
    // Date formatting filter
    this.nunjucksEnv.addFilter('dateFormat', (date: Date | string, format: string = 'MM/DD/YYYY') => {
      if (!date) return '';
      const d = new Date(date);
      if (isNaN(d.getTime())) return '';
      
      switch (format) {
        case 'MM/DD/YYYY':
          return d.toLocaleDateString('en-US');
        case 'YYYY-MM-DD':
          return d.toISOString().split('T')[0];
        case 'long':
          return d.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        default:
          return d.toLocaleDateString('en-US');
      }
    });

    // Currency formatting filter
    this.nunjucksEnv.addFilter('currency', (amount: number | string) => {
      if (!amount) return '$0.00';
      const num = typeof amount === 'string' ? parseFloat(amount) : amount;
      if (isNaN(num)) return '$0.00';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(num);
    });

    // Phone formatting filter
    this.nunjucksEnv.addFilter('phone', (phone: string) => {
      if (!phone) return '';
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length === 10) {
        return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
      }
      return phone;
    });

    // Default value filter
    this.nunjucksEnv.addFilter('default', (value: any, defaultValue: any = '') => {
      return value || defaultValue;
    });
  }

  /**
   * Generate document from template
   */
  async generateDocument(
    templateId: string,
    context: DocumentGenerationContext,
    options: {
      title?: string;
      clientId?: string;
      createdBy?: 'agent' | 'ai';
      generatePdf?: boolean;
    } = {}
  ): Promise<GeneratedDocument> {
    try {
      // Get template
      const template = await this.getTemplate(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Validate required fields
      this.validateContext(template, context);

      // Render HTML content
      const htmlContent = this.renderTemplate(template.template, context);

      // Generate PDF if requested
      let pdfPath: string | undefined;
      if (options.generatePdf !== false) {
        pdfPath = await this.generatePdf(htmlContent, options.title || template.name);
      }

      // Create document record
      const document = await this.saveDocument({
        templateId,
        clientId: options.clientId,
        title: options.title || `${template.name} - ${new Date().toLocaleDateString()}`,
        content: htmlContent,
        pdfPath,
        status: template.riskLevel === 'high' ? 'pending_approval' : 'approved',
        metadata: {
          templateName: template.name,
          templateType: template.type,
          templateVersion: template.version,
          generatedAt: new Date().toISOString(),
          context: this.sanitizeContext(context)
        },
        createdBy: options.createdBy || 'agent'
      });

      logger.info(`Document generated: ${document.id} from template ${templateId}`);
      return document;
    } catch (error) {
      logger.error('Error generating document:', error);
      throw error;
    }
  }

  /**
   * Get template by ID
   */
  private async getTemplate(templateId: string): Promise<DocumentTemplate | null> {
    try {
      const result = await this.db.query(
        `SELECT 
          id, name, type, template, is_default, required_fields, 
          risk_level, version, status, created_by, approved_by,
          created_at, updated_at, approved_at
        FROM document_templates 
        WHERE id = $1 AND status = 'approved'`,
        [templateId]
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
      logger.error('Error fetching template:', error);
      throw new Error('Failed to fetch template');
    }
  }

  /**
   * Validate that context contains required fields
   */
  private validateContext(template: DocumentTemplate, context: DocumentGenerationContext): void {
    const missingFields: string[] = [];

    template.requiredFields.forEach(field => {
      if (!this.hasNestedProperty(context, field)) {
        missingFields.push(field);
      }
    });

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
  }

  /**
   * Check if object has nested property (e.g., 'client.name')
   */
  private hasNestedProperty(obj: any, path: string): boolean {
    const result = path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined && current[key] !== null ? current[key] : undefined;
    }, obj);
    return result !== undefined;
  }

  /**
   * Render template with context
   */
  private renderTemplate(template: string, context: DocumentGenerationContext): string {
    try {
      return this.nunjucksEnv.renderString(template, {
        ...context,
        date: new Date().toLocaleDateString(),
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      logger.error('Template rendering error:', error);
      throw new Error(`Template rendering failed: ${error.message}`);
    }
  }

  /**
   * Generate PDF from HTML content
   */
  private async generatePdf(htmlContent: string, title: string): Promise<string> {
    try {
      await this.initializeBrowser();
      
      if (!this.browser) {
        throw new Error('Browser not initialized');
      }

      const page = await this.browser.newPage();
      
      // Set content and wait for any dynamic content to load
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '1in',
          right: '1in',
          bottom: '1in',
          left: '1in'
        }
      });

      await page.close();

      // Save PDF to temporary storage
      const filename = `${uuidv4()}-${title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      const pdfPath = path.join(process.cwd(), 'temp', 'documents', filename);
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(pdfPath), { recursive: true });
      
      // Write PDF file
      await fs.writeFile(pdfPath, pdfBuffer);

      return pdfPath;
    } catch (error) {
      logger.error('PDF generation error:', error);
      throw new Error('Failed to generate PDF');
    }
  }

  /**
   * Save document to database
   */
  private async saveDocument(documentData: {
    templateId: string;
    clientId?: string;
    title: string;
    content: string;
    pdfPath?: string;
    status: GeneratedDocument['status'];
    metadata: Record<string, any>;
    createdBy: 'agent' | 'ai';
  }): Promise<GeneratedDocument> {
    try {
      const id = uuidv4();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiration

      const result = await this.db.query(
        `INSERT INTO generated_documents 
        (id, template_id, client_id, title, content, pdf_path, status, metadata, created_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          id,
          documentData.templateId,
          documentData.clientId,
          documentData.title,
          documentData.content,
          documentData.pdfPath,
          documentData.status,
          JSON.stringify(documentData.metadata),
          documentData.createdBy,
          expiresAt
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        templateId: row.template_id,
        clientId: row.client_id,
        title: row.title,
        content: row.content,
        pdfPath: row.pdf_path,
        status: row.status,
        metadata: row.metadata,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      };
    } catch (error) {
      logger.error('Error saving document:', error);
      throw new Error('Failed to save document');
    }
  }

  /**
   * Sanitize context for storage (remove sensitive data)
   */
  private sanitizeContext(context: DocumentGenerationContext): any {
    const sanitized = JSON.parse(JSON.stringify(context));
    
    // Remove potentially sensitive fields
    const sensitiveFields = ['ssn', 'password', 'token', 'secret'];
    
    const removeSensitiveData = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          obj[key] = removeSensitiveData(obj[key]);
        }
      }
      return obj;
    };

    return removeSensitiveData(sanitized);
  }

  /**
   * Get document by ID
   */
  async getDocument(id: string): Promise<GeneratedDocument | null> {
    try {
      const result = await this.db.query(
        `SELECT 
          id, template_id, client_id, title, content, pdf_path, 
          status, metadata, created_by, created_at, expires_at
        FROM generated_documents 
        WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        templateId: row.template_id,
        clientId: row.client_id,
        title: row.title,
        content: row.content,
        pdfPath: row.pdf_path,
        status: row.status,
        metadata: row.metadata,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      };
    } catch (error) {
      logger.error('Error fetching document:', error);
      throw new Error('Failed to fetch document');
    }
  }

  /**
   * Approve document
   */
  async approveDocument(id: string, approvedBy: string): Promise<GeneratedDocument> {
    try {
      const result = await this.db.query(
        `UPDATE generated_documents 
        SET status = 'approved'
        WHERE id = $1
        RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        throw new Error('Document not found');
      }

      const row = result.rows[0];
      logger.info(`Document approved: ${id} by ${approvedBy}`);

      return {
        id: row.id,
        templateId: row.template_id,
        clientId: row.client_id,
        title: row.title,
        content: row.content,
        pdfPath: row.pdf_path,
        status: row.status,
        metadata: row.metadata,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      };
    } catch (error) {
      logger.error('Error approving document:', error);
      throw error;
    }
  }

  /**
   * Get documents with filtering
   */
  async getDocuments(filters?: {
    clientId?: string;
    templateId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<GeneratedDocument[]> {
    try {
      let query = `
        SELECT 
          id, template_id, client_id, title, content, pdf_path, 
          status, metadata, created_by, created_at, expires_at
        FROM generated_documents 
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (filters?.clientId) {
        query += ` AND client_id = $${paramIndex}`;
        params.push(filters.clientId);
        paramIndex++;
      }

      if (filters?.templateId) {
        query += ` AND template_id = $${paramIndex}`;
        params.push(filters.templateId);
        paramIndex++;
      }

      if (filters?.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }

      query += ' ORDER BY created_at DESC';

      if (filters?.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(filters.limit);
        paramIndex++;
      }

      if (filters?.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(filters.offset);
      }

      const result = await this.db.query(query, params);
      
      return result.rows.map(row => ({
        id: row.id,
        templateId: row.template_id,
        clientId: row.client_id,
        title: row.title,
        content: row.content,
        pdfPath: row.pdf_path,
        status: row.status,
        metadata: row.metadata,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      }));
    } catch (error) {
      logger.error('Error fetching documents:', error);
      throw new Error('Failed to fetch documents');
    }
  }

  /**
   * Delete expired documents
   */
  async cleanupExpiredDocuments(): Promise<number> {
    try {
      // Get expired documents with PDF paths
      const expiredDocs = await this.db.query(
        'SELECT id, pdf_path FROM generated_documents WHERE expires_at < NOW()'
      );

      // Delete PDF files
      for (const doc of expiredDocs.rows) {
        if (doc.pdf_path) {
          try {
            await fs.unlink(doc.pdf_path);
          } catch (error) {
            logger.warn(`Failed to delete PDF file: ${doc.pdf_path}`, error);
          }
        }
      }

      // Delete database records
      const result = await this.db.query(
        'DELETE FROM generated_documents WHERE expires_at < NOW()'
      );

      logger.info(`Cleaned up ${result.rowCount} expired documents`);
      return result.rowCount || 0;
    } catch (error) {
      logger.error('Error cleaning up expired documents:', error);
      throw new Error('Failed to cleanup expired documents');
    }
  }
}
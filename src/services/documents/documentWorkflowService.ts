import { Pool } from 'pg';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs/promises';
import { DocumentGenerationService } from './documentGenerationService';
import { GeneratedDocument } from '../../types/documents';
import { logger } from '../../utils/logger';

export interface EmailExportOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  attachPdf?: boolean;
}

export interface CRMUploadOptions {
  crmSystem: 'zoho' | 'salesforce' | 'hubspot' | 'agencybloc';
  clientId: string;
  documentType?: string;
  notes?: string;
}

export class DocumentWorkflowService {
  private db: Pool;
  private documentService: DocumentGenerationService;
  private emailTransporter: nodemailer.Transporter | null = null;

  constructor(db: Pool, documentService: DocumentGenerationService) {
    this.db = db;
    this.documentService = documentService;
    this.initializeEmailTransporter();
  }

  /**
   * Initialize email transporter for document export
   */
  private initializeEmailTransporter(): void {
    try {
      this.emailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      logger.info('Email transporter initialized for document export');
    } catch (error) {
      logger.warn('Failed to initialize email transporter:', error);
    }
  }

  /**
   * Export document via email
   */
  async exportDocumentByEmail(documentId: string, options: EmailExportOptions): Promise<void> {
    try {
      if (!this.emailTransporter) {
        throw new Error('Email transporter not configured');
      }

      const document = await this.documentService.getDocument(documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      const attachments: any[] = [];

      // Attach PDF if requested and available
      if (options.attachPdf && document.pdfPath) {
        try {
          await fs.access(document.pdfPath);
          attachments.push({
            filename: `${document.title}.pdf`,
            path: document.pdfPath,
            contentType: 'application/pdf'
          });
        } catch {
          logger.warn(`PDF file not found for document ${documentId}: ${document.pdfPath}`);
        }
      }

      // Attach HTML content
      attachments.push({
        filename: `${document.title}.html`,
        content: document.content,
        contentType: 'text/html'
      });

      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: options.to.join(', '),
        cc: options.cc?.join(', '),
        bcc: options.bcc?.join(', '),
        subject: options.subject || `Document: ${document.title}`,
        html: options.body || `
          <p>Please find the attached document: <strong>${document.title}</strong></p>
          <p>Generated on: ${document.createdAt.toLocaleDateString()}</p>
          <p>Status: ${document.status}</p>
          ${document.metadata?.templateName ? `<p>Template: ${document.metadata.templateName}</p>` : ''}
        `,
        attachments
      };

      await this.emailTransporter.sendMail(mailOptions);

      // Log export activity
      await this.logDocumentActivity(documentId, 'email_export', {
        recipients: options.to,
        subject: mailOptions.subject,
        attachedPdf: options.attachPdf && document.pdfPath ? true : false
      });

      logger.info(`Document ${documentId} exported via email to ${options.to.join(', ')}`);
    } catch (error) {
      logger.error('Error exporting document by email:', error);
      throw error;
    }
  }

  /**
   * Upload document to CRM system
   */
  async uploadDocumentToCRM(documentId: string, options: CRMUploadOptions): Promise<void> {
    try {
      const document = await this.documentService.getDocument(documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      // This is a placeholder for CRM integration
      // In a real implementation, this would use the CRM service
      const crmUploadResult = await this.mockCRMUpload(document, options);

      // Log CRM upload activity
      await this.logDocumentActivity(documentId, 'crm_upload', {
        crmSystem: options.crmSystem,
        clientId: options.clientId,
        documentType: options.documentType,
        crmDocumentId: crmUploadResult.documentId,
        uploadedAt: new Date().toISOString()
      });

      logger.info(`Document ${documentId} uploaded to ${options.crmSystem} CRM`);
    } catch (error) {
      logger.error('Error uploading document to CRM:', error);
      throw error;
    }
  }

  /**
   * Mock CRM upload (placeholder for actual CRM integration)
   */
  private async mockCRMUpload(document: GeneratedDocument, options: CRMUploadOptions): Promise<{ documentId: string }> {
    // Simulate CRM API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mock successful upload
    return {
      documentId: `${options.crmSystem}_doc_${Date.now()}`
    };
  }

  /**
   * Get document download URL/path
   */
  async getDocumentDownloadInfo(documentId: string, format: 'pdf' | 'html' = 'pdf'): Promise<{
    url?: string;
    path?: string;
    filename: string;
    contentType: string;
  }> {
    try {
      const document = await this.documentService.getDocument(documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      if (format === 'pdf') {
        if (!document.pdfPath) {
          throw new Error('PDF not available for this document');
        }

        // Check if file exists
        try {
          await fs.access(document.pdfPath);
        } catch {
          throw new Error('PDF file not found');
        }

        return {
          path: document.pdfPath,
          filename: `${document.title}.pdf`,
          contentType: 'application/pdf'
        };
      } else {
        // HTML format
        return {
          filename: `${document.title}.html`,
          contentType: 'text/html'
        };
      }
    } catch (error) {
      logger.error('Error getting document download info:', error);
      throw error;
    }
  }

  /**
   * Clean up expired documents and their files
   */
  async cleanupExpiredDocuments(): Promise<{
    documentsDeleted: number;
    filesDeleted: number;
    errors: string[];
  }> {
    try {
      const errors: string[] = [];
      let filesDeleted = 0;

      // Get expired documents
      const expiredDocs = await this.db.query(
        'SELECT id, pdf_path, title FROM generated_documents WHERE expires_at < NOW()'
      );

      // Delete associated files
      for (const doc of expiredDocs.rows) {
        if (doc.pdf_path) {
          try {
            await fs.unlink(doc.pdf_path);
            filesDeleted++;
            logger.info(`Deleted PDF file: ${doc.pdf_path}`);
          } catch (error: any) {
            const errorMsg = `Failed to delete PDF file ${doc.pdf_path}: ${error.message}`;
            errors.push(errorMsg);
            logger.warn(errorMsg);
          }
        }
      }

      // Delete database records
      const deleteResult = await this.db.query(
        'DELETE FROM generated_documents WHERE expires_at < NOW()'
      );

      const documentsDeleted = deleteResult.rowCount || 0;

      // Log cleanup activity
      if (documentsDeleted > 0) {
        await this.logSystemActivity('document_cleanup', {
          documentsDeleted,
          filesDeleted,
          errors: errors.length,
          cleanupDate: new Date().toISOString()
        });
      }

      logger.info(`Document cleanup completed: ${documentsDeleted} documents, ${filesDeleted} files deleted`);

      return {
        documentsDeleted,
        filesDeleted,
        errors
      };
    } catch (error) {
      logger.error('Error during document cleanup:', error);
      throw error;
    }
  }

  /**
   * Get document activity history
   */
  async getDocumentActivity(documentId: string): Promise<any[]> {
    try {
      const result = await this.db.query(
        `SELECT activity_type, activity_data, created_at, created_by
        FROM document_activities
        WHERE document_id = $1
        ORDER BY created_at DESC`,
        [documentId]
      );

      return result.rows.map(row => ({
        type: row.activity_type,
        data: row.activity_data,
        createdAt: row.created_at,
        createdBy: row.created_by
      }));
    } catch (error) {
      logger.error('Error fetching document activity:', error);
      throw new Error('Failed to fetch document activity');
    }
  }

  /**
   * Log document activity
   */
  private async logDocumentActivity(
    documentId: string,
    activityType: string,
    activityData: any,
    createdBy: string = 'system'
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO document_activities (document_id, activity_type, activity_data, created_by)
        VALUES ($1, $2, $3, $4)`,
        [documentId, activityType, JSON.stringify(activityData), createdBy]
      );
    } catch (error) {
      logger.error('Error logging document activity:', error);
      // Don't throw error for logging failures
    }
  }

  /**
   * Log system activity
   */
  private async logSystemActivity(activityType: string, activityData: any): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO document_activities (activity_type, activity_data, created_by)
        VALUES ($1, $2, $3)`,
        [activityType, JSON.stringify(activityData), 'system']
      );
    } catch (error) {
      logger.error('Error logging system activity:', error);
      // Don't throw error for logging failures
    }
  }

  /**
   * Validate document before export/upload
   */
  async validateDocumentForExport(documentId: string): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    try {
      const document = await this.documentService.getDocument(documentId);
      if (!document) {
        return {
          isValid: false,
          errors: ['Document not found'],
          warnings: []
        };
      }

      const errors: string[] = [];
      const warnings: string[] = [];

      // Check document status
      if (document.status === 'draft') {
        errors.push('Document is still in draft status');
      } else if (document.status === 'pending_approval') {
        errors.push('Document is pending approval');
      }

      // Check expiration
      if (new Date() > new Date(document.expiresAt)) {
        errors.push('Document has expired');
      } else if (new Date(document.expiresAt).getTime() - Date.now() < 24 * 60 * 60 * 1000) {
        warnings.push('Document expires within 24 hours');
      }

      // Check content
      if (!document.content || document.content.trim().length === 0) {
        errors.push('Document content is empty');
      }

      // Check PDF availability
      if (document.pdfPath) {
        try {
          await fs.access(document.pdfPath);
        } catch {
          warnings.push('PDF file is not accessible');
        }
      } else {
        warnings.push('PDF not generated for this document');
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      logger.error('Error validating document for export:', error);
      return {
        isValid: false,
        errors: ['Failed to validate document'],
        warnings: []
      };
    }
  }

  /**
   * Get document storage statistics
   */
  async getStorageStatistics(): Promise<{
    totalDocuments: number;
    totalSize: number;
    documentsByStatus: Record<string, number>;
    documentsByType: Record<string, number>;
    expiringDocuments: number;
  }> {
    try {
      // Get total documents and status breakdown
      const statusResult = await this.db.query(`
        SELECT status, COUNT(*) as count
        FROM generated_documents
        GROUP BY status
      `);

      const documentsByStatus: Record<string, number> = {};
      let totalDocuments = 0;

      statusResult.rows.forEach(row => {
        documentsByStatus[row.status] = parseInt(row.count);
        totalDocuments += parseInt(row.count);
      });

      // Get documents by template type
      const typeResult = await this.db.query(`
        SELECT dt.type, COUNT(*) as count
        FROM generated_documents gd
        JOIN document_templates dt ON gd.template_id = dt.id
        GROUP BY dt.type
      `);

      const documentsByType: Record<string, number> = {};
      typeResult.rows.forEach(row => {
        documentsByType[row.type] = parseInt(row.count);
      });

      // Get expiring documents (within 7 days)
      const expiringResult = await this.db.query(`
        SELECT COUNT(*) as count
        FROM generated_documents
        WHERE expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      `);

      const expiringDocuments = parseInt(expiringResult.rows[0]?.count || '0');

      // Calculate total size (this is a rough estimate)
      const sizeResult = await this.db.query(`
        SELECT SUM(LENGTH(content)) as total_content_size
        FROM generated_documents
      `);

      const totalSize = parseInt(sizeResult.rows[0]?.total_content_size || '0');

      return {
        totalDocuments,
        totalSize,
        documentsByStatus,
        documentsByType,
        expiringDocuments
      };
    } catch (error) {
      logger.error('Error getting storage statistics:', error);
      throw new Error('Failed to get storage statistics');
    }
  }
}
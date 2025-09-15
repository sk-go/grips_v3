import { Pool } from 'pg';
import { DocumentWorkflowService, EmailExportOptions, CRMUploadOptions } from '../../services/documents/documentWorkflowService';
import { DocumentGenerationService } from '../../services/documents/documentGenerationService';
import { GeneratedDocument } from '../../types/documents';

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('nodemailer');
jest.mock('fs/promises');

const mockNodemailer = require('nodemailer');
const mockFs = require('fs/promises');

describe('DocumentWorkflowService', () => {
  let service: DocumentWorkflowService;
  let mockDb: any;
  let mockDocumentService: jest.Mocked<DocumentGenerationService>;
  let mockTransporter: any;

  const mockDocument: GeneratedDocument = {
    id: 'doc-1',
    templateId: 'template-1',
    clientId: 'client-1',
    title: 'Test Document',
    content: '<html><body>Test content</body></html>',
    pdfPath: '/path/to/test.pdf',
    status: 'approved',
    metadata: { templateName: 'Test Template' },
    createdBy: 'agent',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
  };

  beforeEach(() => {
    mockDb = {
      query: jest.fn()
    };

    mockDocumentService = {
      getDocument: jest.fn()
    } as any;

    mockTransporter = {
      sendMail: jest.fn()
    };

    mockNodemailer.createTransport.mockReturnValue(mockTransporter);
    mockFs.access.mockResolvedValue(undefined);

    service = new DocumentWorkflowService(mockDb as Pool, mockDocumentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('exportDocumentByEmail', () => {
    const emailOptions: EmailExportOptions = {
      to: ['recipient@example.com'],
      cc: ['cc@example.com'],
      subject: 'Test Document',
      body: 'Please find attached document',
      attachPdf: true
    };

    it('should export document via email successfully', async () => {
      mockDocumentService.getDocument.mockResolvedValue(mockDocument);
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.exportDocumentByEmail('doc-1', emailOptions);

      expect(mockDocumentService.getDocument).toHaveBeenCalledWith('doc-1');
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'recipient@example.com',
          cc: 'cc@example.com',
          subject: 'Test Document',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              filename: 'Test Document.pdf',
              path: '/path/to/test.pdf'
            }),
            expect.objectContaining({
              filename: 'Test Document.html',
              content: mockDocument.content
            })
          ])
        })
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO document_activities'),
        expect.arrayContaining(['doc-1', 'email_export'])
      );
    });

    it('should handle missing PDF file gracefully', async () => {
      mockDocumentService.getDocument.mockResolvedValue(mockDocument);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.exportDocumentByEmail('doc-1', emailOptions);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: expect.arrayContaining([
            expect.objectContaining({
              filename: 'Test Document.html'
            })
          ])
        })
      );
    });

    it('should throw error for non-existent document', async () => {
      mockDocumentService.getDocument.mockResolvedValue(null);

      await expect(service.exportDocumentByEmail('nonexistent', emailOptions))
        .rejects.toThrow('Document not found');
    });
  });

  describe('uploadDocumentToCRM', () => {
    const crmOptions: CRMUploadOptions = {
      crmSystem: 'salesforce',
      clientId: 'client-123',
      documentType: 'policy',
      notes: 'Test upload'
    };

    it('should upload document to CRM successfully', async () => {
      mockDocumentService.getDocument.mockResolvedValue(mockDocument);
      mockDb.query.mockResolvedValue({ rows: [] });

      await service.uploadDocumentToCRM('doc-1', crmOptions);

      expect(mockDocumentService.getDocument).toHaveBeenCalledWith('doc-1');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO document_activities'),
        expect.arrayContaining(['doc-1', 'crm_upload'])
      );
    });

    it('should throw error for non-existent document', async () => {
      mockDocumentService.getDocument.mockResolvedValue(null);

      await expect(service.uploadDocumentToCRM('nonexistent', crmOptions))
        .rejects.toThrow('Document not found');
    });
  });

  describe('getDocumentDownloadInfo', () => {
    it('should return PDF download info', async () => {
      mockDocumentService.getDocument.mockResolvedValue(mockDocument);
      mockFs.access.mockResolvedValue(undefined);

      const result = await service.getDocumentDownloadInfo('doc-1', 'pdf');

      expect(result).toEqual({
        path: '/path/to/test.pdf',
        filename: 'Test Document.pdf',
        contentType: 'application/pdf'
      });
    });

    it('should return HTML download info', async () => {
      mockDocumentService.getDocument.mockResolvedValue(mockDocument);

      const result = await service.getDocumentDownloadInfo('doc-1', 'html');

      expect(result).toEqual({
        filename: 'Test Document.html',
        contentType: 'text/html'
      });
    });

    it('should throw error for missing PDF file', async () => {
      mockDocumentService.getDocument.mockResolvedValue(mockDocument);
      mockFs.access.mockRejectedValue(new Error('File not found'));

      await expect(service.getDocumentDownloadInfo('doc-1', 'pdf'))
        .rejects.toThrow('PDF file not found');
    });
  });

  describe('validateDocumentForExport', () => {
    it('should validate approved document successfully', async () => {
      mockDocumentService.getDocument.mockResolvedValue(mockDocument);
      mockFs.access.mockResolvedValue(undefined);

      const result = await service.validateDocumentForExport('doc-1');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject draft document', async () => {
      const draftDocument = { ...mockDocument, status: 'draft' as const };
      mockDocumentService.getDocument.mockResolvedValue(draftDocument);

      const result = await service.validateDocumentForExport('doc-1');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Document is still in draft status');
    });

    it('should reject expired document', async () => {
      const expiredDocument = { 
        ...mockDocument, 
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
      };
      mockDocumentService.getDocument.mockResolvedValue(expiredDocument);

      const result = await service.validateDocumentForExport('doc-1');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Document has expired');
    });

    it('should warn about soon-to-expire document', async () => {
      const soonToExpireDocument = { 
        ...mockDocument, 
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) // 12 hours from now
      };
      mockDocumentService.getDocument.mockResolvedValue(soonToExpireDocument);
      mockFs.access.mockResolvedValue(undefined);

      const result = await service.validateDocumentForExport('doc-1');

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Document expires within 24 hours');
    });
  });

  describe('cleanupExpiredDocuments', () => {
    it('should cleanup expired documents successfully', async () => {
      const expiredDocs = [
        { id: 'doc-1', pdf_path: '/path/to/doc1.pdf', title: 'Doc 1' },
        { id: 'doc-2', pdf_path: '/path/to/doc2.pdf', title: 'Doc 2' }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: expiredDocs })
        .mockResolvedValueOnce({ rowCount: 2 })
        .mockResolvedValueOnce({ rows: [] }); // Log activity

      mockFs.unlink.mockResolvedValue(undefined);

      const result = await service.cleanupExpiredDocuments();

      expect(result.documentsDeleted).toBe(2);
      expect(result.filesDeleted).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(mockFs.unlink).toHaveBeenCalledTimes(2);
    });

    it('should handle file deletion errors gracefully', async () => {
      const expiredDocs = [
        { id: 'doc-1', pdf_path: '/path/to/doc1.pdf', title: 'Doc 1' }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: expiredDocs })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }); // Log activity

      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));

      const result = await service.cleanupExpiredDocuments();

      expect(result.documentsDeleted).toBe(1);
      expect(result.filesDeleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Permission denied');
    });
  });

  describe('getDocumentActivity', () => {
    it('should fetch document activity history', async () => {
      const mockActivities = [
        {
          activity_type: 'email_export',
          activity_data: { recipients: ['test@example.com'] },
          created_at: new Date(),
          created_by: 'agent'
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockActivities });

      const result = await service.getDocumentActivity('doc-1');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('email_export');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM document_activities'),
        ['doc-1']
      );
    });
  });

  describe('getStorageStatistics', () => {
    it('should return storage statistics', async () => {
      mockDb.query
        .mockResolvedValueOnce({ 
          rows: [
            { status: 'approved', count: '10' },
            { status: 'draft', count: '5' }
          ] 
        })
        .mockResolvedValueOnce({ 
          rows: [
            { type: 'policy_summary', count: '8' },
            { type: 'meeting_notes', count: '7' }
          ] 
        })
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })
        .mockResolvedValueOnce({ rows: [{ total_content_size: '1024000' }] });

      const result = await service.getStorageStatistics();

      expect(result.totalDocuments).toBe(15);
      expect(result.documentsByStatus).toEqual({
        approved: 10,
        draft: 5
      });
      expect(result.documentsByType).toEqual({
        policy_summary: 8,
        meeting_notes: 7
      });
      expect(result.expiringDocuments).toBe(3);
      expect(result.totalSize).toBe(1024000);
    });
  });
});
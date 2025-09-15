import request from 'supertest';
import express from 'express';
import { Pool } from 'pg';
import createDocumentRoutes from '../../routes/documents';
import { authenticateToken } from '../../middleware/auth';

// Mock dependencies
jest.mock('../../middleware/auth');
jest.mock('../../utils/logger');
jest.mock('nodemailer');
jest.mock('puppeteer');
jest.mock('fs/promises');

const mockAuthenticateToken = authenticateToken as jest.MockedFunction<typeof authenticateToken>;
const mockNodemailer = require('nodemailer');

describe('Document Workflow Integration', () => {
  let app: express.Application;
  let mockDb: any;
  let mockTransporter: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    mockDb = {
      query: jest.fn(),
      connect: jest.fn()
    };

    mockTransporter = {
      sendMail: jest.fn()
    };

    mockNodemailer.createTransport.mockReturnValue(mockTransporter);

    // Mock authentication middleware
    mockAuthenticateToken.mockImplementation((req, res, next) => {
      (req as any).user = { id: 'test-user' };
      next();
      return Promise.resolve();
    });

    app.use('/api/documents', createDocumentRoutes(mockDb as Pool));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/documents/:id/email', () => {
    it('should export document via email', async () => {
      const mockDocument = {
        id: 'doc-1',
        template_id: 'template-1',
        title: 'Test Document',
        content: '<html>Test</html>',
        pdf_path: '/path/to/test.pdf',
        status: 'approved',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockDocument] }) // getDocument
        .mockResolvedValueOnce({ rows: [] }); // log activity

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });

      const response = await request(app)
        .post('/api/documents/doc-1/email')
        .send({
          to: ['recipient@example.com'],
          subject: 'Test Document',
          attachPdf: true
        })
        .expect(200);

      expect(response.body.message).toBe('Document exported successfully');
      expect(mockTransporter.sendMail).toHaveBeenCalled();
    });

    it('should return 400 for missing recipients', async () => {
      await request(app)
        .post('/api/documents/doc-1/email')
        .send({
          subject: 'Test Document'
        })
        .expect(400);
    });

    it('should return 400 for draft document', async () => {
      const draftDocument = {
        id: 'doc-1',
        template_id: 'template-1',
        title: 'Draft Document',
        content: '<html>Test</html>',
        status: 'draft',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };

      mockDb.query.mockResolvedValueOnce({ rows: [draftDocument] });

      const response = await request(app)
        .post('/api/documents/doc-1/email')
        .send({
          to: ['recipient@example.com']
        })
        .expect(400);

      expect(response.body.error).toBe('Document validation failed');
      expect(response.body.details).toContain('Document is still in draft status');
    });
  });

  describe('POST /api/documents/:id/crm-upload', () => {
    it('should upload document to CRM', async () => {
      const mockDocument = {
        id: 'doc-1',
        template_id: 'template-1',
        title: 'Test Document',
        content: '<html>Test</html>',
        status: 'approved',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockDocument] }) // getDocument
        .mockResolvedValueOnce({ rows: [] }); // log activity

      const response = await request(app)
        .post('/api/documents/doc-1/crm-upload')
        .send({
          crmSystem: 'salesforce',
          clientId: 'client-123',
          documentType: 'policy'
        })
        .expect(200);

      expect(response.body.message).toBe('Document uploaded to CRM successfully');
    });

    it('should return 400 for invalid CRM system', async () => {
      await request(app)
        .post('/api/documents/doc-1/crm-upload')
        .send({
          crmSystem: 'invalid-crm',
          clientId: 'client-123'
        })
        .expect(400);
    });

    it('should return 400 for missing required fields', async () => {
      await request(app)
        .post('/api/documents/doc-1/crm-upload')
        .send({
          crmSystem: 'salesforce'
          // Missing clientId
        })
        .expect(400);
    });
  });

  describe('GET /api/documents/:id/activity', () => {
    it('should return document activity history', async () => {
      const mockActivities = [
        {
          activity_type: 'email_export',
          activity_data: { recipients: ['test@example.com'] },
          created_at: new Date(),
          created_by: 'agent'
        }
      ];

      mockDb.query.mockResolvedValueOnce({ rows: mockActivities });

      const response = await request(app)
        .get('/api/documents/doc-1/activity')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].type).toBe('email_export');
    });
  });

  describe('POST /api/documents/:id/validate', () => {
    it('should validate approved document', async () => {
      const mockDocument = {
        id: 'doc-1',
        template_id: 'template-1',
        title: 'Test Document',
        content: '<html>Test</html>',
        status: 'approved',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };

      mockDb.query.mockResolvedValueOnce({ rows: [mockDocument] });

      const response = await request(app)
        .post('/api/documents/doc-1/validate')
        .expect(200);

      expect(response.body.isValid).toBe(true);
      expect(response.body.errors).toHaveLength(0);
    });

    it('should reject expired document', async () => {
      const expiredDocument = {
        id: 'doc-1',
        template_id: 'template-1',
        title: 'Expired Document',
        content: '<html>Test</html>',
        status: 'approved',
        created_at: new Date(),
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
      };

      mockDb.query.mockResolvedValueOnce({ rows: [expiredDocument] });

      const response = await request(app)
        .post('/api/documents/doc-1/validate')
        .expect(200);

      expect(response.body.isValid).toBe(false);
      expect(response.body.errors).toContain('Document has expired');
    });
  });

  describe('GET /api/documents/storage/statistics', () => {
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
            { type: 'policy_summary', count: '8' }
          ] 
        })
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })
        .mockResolvedValueOnce({ rows: [{ total_content_size: '1024000' }] });

      const response = await request(app)
        .get('/api/documents/storage/statistics')
        .expect(200);

      expect(response.body.totalDocuments).toBe(15);
      expect(response.body.documentsByStatus.approved).toBe(10);
      expect(response.body.documentsByStatus.draft).toBe(5);
    });
  });

  describe('POST /api/documents/cleanup', () => {
    it('should cleanup expired documents', async () => {
      const expiredDocs = [
        { id: 'doc-1', pdf_path: '/path/to/doc1.pdf', title: 'Doc 1' }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: expiredDocs })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }); // log activity

      const response = await request(app)
        .post('/api/documents/cleanup')
        .expect(200);

      expect(response.body.documentsDeleted).toBe(1);
      expect(response.body.errors).toHaveLength(0);
    });
  });

  describe('Complete Document Workflow', () => {
    it('should handle complete document lifecycle', async () => {
      // 1. Generate document
      const mockTemplate = {
        id: 'template-1',
        name: 'Test Template',
        type: 'custom',
        template: '<html>{{ client.name }}</html>',
        required_fields: ['client'],
        risk_level: 'low',
        status: 'approved'
      };

      const mockGeneratedDoc = {
        id: 'doc-1',
        template_id: 'template-1',
        title: 'Generated Document',
        content: '<html>John Doe</html>',
        pdf_path: '/path/to/doc.pdf',
        status: 'approved',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockTemplate] }) // getTemplate
        .mockResolvedValueOnce({ rows: [mockGeneratedDoc] }); // saveDocument

      // Generate document
      const generateResponse = await request(app)
        .post('/api/documents/generate')
        .send({
          templateId: 'template-1',
          context: { client: { name: 'John Doe' } },
          title: 'Generated Document'
        })
        .expect(201);

      expect(generateResponse.body.title).toBe('Generated Document');

      // 2. Validate document
      mockDb.query.mockResolvedValueOnce({ rows: [mockGeneratedDoc] });

      const validateResponse = await request(app)
        .post('/api/documents/doc-1/validate')
        .expect(200);

      expect(validateResponse.body.isValid).toBe(true);

      // 3. Export via email
      mockDb.query
        .mockResolvedValueOnce({ rows: [mockGeneratedDoc] })
        .mockResolvedValueOnce({ rows: [] }); // log activity

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });

      const emailResponse = await request(app)
        .post('/api/documents/doc-1/email')
        .send({
          to: ['client@example.com'],
          subject: 'Your Document'
        })
        .expect(200);

      expect(emailResponse.body.message).toBe('Document exported successfully');

      // 4. Upload to CRM
      mockDb.query
        .mockResolvedValueOnce({ rows: [mockGeneratedDoc] })
        .mockResolvedValueOnce({ rows: [] }); // log activity

      const crmResponse = await request(app)
        .post('/api/documents/doc-1/crm-upload')
        .send({
          crmSystem: 'salesforce',
          clientId: 'client-123'
        })
        .expect(200);

      expect(crmResponse.body.message).toBe('Document uploaded to CRM successfully');

      // 5. Check activity history
      const mockActivities = [
        {
          activity_type: 'email_export',
          activity_data: { recipients: ['client@example.com'] },
          created_at: new Date(),
          created_by: 'system'
        },
        {
          activity_type: 'crm_upload',
          activity_data: { crmSystem: 'salesforce' },
          created_at: new Date(),
          created_by: 'system'
        }
      ];

      mockDb.query.mockResolvedValueOnce({ rows: mockActivities });

      const activityResponse = await request(app)
        .get('/api/documents/doc-1/activity')
        .expect(200);

      expect(activityResponse.body).toHaveLength(2);
      expect(activityResponse.body[0].type).toBe('email_export');
      expect(activityResponse.body[1].type).toBe('crm_upload');
    });
  });
});
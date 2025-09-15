import { Pool } from 'pg';
import { DocumentGenerationService } from '../../services/documents/documentGenerationService';
import { DocumentGenerationContext } from '../../types/documents';

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('puppeteer');
jest.mock('fs/promises');

const mockPuppeteer = require('puppeteer');
const mockFs = require('fs/promises');

describe('DocumentGenerationService', () => {
  let service: DocumentGenerationService;
  let mockDb: any;
  let mockBrowser: any;
  let mockPage: any;

  beforeEach(() => {
    mockDb = {
      query: jest.fn()
    };

    mockPage = {
      setContent: jest.fn(),
      pdf: jest.fn(),
      close: jest.fn()
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn()
    };

    mockPuppeteer.launch.mockResolvedValue(mockBrowser);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    service = new DocumentGenerationService(mockDb as Pool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateDocument', () => {
    const mockTemplate = {
      id: '1',
      name: 'Test Template',
      type: 'custom' as const,
      template: '<html><body>Hello {{ client.name }}!</body></html>',
      is_default: false,
      required_fields: ['client'],
      risk_level: 'low' as const,
      version: 1,
      status: 'approved' as const,
      created_by: 'user1',
      approved_by: 'admin',
      created_at: new Date(),
      updated_at: new Date(),
      approved_at: new Date()
    };

    const mockContext: DocumentGenerationContext = {
      client: {
        name: 'John Doe',
        email: 'john@example.com'
      }
    };

    it('should generate document successfully', async () => {
      const mockGeneratedDoc = {
        id: 'doc-1',
        template_id: '1',
        client_id: 'client-1',
        title: 'Test Document',
        content: '<html><body>Hello John Doe!</body></html>',
        pdf_path: '/path/to/pdf',
        status: 'approved',
        metadata: {},
        created_by: 'agent',
        created_at: new Date(),
        expires_at: new Date()
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockTemplate] }) // getTemplate
        .mockResolvedValueOnce({ rows: [mockGeneratedDoc] }); // saveDocument

      mockPage.pdf.mockResolvedValue(Buffer.from('pdf content'));

      const result = await service.generateDocument('1', mockContext, {
        title: 'Test Document',
        clientId: 'client-1',
        createdBy: 'agent'
      });

      expect(result.title).toBe('Test Document');
      expect(result.content).toContain('John Doe');
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should throw error for non-existent template', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.generateDocument('nonexistent', mockContext))
        .rejects.toThrow('Template not found');
    });

    it('should throw error for missing required fields', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [mockTemplate] });

      const incompleteContext = {}; // Missing client entirely

      await expect(service.generateDocument('1', incompleteContext))
        .rejects.toThrow('Missing required fields');
    });

    it('should set pending approval for high-risk templates', async () => {
      const highRiskTemplate = {
        ...mockTemplate,
        risk_level: 'high' as const
      };

      const mockGeneratedDoc = {
        id: 'doc-1',
        template_id: '1',
        client_id: 'client-1',
        title: 'Test Document',
        content: '<html><body>Hello John Doe!</body></html>',
        pdf_path: '/path/to/pdf',
        status: 'pending_approval',
        metadata: {},
        created_by: 'agent',
        created_at: new Date(),
        expires_at: new Date()
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [highRiskTemplate] })
        .mockResolvedValueOnce({ rows: [mockGeneratedDoc] });

      mockPage.pdf.mockResolvedValue(Buffer.from('pdf content'));

      const result = await service.generateDocument('1', mockContext);

      expect(result.status).toBe('pending_approval');
    });
  });

  describe('getDocument', () => {
    it('should fetch document by ID', async () => {
      const mockDoc = {
        id: 'doc-1',
        template_id: '1',
        client_id: 'client-1',
        title: 'Test Document',
        content: '<html>Test</html>',
        pdf_path: '/path/to/pdf',
        status: 'approved',
        metadata: {},
        created_by: 'agent',
        created_at: new Date(),
        expires_at: new Date()
      };

      mockDb.query.mockResolvedValue({ rows: [mockDoc] });

      const result = await service.getDocument('doc-1');

      expect(result).toBeTruthy();
      expect(result?.title).toBe('Test Document');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['doc-1']
      );
    });

    it('should return null for non-existent document', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await service.getDocument('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('approveDocument', () => {
    it('should approve document successfully', async () => {
      const mockDoc = {
        id: 'doc-1',
        template_id: '1',
        client_id: 'client-1',
        title: 'Test Document',
        content: '<html>Test</html>',
        pdf_path: '/path/to/pdf',
        status: 'approved',
        metadata: {},
        created_by: 'agent',
        created_at: new Date(),
        expires_at: new Date()
      };

      mockDb.query.mockResolvedValue({ rows: [mockDoc] });

      const result = await service.approveDocument('doc-1', 'admin');

      expect(result.status).toBe('approved');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE generated_documents'),
        ['doc-1']
      );
    });

    it('should throw error for non-existent document', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(service.approveDocument('nonexistent', 'admin'))
        .rejects.toThrow('Document not found');
    });
  });

  describe('getDocuments', () => {
    it('should fetch documents with filters', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          template_id: '1',
          client_id: 'client-1',
          title: 'Test Document 1',
          content: '<html>Test 1</html>',
          pdf_path: '/path/to/pdf1',
          status: 'approved',
          metadata: {},
          created_by: 'agent',
          created_at: new Date(),
          expires_at: new Date()
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockDocs });

      const result = await service.getDocuments({
        clientId: 'client-1',
        status: 'approved',
        limit: 10
      });

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test Document 1');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('AND client_id = $1'),
        expect.arrayContaining(['client-1', 'approved', 10])
      );
    });
  });

  describe('cleanupExpiredDocuments', () => {
    it('should cleanup expired documents and files', async () => {
      const expiredDocs = [
        { id: 'doc-1', pdf_path: '/path/to/pdf1' },
        { id: 'doc-2', pdf_path: '/path/to/pdf2' }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: expiredDocs })
        .mockResolvedValueOnce({ rowCount: 2 });

      mockFs.unlink.mockResolvedValue(undefined);

      const result = await service.cleanupExpiredDocuments();

      expect(result).toBe(2);
      expect(mockFs.unlink).toHaveBeenCalledTimes(2);
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should handle file deletion errors gracefully', async () => {
      const expiredDocs = [
        { id: 'doc-1', pdf_path: '/path/to/pdf1' }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: expiredDocs })
        .mockResolvedValueOnce({ rowCount: 1 });

      mockFs.unlink.mockRejectedValue(new Error('File not found'));

      const result = await service.cleanupExpiredDocuments();

      expect(result).toBe(1);
      expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    });
  });

  describe('browser management', () => {
    it('should initialize browser when needed', async () => {
      await service.initializeBrowser();

      expect(mockPuppeteer.launch).toHaveBeenCalledWith({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    });

    it('should close browser properly', async () => {
      await service.initializeBrowser();
      await service.closeBrowser();

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });
});
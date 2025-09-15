import { Pool } from 'pg';
import { TemplateManagementService } from '../../services/documents/templateManagementService';
import { TemplateUploadRequest } from '../../types/documents';

// Mock dependencies
jest.mock('../../utils/logger');

describe('TemplateManagementService', () => {
  let service: TemplateManagementService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
      connect: jest.fn()
    };

    service = new TemplateManagementService(mockDb as Pool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTemplates', () => {
    it('should fetch all templates without filters', async () => {
      const mockTemplates = [
        {
          id: '1',
          name: 'Test Template',
          type: 'custom',
          template: '<html>Test</html>',
          is_default: false,
          required_fields: ['client'],
          risk_level: 'low',
          version: 1,
          status: 'approved',
          created_by: 'user1',
          approved_by: 'admin',
          created_at: new Date(),
          updated_at: new Date(),
          approved_at: new Date()
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockTemplates } as any);

      const result = await service.getTemplates();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        []
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Template');
    });

    it('should fetch templates with filters', async () => {
      mockDb.query.mockResolvedValue({ rows: [] } as any);

      await service.getTemplates({
        type: 'advisory_protocol',
        status: 'approved',
        isDefault: true
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('AND type = $1'),
        ['advisory_protocol', 'approved', true]
      );
    });

    it('should handle database errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(service.getTemplates()).rejects.toThrow('Failed to fetch templates');
    });
  });

  describe('getTemplateById', () => {
    it('should fetch template by ID', async () => {
      const mockTemplate = {
        id: '1',
        name: 'Test Template',
        type: 'custom',
        template: '<html>Test</html>',
        is_default: false,
        required_fields: ['client'],
        risk_level: 'low',
        version: 1,
        status: 'approved',
        created_by: 'user1',
        approved_by: 'admin',
        created_at: new Date(),
        updated_at: new Date(),
        approved_at: new Date()
      };

      mockDb.query.mockResolvedValue({ rows: [mockTemplate] } as any);

      const result = await service.getTemplateById('1');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['1']
      );
      expect(result).toBeTruthy();
      expect(result?.name).toBe('Test Template');
    });

    it('should return null for non-existent template', async () => {
      mockDb.query.mockResolvedValue({ rows: [] } as any);

      const result = await service.getTemplateById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('validateTemplate', () => {
    it('should validate correct template syntax', () => {
      const template = '<html><body>Hello {{ client.name }}!</body></html>';
      
      const result = service.validateTemplate(template);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.requiredFields).toContain('client');
    });

    it('should detect template syntax errors', () => {
      const template = '<html><body>Hello {{ client.name }!</body></html>'; // Missing closing brace
      
      const result = service.validateTemplate(template);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should extract required fields from template', () => {
      const template = `
        <html>
          <body>
            <p>Client: {{ client.name }}</p>
            <p>Agent: {{ agent.name }}</p>
            <p>Date: {{ date }}</p>
          </body>
        </html>
      `;
      
      const result = service.validateTemplate(template);

      expect(result.requiredFields).toContain('client');
      expect(result.requiredFields).toContain('agent');
      expect(result.requiredFields).toContain('date');
    });

    it('should warn about very short templates', () => {
      const template = 'Hi';
      
      const result = service.validateTemplate(template);

      expect(result.warnings).toContain('Template seems very short');
    });

    it('should warn about templates without variables', () => {
      const template = '<html><body>Static content only</body></html>';
      
      const result = service.validateTemplate(template);

      expect(result.warnings).toContain('Template does not contain any variables');
    });
  });

  describe('createTemplate', () => {
    it('should create new template successfully', async () => {
      const templateData: TemplateUploadRequest = {
        name: 'Test Template',
        type: 'custom',
        template: '<html><body>Hello {{ client.name }}!</body></html>',
        requiredFields: ['client'],
        riskLevel: 'low'
      };

      const mockCreatedTemplate = {
        id: '1',
        name: 'Test Template',
        type: 'custom',
        template: templateData.template,
        is_default: false,
        required_fields: ['client'],
        risk_level: 'low',
        version: 1,
        status: 'draft',
        created_by: 'user1',
        approved_by: null,
        created_at: new Date(),
        updated_at: new Date(),
        approved_at: null
      };

      mockDb.query.mockResolvedValue({ rows: [mockCreatedTemplate] } as any);

      const result = await service.createTemplate(templateData, 'user1');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO document_templates'),
        expect.arrayContaining([
          expect.any(String), // id
          'Test Template',
          'custom',
          templateData.template,
          JSON.stringify(['client']),
          'low',
          'user1'
        ])
      );
      expect(result.name).toBe('Test Template');
    });

    it('should reject invalid template syntax', async () => {
      const templateData: TemplateUploadRequest = {
        name: 'Invalid Template',
        type: 'custom',
        template: '<html><body>Hello {{ client.name }!</body></html>', // Missing closing brace
        requiredFields: ['client'],
        riskLevel: 'low'
      };

      await expect(service.createTemplate(templateData, 'user1'))
        .rejects.toThrow('Template validation failed');

      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });

  describe('updateTemplate', () => {
    it('should update template successfully', async () => {
      const existingTemplate = {
        id: '1',
        name: 'Old Name',
        type: 'custom',
        template: '<html>Old</html>',
        is_default: false,
        required_fields: ['client'],
        risk_level: 'low',
        version: 1,
        status: 'approved',
        created_by: 'user1',
        approved_by: 'admin',
        created_at: new Date(),
        updated_at: new Date(),
        approved_at: new Date()
      };

      const updatedTemplate = {
        ...existingTemplate,
        name: 'New Name',
        template: '<html>New</html>',
        version: 2,
        status: 'draft',
        approved_by: null,
        approved_at: null
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [existingTemplate] } as any) // getTemplateById
        .mockResolvedValueOnce({ rows: [updatedTemplate] } as any); // update

      const result = await service.updateTemplate('1', {
        name: 'New Name',
        template: '<html>New</html>'
      }, 'user1');

      expect(result.name).toBe('New Name');
      expect(result.version).toBe(2);
      expect(result.status).toBe('draft');
    });

    it('should throw error for non-existent template', async () => {
      mockDb.query.mockResolvedValue({ rows: [] } as any);

      await expect(service.updateTemplate('nonexistent', { name: 'New Name' }, 'user1'))
        .rejects.toThrow('Template not found');
    });
  });

  describe('approveTemplate', () => {
    it('should approve template successfully', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };

      const approvedTemplate = {
        id: '1',
        name: 'Test Template',
        type: 'custom',
        template: '<html>Test</html>',
        is_default: false,
        required_fields: ['client'],
        risk_level: 'low',
        version: 1,
        status: 'approved',
        created_by: 'user1',
        approved_by: 'admin',
        created_at: new Date(),
        updated_at: new Date(),
        approved_at: new Date()
      };

      mockDb.connect.mockResolvedValue(mockClient as any);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [approvedTemplate] } as any) // UPDATE
        .mockResolvedValueOnce(undefined) // INSERT approval history
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await service.approveTemplate({
        templateId: '1',
        approved: true,
        comments: 'Looks good'
      }, 'admin');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result.status).toBe('approved');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };

      mockDb.connect.mockResolvedValue(mockClient as any);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('Database error')); // UPDATE fails

      await expect(service.approveTemplate({
        templateId: '1',
        approved: true
      }, 'admin')).rejects.toThrow('Database error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('deleteTemplate', () => {
    it('should archive template successfully', async () => {
      mockDb.query.mockResolvedValue({ rowCount: 1 } as any);

      await service.deleteTemplate('1');

      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE document_templates SET status = $1 WHERE id = $2',
        ['archived', '1']
      );
    });

    it('should throw error for non-existent template', async () => {
      mockDb.query.mockResolvedValue({ rowCount: 0 } as any);

      await expect(service.deleteTemplate('nonexistent'))
        .rejects.toThrow('Template not found');
    });
  });

  describe('getTemplateApprovalHistory', () => {
    it('should fetch approval history', async () => {
      const mockHistory = [
        {
          approved_by: 'admin',
          approved: true,
          comments: 'Approved',
          created_at: new Date()
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockHistory } as any);

      const result = await service.getTemplateApprovalHistory('1');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM template_approvals'),
        ['1']
      );
      expect(result).toEqual(mockHistory);
    });
  });
});
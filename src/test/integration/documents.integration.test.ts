import request from 'supertest';
import express from 'express';
import { Pool } from 'pg';
import createDocumentRoutes from '../../routes/documents';
import { authenticateToken } from '../../middleware/auth';

// Mock dependencies
jest.mock('../../middleware/auth');
jest.mock('../../utils/logger');

const mockAuthenticateToken = authenticateToken as jest.MockedFunction<typeof authenticateToken>;

describe('Document Routes Integration', () => {
  let app: express.Application;
  let mockDb: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    mockDb = {
      query: jest.fn(),
      connect: jest.fn()
    };

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

  describe('GET /api/documents/templates', () => {
    it('should return all templates', async () => {
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

      mockDb.query.mockResolvedValueOnce({ rows: mockTemplates });

      const response = await request(app)
        .get('/api/documents/templates')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Test Template');
    });

    it('should filter templates by query parameters', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/documents/templates?type=advisory_protocol&status=approved')
        .expect(200);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('AND type = $1'),
        expect.arrayContaining(['advisory_protocol', 'approved'])
      );
    });

    it('should handle database errors', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Database error'));

      await request(app)
        .get('/api/documents/templates')
        .expect(500);
    });
  });

  describe('GET /api/documents/templates/:id', () => {
    it('should return template by ID', async () => {
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

      mockDb.query.mockResolvedValueOnce({ rows: [mockTemplate] });

      const response = await request(app)
        .get('/api/documents/templates/1')
        .expect(200);

      expect(response.body.name).toBe('Test Template');
    });

    it('should return 404 for non-existent template', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/documents/templates/nonexistent')
        .expect(404);
    });
  });

  describe('POST /api/documents/templates/validate', () => {
    it('should validate template syntax', async () => {
      const template = '<html><body>Hello {{ client.name }}!</body></html>';

      const response = await request(app)
        .post('/api/documents/templates/validate')
        .send({ template })
        .expect(200);

      expect(response.body.isValid).toBe(true);
      expect(response.body.requiredFields).toContain('client');
    });

    it('should return validation errors for invalid template', async () => {
      const template = '<html><body>Hello {{ client.name }!</body></html>'; // Missing closing brace

      const response = await request(app)
        .post('/api/documents/templates/validate')
        .send({ template })
        .expect(200);

      expect(response.body.isValid).toBe(false);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should return 400 for missing template', async () => {
      await request(app)
        .post('/api/documents/templates/validate')
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/documents/templates', () => {
    it('should create new template', async () => {
      const templateData = {
        name: 'Test Template',
        type: 'custom',
        template: '<html><body>Hello {{ client.name }}!</body></html>',
        requiredFields: ['client'],
        riskLevel: 'low'
      };

      const mockCreatedTemplate = {
        id: '1',
        name: templateData.name,
        type: templateData.type,
        template: templateData.template,
        is_default: false,
        required_fields: templateData.requiredFields,
        risk_level: templateData.riskLevel,
        version: 1,
        status: 'draft',
        created_by: 'test-user',
        approved_by: null,
        created_at: new Date(),
        updated_at: new Date(),
        approved_at: null
      };

      mockDb.query.mockResolvedValueOnce({ rows: [mockCreatedTemplate] });

      const response = await request(app)
        .post('/api/documents/templates')
        .send(templateData)
        .expect(201);

      expect(response.body.name).toBe('Test Template');
      expect(response.body.status).toBe('draft');
    });

    it('should return 400 for missing required fields', async () => {
      await request(app)
        .post('/api/documents/templates')
        .send({ name: 'Test' })
        .expect(400);
    });

    it('should return 400 for invalid template type', async () => {
      const templateData = {
        name: 'Test Template',
        type: 'invalid_type',
        template: '<html>Test</html>',
        riskLevel: 'low'
      };

      await request(app)
        .post('/api/documents/templates')
        .send(templateData)
        .expect(400);
    });

    it('should return 400 for invalid risk level', async () => {
      const templateData = {
        name: 'Test Template',
        type: 'custom',
        template: '<html>Test</html>',
        riskLevel: 'invalid_risk'
      };

      await request(app)
        .post('/api/documents/templates')
        .send(templateData)
        .expect(400);
    });
  });

  describe('PUT /api/documents/templates/:id', () => {
    it('should update template', async () => {
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
        version: 2,
        status: 'draft',
        approved_by: null,
        approved_at: null
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [existingTemplate] })
        .mockResolvedValueOnce({ rows: [updatedTemplate] });

      const response = await request(app)
        .put('/api/documents/templates/1')
        .send({ name: 'New Name' })
        .expect(200);

      expect(response.body.name).toBe('New Name');
    });

    it('should return 404 for non-existent template', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/documents/templates/nonexistent')
        .send({ name: 'New Name' })
        .expect(404);
    });
  });

  describe('POST /api/documents/templates/:id/approve', () => {
    it('should approve template', async () => {
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
        approved_by: 'test-user',
        created_at: new Date(),
        updated_at: new Date(),
        approved_at: new Date()
      };

      mockDb.connect.mockResolvedValueOnce(mockClient);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [approvedTemplate] }) // UPDATE
        .mockResolvedValueOnce(undefined) // INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const response = await request(app)
        .post('/api/documents/templates/1/approve')
        .send({ approved: true, comments: 'Looks good' })
        .expect(200);

      expect(response.body.status).toBe('approved');
    });

    it('should return 400 for missing approved field', async () => {
      await request(app)
        .post('/api/documents/templates/1/approve')
        .send({ comments: 'Test' })
        .expect(400);
    });
  });

  describe('DELETE /api/documents/templates/:id', () => {
    it('should delete (archive) template', async () => {
      mockDb.query.mockResolvedValueOnce({ rowCount: 1 });

      await request(app)
        .delete('/api/documents/templates/1')
        .expect(204);
    });

    it('should return 404 for non-existent template', async () => {
      mockDb.query.mockResolvedValueOnce({ rowCount: 0 });

      await request(app)
        .delete('/api/documents/templates/nonexistent')
        .expect(404);
    });
  });

  describe('GET /api/documents/templates/:id/approval-history', () => {
    it('should return approval history', async () => {
      const mockHistory = [
        {
          approved_by: 'admin',
          approved: true,
          comments: 'Approved',
          created_at: new Date()
        }
      ];

      mockDb.query.mockResolvedValueOnce({ rows: mockHistory });

      const response = await request(app)
        .get('/api/documents/templates/1/approval-history')
        .expect(200);

      expect(response.body).toEqual(mockHistory);
    });
  });
});
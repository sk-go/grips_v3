import express from 'express';
import multer from 'multer';
import { TemplateManagementService } from '../services/documents/templateManagementService';
import { DocumentGenerationService } from '../services/documents/documentGenerationService';
import { DocumentWorkflowService } from '../services/documents/documentWorkflowService';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 5 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/html' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only HTML and text files are allowed'));
    }
  }
});

import { Pool } from 'pg';

export function createDocumentRoutes(db: Pool) {
  const templateService = new TemplateManagementService(db);
  const documentService = new DocumentGenerationService(db);
  const workflowService = new DocumentWorkflowService(db, documentService);

  /**
   * GET /api/documents/templates
   * Get all templates with optional filtering
   */
  router.get('/templates', authenticateToken, async (req, res) => {
    try {
      const { type, status, isDefault } = req.query;
      
      const filters: any = {};
      if (type) filters.type = type as string;
      if (status) filters.status = status as string;
      if (isDefault !== undefined) filters.isDefault = isDefault === 'true';

      const templates = await templateService.getTemplates(filters);
      res.json(templates);
    } catch (error) {
      logger.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  /**
   * GET /api/documents/templates/:id
   * Get template by ID
   */
  router.get('/templates/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const template = await templateService.getTemplateById(id);
      
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      return res.json(template);
    } catch (error) {
      logger.error('Error fetching template:', error);
      return res.status(500).json({ error: 'Failed to fetch template' });
    }
  });

  /**
   * POST /api/documents/templates/validate
   * Validate template syntax
   */
  router.post('/templates/validate', authenticateToken, async (req, res) => {
    try {
      const { template } = req.body;
      
      if (!template) {
        return res.status(400).json({ error: 'Template content is required' });
      }

      const validation = templateService.validateTemplate(template);
      return res.json(validation);
    } catch (error) {
      logger.error('Error validating template:', error);
      return res.status(500).json({ error: 'Failed to validate template' });
    }
  });

  /**
   * POST /api/documents/templates
   * Create new template
   */
  router.post('/templates', authenticateToken, async (req, res) => {
    try {
      const { name, type, template, requiredFields, riskLevel } = req.body;
      const userId = (req as any).user?.id || 'unknown';

      // Validate required fields
      if (!name || !type || !template || !riskLevel) {
        return res.status(400).json({ 
          error: 'Name, type, template, and riskLevel are required' 
        });
      }

      // Validate type
      const validTypes = ['advisory_protocol', 'policy_summary', 'meeting_notes', 'custom'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ 
          error: 'Invalid template type' 
        });
      }

      // Validate risk level
      const validRiskLevels = ['low', 'medium', 'high'];
      if (!validRiskLevels.includes(riskLevel)) {
        return res.status(400).json({ 
          error: 'Invalid risk level' 
        });
      }

      const templateData = {
        name,
        type,
        template,
        requiredFields: requiredFields || [],
        riskLevel
      };

      const newTemplate = await templateService.createTemplate(templateData, userId);
      return res.status(201).json(newTemplate);
    } catch (error) {
      logger.error('Error creating template:', error);
      if (error instanceof Error && error.message.includes('validation failed')) {
        return res.status(400).json({ error: error.message });
      } else {
        return res.status(500).json({ error: 'Failed to create template' });
      }
    }
  });

  /**
   * POST /api/documents/templates/upload
   * Upload template file
   */
  router.post('/templates/upload', authenticateToken, upload.single('template'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Template file is required' });
      }

      const { name, type, riskLevel } = req.body;
      const userId = (req as any).user?.id || 'unknown';

      if (!name || !type || !riskLevel) {
        return res.status(400).json({ 
          error: 'Name, type, and riskLevel are required' 
        });
      }

      const templateContent = req.file.buffer.toString('utf-8');
      
      // Validate template
      const validation = templateService.validateTemplate(templateContent);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: 'Template validation failed',
          details: validation.errors 
        });
      }

      const templateData = {
        name,
        type,
        template: templateContent,
        requiredFields: validation.requiredFields,
        riskLevel
      };

      const newTemplate = await templateService.createTemplate(templateData, userId);
      return res.status(201).json(newTemplate);
    } catch (error) {
      logger.error('Error uploading template:', error);
      return res.status(500).json({ error: 'Failed to upload template' });
    }
  });

  /**
   * PUT /api/documents/templates/:id
   * Update template
   */
  router.put('/templates/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, template, requiredFields, riskLevel } = req.body;
      const userId = (req as any).user?.id || 'unknown';

      const templateData: any = {};
      if (name) templateData.name = name;
      if (template) templateData.template = template;
      if (requiredFields) templateData.requiredFields = requiredFields;
      if (riskLevel) templateData.riskLevel = riskLevel;

      const updatedTemplate = await templateService.updateTemplate(id, templateData, userId);
      res.json(updatedTemplate);
    } catch (error) {
      logger.error('Error updating template:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: 'Template not found' });
      } else if (error instanceof Error && error.message.includes('validation failed')) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to update template' });
      }
    }
  });

  /**
   * POST /api/documents/templates/:id/approve
   * Approve or reject template
   */
  router.post('/templates/:id/approve', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { approved, comments } = req.body;
      const userId = (req as any).user?.id || 'unknown';

      if (typeof approved !== 'boolean') {
        return res.status(400).json({ error: 'Approved field is required and must be boolean' });
      }

      const approvalData = {
        templateId: id,
        approved,
        comments
      };

      const updatedTemplate = await templateService.approveTemplate(approvalData, userId);
      return res.json(updatedTemplate);
    } catch (error) {
      logger.error('Error approving template:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        return res.status(404).json({ error: 'Template not found' });
      } else {
        return res.status(500).json({ error: 'Failed to approve template' });
      }
    }
  });

  /**
   * DELETE /api/documents/templates/:id
   * Delete (archive) template
   */
  router.delete('/templates/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      await templateService.deleteTemplate(id);
      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting template:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: 'Template not found' });
      } else {
        res.status(500).json({ error: 'Failed to delete template' });
      }
    }
  });

  /**
   * GET /api/documents/templates/:id/approval-history
   * Get template approval history
   */
  router.get('/templates/:id/approval-history', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const history = await templateService.getTemplateApprovalHistory(id);
      return res.json(history);
    } catch (error) {
      logger.error('Error fetching approval history:', error);
      return res.status(500).json({ error: 'Failed to fetch approval history' });
    }
  });

  // Document Generation Routes

  /**
   * POST /api/documents/generate
   * Generate document from template
   */
  router.post('/generate', authenticateToken, async (req, res) => {
    try {
      const { templateId, context, title, clientId, generatePdf } = req.body;
      const userId = (req as any).user?.id || 'unknown';

      if (!templateId || !context) {
        return res.status(400).json({ 
          error: 'Template ID and context are required' 
        });
      }

      const document = await documentService.generateDocument(templateId, context, {
        title,
        clientId,
        createdBy: 'agent',
        generatePdf
      });

      return res.status(201).json(document);
    } catch (error) {
      logger.error('Error generating document:', error);
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          return res.status(404).json({ error: 'Template not found' });
        }
        if (error.message.includes('Missing required fields')) {
          return res.status(400).json({ error: error.message });
        }
      }
      return res.status(500).json({ error: 'Failed to generate document' });
    }
  });

  /**
   * GET /api/documents
   * Get documents with optional filtering
   */
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const { clientId, templateId, status, limit, offset } = req.query;
      
      const filters: any = {};
      if (clientId) filters.clientId = clientId as string;
      if (templateId) filters.templateId = templateId as string;
      if (status) filters.status = status as string;
      if (limit) filters.limit = parseInt(limit as string);
      if (offset) filters.offset = parseInt(offset as string);

      const documents = await documentService.getDocuments(filters);
      return res.json(documents);
    } catch (error) {
      logger.error('Error fetching documents:', error);
      return res.status(500).json({ error: 'Failed to fetch documents' });
    }
  });

  /**
   * GET /api/documents/:id
   * Get document by ID
   */
  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const document = await documentService.getDocument(id);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      return res.json(document);
    } catch (error) {
      logger.error('Error fetching document:', error);
      return res.status(500).json({ error: 'Failed to fetch document' });
    }
  });

  /**
   * GET /api/documents/:id/preview
   * Get document HTML preview
   */
  router.get('/:id/preview', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const document = await documentService.getDocument(id);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      res.setHeader('Content-Type', 'text/html');
      return res.send(document.content);
    } catch (error) {
      logger.error('Error fetching document preview:', error);
      return res.status(500).json({ error: 'Failed to fetch document preview' });
    }
  });

  /**
   * GET /api/documents/:id/download
   * Download document PDF
   */
  router.get('/:id/download', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const document = await documentService.getDocument(id);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (!document.pdfPath) {
        return res.status(404).json({ error: 'PDF not available for this document' });
      }

      // Check if file exists
      try {
        await require('fs/promises').access(document.pdfPath);
      } catch {
        return res.status(404).json({ error: 'PDF file not found' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${document.title}.pdf"`);
      
      return res.sendFile(document.pdfPath);
    } catch (error) {
      logger.error('Error downloading document:', error);
      return res.status(500).json({ error: 'Failed to download document' });
    }
  });

  /**
   * POST /api/documents/:id/approve
   * Approve document
   */
  router.post('/:id/approve', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id || 'unknown';

      const document = await documentService.approveDocument(id, userId);
      return res.json(document);
    } catch (error) {
      logger.error('Error approving document:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        return res.status(404).json({ error: 'Document not found' });
      }
      return res.status(500).json({ error: 'Failed to approve document' });
    }
  });

  // Document Workflow Routes

  /**
   * POST /api/documents/:id/email
   * Export document via email
   */
  router.post('/:id/email', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { to, cc, bcc, subject, body, attachPdf } = req.body;

      if (!to || !Array.isArray(to) || to.length === 0) {
        return res.status(400).json({ error: 'Recipients (to) are required' });
      }

      // Validate document before export
      const validation = await workflowService.validateDocumentForExport(id);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: 'Document validation failed',
          details: validation.errors 
        });
      }

      await workflowService.exportDocumentByEmail(id, {
        to,
        cc,
        bcc,
        subject,
        body,
        attachPdf: attachPdf !== false // Default to true
      });

      return res.json({ 
        message: 'Document exported successfully',
        warnings: validation.warnings 
      });
    } catch (error) {
      logger.error('Error exporting document by email:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        return res.status(404).json({ error: 'Document not found' });
      }
      return res.status(500).json({ error: 'Failed to export document' });
    }
  });

  /**
   * POST /api/documents/:id/crm-upload
   * Upload document to CRM system
   */
  router.post('/:id/crm-upload', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { crmSystem, clientId, documentType, notes } = req.body;

      if (!crmSystem || !clientId) {
        return res.status(400).json({ 
          error: 'CRM system and client ID are required' 
        });
      }

      const validCrmSystems = ['zoho', 'salesforce', 'hubspot', 'agencybloc'];
      if (!validCrmSystems.includes(crmSystem)) {
        return res.status(400).json({ error: 'Invalid CRM system' });
      }

      // Validate document before upload
      const validation = await workflowService.validateDocumentForExport(id);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: 'Document validation failed',
          details: validation.errors 
        });
      }

      await workflowService.uploadDocumentToCRM(id, {
        crmSystem,
        clientId,
        documentType,
        notes
      });

      return res.json({ 
        message: 'Document uploaded to CRM successfully',
        warnings: validation.warnings 
      });
    } catch (error) {
      logger.error('Error uploading document to CRM:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        return res.status(404).json({ error: 'Document not found' });
      }
      return res.status(500).json({ error: 'Failed to upload document to CRM' });
    }
  });

  /**
   * GET /api/documents/:id/activity
   * Get document activity history
   */
  router.get('/:id/activity', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const activities = await workflowService.getDocumentActivity(id);
      return res.json(activities);
    } catch (error) {
      logger.error('Error fetching document activity:', error);
      return res.status(500).json({ error: 'Failed to fetch document activity' });
    }
  });

  /**
   * POST /api/documents/:id/validate
   * Validate document for export/upload
   */
  router.post('/:id/validate', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const validation = await workflowService.validateDocumentForExport(id);
      return res.json(validation);
    } catch (error) {
      logger.error('Error validating document:', error);
      return res.status(500).json({ error: 'Failed to validate document' });
    }
  });

  /**
   * GET /api/documents/storage/statistics
   * Get document storage statistics
   */
  router.get('/storage/statistics', authenticateToken, async (req, res) => {
    try {
      const stats = await workflowService.getStorageStatistics();
      return res.json(stats);
    } catch (error) {
      logger.error('Error fetching storage statistics:', error);
      return res.status(500).json({ error: 'Failed to fetch storage statistics' });
    }
  });

  /**
   * POST /api/documents/cleanup
   * Clean up expired documents
   */
  router.post('/cleanup', authenticateToken, async (req, res) => {
    try {
      const result = await workflowService.cleanupExpiredDocuments();
      return res.json(result);
    } catch (error) {
      logger.error('Error cleaning up documents:', error);
      return res.status(500).json({ error: 'Failed to cleanup documents' });
    }
  });

  return router;
}

export default createDocumentRoutes;
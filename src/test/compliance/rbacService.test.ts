import { RBACService } from '../../services/compliance/rbacService';
import { DatabaseService } from '../../services/database';
import { AuditLoggingService } from '../../services/compliance/auditLoggingService';

// Mock dependencies
jest.mock('../../services/database');
jest.mock('../../services/compliance/auditLoggingService');

const mockDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockAuditLoggingService = AuditLoggingService as jest.Mocked<typeof AuditLoggingService>;

describe('RBACService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('hasPermission', () => {
    it('should return true for valid permissions', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [
          {
            permissions: {
              'communications': ['read', 'write'],
              'clients': ['read']
            }
          }
        ]
      } as any);

      const result = await RBACService.hasPermission('user-123', 'communications', 'read');
      expect(result).toBe(true);
    });

    it('should return true for wildcard permissions', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [
          {
            permissions: {
              '*': ['*']
            }
          }
        ]
      } as any);

      const result = await RBACService.hasPermission('user-123', 'any_resource', 'any_action');
      expect(result).toBe(true);
    });

    it('should return false for insufficient permissions', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [
          {
            permissions: {
              'communications': ['read']
            }
          }
        ]
      } as any);

      mockAuditLoggingService.logAction.mockResolvedValueOnce('audit-123');

      const result = await RBACService.hasPermission('user-123', 'communications', 'write');
      expect(result).toBe(false);
      expect(mockAuditLoggingService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'permission_denied',
          details: expect.objectContaining({
            resource: 'communications',
            action: 'write',
            reason: 'insufficient_permissions'
          })
        })
      );
    });

    it('should return false when no roles found', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: []
      } as any);

      mockAuditLoggingService.logAction.mockResolvedValueOnce('audit-123');

      const result = await RBACService.hasPermission('user-123', 'communications', 'read');
      expect(result).toBe(false);
      expect(mockAuditLoggingService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            reason: 'no_active_roles'
          })
        })
      );
    });
  });

  describe('assignRole', () => {
    it('should assign role successfully', async () => {
      // Mock role lookup
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ id: 'role-123', name: 'agent' }]
        } as any)
        // Mock existing assignment check
        .mockResolvedValueOnce({
          rows: []
        } as any)
        // Mock role assignment
        .mockResolvedValueOnce({
          rows: [{ id: 'assignment-123' }]
        } as any);

      mockAuditLoggingService.logAction.mockResolvedValueOnce('audit-123');

      const result = await RBACService.assignRole(
        'user-123',
        'agent',
        'admin-123',
        undefined,
        'session-123'
      );

      expect(result).toBe('assignment-123');
      expect(mockAuditLoggingService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'role_assigned',
          details: expect.objectContaining({
            targetUserId: 'user-123',
            roleName: 'agent'
          })
        })
      );
    });

    it('should throw error for non-existent role', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: []
      } as any);

      await expect(
        RBACService.assignRole('user-123', 'invalid-role', 'admin-123')
      ).rejects.toThrow("Role 'invalid-role' not found");
    });

    it('should throw error for existing assignment', async () => {
      mockDatabaseService.query
        .mockResolvedValueOnce({
          rows: [{ id: 'role-123', name: 'agent' }]
        } as any)
        .mockResolvedValueOnce({
          rows: [{ id: 'existing-assignment' }]
        } as any);

      await expect(
        RBACService.assignRole('user-123', 'agent', 'admin-123')
      ).rejects.toThrow('User already has this role assigned');
    });
  });

  describe('revokeRole', () => {
    it('should revoke role successfully', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: 'assignment-123' }]
      } as any);

      mockAuditLoggingService.logAction.mockResolvedValueOnce('audit-123');

      await RBACService.revokeRole('user-123', 'agent', 'admin-123', 'session-123');

      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_roles'),
        ['user-123', 'agent']
      );
      expect(mockAuditLoggingService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'role_revoked'
        })
      );
    });

    it('should throw error when role assignment not found', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: []
      } as any);

      await expect(
        RBACService.revokeRole('user-123', 'agent', 'admin-123')
      ).rejects.toThrow('Active role assignment not found');
    });
  });

  describe('createRole', () => {
    it('should create role with valid permissions', async () => {
      const permissions = {
        'communications': ['read', 'write'],
        'clients': ['read']
      };

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: [{ id: 'role-123' }]
      } as any);

      mockAuditLoggingService.logAction.mockResolvedValueOnce('audit-123');

      const result = await RBACService.createRole(
        'custom-role',
        'Custom role description',
        permissions,
        'admin-123',
        'session-123'
      );

      expect(result).toBe('role-123');
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO roles'),
        ['custom-role', 'Custom role description', JSON.stringify(permissions)]
      );
    });

    it('should reject wildcard permissions', async () => {
      const permissions = {
        '*': ['*']
      };

      await expect(
        RBACService.createRole('invalid-role', 'Description', permissions, 'admin-123')
      ).rejects.toThrow('Wildcard permissions not allowed for custom roles');
    });

    it('should reject wildcard actions for non-public resources', async () => {
      const permissions = {
        'sensitive_resource': ['*']
      };

      await expect(
        RBACService.createRole('invalid-role', 'Description', permissions, 'admin-123')
      ).rejects.toThrow('Wildcard actions not allowed for resource: sensitive_resource');
    });

    it('should reject invalid actions', async () => {
      const permissions = {
        'communications': ['invalid_action']
      };

      await expect(
        RBACService.createRole('invalid-role', 'Description', permissions, 'admin-123')
      ).rejects.toThrow('Invalid action: invalid_action');
    });
  });

  describe('getUserRoles', () => {
    it('should get user roles successfully', async () => {
      const mockRoles = [
        {
          id: 'role-1',
          name: 'agent',
          description: 'Insurance Agent',
          permissions: { 'communications': ['read', 'write'] },
          is_system_role: true,
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: mockRoles
      } as any);

      const result = await RBACService.getUserRoles('user-123');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('agent');
      expect(result[0].isSystemRole).toBe(true);
    });
  });

  describe('cleanupExpiredRoles', () => {
    it('should cleanup expired roles', async () => {
      const expiredRoles = [
        { id: 'assignment-1' },
        { id: 'assignment-2' }
      ];

      mockDatabaseService.query.mockResolvedValueOnce({
        rows: expiredRoles
      } as any);

      mockAuditLoggingService.logAction.mockResolvedValueOnce('audit-123');

      const result = await RBACService.cleanupExpiredRoles();

      expect(result).toBe(2);
      expect(mockAuditLoggingService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'roles_expired',
          details: expect.objectContaining({
            expiredCount: 2
          })
        })
      );
    });

    it('should handle no expired roles', async () => {
      mockDatabaseService.query.mockResolvedValueOnce({
        rows: []
      } as any);

      const result = await RBACService.cleanupExpiredRoles();
      expect(result).toBe(0);
      expect(mockAuditLoggingService.logAction).not.toHaveBeenCalled();
    });
  });
});
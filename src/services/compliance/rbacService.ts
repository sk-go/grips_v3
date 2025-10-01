import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';
import { AuditLoggingService } from './auditLoggingService';

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Record<string, string[]>;
  isSystemRole: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRole {
  id: string;
  userId: string;
  roleId: string;
  assignedBy?: string;
  assignedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
}

export interface Permission {
  resource: string;
  action: string;
}

export class RBACService {
  /**
   * Check if user has permission for a specific action
   */
  static async hasPermission(
    userId: string,
    resource: string,
    action: string,
    sessionId?: string
  ): Promise<boolean> {
    try {
      const query = `
        SELECT r.permissions
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = $1 
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      `;

      const result = await DatabaseService.query(query, [userId]);
      
      if (result.rows.length === 0) {
        await AuditLoggingService.logAction({
          userId,
          sessionId,
          actionType: 'permission_denied',
          resourceType: 'rbac',
          details: {
            resource,
            action,
            reason: 'no_active_roles'
          },
          riskLevel: 'medium'
        });
        return false;
      }

      // Check permissions across all active roles
      for (const row of result.rows) {
        const permissions = row.permissions;
        
        // Check for wildcard permissions (admin)
        if (permissions['*'] && permissions['*'].includes('*')) {
          return true;
        }

        // Check specific resource permissions
        if (permissions[resource]) {
          if (permissions[resource].includes('*') || permissions[resource].includes(action)) {
            return true;
          }
        }
      }

      // Log permission denial
      await AuditLoggingService.logAction({
        userId,
        sessionId,
        actionType: 'permission_denied',
        resourceType: 'rbac',
        details: {
          resource,
          action,
          reason: 'insufficient_permissions'
        },
        riskLevel: 'medium'
      });

      return false;
    } catch (error) {
      logger.error('Failed to check permission', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        resource,
        action
      });
      return false;
    }
  }

  /**
   * Get all roles for a user
   */
  static async getUserRoles(userId: string): Promise<Role[]> {
    try {
      const query = `
        SELECT r.id, r.name, r.description, r.permissions, r.is_system_role,
               r.created_at, r.updated_at
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = $1 
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        ORDER BY r.name
      `;

      const result = await DatabaseService.query(query, [userId]);
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        permissions: row.permissions,
        isSystemRole: row.is_system_role,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get user roles', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw new Error('Failed to get user roles');
    }
  }

  /**
   * Assign role to user with minimal permissions principle
   */
  static async assignRole(
    userId: string,
    roleName: string,
    assignedBy: string,
    expiresAt?: Date,
    sessionId?: string
  ): Promise<string> {
    try {
      // Get role by name
      const roleQuery = `SELECT id, name FROM roles WHERE name = $1`;
      const roleResult = await DatabaseService.query(roleQuery, [roleName]);
      
      if (roleResult.rows.length === 0) {
        throw new Error(`Role '${roleName}' not found`);
      }

      const roleId = roleResult.rows[0].id;

      // Check if assignment already exists
      const existingQuery = `
        SELECT id FROM user_roles 
        WHERE user_id = $1 AND role_id = $2 AND is_active = true
      `;
      const existingResult = await DatabaseService.query(existingQuery, [userId, roleId]);

      if (existingResult.rows.length > 0) {
        throw new Error('User already has this role assigned');
      }

      // Insert new role assignment
      const insertQuery = `
        INSERT INTO user_roles (user_id, role_id, assigned_by, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;

      const insertResult = await DatabaseService.query(insertQuery, [
        userId,
        roleId,
        assignedBy,
        expiresAt || null
      ]);

      const assignmentId = insertResult.rows[0].id;

      // Log the role assignment
      await AuditLoggingService.logAction({
        userId: assignedBy,
        sessionId,
        actionType: 'role_assigned',
        resourceType: 'rbac',
        resourceId: assignmentId,
        details: {
          targetUserId: userId,
          roleName,
          expiresAt: expiresAt?.toISOString()
        },
        riskLevel: 'medium'
      });

      logger.info('Role assigned to user', {
        userId,
        roleName,
        assignedBy,
        assignmentId
      });

      return assignmentId;
    } catch (error) {
      logger.error('Failed to assign role', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        roleName,
        assignedBy
      });
      throw error;
    }
  }

  /**
   * Revoke role from user
   */
  static async revokeRole(
    userId: string,
    roleName: string,
    revokedBy: string,
    sessionId?: string
  ): Promise<void> {
    try {
      const query = `
        UPDATE user_roles 
        SET is_active = false
        FROM roles r
        WHERE user_roles.role_id = r.id
          AND user_roles.user_id = $1
          AND r.name = $2
          AND user_roles.is_active = true
        RETURNING user_roles.id
      `;

      const result = await DatabaseService.query(query, [userId, roleName]);

      if (result.rows.length === 0) {
        throw new Error('Active role assignment not found');
      }

      // Log the role revocation
      await AuditLoggingService.logAction({
        userId: revokedBy,
        sessionId,
        actionType: 'role_revoked',
        resourceType: 'rbac',
        resourceId: result.rows[0].id,
        details: {
          targetUserId: userId,
          roleName
        },
        riskLevel: 'medium'
      });

      logger.info('Role revoked from user', {
        userId,
        roleName,
        revokedBy
      });
    } catch (error) {
      logger.error('Failed to revoke role', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        roleName,
        revokedBy
      });
      throw error;
    }
  }

  /**
   * Create new role with minimal permissions
   */
  static async createRole(
    name: string,
    description: string,
    permissions: Record<string, string[]>,
    createdBy: string,
    sessionId?: string
  ): Promise<string> {
    try {
      // Validate permissions follow minimal access principle
      this.validateMinimalPermissions(permissions);

      const query = `
        INSERT INTO roles (name, description, permissions, is_system_role)
        VALUES ($1, $2, $3, false)
        RETURNING id
      `;

      const result = await DatabaseService.query(query, [
        name,
        description,
        JSON.stringify(permissions)
      ]);

      const roleId = result.rows[0].id;

      // Log role creation
      await AuditLoggingService.logAction({
        userId: createdBy,
        sessionId,
        actionType: 'role_created',
        resourceType: 'rbac',
        resourceId: roleId,
        details: {
          roleName: name,
          permissions
        },
        riskLevel: 'high'
      });

      logger.info('New role created', {
        roleId,
        name,
        createdBy
      });

      return roleId;
    } catch (error) {
      logger.error('Failed to create role', {
        error: error instanceof Error ? error.message : 'Unknown error',
        name,
        createdBy
      });
      throw error;
    }
  }

  /**
   * Validate permissions follow minimal access principle
   */
  private static validateMinimalPermissions(permissions: Record<string, string[]>): void {
    // Prevent wildcard permissions for non-admin roles
    if (permissions['*']) {
      throw new Error('Wildcard permissions not allowed for custom roles');
    }

    // Validate each resource has specific actions
    for (const [resource, actions] of Object.entries(permissions)) {
      if (actions.includes('*') && resource !== 'public') {
        throw new Error(`Wildcard actions not allowed for resource: ${resource}`);
      }

      // Validate actions are from allowed set
      const allowedActions = ['read', 'write', 'delete', 'execute', 'admin'];
      for (const action of actions) {
        if (action !== '*' && !allowedActions.includes(action)) {
          throw new Error(`Invalid action: ${action}`);
        }
      }
    }
  }

  /**
   * Get all available roles
   */
  static async getAllRoles(): Promise<Role[]> {
    try {
      const query = `
        SELECT id, name, description, permissions, is_system_role,
               created_at, updated_at
        FROM roles
        ORDER BY is_system_role DESC, name ASC
      `;

      const result = await DatabaseService.query(query);
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        permissions: row.permissions,
        isSystemRole: row.is_system_role,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get all roles', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to get all roles');
    }
  }

  /**
   * Clean up expired role assignments
   */
  static async cleanupExpiredRoles(): Promise<number> {
    try {
      const query = `
        UPDATE user_roles 
        SET is_active = false
        WHERE expires_at < NOW() AND is_active = true
        RETURNING id
      `;

      const result = await DatabaseService.query(query);
      const expiredCount = result.rows.length;

      if (expiredCount > 0) {
        await AuditLoggingService.logAction({
          actionType: 'roles_expired',
          resourceType: 'rbac',
          details: {
            expiredCount,
            expiredRoles: result.rows.map(r => r.id)
          },
          riskLevel: 'low'
        });

        logger.info('Expired roles cleaned up', { expiredCount });
      }

      return expiredCount;
    } catch (error) {
      logger.error('Failed to cleanup expired roles', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to cleanup expired roles');
    }
  }
}
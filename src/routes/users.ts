import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { AuthService, CreateUserRequest, UserProfileUpdate } from '../services/auth';
import { authenticateToken, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { DatabaseService } from '../services/database';

const router = Router();

// Validation schemas
const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  role: Joi.string().valid('agent', 'admin').default('agent')
});

const updateUserProfileSchema = Joi.object({
  firstName: Joi.string().min(1).max(100).optional(),
  lastName: Joi.string().min(1).max(100).optional(),
  email: Joi.string().email().optional()
}).min(1); // At least one field must be provided

const getUsersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  role: Joi.string().valid('agent', 'admin').optional(),
  isActive: Joi.boolean().optional(),
  search: Joi.string().max(100).optional()
});

/**
 * POST /api/users
 * Create new user (admin only)
 * Requirements: 2.2, 5.1
 */
router.post('/', authenticateToken, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = createUserSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { email, password, firstName, lastName, role } = value;

  try {
    const user = await AuthService.createUser({ 
      email, 
      password, 
      firstName, 
      lastName, 
      role 
    } as CreateUserRequest);
    
    logger.info('User created by admin', {
      createdUserId: user.id,
      createdUserEmail: user.email,
      createdUserRole: user.role,
      adminUserId: req.user!.id,
      adminEmail: req.user!.email
    });

    return res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isActive: user.isActive,
        emailVerified: user.emailVerified
      }
    });
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        error: 'User with this email already exists'
      });
    }
    if (error.message.includes('Password validation failed')) {
      return res.status(400).json({
        error: error.message
      });
    }
    throw error;
  }
}));

/**
 * GET /api/users
 * Get list of users with pagination and filtering (admin only)
 * Requirements: 5.1
 */
router.get('/', authenticateToken, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = getUsersQuerySchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { page, limit, role, isActive, search } = value;
  const offset = (page - 1) * limit;

  // Build dynamic query
  let whereConditions: string[] = [];
  let queryParams: any[] = [];
  let paramIndex = 1;

  if (role !== undefined) {
    whereConditions.push(`role = $${paramIndex++}`);
    queryParams.push(role);
  }

  if (isActive !== undefined) {
    whereConditions.push(`is_active = $${paramIndex++}`);
    queryParams.push(isActive);
  }

  if (search) {
    whereConditions.push(`(
      LOWER(first_name) LIKE LOWER($${paramIndex}) OR 
      LOWER(last_name) LIKE LOWER($${paramIndex}) OR 
      LOWER(email) LIKE LOWER($${paramIndex})
    )`);
    queryParams.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM users 
    ${whereClause}
  `;
  const countResult = await DatabaseService.query(countQuery, queryParams);
  const total = parseInt(countResult.rows[0].total);

  // Get users with pagination
  const usersQuery = `
    SELECT id, email, first_name, last_name, role, is_active, email_verified, keycloak_id, created_at, updated_at
    FROM users 
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;
  queryParams.push(limit, offset);

  const usersResult = await DatabaseService.query(usersQuery, queryParams);

  const users = usersResult.rows.map(user => ({
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    isActive: user.is_active,
    emailVerified: user.email_verified,
    keycloakId: user.keycloak_id,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  }));

  const totalPages = Math.ceil(total / limit);

  logger.info('Users list retrieved by admin', {
    adminUserId: req.user!.id,
    adminEmail: req.user!.email,
    filters: { role, isActive, search },
    pagination: { page, limit, total, totalPages }
  });

  return res.json({
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  });
}));

/**
 * GET /api/users/:id
 * Get user by ID (admin only or own profile)
 * Requirements: 5.1
 */
router.get('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Users can view their own profile, admins can view any profile
  if (req.user!.role !== 'admin' && req.user!.id !== id) {
    return res.status(403).json({
      error: 'Insufficient permissions to view this user'
    });
  }

  const user = await AuthService.getUserById(id);
  
  if (!user) {
    return res.status(404).json({
      error: 'User not found'
    });
  }

  logger.info('User profile retrieved', {
    viewedUserId: user.id,
    viewedUserEmail: user.email,
    viewerUserId: req.user!.id,
    viewerEmail: req.user!.email,
    viewerRole: req.user!.role
  });

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      keycloakId: user.keycloakId
    }
  });
}));

/**
 * PUT /api/users/:id
 * Update user profile (admin only or own profile)
 * Requirements: 2.2, 5.1
 */
router.put('/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Users can update their own profile, admins can update any profile
  if (req.user!.role !== 'admin' && req.user!.id !== id) {
    return res.status(403).json({
      error: 'Insufficient permissions to update this user'
    });
  }

  const { error, value } = updateUserProfileSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  try {
    const updatedUser = await AuthService.updateUserProfile(id, value as UserProfileUpdate);
    
    logger.info('User profile updated', {
      updatedUserId: updatedUser.id,
      updatedUserEmail: updatedUser.email,
      updaterUserId: req.user!.id,
      updaterEmail: req.user!.email,
      updaterRole: req.user!.role,
      updatedFields: Object.keys(value)
    });

    return res.json({
      message: 'User profile updated successfully',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
        emailVerified: updatedUser.emailVerified,
        keycloakId: updatedUser.keycloakId
      }
    });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'User not found'
      });
    }
    if (error.message.includes('already taken')) {
      return res.status(409).json({
        error: 'Email is already taken by another user'
      });
    }
    if (error.message.includes('Invalid email format')) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }
    throw error;
  }
}));

/**
 * DELETE /api/users/:id
 * Deactivate user instead of deletion (admin only)
 * Requirements: 5.1
 */
router.delete('/:id', authenticateToken, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Prevent admin from deactivating themselves
  if (req.user!.id === id) {
    return res.status(400).json({
      error: 'Cannot deactivate your own account'
    });
  }

  try {
    // Check if user exists and is currently active
    const user = await AuthService.getUserById(id);
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        error: 'User is already deactivated'
      });
    }

    // Deactivate user instead of deleting
    const result = await DatabaseService.query(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, email, first_name, last_name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const deactivatedUser = result.rows[0];

    // Revoke all refresh tokens for the deactivated user
    await AuthService.revokeAllRefreshTokens(id);

    logger.info('User deactivated by admin', {
      deactivatedUserId: deactivatedUser.id,
      deactivatedUserEmail: deactivatedUser.email,
      adminUserId: req.user!.id,
      adminEmail: req.user!.email
    });

    return res.json({
      message: 'User deactivated successfully',
      user: {
        id: deactivatedUser.id,
        email: deactivatedUser.email,
        firstName: deactivatedUser.first_name,
        lastName: deactivatedUser.last_name,
        isActive: false
      }
    });
  } catch (error: any) {
    throw error;
  }
}));

/**
 * POST /api/users/:id/reactivate
 * Reactivate a deactivated user (admin only)
 * Requirements: 5.1
 */
router.post('/:id/reactivate', authenticateToken, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // Check if user exists and is currently inactive
    const user = await AuthService.getUserById(id);
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    if (user.isActive) {
      return res.status(400).json({
        error: 'User is already active'
      });
    }

    // Reactivate user
    const result = await DatabaseService.query(
      'UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, email, first_name, last_name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const reactivatedUser = result.rows[0];

    logger.info('User reactivated by admin', {
      reactivatedUserId: reactivatedUser.id,
      reactivatedUserEmail: reactivatedUser.email,
      adminUserId: req.user!.id,
      adminEmail: req.user!.email
    });

    return res.json({
      message: 'User reactivated successfully',
      user: {
        id: reactivatedUser.id,
        email: reactivatedUser.email,
        firstName: reactivatedUser.first_name,
        lastName: reactivatedUser.last_name,
        isActive: true
      }
    });
  } catch (error: any) {
    throw error;
  }
}));

export default router;
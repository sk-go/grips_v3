# Implementation Plan

- [x] 1. Update database schema for local authentication










  - Create migration to add password-related columns to users table
  - Add password_reset_tokens table for secure password recovery
  - Update users table to make keycloak_id optional
  - _Requirements: 2.1, 2.2, 5.1_

- [x] 2. Implement password reset token management





  - Create PasswordResetService for generating and validating reset tokens
  - Implement token cleanup functionality for expired tokens
  - Add database queries for password reset token operations
  - _Requirements: 3.1, 3.2, 3.4_

- [x] 3. Enhance AuthService for local authentication








  - Update AuthService to support email/password authentication
  - Implement secure password hashing with bcrypt
  - Add password validation and strength checking
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Create password management functionality





  - Implement password reset initiation and completion
  - Add password change functionality for authenticated users
  - Create email service integration for reset notifications
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Update authentication middleware





  - Modify auth middleware to work with local JWT tokens instead of Keycloak
  - Update token verification to use local JWT secrets
  - Maintain backward compatibility with existing token structure
  - _Requirements: 4.1, 4.2, 4.3, 5.3_

- [x] 6. Create new authentication API routes









  - Implement POST /api/auth/login for direct email/password authentication
  - Add POST /api/auth/password/forgot for password reset initiation
  - Create POST /api/auth/password/reset for password reset completion
  - Add POST /api/auth/password/change for authenticated password changes
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2_

- [x] 7. Implement user management endpoints





  - Create POST /api/users for admin user creation
  - Add user profile update functionality
  - Implement user deactivation instead of deletion
  - _Requirements: 2.2, 5.1_

- [x] 8. Update frontend login form




  - Replace Keycloak redirect button with email/password form
  - Add form validation for email format and password requirements
  - Implement error handling for authentication failures
  - Add loading states and user feedback
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 9. Create password reset frontend components





  - Build ForgotPasswordForm component for email input
  - Create ResetPasswordForm component for new password entry
  - Add ChangePasswordForm for authenticated users
  - Implement proper error handling and success feedback
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 10. Update frontend AuthContext and auth service





  - Modify AuthContext to use direct login instead of redirects
  - Update auth service to call new local authentication endpoints
  - Remove Keycloak-specific code and dependencies
  - Maintain existing authentication state management
  - _Requirements: 1.4, 4.4, 5.2_

- [ ] 11. Create data migration utilities







  - Implement migration service to create default admin user
  - Add utility to migrate existing Keycloak users if present
  - Create validation functions to verify migration success
  - _Requirements: 5.1, 5.2, 5.4_

- [ ] 12. Add comprehensive error handling and rate limiting




  - Implement rate limiting for login attempts to prevent brute force
  - Add proper error messages that don't reveal user enumeration
  - Create consistent error response format across all endpoints
  - _Requirements: 2.4, 1.3_

- [x] 13. Write comprehensive tests for authentication system





  - Create unit tests for AuthService password hashing and validation
  - Add integration tests for complete login and password reset flows
  - Test rate limiting and security measures
  - Write frontend tests for login form and password reset components
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 14. Remove Keycloak dependencies and clean up




  - Remove Keycloak service and related middleware
  - Clean up Keycloak routes and configuration
  - Remove frontend Keycloak auth callback page
  - Update environment variables and documentation
  - _Requirements: 5.2, 5.3_
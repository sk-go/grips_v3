import { AuthService } from '../services/auth';

describe('AuthService', () => {
  describe('Password hashing', () => {
    it('should hash passwords correctly', async () => {
      const password = 'testpassword123';
      const hash = await AuthService.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should verify passwords correctly', async () => {
      const password = 'testpassword123';
      const hash = await AuthService.hashPassword(password);
      
      const isValid = await AuthService.comparePassword(password, hash);
      const isInvalid = await AuthService.comparePassword('wrongpassword', hash);
      
      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });
  });

  describe('JWT tokens', () => {
    const mockPayload = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      email: 'test@example.com',
      role: 'agent'
    };

    it('should generate and verify access tokens', () => {
      const token = AuthService.generateAccessToken(mockPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = AuthService.verifyAccessToken(token);
      expect(decoded.userId).toBe(mockPayload.userId);
      expect(decoded.email).toBe(mockPayload.email);
      expect(decoded.role).toBe(mockPayload.role);
    });

    it('should generate and verify refresh tokens', () => {
      const token = AuthService.generateRefreshToken(mockPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = AuthService.verifyRefreshToken(token);
      expect(decoded.userId).toBe(mockPayload.userId);
      expect(decoded.email).toBe(mockPayload.email);
      expect(decoded.role).toBe(mockPayload.role);
    });

    it('should reject invalid tokens', () => {
      expect(() => {
        AuthService.verifyAccessToken('invalid-token');
      }).toThrow();

      expect(() => {
        AuthService.verifyRefreshToken('invalid-token');
      }).toThrow();
    });
  });
});
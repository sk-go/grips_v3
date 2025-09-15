import { OfficeHoursService } from '../../services/twilio/officeHoursService';
import { DatabaseService } from '../../services/database';
import { OfficeHours, DaySchedule } from '../../types/twilio';

// Mock dependencies
jest.mock('../../services/database', () => ({
  DatabaseService: {
    query: jest.fn(),
    initialize: jest.fn(),
    close: jest.fn(),
    getClient: jest.fn(),
  },
}));

describe('OfficeHoursService', () => {
  let officeHoursService: OfficeHoursService;
  const mockDbService = DatabaseService as jest.Mocked<typeof DatabaseService>;

  const mockOfficeHours: OfficeHours = {
    id: 'test-office-hours-id',
    userId: 'test-user-id',
    timezone: 'America/New_York',
    monday: {
      isWorkingDay: true,
      startTime: '09:00',
      endTime: '17:00',
      breaks: [{ startTime: '12:00', endTime: '13:00' }],
    },
    tuesday: {
      isWorkingDay: true,
      startTime: '09:00',
      endTime: '17:00',
      breaks: [{ startTime: '12:00', endTime: '13:00' }],
    },
    wednesday: {
      isWorkingDay: true,
      startTime: '09:00',
      endTime: '17:00',
      breaks: [{ startTime: '12:00', endTime: '13:00' }],
    },
    thursday: {
      isWorkingDay: true,
      startTime: '09:00',
      endTime: '17:00',
      breaks: [{ startTime: '12:00', endTime: '13:00' }],
    },
    friday: {
      isWorkingDay: true,
      startTime: '09:00',
      endTime: '17:00',
      breaks: [{ startTime: '12:00', endTime: '13:00' }],
    },
    saturday: {
      isWorkingDay: false,
      startTime: '09:00',
      endTime: '17:00',
    },
    sunday: {
      isWorkingDay: false,
      startTime: '09:00',
      endTime: '17:00',
    },
    holidays: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    officeHoursService = new OfficeHoursService(mockDbService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('getOfficeHours', () => {
    it('should return office hours for user', async () => {
      mockDbService.query.mockResolvedValue({
        rows: [{
          id: mockOfficeHours.id,
          user_id: mockOfficeHours.userId,
          timezone: mockOfficeHours.timezone,
          monday: mockOfficeHours.monday,
          tuesday: mockOfficeHours.tuesday,
          wednesday: mockOfficeHours.wednesday,
          thursday: mockOfficeHours.thursday,
          friday: mockOfficeHours.friday,
          saturday: mockOfficeHours.saturday,
          sunday: mockOfficeHours.sunday,
          holidays: mockOfficeHours.holidays,
          is_active: mockOfficeHours.isActive,
          created_at: mockOfficeHours.createdAt,
          updated_at: mockOfficeHours.updatedAt,
        }],
      });

      const result = await officeHoursService.getOfficeHours(mockOfficeHours.userId);

      expect(result).toMatchObject({
        id: mockOfficeHours.id,
        userId: mockOfficeHours.userId,
        timezone: mockOfficeHours.timezone,
      });

      expect(mockDbService.query).toHaveBeenCalledWith(
        'SELECT * FROM office_hours WHERE user_id = $1 AND is_active = true',
        [mockOfficeHours.userId]
      );
    });

    it('should return null if no office hours found', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });

      const result = await officeHoursService.getOfficeHours('non-existent-user');

      expect(result).toBeNull();
    });
  });

  describe('setOfficeHours', () => {
    it('should set new office hours for user', async () => {
      // Mock deactivate existing
      mockDbService.query.mockResolvedValueOnce({ rows: [] });
      
      // Mock insert new
      mockDbService.query.mockResolvedValueOnce({
        rows: [{
          id: 'new-office-hours-id',
          user_id: mockOfficeHours.userId,
          timezone: mockOfficeHours.timezone,
          monday: mockOfficeHours.monday,
          tuesday: mockOfficeHours.tuesday,
          wednesday: mockOfficeHours.wednesday,
          thursday: mockOfficeHours.thursday,
          friday: mockOfficeHours.friday,
          saturday: mockOfficeHours.saturday,
          sunday: mockOfficeHours.sunday,
          holidays: mockOfficeHours.holidays,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const officeHoursData = {
        timezone: mockOfficeHours.timezone,
        monday: mockOfficeHours.monday,
        tuesday: mockOfficeHours.tuesday,
        wednesday: mockOfficeHours.wednesday,
        thursday: mockOfficeHours.thursday,
        friday: mockOfficeHours.friday,
        saturday: mockOfficeHours.saturday,
        sunday: mockOfficeHours.sunday,
        holidays: mockOfficeHours.holidays,
        isActive: true,
      };

      const result = await officeHoursService.setOfficeHours(mockOfficeHours.userId, officeHoursData);

      expect(result).toMatchObject({
        userId: mockOfficeHours.userId,
        timezone: mockOfficeHours.timezone,
      });

      // Should deactivate existing first
      expect(mockDbService.query).toHaveBeenNthCalledWith(1,
        'UPDATE office_hours SET is_active = false WHERE user_id = $1',
        [mockOfficeHours.userId]
      );

      // Then insert new
      expect(mockDbService.query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('INSERT INTO office_hours'),
        expect.arrayContaining([mockOfficeHours.userId, mockOfficeHours.timezone])
      );
    });
  });

  describe('isWithinOfficeHours', () => {
    beforeEach(() => {
      mockDbService.query.mockResolvedValue({
        rows: [{
          id: mockOfficeHours.id,
          user_id: mockOfficeHours.userId,
          timezone: mockOfficeHours.timezone,
          monday: mockOfficeHours.monday,
          tuesday: mockOfficeHours.tuesday,
          wednesday: mockOfficeHours.wednesday,
          thursday: mockOfficeHours.thursday,
          friday: mockOfficeHours.friday,
          saturday: mockOfficeHours.saturday,
          sunday: mockOfficeHours.sunday,
          holidays: mockOfficeHours.holidays,
          is_active: mockOfficeHours.isActive,
          created_at: mockOfficeHours.createdAt,
          updated_at: mockOfficeHours.updatedAt,
        }],
      });
    });

    it('should return true during business hours on weekday', async () => {
      // Tuesday at 10 AM EST
      const businessHourTime = new Date('2023-12-05T15:00:00Z'); // 10 AM EST in UTC
      
      const result = await officeHoursService.isWithinOfficeHours(mockOfficeHours.userId, businessHourTime);

      expect(result).toBe(true);
    });

    it('should return false during lunch break', async () => {
      // Tuesday at 12:30 PM EST (during lunch break)
      const lunchTime = new Date('2023-12-05T17:30:00Z'); // 12:30 PM EST in UTC
      
      const result = await officeHoursService.isWithinOfficeHours(mockOfficeHours.userId, lunchTime);

      expect(result).toBe(false);
    });

    it('should return false on weekend', async () => {
      // Saturday at 10 AM EST
      const weekendTime = new Date('2023-12-09T15:00:00Z'); // Saturday 10 AM EST in UTC
      
      const result = await officeHoursService.isWithinOfficeHours(mockOfficeHours.userId, weekendTime);

      expect(result).toBe(false);
    });

    it('should return false before business hours', async () => {
      // Tuesday at 8 AM EST (before 9 AM start)
      const earlyTime = new Date('2023-12-05T13:00:00Z'); // 8 AM EST in UTC
      
      const result = await officeHoursService.isWithinOfficeHours(mockOfficeHours.userId, earlyTime);

      expect(result).toBe(false);
    });

    it('should return false after business hours', async () => {
      // Tuesday at 6 PM EST (after 5 PM end)
      const lateTime = new Date('2023-12-05T23:00:00Z'); // 6 PM EST in UTC
      
      const result = await officeHoursService.isWithinOfficeHours(mockOfficeHours.userId, lateTime);

      expect(result).toBe(false);
    });

    it('should return true if no office hours configured', async () => {
      mockDbService.query.mockResolvedValue({ rows: [] });
      
      const result = await officeHoursService.isWithinOfficeHours('no-config-user');

      expect(result).toBe(true);
    });

    it('should return false on holidays', async () => {
      const holidayOfficeHours = {
        ...mockOfficeHours,
        holidays: [new Date('2023-12-25')], // Christmas
      };

      mockDbService.query.mockResolvedValue({
        rows: [{
          id: holidayOfficeHours.id,
          user_id: holidayOfficeHours.userId,
          timezone: holidayOfficeHours.timezone,
          monday: holidayOfficeHours.monday,
          tuesday: holidayOfficeHours.tuesday,
          wednesday: holidayOfficeHours.wednesday,
          thursday: holidayOfficeHours.thursday,
          friday: holidayOfficeHours.friday,
          saturday: holidayOfficeHours.saturday,
          sunday: holidayOfficeHours.sunday,
          holidays: holidayOfficeHours.holidays,
          is_active: holidayOfficeHours.isActive,
          created_at: holidayOfficeHours.createdAt,
          updated_at: holidayOfficeHours.updatedAt,
        }],
      });

      // Christmas day at 10 AM EST
      const holidayTime = new Date('2023-12-25T15:00:00Z');
      
      const result = await officeHoursService.isWithinOfficeHours(mockOfficeHours.userId, holidayTime);

      expect(result).toBe(false);
    });
  });

  describe('getDefaultOfficeHours', () => {
    it('should return standard business hours', () => {
      const defaultHours = officeHoursService.getDefaultOfficeHours();

      expect(defaultHours).toMatchObject({
        timezone: 'America/New_York',
        monday: {
          isWorkingDay: true,
          startTime: '09:00',
          endTime: '17:00',
        },
        saturday: {
          isWorkingDay: false,
        },
        sunday: {
          isWorkingDay: false,
        },
        isActive: true,
      });
    });

    it('should accept custom timezone', () => {
      const defaultHours = officeHoursService.getDefaultOfficeHours('America/Los_Angeles');

      expect(defaultHours.timezone).toBe('America/Los_Angeles');
    });
  });
});
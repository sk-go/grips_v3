import { OfficeHours, DaySchedule } from '../../types/twilio';
import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';

export class OfficeHoursService {
  constructor(private dbService: typeof DatabaseService) {}

  public async getOfficeHours(userId: string): Promise<OfficeHours | null> {
    try {
      const query = 'SELECT * FROM office_hours WHERE user_id = $1 AND is_active = true';
      const result = await this.dbService.query(query, [userId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.mapDbRowToOfficeHours(result.rows[0]);
    } catch (error) {
      logger.error(`Failed to get office hours for user ${userId}:`, error);
      throw error;
    }
  }

  public async setOfficeHours(userId: string, officeHours: Omit<OfficeHours, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<OfficeHours> {
    try {
      // Deactivate existing office hours
      await this.dbService.query(
        'UPDATE office_hours SET is_active = false WHERE user_id = $1',
        [userId]
      );

      // Insert new office hours
      const query = `
        INSERT INTO office_hours (
          user_id, timezone, monday, tuesday, wednesday, thursday, friday, saturday, sunday,
          holidays, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
        RETURNING *
      `;

      const result = await this.dbService.query(query, [
        userId,
        officeHours.timezone,
        JSON.stringify(officeHours.monday),
        JSON.stringify(officeHours.tuesday),
        JSON.stringify(officeHours.wednesday),
        JSON.stringify(officeHours.thursday),
        JSON.stringify(officeHours.friday),
        JSON.stringify(officeHours.saturday),
        JSON.stringify(officeHours.sunday),
        JSON.stringify(officeHours.holidays),
        officeHours.isActive,
      ]);

      return this.mapDbRowToOfficeHours(result.rows[0]);
    } catch (error) {
      logger.error(`Failed to set office hours for user ${userId}:`, error);
      throw error;
    }
  }

  public async isWithinOfficeHours(userId: string, timestamp: Date = new Date()): Promise<boolean> {
    try {
      const officeHours = await this.getOfficeHours(userId);
      
      if (!officeHours || !officeHours.isActive) {
        // If no office hours configured, assume always within hours
        return true;
      }

      // Convert timestamp to user's timezone
      const userTime = new Date(timestamp.toLocaleString('en-US', { timeZone: officeHours.timezone }));
      
      // Check if it's a holiday
      const dateOnly = userTime.toISOString().split('T')[0];
      const isHoliday = officeHours.holidays.some(holiday => 
        holiday.toISOString().split('T')[0] === dateOnly
      );
      
      if (isHoliday) {
        return false;
      }

      // Get day of week (0 = Sunday, 1 = Monday, etc.)
      const dayOfWeek = userTime.getDay();
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = dayNames[dayOfWeek] as keyof OfficeHours;
      
      const daySchedule = officeHours[dayName] as DaySchedule;
      
      if (!daySchedule.isWorkingDay) {
        return false;
      }

      // Check if current time is within working hours
      const currentTime = userTime.getHours() * 60 + userTime.getMinutes(); // minutes since midnight
      const startTime = this.timeStringToMinutes(daySchedule.startTime);
      const endTime = this.timeStringToMinutes(daySchedule.endTime);

      if (currentTime < startTime || currentTime > endTime) {
        return false;
      }

      // Check if current time is during a break
      if (daySchedule.breaks) {
        for (const breakSlot of daySchedule.breaks) {
          const breakStart = this.timeStringToMinutes(breakSlot.startTime);
          const breakEnd = this.timeStringToMinutes(breakSlot.endTime);
          
          if (currentTime >= breakStart && currentTime <= breakEnd) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      logger.error(`Failed to check office hours for user ${userId}:`, error);
      // Default to within hours if there's an error
      return true;
    }
  }

  public async getNextBusinessHours(userId: string, fromTime: Date = new Date()): Promise<Date | null> {
    try {
      const officeHours = await this.getOfficeHours(userId);
      
      if (!officeHours || !officeHours.isActive) {
        return null;
      }

      // Start checking from the next minute
      let checkTime = new Date(fromTime.getTime() + 60000);
      const maxDaysToCheck = 14; // Don't check more than 2 weeks ahead
      
      for (let day = 0; day < maxDaysToCheck; day++) {
        const currentCheckTime = new Date(checkTime.getTime() + (day * 24 * 60 * 60 * 1000));
        
        if (await this.isWithinOfficeHours(userId, currentCheckTime)) {
          return currentCheckTime;
        }
        
        // If not within hours, try the start of the next business day
        const userTime = new Date(currentCheckTime.toLocaleString('en-US', { timeZone: officeHours.timezone }));
        const dayOfWeek = userTime.getDay();
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dayOfWeek] as keyof OfficeHours;
        const daySchedule = officeHours[dayName] as DaySchedule;
        
        if (daySchedule.isWorkingDay) {
          const startTime = this.timeStringToMinutes(daySchedule.startTime);
          const nextBusinessStart = new Date(currentCheckTime);
          nextBusinessStart.setHours(Math.floor(startTime / 60), startTime % 60, 0, 0);
          
          if (await this.isWithinOfficeHours(userId, nextBusinessStart)) {
            return nextBusinessStart;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error(`Failed to get next business hours for user ${userId}:`, error);
      return null;
    }
  }

  private timeStringToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private mapDbRowToOfficeHours(row: any): OfficeHours {
    return {
      id: row.id,
      userId: row.user_id,
      timezone: row.timezone,
      monday: row.monday,
      tuesday: row.tuesday,
      wednesday: row.wednesday,
      thursday: row.thursday,
      friday: row.friday,
      saturday: row.saturday,
      sunday: row.sunday,
      holidays: row.holidays.map((date: string) => new Date(date)),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public getDefaultOfficeHours(timezone: string = 'America/New_York'): Omit<OfficeHours, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
    const standardWorkDay: DaySchedule = {
      isWorkingDay: true,
      startTime: '09:00',
      endTime: '17:00',
      breaks: [
        { startTime: '12:00', endTime: '13:00' } // Lunch break
      ],
    };

    const weekend: DaySchedule = {
      isWorkingDay: false,
      startTime: '09:00',
      endTime: '17:00',
    };

    return {
      timezone,
      monday: standardWorkDay,
      tuesday: standardWorkDay,
      wednesday: standardWorkDay,
      thursday: standardWorkDay,
      friday: standardWorkDay,
      saturday: weekend,
      sunday: weekend,
      holidays: [],
      isActive: true,
    };
  }
}
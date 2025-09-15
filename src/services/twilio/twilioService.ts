import { Twilio } from 'twilio';
import { EventEmitter } from 'events';
import { 
  TwilioServiceConfig, 
  PhoneCall, 
  SmsMessage, 
  TwilioWebhookPayload,
  CallTranscriptionResult 
} from '../../types/twilio';
import { Pool } from 'pg';
import { OfficeHoursService } from './officeHoursService';
import { CacheService } from '../cacheService';
import { logger } from '../../utils/logger';

export class TwilioService extends EventEmitter {
  private twilioClient: Twilio;
  private officeHoursService: OfficeHoursService;

  constructor(
    private config: TwilioServiceConfig,
    private dbService: Pool,
    private cacheService: CacheService
  ) {
    super();
    this.twilioClient = new Twilio(config.accountSid, config.authToken);
    this.officeHoursService = new OfficeHoursService(dbService);
  }

  public async setupWebhooks(): Promise<void> {
    try {
      // Configure phone number webhooks
      const phoneNumber = await this.twilioClient.incomingPhoneNumbers.list({
        phoneNumber: this.config.phoneNumber,
      });

      if (phoneNumber.length === 0) {
        throw new Error(`Phone number ${this.config.phoneNumber} not found in Twilio account`);
      }

      const phoneNumberSid = phoneNumber[0].sid;

      // Update webhooks for voice and SMS
      await this.twilioClient.incomingPhoneNumbers(phoneNumberSid).update({
        voiceUrl: `${this.config.webhookBaseUrl}/api/twilio/voice`,
        voiceMethod: 'POST',
        smsUrl: `${this.config.webhookBaseUrl}/api/twilio/sms`,
        smsMethod: 'POST',
        statusCallback: `${this.config.webhookBaseUrl}/api/twilio/status`,
        statusCallbackMethod: 'POST',
      });

      logger.info('Twilio webhooks configured successfully');
    } catch (error) {
      logger.error('Failed to setup Twilio webhooks:', error);
      throw error;
    }
  }

  public async handleIncomingCall(payload: TwilioWebhookPayload): Promise<string> {
    try {
      const { CallSid, From, To, Direction } = payload;
      
      // Determine if call is during office hours
      const userId = await this.getUserIdFromPhoneNumber(To);
      const isOffHours = userId ? !(await this.officeHoursService.isWithinOfficeHours(userId)) : false;

      // Create call record
      const call: Omit<PhoneCall, 'id' | 'createdAt' | 'updatedAt'> = {
        twilioCallSid: CallSid!,
        from: From,
        to: To,
        direction: Direction === 'inbound' ? 'inbound' : 'outbound',
        status: 'ringing',
        tags: [],
        isOffHours,
      };

      const savedCall = await this.saveCall(call);
      
      // Emit event for real-time updates
      this.emit('incomingCall', savedCall);

      // Generate TwiML response
      let twimlResponse = '<?xml version="1.0" encoding="UTF-8"?><Response>';

      if (isOffHours) {
        // Off-hours handling - record voicemail
        twimlResponse += `
          <Say voice="alice">Thank you for calling. We are currently closed. Please leave a message after the tone and we will get back to you as soon as possible.</Say>
          <Record 
            timeout="30" 
            maxLength="300" 
            action="${this.config.webhookBaseUrl}/api/twilio/recording" 
            transcribe="true"
            transcribeCallback="${this.config.webhookBaseUrl}/api/twilio/transcription"
          />
          <Say voice="alice">Thank you for your message. Goodbye.</Say>
        `;
      } else {
        // During office hours - forward to agent or queue
        twimlResponse += `
          <Say voice="alice">Please hold while we connect you to an agent.</Say>
          <Dial timeout="30" action="${this.config.webhookBaseUrl}/api/twilio/dial-status">
            <Queue>support-queue</Queue>
          </Dial>
          <Say voice="alice">All agents are currently busy. Please leave a message after the tone.</Say>
          <Record 
            timeout="30" 
            maxLength="300" 
            action="${this.config.webhookBaseUrl}/api/twilio/recording"
            transcribe="true"
            transcribeCallback="${this.config.webhookBaseUrl}/api/twilio/transcription"
          />
        `;
      }

      twimlResponse += '</Response>';

      return twimlResponse;
    } catch (error) {
      logger.error('Failed to handle incoming call:', error);
      
      // Return error TwiML
      return `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">We're sorry, but we're experiencing technical difficulties. Please try calling back later.</Say>
          <Hangup/>
        </Response>`;
    }
  }

  public async handleIncomingSms(payload: TwilioWebhookPayload): Promise<string> {
    try {
      const { MessageSid, From, To, Body } = payload;
      
      // Determine if SMS is during office hours
      const userId = await this.getUserIdFromPhoneNumber(To);
      const isOffHours = userId ? !(await this.officeHoursService.isWithinOfficeHours(userId)) : false;

      // Create SMS record
      const sms: Omit<SmsMessage, 'id' | 'createdAt' | 'updatedAt'> = {
        twilioMessageSid: MessageSid!,
        from: From,
        to: To,
        direction: 'inbound',
        body: Body || '',
        status: 'received',
        tags: [],
        isOffHours,
      };

      const savedSms = await this.saveSms(sms);
      
      // Try to link to CRM client
      const linkedClientId = await this.linkToClient(savedSms);
      savedSms.clientId = linkedClientId || undefined;
      if (savedSms.clientId) {
        await this.updateSmsClientId(savedSms.id, savedSms.clientId);
      }

      // Emit event for real-time updates
      this.emit('incomingSms', savedSms);

      // Generate auto-response if off-hours
      let twimlResponse = '<?xml version="1.0" encoding="UTF-8"?><Response>';

      if (isOffHours) {
        const nextBusinessHours = userId ? await this.officeHoursService.getNextBusinessHours(userId) : null;
        const responseMessage = nextBusinessHours 
          ? `Thank you for your message. We are currently closed and will respond during our next business hours (${nextBusinessHours.toLocaleString()}). For urgent matters, please call our emergency line.`
          : 'Thank you for your message. We are currently closed and will respond as soon as possible during business hours.';

        twimlResponse += `<Message>${responseMessage}</Message>`;
      }

      twimlResponse += '</Response>';

      return twimlResponse;
    } catch (error) {
      logger.error('Failed to handle incoming SMS:', error);
      
      // Return empty response on error
      return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    }
  }

  public async handleCallStatus(payload: TwilioWebhookPayload): Promise<void> {
    try {
      const { CallSid, CallStatus, Duration } = payload;
      
      if (!CallSid) return;

      // Update call status in database
      const updates: any = { status: CallStatus };
      
      if (Duration) {
        updates.duration = parseInt(Duration, 10);
      }

      if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'no-answer') {
        updates.endTime = new Date();
      }

      await this.updateCall(CallSid, updates);
      
      // Emit status update event
      this.emit('callStatusUpdate', { callSid: CallSid, status: CallStatus, duration: Duration });
      
      logger.info(`Call ${CallSid} status updated to ${CallStatus}`);
    } catch (error) {
      logger.error('Failed to handle call status update:', error);
    }
  }

  public async handleRecording(payload: TwilioWebhookPayload): Promise<void> {
    try {
      const { CallSid, RecordingUrl } = payload;
      
      if (!CallSid || !RecordingUrl) return;

      // Update call with recording URL
      await this.updateCall(CallSid, { recordingUrl: RecordingUrl });
      
      // Emit recording event
      this.emit('callRecorded', { callSid: CallSid, recordingUrl: RecordingUrl });
      
      logger.info(`Recording saved for call ${CallSid}: ${RecordingUrl}`);
    } catch (error) {
      logger.error('Failed to handle recording:', error);
    }
  }

  public async handleTranscription(payload: TwilioWebhookPayload): Promise<void> {
    try {
      const { CallSid, TranscriptionText, TranscriptionStatus } = payload;
      
      if (!CallSid || !TranscriptionText) return;

      // Calculate transcription accuracy (simplified - in production, use more sophisticated methods)
      const accuracy = this.calculateTranscriptionAccuracy(TranscriptionText);
      
      if (accuracy >= this.config.transcriptionAccuracyThreshold) {
        // Update call with transcription
        await this.updateCall(CallSid, { 
          transcription: TranscriptionText,
          transcriptionAccuracy: accuracy 
        });
        
        // Emit transcription event
        this.emit('callTranscribed', { 
          callSid: CallSid, 
          transcription: TranscriptionText, 
          accuracy 
        });
        
        logger.info(`Transcription completed for call ${CallSid} with ${(accuracy * 100).toFixed(1)}% accuracy`);
      } else {
        logger.warn(`Transcription accuracy too low for call ${CallSid}: ${(accuracy * 100).toFixed(1)}%`);
      }
    } catch (error) {
      logger.error('Failed to handle transcription:', error);
    }
  }

  public async sendSms(to: string, body: string, from?: string): Promise<SmsMessage> {
    try {
      const message = await this.twilioClient.messages.create({
        body,
        from: from || this.config.phoneNumber,
        to,
        statusCallback: `${this.config.webhookBaseUrl}/api/twilio/sms-status`,
      });

      const sms: Omit<SmsMessage, 'id' | 'createdAt' | 'updatedAt'> = {
        twilioMessageSid: message.sid,
        from: message.from,
        to: message.to,
        direction: 'outbound',
        body: message.body,
        status: message.status as any,
        dateSent: message.dateSent || undefined,
        tags: [],
        isOffHours: false, // Outbound messages are intentional
      };

      const savedSms = await this.saveSms(sms);
      
      logger.info(`SMS sent to ${to}: ${message.sid}`);
      return savedSms;
    } catch (error) {
      logger.error(`Failed to send SMS to ${to}:`, error);
      throw error;
    }
  }

  public async makeCall(to: string, from?: string): Promise<PhoneCall> {
    try {
      const call = await this.twilioClient.calls.create({
        url: `${this.config.webhookBaseUrl}/api/twilio/outbound-call`,
        to,
        from: from || this.config.phoneNumber,
        statusCallback: `${this.config.webhookBaseUrl}/api/twilio/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        record: this.config.enableRecording,
      });

      const phoneCall: Omit<PhoneCall, 'id' | 'createdAt' | 'updatedAt'> = {
        twilioCallSid: call.sid,
        from: call.from,
        to: call.to,
        direction: 'outbound',
        status: call.status as any,
        startTime: call.startTime || undefined,
        tags: [],
        isOffHours: false, // Outbound calls are intentional
      };

      const savedCall = await this.saveCall(phoneCall);
      
      logger.info(`Call initiated to ${to}: ${call.sid}`);
      return savedCall;
    } catch (error) {
      logger.error(`Failed to make call to ${to}:`, error);
      throw error;
    }
  }

  private async saveCall(call: Omit<PhoneCall, 'id' | 'createdAt' | 'updatedAt'>): Promise<PhoneCall> {
    const query = `
      INSERT INTO phone_calls (
        twilio_call_sid, from_number, to_number, direction, status,
        start_time, end_time, duration, recording_url, transcription,
        transcription_accuracy, client_id, tags, is_off_hours, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      RETURNING *
    `;

    const result = await this.dbService.query(query, [
      call.twilioCallSid,
      call.from,
      call.to,
      call.direction,
      call.status,
      call.startTime,
      call.endTime,
      call.duration,
      call.recordingUrl,
      call.transcription,
      call.transcriptionAccuracy,
      call.clientId,
      JSON.stringify(call.tags),
      call.isOffHours,
    ]);

    return this.mapDbRowToPhoneCall(result.rows[0]);
  }

  private async saveSms(sms: Omit<SmsMessage, 'id' | 'createdAt' | 'updatedAt'>): Promise<SmsMessage> {
    const query = `
      INSERT INTO sms_messages (
        twilio_message_sid, from_number, to_number, direction, body, status,
        media_urls, date_sent, client_id, tags, is_off_hours, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *
    `;

    const result = await this.dbService.query(query, [
      sms.twilioMessageSid,
      sms.from,
      sms.to,
      sms.direction,
      sms.body,
      sms.status,
      JSON.stringify(sms.mediaUrls),
      sms.dateSent,
      sms.clientId,
      JSON.stringify(sms.tags),
      sms.isOffHours,
    ]);

    return this.mapDbRowToSmsMessage(result.rows[0]);
  }

  private async updateCall(twilioCallSid: string, updates: Partial<PhoneCall>): Promise<void> {
    const setParts: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbColumn = this.camelToSnakeCase(key);
        setParts.push(`${dbColumn} = $${paramIndex}`);
        values.push(typeof value === 'object' ? JSON.stringify(value) : value);
        paramIndex++;
      }
    });

    if (setParts.length === 0) return;

    setParts.push(`updated_at = NOW()`);
    values.push(twilioCallSid);

    const query = `UPDATE phone_calls SET ${setParts.join(', ')} WHERE twilio_call_sid = $${paramIndex}`;
    await this.dbService.query(query, values);
  }

  private async updateSmsClientId(smsId: string, clientId: string): Promise<void> {
    const query = 'UPDATE sms_messages SET client_id = $1, updated_at = NOW() WHERE id = $2';
    await this.dbService.query(query, [clientId, smsId]);
  }

  private async getUserIdFromPhoneNumber(phoneNumber: string): Promise<string | null> {
    // This would integrate with user management system
    // For now, return null
    return null;
  }

  private async linkToClient(sms: SmsMessage): Promise<string | null> {
    // This would integrate with CRM service to match phone numbers
    // For now, return null
    return null;
  }

  private calculateTranscriptionAccuracy(transcriptionText: string): number {
    // Simplified accuracy calculation based on text characteristics
    // In production, you'd use more sophisticated methods like comparing with known phrases
    
    const wordCount = transcriptionText.split(/\s+/).length;
    const hasCommonWords = /\b(the|and|is|are|was|were|have|has|will|would|could|should)\b/i.test(transcriptionText);
    const hasProperCapitalization = /^[A-Z]/.test(transcriptionText);
    const hasReasonableLength = wordCount >= 3 && wordCount <= 1000;
    
    let accuracy = 0.7; // Base accuracy
    
    if (hasCommonWords) accuracy += 0.1;
    if (hasProperCapitalization) accuracy += 0.05;
    if (hasReasonableLength) accuracy += 0.1;
    if (wordCount > 10) accuracy += 0.05; // Longer transcriptions tend to be more accurate
    
    return Math.min(accuracy, 1.0);
  }

  private camelToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  private mapDbRowToPhoneCall(row: any): PhoneCall {
    return {
      id: row.id,
      twilioCallSid: row.twilio_call_sid,
      from: row.from_number,
      to: row.to_number,
      direction: row.direction,
      status: row.status,
      startTime: row.start_time,
      endTime: row.end_time,
      duration: row.duration,
      recordingUrl: row.recording_url,
      transcription: row.transcription,
      transcriptionAccuracy: row.transcription_accuracy,
      clientId: row.client_id,
      tags: row.tags || [],
      isOffHours: row.is_off_hours,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapDbRowToSmsMessage(row: any): SmsMessage {
    return {
      id: row.id,
      twilioMessageSid: row.twilio_message_sid,
      from: row.from_number,
      to: row.to_number,
      direction: row.direction,
      body: row.body,
      status: row.status,
      mediaUrls: row.media_urls || [],
      dateSent: row.date_sent,
      clientId: row.client_id,
      tags: row.tags || [],
      isOffHours: row.is_off_hours,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
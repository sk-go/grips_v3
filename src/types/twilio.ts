export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  webhookUrl: string;
  transcriptionWebhookUrl?: string;
}

export interface PhoneCall {
  id: string;
  twilioCallSid: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  status: 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled';
  startTime?: Date;
  endTime?: Date;
  duration?: number; // seconds
  recordingUrl?: string;
  transcription?: string;
  transcriptionAccuracy?: number;
  clientId?: string;
  tags: string[];
  isOffHours: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SmsMessage {
  id: string;
  twilioMessageSid: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'delivered' | 'undelivered' | 'receiving' | 'received';
  mediaUrls?: string[];
  dateSent?: Date;
  clientId?: string;
  tags: string[];
  isOffHours: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OfficeHours {
  id: string;
  userId: string;
  timezone: string;
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
  holidays: Date[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DaySchedule {
  isWorkingDay: boolean;
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  breaks?: TimeSlot[];
}

export interface TimeSlot {
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
}

export interface TwilioWebhookPayload {
  CallSid?: string;
  MessageSid?: string;
  From: string;
  To: string;
  CallStatus?: string;
  MessageStatus?: string;
  Body?: string;
  RecordingUrl?: string;
  TranscriptionText?: string;
  TranscriptionStatus?: string;
  Direction?: string;
  Duration?: string;
  [key: string]: any;
}

export interface CallTranscriptionResult {
  callSid: string;
  transcriptionText: string;
  accuracy: number;
  confidence: number;
  status: 'completed' | 'failed' | 'in-progress';
}

export interface TwilioServiceConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  webhookBaseUrl: string;
  enableRecording: boolean;
  enableTranscription: boolean;
  transcriptionAccuracyThreshold: number; // Minimum accuracy required (0.95 for >95%)
}
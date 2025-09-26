export interface MigrationResult {
  success: boolean;
  message: string;
}

export class MigrationService {
  static async test(): Promise<MigrationResult> {
    return {
      success: true,
      message: 'Test successful'
    };
  }
}
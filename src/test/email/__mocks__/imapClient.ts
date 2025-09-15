export class ImapClient {
  constructor(private account: any) {}

  async connect(): Promise<void> {
    // Mock connection - always succeeds
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    return Promise.resolve();
  }

  async getFolders(): Promise<string[]> {
    return ['INBOX', 'Sent', 'Drafts'];
  }

  async selectFolder(folderName: string): Promise<{ uidvalidity: number; uidnext: number; messages: number }> {
    return {
      uidvalidity: 1,
      uidnext: 100,
      messages: 50,
    };
  }

  async fetchMessages(): Promise<any[]> {
    return [];
  }

  async fetchNewMessages(): Promise<any[]> {
    return [];
  }

  async markAsRead(): Promise<void> {
    return Promise.resolve();
  }

  isConnectionActive(): boolean {
    return true;
  }
}
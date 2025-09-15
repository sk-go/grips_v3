import Imap from 'imap';
import { EventEmitter } from 'events';
import { EmailAccount, EmailMessage, EmailAddress, EmailAttachment } from '../../types/email';
import { logger } from '../../utils/logger';

export class ImapClient extends EventEmitter {
  private imap: Imap | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(private account: EmailAccount) {
    super();
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.imap = new Imap({
          user: this.account.imapConfig.auth.user,
          password: this.account.imapConfig.auth.pass || '',
          xoauth2: this.account.imapConfig.auth.accessToken,
          host: this.account.imapConfig.host,
          port: this.account.imapConfig.port,
          tls: this.account.imapConfig.secure,
          tlsOptions: { rejectUnauthorized: false },
          keepalive: true,
        });

        this.imap!.once('ready', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          logger.info(`IMAP connected for account: ${this.account.email}`);
          resolve();
        });

        this.imap!.once('error', (error: any) => {
          logger.error(`IMAP connection error for ${this.account.email}:`, error);
          this.isConnected = false;
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), 5000 * this.reconnectAttempts);
          } else {
            reject(error);
          }
        });

        this.imap!.once('end', () => {
          logger.info(`IMAP connection ended for account: ${this.account.email}`);
          this.isConnected = false;
        });

        this.imap!.connect();
      } catch (error) {
        logger.error(`Failed to create IMAP connection for ${this.account.email}:`, error);
        reject(error);
      }
    });
  }

  public async disconnect(): Promise<void> {
    if (this.imap && this.isConnected) {
      this.imap.end();
      this.isConnected = false;
    }
  }

  public async getFolders(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.imap || !this.isConnected) {
        reject(new Error('IMAP not connected'));
        return;
      }

      this.imap.getBoxes((error, boxes) => {
        if (error) {
          reject(error);
          return;
        }

        const folderNames: string[] = [];
        const extractFolders = (boxObj: any, prefix = '') => {
          Object.keys(boxObj).forEach(key => {
            const box = boxObj[key];
            const fullName = prefix ? `${prefix}${box.delimiter}${key}` : key;
            
            if (!box.attribs || !box.attribs.includes('\\Noselect')) {
              folderNames.push(fullName);
            }
            
            if (box.children) {
              extractFolders(box.children, fullName);
            }
          });
        };

        extractFolders(boxes);
        resolve(folderNames);
      });
    });
  }

  public async selectFolder(folderName: string): Promise<{ uidvalidity: number; uidnext: number; messages: number }> {
    return new Promise((resolve, reject) => {
      if (!this.imap || !this.isConnected) {
        reject(new Error('IMAP not connected'));
        return;
      }

      this.imap.openBox(folderName, true, (error, box) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          uidvalidity: box.uidvalidity,
          uidnext: box.uidnext,
          messages: box.messages.total,
        });
      });
    });
  }

  public async fetchMessages(
    folder: string,
    criteria: string[] = ['ALL'],
    options: { bodies?: string; struct?: boolean; envelope?: boolean } = {}
  ): Promise<EmailMessage[]> {
    return new Promise((resolve, reject) => {
      if (!this.imap || !this.isConnected) {
        reject(new Error('IMAP not connected'));
        return;
      }

      this.imap.openBox(folder, true, (error) => {
        if (error) {
          reject(error);
          return;
        }

        this.imap!.search(criteria, (searchError, uids) => {
          if (searchError) {
            reject(searchError);
            return;
          }

          if (!uids || uids.length === 0) {
            resolve([]);
            return;
          }

          const messages: EmailMessage[] = [];
          const fetch = this.imap!.fetch(uids, {
            bodies: options.bodies || 'HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID)',
            struct: options.struct !== false,
            envelope: options.envelope !== false,
          });

          fetch.on('message', (msg, seqno) => {
            const message: Partial<EmailMessage> = {
              folder,
              tags: [],
              flags: [],
            };

            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
              stream.once('end', () => {
                if (info.which === 'TEXT') {
                  message.body = { text: buffer };
                } else {
                  // Parse headers
                  const headers = this.parseHeaders(buffer);
                  message.from = this.parseAddresses(headers.from);
                  message.to = this.parseAddresses(headers.to);
                  message.cc = this.parseAddresses(headers.cc);
                  message.bcc = this.parseAddresses(headers.bcc);
                  message.subject = headers.subject || '';
                  message.messageId = headers['message-id'] || '';
                  message.date = new Date(headers.date || Date.now());
                }
              });
            });

            msg.once('attributes', (attrs) => {
              message.uid = attrs.uid;
              message.flags = attrs.flags || [];
              message.isRead = attrs.flags?.includes('\\Seen') || false;
              message.isImportant = attrs.flags?.includes('\\Flagged') || false;
            });

            msg.once('end', () => {
              if (message.uid && message.from) {
                message.id = `${this.account.id}_${message.uid}`;
                message.accountId = this.account.id;
                message.createdAt = new Date();
                message.updatedAt = new Date();
                messages.push(message as EmailMessage);
              }
            });
          });

          fetch.once('error', (fetchError) => {
            reject(fetchError);
          });

          fetch.once('end', () => {
            resolve(messages);
          });
        });
      });
    });
  }

  public async fetchNewMessages(folder: string, lastUid?: number): Promise<EmailMessage[]> {
    const criteria = lastUid ? [`UID ${lastUid + 1}:*`] : ['ALL'];
    return this.fetchMessages(folder, criteria);
  }

  public async markAsRead(folder: string, uid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.imap || !this.isConnected) {
        reject(new Error('IMAP not connected'));
        return;
      }

      this.imap.openBox(folder, false, (error) => {
        if (error) {
          reject(error);
          return;
        }

        this.imap!.addFlags(uid, '\\Seen', (flagError) => {
          if (flagError) {
            reject(flagError);
          } else {
            resolve();
          }
        });
      });
    });
  }

  private parseHeaders(headerText: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const lines = headerText.split('\r\n');
    
    let currentHeader = '';
    let currentValue = '';

    for (const line of lines) {
      if (line.match(/^[a-zA-Z-]+:/)) {
        if (currentHeader) {
          headers[currentHeader.toLowerCase()] = currentValue.trim();
        }
        const [header, ...valueParts] = line.split(':');
        currentHeader = header.trim();
        currentValue = valueParts.join(':').trim();
      } else if (currentHeader && line.startsWith(' ')) {
        currentValue += ' ' + line.trim();
      }
    }

    if (currentHeader) {
      headers[currentHeader.toLowerCase()] = currentValue.trim();
    }

    return headers;
  }

  private parseAddresses(addressString?: string): EmailAddress[] {
    if (!addressString) return [];

    const addresses: EmailAddress[] = [];
    const addressRegex = /(?:"?([^"]*)"?\s)?<?([^<>\s]+@[^<>\s]+)>?/g;
    let match;

    while ((match = addressRegex.exec(addressString)) !== null) {
      addresses.push({
        name: match[1]?.trim() || undefined,
        address: match[2].trim(),
      });
    }

    return addresses;
  }

  public isConnectionActive(): boolean {
    return this.isConnected;
  }
}
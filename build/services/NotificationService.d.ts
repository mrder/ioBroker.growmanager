import type { AlarmRecord, NotificationChannel, NotificationConfig } from '../models/config';
import type { ILogger } from '../utils/logger';
export type SendToFn = (adapter: string, command: string, data: unknown) => void;
export declare class NotificationService {
    private readonly log;
    private readonly sendTo;
    private readonly lastSent;
    constructor(log: ILogger, sendTo: SendToFn);
    /**
     * Prüft und sendet Alarm-Benachrichtigung an alle konfigurierten Kanäle.
     * Nur bei neuen Alarmen (isNew=true) und außerhalb der Cooldown-Zeit.
     */
    notify(alarm: AlarmRecord, isNew: boolean, groupName: string, config: NotificationConfig): Promise<void>;
    sendTest(channel: NotificationChannel): Promise<{
        ok: boolean;
        error?: string;
    }>;
    private sendToChannel;
    private formatText;
    private buildDiscordEmbed;
    private postDiscordWebhook;
    private severityPasses;
    private isQuietHour;
}
//# sourceMappingURL=NotificationService.d.ts.map
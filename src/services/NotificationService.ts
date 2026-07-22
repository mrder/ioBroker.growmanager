// ============================================================
// GrowManager – NotificationService
// Push-Benachrichtigungen via Telegram, WhatsApp, Discord, Signal
// ============================================================

import * as https from 'https';
import type { AlarmRecord, NotificationChannel, NotificationConfig } from '../models/config';
import type { ILogger } from '../utils/logger';

const SEVERITY_EMOJI: Record<string, string> = {
    info:     'ℹ️',
    warning:  '⚠️',
    fault:    '🔥',
    critical: '🚨',
};

const SEVERITY_COLOR: Record<string, number> = {
    info:     0x1976d2,
    warning:  0xfbc02d,
    fault:    0xf57c00,
    critical: 0xd32f2f,
};

export type SendToFn = (adapter: string, command: string, data: unknown) => void;

export class NotificationService {
    // Cooldown: {alarmId → last sent timestamp}
    private readonly lastSent = new Map<string, number>();

    constructor(
        private readonly log: ILogger,
        private readonly sendTo: SendToFn,
    ) {}

    /**
     * Prüft und sendet Alarm-Benachrichtigung an alle konfigurierten Kanäle.
     * Nur bei neuen Alarmen (isNew=true) und außerhalb der Cooldown-Zeit.
     */
    async notify(
        alarm: AlarmRecord,
        isNew: boolean,
        groupName: string,
        config: NotificationConfig,
    ): Promise<void> {
        if (!config.enabled || !isNew) return;

        const cooldownMs = (config.cooldownMinutes ?? 30) * 60_000;
        const lastTs = this.lastSent.get(alarm.id) ?? 0;
        if (Date.now() - lastTs < cooldownMs) return;

        const text = this.formatText(alarm, groupName);
        const embed = this.buildDiscordEmbed(alarm, groupName);

        let sentAtLeastOne = false;
        for (const ch of config.channels) {
            if (!ch.enabled) continue;
            if (!this.severityPasses(alarm.severity, ch.minSeverity)) continue;
            if (this.isQuietHour(ch)) continue;

            try {
                await this.sendToChannel(ch, text, embed);
                sentAtLeastOne = true;
            } catch (err) {
                this.log.error(`NotificationService: Kanal ${ch.id} Fehler: ${err}`);
            }
        }
        // Cooldown immer setzen — auch bei Totalausfall aller Kanäle, damit schnelle
        // raise/clear-Oscillation nicht sofort erneut feuert. Bei echtem Netzfehler
        // sorgt der Cooldown ebenfalls für eine Pause bis zum nächsten Versuch.
        this.lastSent.set(alarm.id, Date.now());
    }

    async sendTest(channel: NotificationChannel): Promise<{ ok: boolean; error?: string }> {
        const fakeAlarm: AlarmRecord = {
            id: 'test', code: 'TEST', groupId: 'test', source: 'NotificationService',
            severity: 'warning', active: true, since: Date.now(), lastUpdate: Date.now(),
            message: 'Dies ist eine Test-Benachrichtigung vom GrowManager. 🌱',
            acknowledged: false, repeatCount: 1,
        };
        const text = this.formatText(fakeAlarm, 'Testgruppe');
        const embed = this.buildDiscordEmbed(fakeAlarm, 'Testgruppe');
        try {
            await this.sendToChannel(channel, text, embed);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: String(err) };
        }
    }

    private stripHtml(html: string): string {
        return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    private async sendToChannel(
        ch: NotificationChannel,
        text: string,
        embed: object,
    ): Promise<void> {
        switch (ch.type) {
            case 'telegram': {
                const instance = ch.telegramInstance ?? '0';
                const payload: Record<string, unknown> = { text, parse_mode: 'HTML' };
                if (ch.telegramChatId) payload.chatId = ch.telegramChatId;
                this.sendTo(`telegram.${instance}`, 'send', payload);
                this.log.info(`Telegram-Notification gesendet (Instanz ${instance})`);
                break;
            }
            case 'whatsapp': {
                const instance = ch.whatsappInstance ?? '0';
                const waPayload: Record<string, string> = { text };
                if (ch.whatsappPhone) waPayload.phone = ch.whatsappPhone;
                this.sendTo(`whatsapp-cmb.${instance}`, 'send', waPayload);
                this.log.info(`WhatsApp-Notification gesendet (Instanz ${instance})`);
                break;
            }
            case 'signal': {
                const instance = ch.signalInstance ?? '0';
                this.sendTo(`signal-cmb.${instance}`, 'send', {
                    text,
                    phone: ch.signalPhone ?? '',
                });
                this.log.info(`Signal-Notification gesendet (Instanz ${instance})`);
                break;
            }
            case 'discord': {
                if (!ch.discordWebhookUrl) throw new Error('Keine Discord-Webhook-URL konfiguriert');
                await this.postDiscordWebhook(ch.discordWebhookUrl, embed);
                this.log.info('Discord-Notification gesendet');
                break;
            }
            case 'pushover': {
                const instance = ch.pushoverInstance ?? '0';
                this.sendTo(`pushover.${instance}`, 'send', {
                    message: this.stripHtml(text),
                    title: 'GrowManager Alarm',
                    sound: 'none',
                });
                this.log.info(`Pushover-Notification gesendet (Instanz ${instance})`);
                break;
            }
        }
    }

    private formatText(alarm: AlarmRecord, groupName: string): string {
        const emoji = SEVERITY_EMOJI[alarm.severity] ?? '⚪';
        const ts = new Date(alarm.since).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
        return [
            `${emoji} <b>GrowManager Alarm</b>`,
            `──────────────────`,
            `Gruppe:   <b>${groupName}</b>`,
            `Code:     <code>${alarm.code}</code>`,
            `Schwere:  <b>${alarm.severity.toUpperCase()}</b>`,
            `──────────────────`,
            alarm.message,
            `──────────────────`,
            ts,
        ].join('\n');
    }

    private buildDiscordEmbed(alarm: AlarmRecord, groupName: string): object {
        const emoji = SEVERITY_EMOJI[alarm.severity] ?? '⚪';
        const color = SEVERITY_COLOR[alarm.severity] ?? 0x4caf50;
        const ts = new Date(alarm.since).toISOString();
        return {
            embeds: [{
                title: `${emoji} GrowManager Alarm – ${alarm.severity.toUpperCase()}`,
                color,
                fields: [
                    { name: 'Gruppe', value: groupName, inline: true },
                    { name: 'Code', value: alarm.code, inline: true },
                    { name: 'Schwere', value: alarm.severity, inline: true },
                    { name: 'Meldung', value: alarm.message, inline: false },
                ],
                timestamp: ts,
                footer: { text: 'GrowManager ioBroker' },
            }],
        };
    }

    private postDiscordWebhook(url: string, body: object): Promise<void> {
        return new Promise((resolve, reject) => {
            const json = JSON.stringify(body);
            const parsed = new URL(url);
            const options: https.RequestOptions = {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(json),
                },
            };
            const req = https.request(options, res => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`Discord Webhook HTTP ${res.statusCode}`));
                } else {
                    resolve();
                }
                res.resume();
            });
            req.on('error', reject);
            req.setTimeout(8000, () => { req.destroy(); reject(new Error('Discord Webhook Timeout')); });
            req.write(json);
            req.end();
        });
    }

    private severityPasses(alarmSev: string, minSev: string): boolean {
        const order = ['info', 'warning', 'fault', 'critical'];
        const minIdx = order.indexOf(minSev);
        if (minIdx === -1) return true; // unbekannter minSeverity → alle durchlassen (Default: info)
        return order.indexOf(alarmSev) >= minIdx;
    }

    private isQuietHour(ch: NotificationChannel): boolean {
        if (!ch.quietHoursEnabled) return false;
        // Intl.DateTimeFormat ist robuster als toLocaleString bei verschiedenen Node/ICU-Versionen.
        // % 24 fängt den '24'-Mitternacht-Fall mancher ICU-Implementierungen ab.
        const h = parseInt(
            new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(new Date()),
            10
        ) % 24;
        const s = ch.quietHoursStart;
        const e = ch.quietHoursEnd;
        if (s <= e) return h >= s && h < e;
        // Overnight (z.B. 22–06)
        return h >= s || h < e;
    }
}

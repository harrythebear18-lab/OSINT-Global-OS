import { OutageEvent, NetworkHealth } from './networkTypes';

export class NotificationService {
  private emailConfig: {
    enabled: boolean;
    recipient: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPassword?: string;
  } | null = null;

  private smsConfig: {
    enabled: boolean;
    recipient: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioPhoneNumber?: string;
  } | null = null;

  setEmailConfig(config: {
    enabled: boolean;
    recipient: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPassword?: string;
  }) {
    this.emailConfig = config;
  }

  setSMSConfig(config: {
    enabled: boolean;
    recipient: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioPhoneNumber?: string;
  }) {
    this.smsConfig = config;
  }

  async sendEmailAlert(subject: string, message: string): Promise<boolean> {
    if (!this.emailConfig?.enabled || !this.emailConfig.recipient) {
      return false;
    }

    // For production, integrate with an SMTP library like nodemailer
    // For now, this is a placeholder that logs the email
    console.log(`[EMAIL] To: ${this.emailConfig.recipient}, Subject: ${subject}`);
    console.log(`[EMAIL] Message: ${message}`);
    
    // TODO: Implement actual SMTP sending using nodemailer
    // This would require adding nodemailer as a dependency
    
    return true;
  }

  async sendSMSAlert(message: string): Promise<boolean> {
    if (!this.smsConfig?.enabled || !this.smsConfig.recipient) {
      return false;
    }

    // For production, integrate with Twilio API
    // For now, this is a placeholder that logs the SMS
    console.log(`[SMS] To: ${this.smsConfig.recipient}, Message: ${message}`);
    
    // TODO: Implement actual SMS sending using Twilio
    // This would require adding twilio as a dependency
    
    return true;
  }

  async sendOutageAlert(outage: OutageEvent): Promise<boolean> {
    const subject = `Network Outage Alert: ${outage.severity.toUpperCase()} - ${outage.type}`;
    const message = `
Network Outage Detected

Type: ${outage.type}
Severity: ${outage.severity}
Description: ${outage.description}
Start Time: ${new Date(outage.startTime).toISOString()}
Scope: ${outage.scope}
ISP: ${outage.isp || 'Unknown'}
Failure Point: ${outage.failurePoint || 'Unknown'}
    `.trim();

    const results = await Promise.allSettled([
      this.sendEmailAlert(subject, message),
      this.sendSMSAlert(message),
    ]);

    return results.some(r => r.status === 'fulfilled' && r.value === true);
  }

  async sendHealthAlert(health: NetworkHealth): Promise<boolean> {
    const subject = `Network Health Alert: ${health.status.toUpperCase()}`;
    const message = `
Network Health Status Changed

Status: ${health.status}
Connectivity Score: ${health.connectivityScore}%
Latency: ${health.latency}ms
Packet Loss: ${health.packetLoss}%
Internet Access: ${health.internetAccess ? 'Yes' : 'No'}
DNS Resolution: ${health.dnsResolution ? 'Yes' : 'No'}
Local Network: ${health.localNetwork ? 'Yes' : 'No'}
    `.trim();

    const results = await Promise.allSettled([
      this.sendEmailAlert(subject, message),
      this.sendSMSAlert(message),
    ]);

    return results.some(r => r.status === 'fulfilled' && r.value === true);
  }
}

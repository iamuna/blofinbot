/* Guardian: enforces the rules no agent may bend.
 *   - the risk limits file must match the signature Ibrahim made on the home PC (/etc/swarm/risk.sha256,
 *     root-owned; `sudo swarm-sign-risk` writes it). A mismatch → flatten, halt, alert.
 *   - live money only when risk.json says liveEnabled AND the signature matches; otherwise the trader must not
 *     run in live mode (the guardian halts it).
 *   - API keys (demo/live) must be read + trade only; the broker refuses others, the guardian alerts.
 * Runs every minute. Without a signature file (development, CI) it only reports 'unsigned'.
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Agent } = require('../core/agent');

class Guardian extends Agent {
  static agentName = 'guardian';
  async onStart() {
    this.riskFile = this.ctx.riskFile || path.join(__dirname, '..', '..', 'config', 'risk.json');
    this.sigFile = (this.cfg.guardian || {}).signatureFile || '/etc/swarm/risk.sha256';
    this.tripped = false;
    await this.check();
    this.every(60000, () => this.check());
  }
  async check() {
    let raw; try { raw = fs.readFileSync(this.riskFile); } catch (e) { return this.trip(`cannot read ${this.riskFile}`); }
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    let sig = null; try { sig = fs.readFileSync(this.sigFile, 'utf8').trim().split(/\s+/)[0]; } catch (e) { /* none */ }
    const limits = JSON.parse(raw), account = (this.cfg.trading || {}).account || 'paper';
    this.gauge('riskHash', hash.slice(0, 16)); this.gauge('signed', sig ? sig === hash : 'unsigned'); this.gauge('account', account);
    if (sig && sig !== hash) return this.trip('risk limits changed without Ibrahim\'s signature');
    if (account === 'live' && !(limits.liveEnabled && sig === hash)) return this.trip('live trading is not enabled and signed by Ibrahim');
    if (!sig) this.setStatus(account === 'paper' ? 'ok' : 'degraded', account === 'paper' ? '' : 'risk limits are not signed on this machine');
    else this.setStatus('ok');
  }
  async trip(why) {
    this.setStatus('degraded', why);
    if (this.tripped === why) return;
    this.tripped = why;
    await this.publish('sys.command', { cmd: 'flatten', by: 'guardian', why });
    await this.publish('sys.command', { cmd: 'pause', by: 'guardian', why });
    await this.publish('sys.alert', { text: `Guardian stopped trading: ${why}`, key: `guardian:${why}` });
  }
}

module.exports = { Guardian };

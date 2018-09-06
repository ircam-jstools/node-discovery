import dgram from 'dgram';
import os from 'os';
import { EventEmitter } from 'events';
import { BROADCAST_PORT } from './config';
import { getTime } from './utils';

const BROADCAST_ADDRESS = '255.255.255.255';
const HANDSHAKE_INTERVAL = 1000;
const MONITOR_INTERVAL = 1000;
const PING_INTERVAL = 1000;

/**
 * Create a client that tries to connect to a DiscoveryServer.
 *
 * @example
 * import { DiscoveryClient } from '@ircam/node-discovery';
 *
 * const client = new DiscoveryClient({
 *   port: BROADCAST_PORT + Math.floor(Math.random() * 1000),
 *   broadcastPort: BROADCAST_PORT,
 *   verbose: true,
 * });
 * client.on('connection', rinfo => console.log('connection', rinfo));
 * client.on('close', () => console.log('close'));
 */
class DiscoveryClient extends EventEmitter {
  constructor({
    port = BROADCAST_PORT,
    broadcastPort = BROADCAST_PORT,
    payload = {},
    verbose = false,
  } = {}) {
    super();

    this.port = port;
    this.broadcastPort = broadcastPort;
    this.payload = payload;
    this.verbose = verbose;

    this.udp = null;
    this.state = 'disconnected';

    this.server = null;
    this.lastSeen = null;

    this.handshakeIntervalId = null;
    this.pingIntervalId = null;
    this.monitorIntervalId = null;

    this._sendHandshake = this._sendHandshake.bind(this);
    this._sendPing = this._sendPing.bind(this);
    this._monitorConnection = this._monitorConnection.bind(this);
  }

  /**
   * Start the client.
   */
  start() {
    this._setupSocket();
  }

  /**
   * Stop the client.
   */
  stop() {
    this.udp.close();
  }

  /**
   * Send a message to the server.
   *
   * @param {String} msg - Message to send.
   */
  send(msg) {
    if (this.udp) {
      const buf = Buffer.from(msg);
      const { port, address } = this.server;

      this.udp.send(buf, 0, buf.length, port, address);
    }
  }

  _setupSocket() {
    this.udp = dgram.createSocket('udp4');

    this.udp.on('message', (buffer, rinfo) => {
      const msg = buffer.toString();

      // socket is used for something else
      if (msg !== '1') {
        // forward message
        // @todo - this is not clean, review...
        this.emit('message', buffer, rinfo);
      } else {
        if (this.state === 'disconnected')
          this._receiveHandshake(msg, rinfo);
        else
          this._receivePong(msg, rinfo);
      }
    });

    this.udp.on('listening', () => {
      this._sendHandshake();
    });

    this.udp.bind(this.port, () => {
      if (this.verbose)
        console.log('binded to port:', this.port);
    });
  }

  _sendHandshake() {
    if (this.verbose)
      console.log('sendHandshake', this.state);

    const msg = Buffer.from('DISCOVERY_HANDSHAKE ' + JSON.stringify(this.payload));
    this.udp.setBroadcast(true);
    this.udp.send(msg, 0, msg.length, this.broadcastPort, BROADCAST_ADDRESS);

    // send handshakes until we have a response from the server
    this.handshakeIntervalId = setTimeout(this._sendHandshake, HANDSHAKE_INTERVAL);
  }

  _receiveHandshake(msg, rinfo) {
    this.state = 'connected';

    clearTimeout(this.handshakeIntervalId);
    this.handshakeIntervalId = null;

    this.udp.setBroadcast(false);
    this.server = rinfo;
    this.lastSeen = getTime();

    this.emit('connection', rinfo);

    if (this.verbose)
      console.log('> connection', this.server);

    this.pingIntervalId = setInterval(this._sendPing, PING_INTERVAL);
    this.monitorIntervalId = setInterval(this._monitorConnection, MONITOR_INTERVAL);
  }

  _sendPing() {
    if (this.verbose)
      console.log('> ping:', this.state);

    const msg = Buffer.from('0');;
    this.udp.send(msg, 0, msg.length, this.server.port, this.server.address);
  }

  _receivePong(msg, rinfo) {
    if (this.verbose)
      console.log('> pong:', this.state);

    this.lastSeen = getTime();
  }

  _monitorConnection() {
    const now = getTime();

    if (this.verbose)
      console.log('> monitorConnection (lastSeen, now):', this.lastSeen, now);

    if (now - this.lastSeen > 4) {
      if (this.verbose)
        console.log('> close', this.server);

      this.emit('close');

      clearInterval(this.pingIntervalId);
      clearInterval(this.monitorIntervalId);
      this.pingIntervalId = null;
      this.monitorIntervalId = null;

      this.server = null;
      this.lastSeen = null;
      this.state = 'disconnected';

      this._sendHandshake();
    }
  }
}

export default DiscoveryClient;

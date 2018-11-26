import dgram from 'dgram';
import os from 'os';
import { EventEmitter } from 'events';
import { BROADCAST_PORT } from './config';
import { getTime } from './utils';

const BROADCAST_ADDRESS = '255.255.255.255';
const DISCOVER_INTERVAL = 1000;
const ACK_TIMEOUT = 4000; // reset connection after duration
const KEEPALIVE_INTERVAL = 1000; // ms

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

    this.broadcast = this.broadcast.bind(this);
    this.messageId = -1; // ID of _last_ message
    this.send = this.send.bind(this);

    this.ackTimeoutId = null; // for aperiodic request

    this.discoverTimeoutId = null; // periodic
    this._sendDiscoverReq = this._sendDiscoverReq.bind(this);
    this._receiveDiscoverAck = this._receiveDiscoverAck.bind(this);

    this._sendConnectReq = this._sendConnectReq.bind(this);
    this._receiveConnectAck = this._receiveConnectAck.bind(this);

    this.keepaliveTimeoutId = null; // periodic
    this._sendKeepaliveReq = this._sendKeepaliveReq.bind(this);
    this._receiveKeepaliveAck = this._receiveKeepaliveAck.bind(this);

    this._resetConnection = this._resetConnection.bind(this);

    this._receiveError = this._receiveError.bind(this);
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

      this.udp.setBroadcast(false);
      this.udp.send(buf, 0, buf.length, port, address);
    }
  }

  broadcast(msg) {
    if (this.udp) {
      const buf = Buffer.from(msg);
      const port =  this.broadcastPort;
      const address= BROADCAST_ADDRESS;

      this.udp.setBroadcast(true);
      this.udp.send(buf, 0, buf.length, port, address);
    }
  }

  _setupSocket() {
    this.udp = dgram.createSocket('udp4');

    this.udp.on('message', (buffer, rinfo) => {
      const msg = buffer.toString().split(' ');

      switch(msg[0]) {
        case 'DISCOVER_ACK': {
          this._receiveDiscoverAck(msg, rinfo);
          break;
        }
        case 'CONNECT_ACK': {
          this._receiveConnectAck(msg, rinfo);
          break;
        }
        case 'KEEPALIVE_ACK': {
          this._receiveKeepaliveAck(msg, rinfo);
          break;
        }
        case 'ERROR': {
          this._receiveError(msg, rinfo);
          break;
        }
        default: {
          // forward messages that are not part of the connection protocol
          this.emit('message', buffer, rinfo);
          break;
        }

      }
    });

    this.udp.on('listening', this._sendDiscoverReq);

    this.udp.bind(this.port, () => {
      if (this.verbose)
        console.log('binded to port:', this.port);
    });
  }

  _sendDiscoverReq() {
    clearTimeout(this.discoverTimeoutId);
    this.messageId += 1;
    const msg = 'DISCOVER_REQ ' + this.messageId;
    this.broadcast(msg);

    // send handshakes until we have a response from the server
    this.discoverTimeoutId = setTimeout(this._sendDiscoverReq, DISCOVER_INTERVAL);
  }

  _receiveDiscoverAck(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    if(this.messageId !== messageId) {
      if(this.verbose) {
        console.log('ignore discover ack ' + msg[1]);
      }
    } else {
      clearTimeout(this.discoverTimeoutId);

      this.server = rinfo;
      if(this.verbose) {
        console.log('> discovered: ', this.server);
      }

      if(this.state !== 'connected') {
        this._sendConnectReq();
      }
    }
  }

  _sendConnectReq() {
    clearTimeout(this.ackTimeoutId);
    this.messageId += 1;
    const msg = 'CONNECT_REQ ' + this.messageId + ' ' + JSON.stringify(this.payload);
    this.send(msg);

    this.ackTimeoutId = setTimeout(this._resetConnection, ACK_TIMEOUT);
  }

  _receiveConnectAck(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    if(this.messageId !== messageId) {
      if(this.verbose) {
        console.log('ignore connect ack ' + msg[1]);
      }
    } else {
      clearTimeout(this.ackTimeoutId);

      this.state = 'connected';
      this._sendKeepaliveReq();
    }
  }

  _sendKeepaliveReq() {
    clearTimeout(this.ackTimeoutId);
    clearTimeout(this.keepaliveTimeoutId);
    this.messageId += 1;
    const msg = 'KEEPALIVE_REQ ' + this.messageId + ' ' + JSON.stringify(this.payload);
    this.send(msg);

    this.ackTimeoutId = setTimeout(this._resetConnection, ACK_TIMEOUT);
  }

  _receiveKeepaliveAck(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    if(this.messageId !== messageId) {
      if(this.verbose) {
        console.log('ignore keepalive ack ' + msg[1]);
      }
    } else {
      clearTimeout(this.ackTimeoutId);
      clearTimeout(this.keepaliveTimeoutId);

      this.keepaliveTimeoutId = setTimeout(this._sendKeepaliveReq, KEEPALIVE_INTERVAL);
    }
  }

  _receiveError(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    if(this.messageId !== messageId) {
      if(this.verbose) {
        console.log('ignore error ' + msg[1]);
      }
    } else {
      this._resetConnection();
      if(this.verbose) {
        console.log('> error: ' + msg);
      }
    }
  }

  _resetConnection() {
    this.messageId += 1; // discard any previous message

    clearTimeout(this.ackTimeoutId);
    clearTimeout(this.discoverTimeoutId);
    clearTimeout(this.keepaliveTimeoutId);

    if(this.state === 'connected') {
      this.emit('close');
    }

    this.state = 'disconnected';
    this.server = null;

    this._sendDiscoverReq();
  }
}

export default DiscoveryClient;
